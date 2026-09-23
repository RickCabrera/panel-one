using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ArkonAgente.Actualizacion;

namespace ArkonAgente.Tests;

/// <summary>Una petición que llegó al canal falso.</summary>
internal sealed record PeticionCanal(HttpMethod Metodo, Uri Url, string? ApiKey, string? Cuerpo);

/// <summary>
/// El canal de versiones LOCAL (F2-143): simula <c>GET /agente/version</c>, la descarga firmada y
/// <c>POST /agente/actualizacion</c> del api, con binarios de prueba sintéticos.
/// </summary>
internal sealed class CanalFalso : HttpMessageHandler
{
    private readonly object _candado = new();
    private readonly List<PeticionCanal> _peticiones = [];

    /// <summary>Null = la sucursal no tiene bandera (o no hay vigente): <c>disponible: false</c>.</summary>
    public string? Version { get; set; }

    /// <summary>Lo que se sirve en la descarga.</summary>
    public byte[] Binario { get; set; } = [];

    /// <summary>El SHA que anuncia el canal; por defecto el del binario (sobrescribirlo simula uno corrupto).</summary>
    public string? ShaAnunciado { get; set; }

    /// <summary>El tamaño que anuncia el canal; por defecto el del binario.</summary>
    public long? TamanoAnunciado { get; set; }

    /// <summary>El enlace que se ofrece (relativo al api, como el real).</summary>
    public string Enlace { get; set; } = "agente/binario/X?expira=1&firma=f";

    public bool ReporteFalla { get; set; }

    public IReadOnlyList<PeticionCanal> Peticiones
    {
        get { lock (_candado) { return _peticiones.ToList(); } }
    }

    public IReadOnlyList<PeticionCanal> Descargas => Peticiones.Where(p => p.Url.AbsolutePath.Contains("/agente/binario/")).ToList();

    public IReadOnlyList<JsonElement> Reportes =>
        Peticiones.Where(p => p.Url.AbsolutePath.EndsWith("/agente/actualizacion", StringComparison.Ordinal))
            .Select(p => JsonDocument.Parse(p.Cuerpo!).RootElement.Clone()).ToList();

    public static string Sha(byte[] datos) => Convert.ToHexString(SHA256.HashData(datos)).ToLowerInvariant();

    /// <summary>Un "agente.exe" de prueba: el texto de su versión y relleno determinista.</summary>
    public static byte[] BinarioDePrueba(string version, int tamano = 50_000)
    {
        var datos = new byte[tamano];
        var cabecera = Encoding.ASCII.GetBytes("AGENTE-" + version + "|");
        for (var i = 0; i < tamano; i++)
        {
            datos[i] = i < cabecera.Length ? cabecera[i] : (byte)((i * 31 + version.Length) % 251);
        }

        return datos;
    }

    /// <summary>La versión "que corre" un binario de prueba (lo que reportaría su heartbeat).</summary>
    public static string? VersionDe(byte[] binario)
    {
        var texto = Encoding.ASCII.GetString(binario, 0, Math.Min(40, binario.Length));
        return texto.StartsWith("AGENTE-", StringComparison.Ordinal) ? texto[7..texto.IndexOf('|')] : null;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var cuerpo = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (_candado)
        {
            _peticiones.Add(new PeticionCanal(
                request.Method,
                request.RequestUri!,
                request.Headers.TryGetValues("X-Api-Key", out var k) ? k.Single() : null,
                cuerpo));
        }

        var ruta = request.RequestUri!.AbsolutePath;
        if (ruta.EndsWith("/agente/version", StringComparison.Ordinal))
        {
            object respuesta = Version is null
                ? new { disponible = false }
                : new
                {
                    disponible = true,
                    version = Version,
                    sha256 = ShaAnunciado ?? Sha(Binario),
                    tamanoBytes = TamanoAnunciado ?? Binario.Length,
                    url = Enlace,
                };
            return ApiFalso.Json(HttpStatusCode.OK, respuesta);
        }

        if (ruta.Contains("/agente/binario/", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Binario) };
        }

