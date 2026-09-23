using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Inventario;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>Una petición al API falso de inventario (cuerpo ya inflado).</summary>
internal sealed record PeticionInventario(string Ruta, string? ApiKey, IReadOnlyList<string> ContentEncoding, JsonElement Cuerpo)
{
    public string Campo => Ruta.EndsWith("movimientos") ? "polizas" : Ruta.EndsWith("compras") ? "compras" : "recetas";

    public IReadOnlyList<JsonElement> Documentos => Cuerpo.GetProperty(Campo).EnumerateArray().ToList();
}

/// <summary>Simula los tres POST de F2-122/F2-125/F2-126: por defecto acepta todo.</summary>
internal sealed class ApiInventarioFalso : HttpMessageHandler
{
    private readonly object _candado = new();

    public bool Caido { get; set; }

    public Func<PeticionInventario, HttpResponseMessage?>? Responder { get; set; }

    public List<PeticionInventario> Peticiones { get; } = [];

    public List<PeticionInventario> Envios
    {
        get { lock (_candado) { return Peticiones.ToList(); } }
    }

    public List<JsonElement> De(string ruta) => Envios.Where(p => p.Ruta == ruta).SelectMany(p => p.Documentos).ToList();

    public static HttpResponseMessage Resultado(int recibidas, params object[] rechazadas) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new
            {
                recibidas, creadas = recibidas, actualizadas = 0, sinCambios = 0, obsoletas = 0, rechazadas,
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
        var peticion = new PeticionInventario(
            request.RequestUri!.AbsolutePath,
            request.Headers.TryGetValues("X-Api-Key", out var k) ? k.Single() : null,
            request.Content.Headers.ContentEncoding.ToList(),
            JsonDocument.Parse(inflado.ToArray()).RootElement.Clone());
        lock (_candado)
        {
            Peticiones.Add(peticion);
        }

        return Responder?.Invoke(peticion) ?? Resultado(peticion.Documentos.Count);
    }
}

/// <summary>
/// Lector de fixtures: lo que "hay en el POS" se cambia desde el test. Aplica la MISMA regla de ventana
/// que los <c>.sql</c> (movimientos: documentos con alguna fila dentro, completos; compras: por fecha de
/// la cabecera o sin fecha; recetas: todo). La regla real sólo se ha compilado contra una base vacía.
/// </summary>
internal sealed class LectorDocumentosFalso : ILectorDocumentos
{
    public List<FilaMov> Movimientos { get; set; } = [];

    public List<FilaCompra> Compras { get; set; } = [];

    public List<(string? Producto, string? Insumo, decimal? Cantidad, string? Empresa)> Recetas { get; set; } = [];

    public Func<Exception>? Falla { get; set; }

    public PermisosLectura Permisos { get; set; } = new(true, null);

    public List<(TipoDocumentoInventario Tipo, VentanaLectura? Ventana)> Lecturas { get; } = [];

    public VentanaLectura? UltimaVentana(TipoDocumentoInventario tipo) => Lecturas.Last(l => l.Tipo == tipo).Ventana;

    public int Cuantas(TipoDocumentoInventario tipo) => Lecturas.Count(l => l.Tipo == tipo);

    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) => Task.FromResult(Permisos);

    public Task<LecturaDocumentos> LeerAsync(TipoDocumentoInventario tipo, VentanaLectura? ventana, CancellationToken cancelacion)
    {
        Lecturas.Add((tipo, ventana));
        if (Falla is not null)
        {
            throw Falla();
        }

        var leidos = tipo switch
        {
            TipoDocumentoInventario.Movimientos => MapeoMovimientos.Mapear(
                FixturesDocumentos.Movimientos(Elegidas(ventana!)).CreateDataReader(), FixturesDocumentos.Zona),
            TipoDocumentoInventario.Compras => MapeoCompras.Mapear(
                FixturesDocumentos.Compras(Compras.Where(c => c.Fecha is null || c.Fecha >= ventana!.Desde)).CreateDataReader(),
                FixturesDocumentos.Zona),
            _ => MapeoRecetas.Mapear(FixturesDocumentos.Recetas(Recetas).CreateDataReader()),
        };
        return Task.FromResult(new LecturaDocumentos(leidos, 7));
    }

    private List<FilaMov> Elegidas(VentanaLectura v)
    {
        var claves = Movimientos
            .Where(f => f.Fecha is { } x && (f.Cancelado ? x >= v.DesdeCanceladas : x >= v.Desde))
            .Select(FixturesDocumentos.Documento)
            .ToHashSet();
        return Movimientos.Where(f => claves.Contains(FixturesDocumentos.Documento(f))).ToList();
    }
}

