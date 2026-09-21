using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;

namespace ArkonAgente.Tests;

/// <summary>Datos sintéticos. Nada de aquí es de un cliente real.</summary>
internal static class Datos
{
    public const string ApiKey = "ak_SECRETO_de_prueba_0123456789";
    public const string Password = "P4ss-SECRETA-xyz";
    public const string Cadena =
        "Server=127.0.0.1\\SQLEXPRESS;Database=softrestaurant;User ID=lector;Password=" + Password +
        ";TrustServerCertificate=True";

    public static ConfiguracionAgente Config(string apiUrl = "https://monitor.ejemplo.test") =>
        new(new Uri(apiUrl), ApiKey, Cadena, 30);

    public static string Json(
        string apiUrl = "https://monitor.ejemplo.test",
        string apiKey = ApiKey,
        string cadena = Cadena,
        string? intervalo = null)
    {
        var campos = new List<string>
        {
            $"\"apiUrl\": {Texto(apiUrl)}",
            $"\"apiKey\": {Texto(apiKey)}",
            $"\"connectionString\": {Texto(cadena)}",
        };
        if (intervalo is not null)
        {
            campos.Add($"\"intervaloSegundos\": {intervalo}");
        }

        return "{\n  " + string.Join(",\n  ", campos) + "\n}";
    }

    private static string Texto(string s) => System.Text.Json.JsonSerializer.Serialize(s);
}

/// <summary>Carpeta temporal propia de cada test (los tests corren en paralelo).</summary>
internal sealed class CarpetaTemporal : IDisposable
{
    public CarpetaTemporal()
    {
        Ruta = Path.Combine(Path.GetTempPath(), "arkon-agente-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Ruta);
    }

    public string Ruta { get; }

    public RutasAgente Rutas => new(Ruta);

    public string Escribir(string nombre, string contenido)
    {
        var ruta = Path.Combine(Ruta, nombre);
        File.WriteAllText(ruta, contenido);
        return ruta;
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(Ruta, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}

/// <summary>Verificación con resultado fijo, que cuenta cuántas veces la llamaron.</summary>
internal sealed class VerificacionFija(string nombre, bool ok) : IVerificacion
{
    public int Llamadas { get; private set; }

    public string Nombre { get; } = nombre;

    public Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion)
    {
        Llamadas++;
        return Task.FromResult(ok
            ? ResultadoVerificacion.Bien(Nombre, "funciona")
            : ResultadoVerificacion.Falla(Nombre, "no funciona", "arréglalo"));
    }
}

/// <summary>Verificación que truena con una excepción no prevista.</summary>
internal sealed class VerificacionQueTruena(string nombre) : IVerificacion
{
    public string Nombre { get; } = nombre;

    public Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion) =>
        throw new InvalidCastException("mensaje con " + Datos.Password);
}

/// <summary>Handler HTTP falso: responde con la función dada y guarda la petición.</summary>
internal sealed class HandlerFalso(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder)
    : HttpMessageHandler
{
    public HttpRequestMessage? Ultima { get; private set; }

    public static HandlerFalso Con(System.Net.HttpStatusCode codigo, string cuerpo = "") =>
        new((_, _) => Task.FromResult(new HttpResponseMessage(codigo)
        {
            Content = new StringContent(cuerpo, System.Text.Encoding.UTF8, "application/json"),
        }));

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Ultima = request;
        return responder(request, cancellationToken);
    }
}

/// <summary>Envío que sólo cuenta cuántos ciclos le pidieron y si lo liberaron.</summary>
internal sealed class EnvioFalso : ArkonAgente.Cola.ICicloEnvio
{
    private int _ciclos;

    public int Ciclos => Volatile.Read(ref _ciclos);

    public bool Liberado { get; private set; }

    public Task CicloAsync(CancellationToken cancelacion)
    {
        Interlocked.Increment(ref _ciclos);
        return Task.CompletedTask;
    }

    public void Dispose() => Liberado = true;
}

/// <summary>Reloj que sólo avanza cuando el test lo pide.</summary>
internal sealed class RelojFalso(DateTimeOffset inicio) : TimeProvider
{
    public RelojFalso() : this(new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero))
    {
    }

    public DateTimeOffset Ahora { get; private set; } = inicio;

    public override DateTimeOffset GetUtcNow() => Ahora;

    public void Avanzar(TimeSpan cuanto) => Ahora += cuanto;
}
