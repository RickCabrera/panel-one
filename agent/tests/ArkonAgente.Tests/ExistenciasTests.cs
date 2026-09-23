using System.Data;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Inventario;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>Una petición al API falso de existencias (cuerpo ya inflado).</summary>
internal sealed record PeticionExistencias(string Ruta, string? ApiKey, IReadOnlyList<string> ContentEncoding, JsonElement Cuerpo)
{
    public string Almacen => Cuerpo.GetProperty("almacenOrigenSrId").GetString()!;
}

/// <summary>Simula <c>POST /ingesta/existencias</c> (F2-121): por defecto aplica todo sin rechazos.</summary>
internal sealed class ApiExistenciasFalso : HttpMessageHandler
{
    private readonly object _candado = new();

    public bool Caido { get; set; }

    public Func<PeticionExistencias, HttpResponseMessage?>? Responder { get; set; }

    public List<PeticionExistencias> Peticiones { get; } = [];

    public List<PeticionExistencias> Envios
    {
        get { lock (_candado) { return Peticiones.ToList(); } }
    }

    public static HttpResponseMessage Resultado(
        bool aplicado = true, int recibidos = 0, bool ausentesConservados = false, params object[] rechazados) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                aplicado, recibidos, creados = recibidos, actualizados = 0, sinCambios = 0, borrados = 0, conservados = 0,
                ausentesConservados, rechazados,
            }), Encoding.UTF8, "application/json"),
        };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Caido)
        {
            throw new HttpRequestException("conexión rechazada (simulado)", null, HttpStatusCode.ServiceUnavailable);
        }

        var crudo = await request.Content!.ReadAsByteArrayAsync(cancellationToken);
        using var gzip = new GZipStream(new MemoryStream(crudo), CompressionMode.Decompress);
        using var inflado = new MemoryStream();
        await gzip.CopyToAsync(inflado, cancellationToken);
        var peticion = new PeticionExistencias(
            request.RequestUri!.AbsolutePath,
            request.Headers.TryGetValues("X-Api-Key", out var k) ? k.Single() : null,
            request.Content.Headers.ContentEncoding.ToList(),
            JsonDocument.Parse(inflado.ToArray()).RootElement.Clone());
        lock (_candado)
        {
            Peticiones.Add(peticion);
        }

        return Responder?.Invoke(peticion)
               ?? Resultado(recibidos: peticion.Cuerpo.GetProperty("registros").GetArrayLength());
    }
}

/// <summary>Lector de fixtures: lo que "hay en el POS" se cambia desde el test.</summary>
internal sealed class LectorExistenciasFalso : ILectorExistencias
{
    public Func<DataTable> Tabla { get; set; } = () => FixturesExistencias.Tabla(
        ("1", 0, 1, "I001", 12.5m, 85.4m), ("1", 0, 2, "I002", -2m, 10m), ("2", 0, null, null, null, null));

    /// <summary>Si no es null, la lectura lanza esto (p. ej. el timeout de un comando).</summary>
    public Func<Exception>? Falla { get; set; }

    public PermisosLectura Permisos { get; set; } = new(true, null);

    public int Lecturas { get; private set; }

    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) => Task.FromResult(Permisos);

    public Task<LecturaExistencias> LeerAsync(CancellationToken cancelacion)
    {
        Lecturas++;
        if (Falla is not null)
        {
            throw Falla();
        }

        return Task.FromResult(new LecturaExistencias(MapeoExistencias.Mapear(Tabla().CreateDataReader()), 9));
    }
}

public class ColaExistenciasTests : IDisposable
{
    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();

    public void Dispose() => _carpeta.Dispose();

    private static EnvioExistencias Foto(string almacen, string capturado, int registros = 1) =>
        new(almacen, capturado, registros, $"{{\"almacenOrigenSrId\":\"{almacen}\",\"capturadoAt\":\"{capturado}\",\"registros\":[]}}");

    [Fact]
    public void Una_foto_mas_nueva_reemplaza_a_la_pendiente_de_su_almacen_y_sobrevive_reabrir()
    {
        var cola = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.Guardar([Foto("1", "2026-09-21T12:00:00.000Z"), Foto("2", "2026-09-21T12:00:00.000Z")]);
        _reloj.Avanzar(TimeSpan.FromMinutes(30));
        cola.Guardar([Foto("1", "2026-09-21T12:30:00.000Z", 7)]);

        var reabierta = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        Assert.Equal(2, reabierta.ContarPendientes()); // a lo más una por almacén
        var primera = reabierta.TomarSiguiente()!;
        Assert.Equal(("2", "2026-09-21T12:00:00.000Z"), (primera.Almacen, primera.CapturadoAt));
        reabierta.Quitar(primera);
        var segunda = reabierta.TomarSiguiente()!;
        Assert.Equal(("1", "2026-09-21T12:30:00.000Z", 7), (segunda.Almacen, segunda.CapturadoAt, segunda.Registros));
    }