public class SincronizadorInventarioTests : IDisposable
{
    private static readonly ISoftRestaurantReader Reader = new SrV11Reader(new VersionSr("10.021800", 10));

    /// <summary>El reloj falso arranca 2026-09-21 12:00 UTC = 06:00 en la hora de SR de las pruebas (UTC−6).</summary>
    private static readonly DateTime AhoraSr = new(2026, 9, 21, 6, 0, 0);

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();
    private readonly ApiInventarioFalso _api = new();
    private readonly LogSimple _log = new();
    private readonly LectorDocumentosFalso _lector = new();
    private readonly ColaInventario _cola;
    private SincronizadorInventario _sinc;

    public SincronizadorInventarioTests()
    {
        _cola = ColaInventario.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _sinc = Nuevo();
    }

    private SincronizadorInventario Nuevo()
    {
        var config = Datos.Config() with { IntervaloSegundos = 30 };
        return new SincronizadorInventario(
            _cola, new EnviadorInventario(_cola, config, _log, _reloj, _api, TimeSpan.FromSeconds(5)),
            _ => _lector, config, FixturesDocumentos.Zona, _reloj, _log);
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

    /// <summary>Hasta la siguiente lectura de movimientos (15 min = 30 ciclos de 30 s).</summary>
    private Task Minutos(int minutos) => Ciclos(minutos * 2);

    private List<JsonElement> Polizas => _api.De("/ingesta/movimientos");

    private static JsonElement Buscar(IEnumerable<JsonElement> docs, string clave) =>
        docs.Last(d => (d.TryGetProperty("origenSrId", out var o) ? o : d.GetProperty("productoOrigenSrId")).GetString() == clave);

    [Fact]
    public void Intervalos_y_ventanas_son_los_decididos()
    {
        Assert.Equal(TimeSpan.FromMinutes(15), SincronizadorDocumentos.Intervalo(TipoDocumentoInventario.Movimientos));
        Assert.Equal(TimeSpan.FromMinutes(30), SincronizadorDocumentos.Intervalo(TipoDocumentoInventario.Compras));
        Assert.Equal(TimeSpan.FromMinutes(60), SincronizadorDocumentos.Intervalo(TipoDocumentoInventario.Recetas));
        Assert.Equal(TimeSpan.FromDays(3), SincronizadorDocumentos.VentanaVivos(TipoDocumentoInventario.Movimientos));
        Assert.Equal(TimeSpan.FromDays(35), SincronizadorDocumentos.VentanaVivos(TipoDocumentoInventario.Compras));
        Assert.Equal(TimeSpan.FromDays(35), SincronizadorDocumentos.VentanaCanceladas);
        Assert.Equal(TimeSpan.FromDays(35), SincronizadorDocumentos.HistoriaInicial);
    }

    [Fact]
    public async Task Al_arrancar_lee_los_tres_tipos_con_la_historia_inicial_y_manda_con_la_forma_del_contrato()
    {
        _lector.Movimientos = [new FilaMov(AhoraSr.AddDays(-1), "SPM", "I1", -1m, 5m, "A01", Movto: 1)];
        _lector.Compras = [new FilaCompra(10, "F10", AhoraSr.AddDays(-2), "PR1", false, "I1", 3m, 4m, "A01")];
        _lector.Recetas = [("P1", "I1", 0.25m, "E1")];

        await Ciclos();

        var inicial = new VentanaLectura(AhoraSr.AddDays(-35), AhoraSr.AddDays(-35));
        Assert.Equal(inicial, _lector.UltimaVentana(TipoDocumentoInventario.Movimientos));
        Assert.Equal(inicial, _lector.UltimaVentana(TipoDocumentoInventario.Compras));
        Assert.Null(_lector.UltimaVentana(TipoDocumentoInventario.Recetas));
        Assert.Equal(["/ingesta/movimientos", "/ingesta/compras", "/ingesta/recetas"], _api.Envios.Select(p => p.Ruta));
        var mov = _api.Envios[0];
        Assert.Equal((Datos.ApiKey, "gzip"), (mov.ApiKey, mov.ContentEncoding.Single()));
        Assert.Equal(["leidoAt", "polizas"], mov.Cuerpo.EnumerateObject().Select(p => p.Name));
        Assert.Equal("2026-09-21T12:00:00.000Z", mov.Cuerpo.GetProperty("leidoAt").GetString());
        Assert.Equal(["leidoAt", "compras"], _api.Envios[1].Cuerpo.EnumerateObject().Select(p => p.Name));
        Assert.Equal(["leidoAt", "recetas"], _api.Envios[2].Cuerpo.EnumerateObject().Select(p => p.Name));
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("Movimientos: leídos en SoftRestaurant en 7 ms: 1 documento(s)"));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("lote de recetas aplicado en el panel"));
    }

    [Fact]
    public async Task El_cursor_sobrevive_reiniciar_no_reprocesa_desde_el_principio_y_la_poliza_del_borde_viaja_completa()
    {
        // Póliza del borde: una fila ANTES de la ventana de 3 días del segundo ciclo y otra dentro.
        var viejo = new FilaMov(AhoraSr.AddDays(-4).AddHours(-1), "SPV", "I1", -1m, 5m, "A01", Cheque: 77);
        var nuevo = new FilaMov(AhoraSr.AddDays(-1), "SPV", "I2", -2m, 6m, "A01", Cheque: 77);
        _lector.Movimientos = [viejo, nuevo];

        await Ciclos();
        Assert.Equal(2, Buscar(Polizas, "V77|A01|SPV").GetProperty("partidas").GetArrayLength());
        Assert.Equal(ApoyoMapeo.FechaSrTexto(AhoraSr.AddDays(-1)),
            _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos)));

        _sinc.Dispose();
        _sinc = Nuevo(); // reinicio del servicio: cursor y hashes viven en cola.db
        await Minutos(15);

        Assert.Equal(new VentanaLectura(AhoraSr.AddDays(-4), AhoraSr.AddDays(-36)),
            _lector.UltimaVentana(TipoDocumentoInventario.Movimientos)); // cursor − 3 d, no la historia inicial
        Assert.Single(_api.Envios, p => p.Ruta == "/ingesta/movimientos"); // nada cambió: nada se reenvía

        // Corrección tardía en la fila VIEJA (fuera de la ventana): la póliza vuelve COMPLETA, nunca a medias.
        _lector.Movimientos = [viejo with { Cantidad = -1.5m }, nuevo];
        await Minutos(15);

        var corregida = Buscar(Polizas, "V77|A01|SPV").GetProperty("partidas");
        Assert.Equal(2, corregida.GetArrayLength());
        Assert.Equal(["-1.5", "-2"], corregida.EnumerateArray().Select(p => p.GetProperty("cantidad").GetString()));
    }

    [Fact]
    public async Task Una_poliza_que_pasa_a_movsinvcancelados_viaja_cancelada_y_una_que_desaparece_viaja_cancelada_una_vez()
    {
        var a = new FilaMov(AhoraSr.AddDays(-1), "SPM", "I1", -1m, 5m, "A01", Movto: 1);
        var b = new FilaMov(AhoraSr.AddHours(-5), "SPM", "I2", -2m, 5m, "A01", Movto: 2);
        _lector.Movimientos = [a, b];
        await Ciclos();

        _lector.Movimientos = [a with { Cancelado = true }]; // a se canceló; b se borró sin dejar rastro
        await Minutos(15);

        var canceladaA = Buscar(Polizas, "M1|A01|SPM");
        Assert.True(canceladaA.GetProperty("cancelada").GetBoolean());
        var ausenteB = Buscar(Polizas, "M2|A01|SPM");
        Assert.True(ausenteB.GetProperty("cancelada").GetBoolean());
        Assert.Equal(1, ausenteB.GetProperty("partidas").GetArrayLength()); // su última versión completa
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("1 que ya no están en SR"));
        var enviados = _api.Envios.Count;

        await Minutos(15);
        Assert.Equal(enviados, _api.Envios.Count); // una sola vez
    }

    [Fact]
    public async Task Una_cancelacion_vieja_que_conserva_la_fecha_original_se_ve_con_la_ventana_amplia()
    {
        var reciente = new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 5m, "A01", Movto: 1);
        var vieja = new FilaMov(AhoraSr.AddDays(-10), "SPM", "I1", -1m, 5m, "A01", Movto: 2);
        _lector.Movimientos = [reciente, vieja];
        await Ciclos();

        _lector.Movimientos = [reciente, vieja with { Cancelado = true }];
        await Minutos(15);

        Assert.True(Buscar(Polizas, "M2|A01|SPM").GetProperty("cancelada").GetBoolean());
        var enviados = _api.Envios.Count;
        await Minutos(15);
        Assert.Equal(enviados, _api.Envios.Count); // sigue en la ventana amplia pero ya no se reenvía
    }

    [Fact]
    public async Task Una_fila_con_fecha_futura_no_congela_el_cursor_y_lo_nuevo_se_sigue_leyendo()
    {
        _lector.Movimientos = [new FilaMov(new DateTime(2099, 1, 1), "SPM", "I1", -1m, 5m, "A01", Movto: 1)];
        await Ciclos();

        var tope = AhoraSr.AddMinutes(5);
        Assert.Equal(ApoyoMapeo.FechaSrTexto(tope), _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos)));
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("en el futuro"));

        _lector.Movimientos.Add(new FilaMov(AhoraSr.AddMinutes(10), "SPM", "I1", -1m, 5m, "A01", Movto: 2));
        await Minutos(15);

        Assert.Equal(tope.AddDays(-3), _lector.UltimaVentana(TipoDocumentoInventario.Movimientos)!.Desde);
        Assert.Contains(Polizas, p => p.GetProperty("origenSrId").GetString() == "M2|A01|SPM");
    }

    [Fact]
    public async Task Un_cursor_guardado_en_el_futuro_se_topa_al_leer()
    {
        _lector.Movimientos = [];
        _cola.Aplicar(TipoDocumentoInventario.Movimientos, [], [], [],
            [(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos), ApoyoMapeo.FechaSrTexto(new DateTime(2099, 1, 1)))]);

        await Ciclos();

        Assert.Equal(AhoraSr.AddMinutes(5).AddDays(-3), _lector.UltimaVentana(TipoDocumentoInventario.Movimientos)!.Desde);
    }

    [Fact]
    public async Task Una_receta_que_SR_ya_no_tiene_viaja_vacia_y_una_en_conflicto_entre_empresas_no()
    {
        _lector.Recetas = [("P1", "I1", 1m, "E1"), ("P2", "I1", 1m, "E1"), ("P3", "I2", 2m, "E1")];
        await Ciclos();
        Assert.Equal(3, _api.De("/ingesta/recetas").Count);

        // P1 se borró en SR; P2 ahora tiene otra versión en una segunda empresa (conflicto).
        _lector.Recetas = [("P2", "I1", 1m, "E1"), ("P2", "I1", 9m, "E2"), ("P3", "I2", 2m, "E1")];
        await Minutos(60);

        var recetas = _api.De("/ingesta/recetas");
        Assert.Equal(4, recetas.Count);
        Assert.Equal(0, Buscar(recetas, "P1").GetProperty("renglones").GetArrayLength());
        Assert.Equal(1, Buscar(recetas, "P2").GetProperty("renglones").GetArrayLength()); // la vieja: no se mandó []
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("varias empresas"));
    }

    [Fact]
    public async Task Una_compra_que_se_cancela_se_reenvia_cancelada()
    {
        var compra = new FilaCompra(10, "F10", AhoraSr.AddDays(-20), null, false, "I1", 1m, 2m, "A01");
        _lector.Compras = [compra];
        await Ciclos();

        _lector.Compras = [compra with { Cancelado = true }];
        await Minutos(30);

        var compras = _api.De("/ingesta/compras");
        Assert.Equal(2, compras.Count);
        Assert.True(compras[1].GetProperty("cancelada").GetBoolean());
        Assert.Equal(1, compras[1].GetProperty("partidas").GetArrayLength());
    }

    [Fact]
    public async Task Los_lotes_se_parten_por_partidas_en_total_y_por_numero_de_documentos()
    {
        var fecha = AhoraSr.AddHours(-1);
        _lector.Movimientos = Enumerable.Range(1, 3)
            .SelectMany(p => Enumerable.Range(1, 2000).Select(i => new FilaMov(fecha, "SPV", $"I{i}", -1m, 1m, "A01", Cheque: p)))
            .ToList();
        _lector.Recetas = Enumerable.Range(1, 501).Select(i => ((string?)$"P{i}", (string?)"I1", (decimal?)1m, (string?)"E1")).ToList();

        await Ciclos(3); // el tope de peticiones por ciclo es 5

        var lotesMov = _api.Envios.Where(p => p.Ruta == "/ingesta/movimientos").ToList();
        Assert.Equal([2, 1], lotesMov.Select(p => p.Documentos.Count));
        Assert.All(lotesMov, p => Assert.True(p.Documentos.Sum(d => d.GetProperty("partidas").GetArrayLength()) <= 5000));
        var lotesRecetas = _api.Envios.Where(p => p.Ruta == "/ingesta/recetas").ToList();
        Assert.Equal([500, 1], lotesRecetas.Select(p => p.Documentos.Count));
    }

    [Fact]
    public async Task Un_documento_de_mas_de_5000_renglones_no_se_manda_ni_cuenta_como_desaparecido()
    {
        var fecha = AhoraSr.AddHours(-1);
        _lector.Compras = Enumerable.Range(1, 5001)
            .Select(i => new FilaCompra(20, "F", fecha, null, false, $"I{i}", 1m, 1m, "A01"))
            .Append(new FilaCompra(21, "F", fecha, null, false, "I1", 1m, 1m, "A01"))
            .ToList();

        await Ciclos();

        Assert.Equal(["21"], _api.De("/ingesta/compras").Select(c => c.GetProperty("origenSrId").GetString()));
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("documento 20 tiene 5001 renglones"));
        await Minutos(30);
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("documento 20")); // no se repite en cada lectura
    }

    [Fact]
    public async Task Una_clave_de_mas_de_64_caracteres_no_se_trunca_ni_se_manda()
    {
        _lector.Movimientos =
        [
            new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 1m, new string('A', 60), Movto: 1),
            new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 1m, "A01", Movto: 2),
        ];

        await Ciclos();

        Assert.Equal(["M2|A01|SPM"], Polizas.Select(p => p.GetProperty("origenSrId").GetString()));
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("clave de 67 caracteres") && m.Contains("no se manda"));
    }

    [Fact]
    public async Task Una_desaparicion_masiva_frena_la_lectura_sin_encolar_nada_ni_mover_el_cursor()
    {
        _lector.Movimientos = Enumerable.Range(1, 6)
            .Select(i => new FilaMov(AhoraSr.AddHours(-i), "SPM", "I1", -1m, 1m, "A01", Movto: i)).ToList();
        await Ciclos();
        var cursor = _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos));
        var enviados = _api.Envios.Count;

        _lector.Movimientos = []; // ¿base restaurada o equivocada?
        await Minutos(15);

        Assert.Equal(enviados, _api.Envios.Count);
        Assert.Equal(cursor, _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos)));
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("faltan 6 de los 6") && m.Contains("NO se encola nada"));
        await Minutos(15);
        Assert.Single(_log.De(LogLevel.Error)); // una vez por mensaje
    }

    [Fact]
    public async Task Pocas_desapariciones_no_frenan()
    {
        _lector.Recetas = Enumerable.Range(1, 10).Select(i => ((string?)$"P{i}", (string?)"I1", (decimal?)1m, (string?)"E1")).ToList();
        await Ciclos();

        _lector.Recetas = _lector.Recetas.Skip(4).ToList(); // 4 de 10
        await Minutos(60);

        Assert.Equal(4, _api.De("/ingesta/recetas").Count(r => r.GetProperty("renglones").GetArrayLength() == 0));
    }

    public static TheoryData<string> Fallas => new() { "timeout", "sql-timeout", "columna" };

    [Theory]
    [MemberData(nameof(Fallas))]
    public async Task Una_lectura_que_falla_no_encola_nada_no_mueve_el_cursor_se_registra_y_se_reintenta_a_los_15_min(string caso)
    {
        _lector.Movimientos = [new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 1m, "A01", Movto: 1)];
        await Ciclos();
        var cursor = _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos));
        _lector.Movimientos = [];
        _lector.Falla = caso switch
        {
            // SIMULADO: prueba el manejo de la excepción, no que SQL Server corte la consulta. Que el
            // timeout sea real lo sostiene la guardia de CrearComando (SoloLecturaTests).
            "timeout" => () => new TimeoutException("el comando excedió su CommandTimeout (simulado)"),
            "sql-timeout" => () => SqlExceptionFalsa.Timeout(),
            _ => () => new InvalidDataException("La consulta no trae la columna 'documento'."),
        };
        var lecturas = _lector.Lecturas.Count;

        await Minutos(15);

        Assert.Single(_api.De("/ingesta/movimientos")); // nada de "desapareció todo"
        Assert.Equal(cursor, _cola.Marca(SincronizadorDocumentos.MarcaCursor(TipoDocumentoInventario.Movimientos)));
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("Movimientos: no se pudieron leer") && m.Contains("cursor no se mueve"));
        var errores = _log.De(LogLevel.Error).Count;
        var intentos = _lector.Lecturas.Count - lecturas;
        await Minutos(10);
        Assert.Equal(intentos, _lector.Lecturas.Count - lecturas); // no reintenta antes de 15 min
        Assert.Equal(errores, _log.De(LogLevel.Error).Count); // ni repite el error
        _lector.Falla = null;
        await Minutos(6);
        Assert.True(_lector.Cuantas(TipoDocumentoInventario.Movimientos) > 2);
    }

    [Fact]
    public async Task Sin_usuario_de_solo_lectura_confirmado_no_lee_nada()
    {
        _lector.Permisos = new PermisosLectura(false, "El usuario SQL puede escribir en SoftRestaurant: db_owner.");

        await Minutos(20);

        Assert.Empty(_lector.Lecturas);
        Assert.Empty(_api.Envios);
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("db_owner") && m.Contains("SOLO LECTURA"));
    }

    [Fact]
    public async Task Un_lote_descartado_con_una_poliza_desaparecida_la_vuelve_a_mandar_cancelada()
    {
        var a = new FilaMov(AhoraSr.AddHours(-2), "SPM", "I1", -1m, 5m, "A01", Movto: 1);
        var b = new FilaMov(AhoraSr.AddHours(-3), "SPM", "I1", -1m, 5m, "A01", Movto: 2);
        _lector.Movimientos = [a, b];
        await Ciclos();

        _lector.Movimientos = [a];
        _api.Responder = _ => new HttpResponseMessage(HttpStatusCode.BadRequest);
        await Minutos(15);
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("respondió 400 al lote de movimientos") && m.Contains("descarta"));
        Assert.Equal(0, _cola.ContarPendientes());

        var rechazadas = _api.Envios.Count; // incluye la petición que respondió 400
        _api.Responder = null;
        await Minutos(15);

        var nuevas = _api.Envios.Skip(rechazadas).Where(p => p.Ruta == "/ingesta/movimientos").ToList();
        Assert.Single(nuevas);
        Assert.True(Buscar(nuevas[0].Documentos, "M2|A01|SPM").GetProperty("cancelada").GetBoolean());
    }

    [Fact]
    public async Task Con_el_API_caido_los_lotes_se_conservan_y_salen_al_volver()
    {
        _lector.Movimientos = [new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 1m, "A01", Movto: 1)];
        _api.Caido = true;
        await Ciclos();
        Assert.Equal(1, _cola.ContarPendientes());

        _api.Caido = false;
        await Minutos(11); // el backoff tope es 10 min

        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Single(_api.Envios);
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("Inventario: se restableció el envío"));
    }

    [Fact]
    public async Task Los_rechazos_van_al_log_sin_valores_y_no_se_reenvian()
    {
        _lector.Movimientos = [new FilaMov(AhoraSr.AddHours(-1), "SPM", "I1", -1m, 85.4m, "A01", Movto: 1)];
        _api.Responder = p => ApiInventarioFalso.Resultado(1,
            new { indice = 0, origenSrId = "M1|A01|SPM", motivo = "polizas.0.partidas.0.costoUnitario: debe ser un importe", reintentable = false });

        await Ciclos();
        await Minutos(15);

        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("rechazó el documento 0 (M1|A01|SPM) del lote de movimientos"));
        Assert.DoesNotContain("85.4", _log.Todo);
        Assert.Single(_api.Envios);
    }
}