        if (ruta.EndsWith("/agente/actualizacion", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(ReporteFalla ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.NoContent);
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}

/// <summary>
/// El administrador de servicios, simulado sobre un exe REAL en disco: al arrancar, "corre" lo
/// que haya en ese archivo. Lleva la cuenta de instancias y FALLA el test si alguna vez hubiera
/// dos (el AC "nunca quedan las dos versiones corriendo").
/// </summary>
internal sealed class ServicioFalso(string exeAgente) : IControlServicio, IProcesos
{
    private int _instancias = 1;
    private int _pollsParaDetener;

    public EstadoServicio EstadoActual { get; private set; } = EstadoServicio.Corriendo;

    /// <summary>El binario que corre ahora (null = detenido).</summary>
    public byte[]? Corriendo { get; private set; } = File.Exists(exeAgente) ? File.ReadAllBytes(exeAgente) : null;

    /// <summary>El servicio ignora el Stop.</summary>
    public bool NoSeDetiene { get; set; }

    /// <summary>El servicio dice Detenido, pero su proceso sigue vivo.</summary>
    public bool ProcesoColgado { get; set; }

    /// <summary>Consultas de estado que tarda en quedar Detenido tras el Stop.</summary>
    public int PollsParaDetener { get; set; }

    /// <summary>Un binario con esta versión se cae a los pocos segundos de arrancar.</summary>
    public string? VersionQueSeCae { get; set; }

    public List<string> Bitacora { get; } = [];

    public int MaxInstancias { get; private set; } = 1;

    public List<string> Violaciones { get; } = [];

    private int _estadosDesdeArranque;

    public EstadoServicio Estado()
    {
        if (EstadoActual == EstadoServicio.EnTransicion && --_pollsParaDetener <= 0)
        {
            EstadoActual = EstadoServicio.Detenido;
            _instancias = ProcesoColgado ? 1 : 0;
            Corriendo = null;
        }

        if (EstadoActual == EstadoServicio.Corriendo && VersionQueSeCae is { } v && Corriendo is { } bin &&
            CanalFalso.VersionDe(bin) == v && ++_estadosDesdeArranque > 3)
        {
            // La versión rota termina sola: el servicio queda detenido y su proceso sale.
            EstadoActual = EstadoServicio.Detenido;
            _instancias = 0;
            Corriendo = null;
            Bitacora.Add("se-cayo");
        }

        return EstadoActual;
    }

    public void Detener()
    {
        Bitacora.Add("detener");
        if (NoSeDetiene)
        {
            return;
        }

        EstadoActual = EstadoServicio.EnTransicion;
        _pollsParaDetener = Math.Max(1, PollsParaDetener);
    }

    public void Arrancar()
    {
        Bitacora.Add("arrancar");
        if (EstadoActual != EstadoServicio.Detenido || _instancias != 0)
        {
            Violaciones.Add($"Arrancar con el servicio {EstadoActual} y {_instancias} proceso(s) vivos");
        }

        _instancias++;
        MaxInstancias = Math.Max(MaxInstancias, _instancias);
        EstadoActual = EstadoServicio.Corriendo;
        Corriendo = File.ReadAllBytes(exeAgente);
        _estadosDesdeArranque = 0;
    }

    public int ContarCorriendo(string rutaExe)
    {
        if (!string.Equals(Path.GetFullPath(rutaExe), Path.GetFullPath(exeAgente), StringComparison.OrdinalIgnoreCase))
        {
            Violaciones.Add("Contó procesos de otra ruta: " + rutaExe);
        }

        return _instancias;
    }
}

/// <summary>Logger en memoria para la auto-actualización.</summary>
internal sealed class LogActualizacion : Microsoft.Extensions.Logging.ILogger
{
    private readonly List<(Microsoft.Extensions.Logging.LogLevel Nivel, string Mensaje)> _entradas = [];

    public IReadOnlyList<string> De(Microsoft.Extensions.Logging.LogLevel nivel)
    {
        lock (_entradas)
        {
            return _entradas.Where(e => e.Nivel == nivel).Select(e => e.Mensaje).ToList();
        }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

    public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId,
        TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        lock (_entradas)
        {
            _entradas.Add((logLevel, formatter(state, exception)));
        }
    }
}