    [Fact]
    public void Quitar_una_foto_vieja_no_borra_la_nueva_que_llego_mientras_tanto()
    {
        var cola = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.Guardar([Foto("1", "2026-09-21T12:00:00.000Z")]);
        var enviando = cola.TomarSiguiente()!;
        cola.Guardar([Foto("1", "2026-09-21T12:30:00.000Z")]);

        cola.Quitar(enviando);

        Assert.Equal("2026-09-21T12:30:00.000Z", cola.TomarSiguiente()!.CapturadoAt);
    }

    [Fact]
    public void Convive_con_las_tablas_de_catalogos_y_eventos_en_el_mismo_cola_db()
    {
        var eventos = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        var catalogos = ColaCatalogos.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        catalogos.GuardarMarca("catalogos.diaria", "2026-09-21");

        var cola = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.GuardarMarca(SincronizadorExistencias.MarcaUltimaLectura, "x");

        Assert.Equal("2026-09-21", cola.Marca("catalogos.diaria"));
        Assert.Equal("x", catalogos.Marca(SincronizadorExistencias.MarcaUltimaLectura));
        Assert.Equal(0, eventos.ContarPendientes());
    }
}

public class SincronizadorExistenciasTests : IDisposable
{
    private static readonly ISoftRestaurantReader Reader = new SrV11Reader(new VersionSr("10.021800", 10));

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new(); // 2026-09-21 12:00 UTC
    private readonly ApiExistenciasFalso _api = new();
    private readonly LogSimple _log = new();
    private readonly LectorExistenciasFalso _lector = new();
    private readonly ColaExistencias _cola;
    private SincronizadorExistencias _sinc;

    public SincronizadorExistenciasTests()
    {
        _cola = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _sinc = Nuevo();
    }

    private SincronizadorExistencias Nuevo()
    {
        var config = Datos.Config() with { IntervaloSegundos = 30 };
        return new SincronizadorExistencias(
            _cola, new EnviadorExistencias(_cola, config, _log, _reloj, _api, TimeSpan.FromSeconds(5)),
            _ => _lector, config, _reloj, _log);
    }

    public void Dispose()
    {
        _sinc.Dispose();
        _carpeta.Dispose();
    }

    private async Task Ciclos(int n = 1)
    {
        for (var i = 0; i < n; i++)
        {
            await _sinc.CicloAsync(Reader, CancellationToken.None);
            _reloj.Avanzar(TimeSpan.FromSeconds(30));
        }
    }

    [Fact]
    public void Las_existencias_se_leen_cada_30_min_y_se_reintentan_a_los_15()
    {
        Assert.Equal(TimeSpan.FromMinutes(30), SincronizadorExistencias.Intervalo);
        Assert.Equal(TimeSpan.FromMinutes(15), SincronizadorExistencias.EsperaReintento);
    }

    [Fact]
    public async Task Al_arrancar_lee_y_manda_una_foto_por_almacen_con_la_forma_del_contrato()
    {
        await Ciclos();

        Assert.Equal(1, _lector.Lecturas);
        Assert.Equal(["1", "2"], _api.Envios.Select(p => p.Almacen));
        var uno = _api.Envios[0];
        Assert.Equal("/ingesta/existencias", uno.Ruta);
        Assert.Equal(Datos.ApiKey, uno.ApiKey);
        Assert.Equal(["gzip"], uno.ContentEncoding);
        Assert.Equal(["almacenOrigenSrId", "capturadoAt", "registros"], uno.Cuerpo.EnumerateObject().Select(p => p.Name));
        Assert.Equal("2026-09-21T12:00:00.000Z", uno.Cuerpo.GetProperty("capturadoAt").GetString());
        var r = uno.Cuerpo.GetProperty("registros");
        Assert.Equal(["insumoOrigenSrId", "cantidad", "costoPromedio"], r[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(("I002", "-2", "10"),
            (r[1].GetProperty("insumoOrigenSrId").GetString(), r[1].GetProperty("cantidad").GetString(),
             r[1].GetProperty("costoPromedio").GetString())); // la negativa también viaja
        Assert.Equal(0, _api.Envios[1].Cuerpo.GetProperty("registros").GetArrayLength()); // almacén vacío: foto vacía
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Contains(_log.De(LogLevel.Information), m =>
            m.Contains("leídas en SoftRestaurant en 9 ms: 2 almacén(es), 2 registro(s) (3 fila(s)); encoladas 2 foto(s)"));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("foto del almacén 1 aplicada en el panel"));
    }

    [Fact]
    public async Task Relee_cada_30_min_aunque_nada_cambie_y_un_reinicio_no_relee_antes_de_tiempo()
    {
        await Ciclos();
        await Ciclos(58); // 29 min
        Assert.Equal(1, _lector.Lecturas);

        _sinc.Dispose();
        _sinc = Nuevo(); // reinicio del servicio: la marca vive en el SQLite
        await Ciclos(1);
        Assert.Equal(1, _lector.Lecturas);

        await Ciclos(2); // pasan los 30 min
        Assert.Equal(2, _lector.Lecturas);
        Assert.Equal(4, _api.Envios.Count); // sin hash: la foto también dice "sigo leyendo"
    }

    public static TheoryData<string> Fallas => new() { "timeout", "columna" };

    [Theory]
    [MemberData(nameof(Fallas))]
    public async Task Una_lectura_que_falla_no_manda_NINGUNA_foto_se_registra_y_se_reintenta_a_los_15_min(string caso)
    {
        _lector.Falla = caso == "timeout"
            ? () => new TimeoutException("el comando excedió su CommandTimeout (simulado)")
            : () => new InvalidDataException("La consulta no trae la columna 'existencia'.");

        await Ciclos();

        Assert.Empty(_api.Envios); // nunca una foto vacía que vaciaría el almacén en el panel
        Assert.Equal(0, _cola.ContarPendientes());
        var tipo = caso == "timeout" ? "TimeoutException" : "InvalidDataException";
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("no se pudieron leer las existencias") && m.Contains(tipo));

        await Ciclos(28); // 14 min: todavía no
        Assert.Equal(1, _lector.Lecturas);
        _lector.Falla = null;
        await Ciclos(2);
        Assert.Equal(2, _lector.Lecturas);
        Assert.Equal(2, _api.Envios.Count);
        Assert.Single(_log.De(LogLevel.Error)); // el error no se repitió en cada ciclo
    }