/// <summary>
/// Una <see cref="SqlException"/> de timeout (Number −2) armada por reflexión: el tipo no tiene
/// constructor público. SIMULADA: sirve para probar el camino <c>SqlException</c> →
/// <c>ClasificarError</c>, no que SQL Server corte la consulta.
/// </summary>
internal static class SqlExceptionFalsa
{
    public static SqlException Timeout()
    {
        const BindingFlags Todo = BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static;
        var ctorError = typeof(SqlError).GetConstructors(Todo).OrderByDescending(c => c.GetParameters().Length).First();
        var argumentos = ctorError.GetParameters().Select(p => p.Name switch
        {
            "infoNumber" => (object?)(-2),
            "errorMessage" => "Execution Timeout Expired (simulado).",
            "server" or "procedure" => "",
            _ => p.ParameterType.IsValueType ? Activator.CreateInstance(p.ParameterType) : null,
        }).ToArray();
        var error = (SqlError)ctorError.Invoke(argumentos);
        var errores = (SqlErrorCollection)typeof(SqlErrorCollection).GetConstructors(Todo).First().Invoke(null);
        typeof(SqlErrorCollection).GetMethod("Add", Todo)!.Invoke(errores, [error]);
        var crear = typeof(SqlException).GetMethods(Todo)
            .First(m => m.Name == "CreateException" && m.GetParameters().Length == 2
                        && m.GetParameters()[0].ParameterType == typeof(SqlErrorCollection));
        return (SqlException)crear.Invoke(null, [errores, "16.0"])!;
    }
}