    [Fact]
    public async Task Sin_usuario_de_solo_lectura_confirmado_no_lee_nada()
    {
        _lector.Permisos = new PermisosLectura(false, "El usuario SQL puede escribir en SoftRestaurant: db_owner.");

        await Ciclos(40); // 20 min

        Assert.Equal(0, _lector.Lecturas);
        Assert.Empty(_api.Envios);
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("db_owner") && m.Contains("SOLO LECTURA"));
    }

    [Fact]
    public async Task Con_el_API_caido_la_foto_se_conserva_y_una_mas_nueva_la_reemplaza()
    {
        _api.Caido = true;
        await Ciclos();
        Assert.Equal(2, _cola.ContarPendientes());

        await Ciclos(60); // 30 min: otra lectura
        Assert.Equal(2, _lector.Lecturas);
        Assert.Equal(2, _cola.ContarPendientes()); // no crece: una por almacén

        _api.Caido = false;
        await Ciclos(30); // el backoff tope es 10 min
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(2, _api.Envios.Count); // sólo las nuevas
        Assert.All(_api.Envios, p => Assert.Equal("2026-09-21T12:30:00.000Z", p.Cuerpo.GetProperty("capturadoAt").GetString()));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("se restableció el envío"));
    }

    [Fact]
    public async Task Un_400_descarta_la_foto_y_no_atora_el_carril()
    {
        _api.Responder = p => p.Almacen == "1" ? new HttpResponseMessage(HttpStatusCode.BadRequest) : null;

        await Ciclos();

        Assert.Equal(2, _api.Envios.Count);
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("respondió 400 a la foto del almacén 1") && m.Contains("descarta"));
    }

    [Fact]
    public async Task Los_rechazos_y_aplicado_false_van_al_log_sin_valores()
    {
        _api.Responder = p => p.Almacen == "1"
            ? ApiExistenciasFalso.Resultado(recibidos: 2, ausentesConservados: true, rechazados:
                new { indice = 0, insumoOrigenSrId = "I001", motivo = "registros.0.costoPromedio: debe ser un importe", reintentable = false })
            : ApiExistenciasFalso.Resultado(aplicado: false);

        await Ciclos();

        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("rechazó el registro 0 (I001) del almacén 1"));
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("no borró los insumos que faltan"));
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("ignoró la foto del almacén 2"));
        Assert.DoesNotContain("85.4", _log.Todo);
    }

    [Fact]
    public async Task Un_almacen_de_mas_de_5000_registros_no_se_manda_y_los_demas_si()
    {
        var filas = Enumerable.Range(1, MapeoExistencias.MaxRegistrosPorFoto + 1)
            .Select(i => ("2", 0, (int?)i, (string?)$"I{i}", (decimal?)1m, (decimal?)1m))
            .Prepend(("1", 0, (int?)0, (string?)"I0", (decimal?)1m, (decimal?)1m))
            .ToArray();
        _lector.Tabla = () => FixturesExistencias.Tabla(filas);

        await Ciclos();

        Assert.Equal(["1"], _api.Envios.Select(p => p.Almacen));
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("almacén 2 tiene 5001 registros") && m.Contains("NO se manda"));
    }
}
