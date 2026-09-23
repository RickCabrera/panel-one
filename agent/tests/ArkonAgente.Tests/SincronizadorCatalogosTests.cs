using System.Data;
using System.Net;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>Lector de fixtures: lo que "hay en el POS" se cambia desde el test.</summary>
internal sealed class LectorFalso : ILectorCatalogos
{
    public Dictionary<CatalogoPanel, Func<DataTable>> Tablas { get; } = new()
    {
        [CatalogoPanel.Grupos] = () => FixturesSr.Grupos(("G01", "Bebidas"), ("G02", "Postres de café")),
        [CatalogoPanel.Productos] = () => FixturesSr.Productos(
            ("P001", "Chilaquiles", "G01", 89.5000m, false), ("P002", "Flan \"napolitano\"", "G02", 45m, false)),
        [CatalogoPanel.Meseros] = () => FixturesSr.Meseros(("1", "01", "Ana", 1m)),
        [CatalogoPanel.Areas] = () => FixturesSr.Areas(("01", "Terraza", true)),
        [CatalogoPanel.Canales] = () => FixturesSr.Canales(),
        [CatalogoPanel.Clientes] = () => FixturesSr.Clientes(),
        [CatalogoPanel.Unidades] = () => FixturesSr.Unidades("kg", "PZA"),
        [CatalogoPanel.GruposInsumo] = () => FixturesSr.GruposInsumo(("GI1", "Lácteos")),
        [CatalogoPanel.Insumos] = () => FixturesSr.Insumos(("I001", "Leche entera", "GI1", "kg", 1)),
        [CatalogoPanel.Almacenes] = () => FixturesSr.Almacenes(("1", "Almacén general"), ("2", "Barra")),
        [CatalogoPanel.Proveedores] = () => FixturesSr.Proveedores(),
    };

    public HashSet<CatalogoPanel> Fallan { get; } = [];

    public PermisosLectura Permisos { get; set; } = new(true, null);

    public Dictionary<CatalogoPanel, int> Lecturas { get; } = [];

    public int RevisionesPermisos { get; private set; }

    public int Total => Lecturas.Values.Sum();

    public int LecturasDe(CatalogoPanel c) => Lecturas.GetValueOrDefault(c);

    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion)
    {
        RevisionesPermisos++;
        return Task.FromResult(Permisos);
    }

    public Task<LecturaCatalogo> LeerAsync(CatalogoPanel catalogo, CancellationToken cancelacion)
    {
        Lecturas[catalogo] = LecturasDe(catalogo) + 1;
        if (Fallan.Contains(catalogo))
        {
            throw new TimeoutException("la consulta tardó demasiado (simulado)");
        }

        return Task.FromResult(new LecturaCatalogo(MapeoCatalogos.Mapear(catalogo, Tablas[catalogo]().CreateDataReader()), 7));
    }
}

public class SincronizadorCatalogosTests : IDisposable
{
    private static readonly ISoftRestaurantReader Reader = new SrV11Reader(new VersionSr("10.021800", 10));

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new(); // 2026-09-21 12:00 UTC
    private readonly ApiCatalogosFalso _api = new();
    private readonly LogSimple _log = new();
    private readonly LectorFalso _lector = new();
    private readonly ColaCatalogos _cola;
    private readonly SincronizadorCatalogos _sinc;

    public SincronizadorCatalogosTests()
    {
        _cola = ColaCatalogos.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        var config = Datos.Config() with { IntervaloSegundos = 30 };
        _sinc = new SincronizadorCatalogos(
            _cola, new EnviadorCatalogos(_cola, config, _log, _reloj, _api, TimeSpan.FromSeconds(5)),
            _ => _lector, config, TimeZoneInfo.Utc, _reloj, _log);
    }

    public void Dispose()
    {
        _sinc.Dispose();
        _carpeta.Dispose();
    }

    /// <summary>Ciclos de 30 s hasta que la cola de catálogos se vacíe (o un tope).</summary>
    private async Task Ciclos(int n = 1)
    {
        for (var i = 0; i < n; i++)
        {
            await _sinc.CicloAsync(Reader, CancellationToken.None);
            _reloj.Avanzar(TimeSpan.FromSeconds(30));
        }
    }

    private async Task CicloYVaciar()
    {
        await Ciclos();
        for (var i = 0; i < 10 && _cola.ContarPendientes() > 0; i++)
        {
            await Ciclos();
        }
    }

    private void IrAlDiaSiguiente(int hora = 5) =>
        _reloj.Avanzar(new DateTimeOffset(_reloj.Ahora.UtcDateTime.Date.AddDays(1).AddHours(hora), TimeSpan.Zero) - _reloj.Ahora);

    [Fact]
    public async Task La_primera_vez_lee_y_manda_los_once_catalogos_y_el_log_dice_filas_y_tiempo()
    {
        await CicloYVaciar();

        Assert.All(CatalogosPanel.Todos, c => Assert.Equal(1, _lector.LecturasDe(c)));
        var cierres = _api.Envios.Where(p => p.EsCierre).ToDictionary(p => p.Catalogo!, p => p.Cuerpo!.Value.GetProperty("total").GetInt32());
        Assert.Equal(
            new Dictionary<string, int>
            {
                ["grupos"] = 2, ["productos"] = 2, ["meseros"] = 1, ["areas"] = 1, ["canales"] = 0, ["clientes"] = 0,
                ["unidades"] = 2, ["grupos_insumo"] = 1, ["insumos"] = 1, ["almacenes"] = 2, ["proveedores"] = 0,
            },
            cierres);
        // Un catálogo vacío en el POS sólo manda el cierre con total = 0 (sin página vacía).
        Assert.DoesNotContain(_api.Envios, p => p.EsPagina && p.Catalogo is "canales" or "clientes" or "proveedores");
        Assert.All(_api.Envios, p => Assert.Contains(p.Catalogo, CatalogosPanel.Todos.Select(c => c.Texto())));
        // El insumo apunta a la MISMA clave de unidad que manda el catálogo de unidades (F2-241).
        var insumo = _api.Envios.Single(p => p.EsPagina && p.Catalogo == "insumos").Cuerpo!.Value.GetProperty("registros")[0];
        var unidades = _api.Envios.Single(p => p.EsPagina && p.Catalogo == "unidades").Cuerpo!.Value.GetProperty("registros")
            .EnumerateArray().Select(r => r.GetProperty("origenSrId").GetString()).ToList();
        Assert.Contains(insumo.GetProperty("unidadOrigenSrId").GetString(), unidades);
        Assert.Contains(_log.De(LogLevel.Information), m =>
            m.Contains("'productos' leído en SoftRestaurant: 2 registro(s) (2 fila(s)) en 7 ms") && m.Contains("encolado"));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("corrida primera sincronización terminada"));
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Fact]
    public async Task Dos_sincronizaciones_seguidas_sin_cambios_en_el_POS_la_segunda_no_encola_nada()
    {
        await CicloYVaciar();
        var enviosAntes = _api.Envios.Count;

        IrAlDiaSiguiente();
        await Ciclos();

        Assert.All(CatalogosPanel.Todos, c => Assert.Equal(2, _lector.LecturasDe(c))); // sí volvió a leer
        Assert.Equal(0, _cola.ContarPendientes()); // pero no encoló nada
        Assert.Equal(enviosAntes, _api.Envios.Count);
        Assert.Equal(11, _log.De(LogLevel.Information).Count(m => m.Contains("sin cambios, no se encola nada")));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("corrida diaria terminada") && m.Contains("11 sin cambios"));
    }

    [Fact]
    public async Task Solo_se_encola_el_catalogo_que_cambio()
    {
        await CicloYVaciar();
        _lector.Tablas[CatalogoPanel.Productos] = () => FixturesSr.Productos(
            ("P001", "Chilaquiles", "G01", 95m, false), ("P002", "Flan \"napolitano\"", "G02", 45m, false));

        var enviosAntes = _api.Envios.Count;

        IrAlDiaSiguiente();
        await CicloYVaciar();

        var nuevos = _api.Envios.Skip(enviosAntes).ToList();
        Assert.Equal(2, nuevos.Count); // una página + su cierre
        Assert.All(nuevos, p => Assert.Equal("productos", p.Catalogo));
        Assert.Equal("95", nuevos[0].Cuerpo!.Value.GetProperty("registros")[0].GetProperty("precio").GetString());
    }

    [Fact]
    public async Task Antes_de_la_hora_configurada_no_relee_y_despues_si()
    {
        await CicloYVaciar();

        IrAlDiaSiguiente(hora: 3); // 03:00 < 04:00
        await Ciclos();
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Grupos));

        _reloj.Avanzar(TimeSpan.FromHours(1)); // 04:00:30
        await Ciclos();
        Assert.Equal(2, _lector.LecturasDe(CatalogoPanel.Grupos));

        await Ciclos(5); // mismo día: no otra vez
        Assert.Equal(2, _lector.LecturasDe(CatalogoPanel.Grupos));
    }

    [Fact]
    public async Task El_forzado_del_panel_manda_todo_aunque_no_cambie_y_se_atiende_una_sola_vez()
    {
        await CicloYVaciar();
        var enviosAntes = _api.Envios.Count;
        _api.Solicitud = ("2026-09-21T12:10:00.000Z", true);

        _reloj.Avanzar(TimeSpan.FromMinutes(2));
        await CicloYVaciar();

        var forzados = _api.Envios.Skip(enviosAntes).ToList();
        Assert.Equal(11, forzados.Count(p => p.EsCierre)); // los once, inventario incluido (F2-241)
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("corrida forzada desde el panel"));

        // Si el panel lo sigue viendo pendiente (p. ej. un catálogo que falló), no se cicla.
        var lecturas = _lector.Total;
        _reloj.Avanzar(TimeSpan.FromMinutes(5));
        await Ciclos(20);
        Assert.Equal(lecturas, _lector.Total);
        Assert.True(_api.ConsultasSolicitud >= 2);

        // Una solicitud nueva sí se atiende.
        _api.Solicitud = ("2026-09-21T13:00:00.000Z", true);
        _reloj.Avanzar(TimeSpan.FromMinutes(2));
        await Ciclos();
        Assert.Equal(lecturas + 11, _lector.Total);
    }

    [Fact]
    public async Task Una_lectura_que_falla_no_manda_nada_de_ese_catalogo_y_se_reintenta_a_los_15_min()
    {
        _lector.Fallan.Add(CatalogoPanel.Clientes);

        await CicloYVaciar();

        Assert.DoesNotContain(_api.Envios, p => p.Catalogo == "clientes"); // ni siquiera un cierre con 0
        Assert.Contains(_api.Envios, p => p.Catalogo == "grupos");
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("no se pudo leer 'clientes'") && m.Contains("TimeoutException"));
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Clientes));

        await Ciclos(20); // 10 min
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Clientes));
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Grupos)); // el reintento es sólo del que falló

        _lector.Fallan.Clear();
        await Ciclos(12); // pasan los 15 min
        Assert.Equal(2, _lector.LecturasDe(CatalogoPanel.Clientes));
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Grupos));
        Assert.Contains(_api.Envios, p => p.EsCierre && p.Catalogo == "clientes");
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("no se pudo leer"));
    }

    [Fact]
    public async Task Un_400_que_no_se_va_relee_el_POS_a_lo_mas_una_vez_cada_15_min()
    {
        _api.Responder = p => p.Catalogo == "grupos" ? ApiCatalogosFalso.Json(HttpStatusCode.BadRequest, new { }) : null;

        for (var i = 0; i < 120; i++) // 60 min de ciclos de 30 s
        {
            await Ciclos();
        }

        // Al arrancar, y luego una vez por ventana de 15 min (abandono → reintento).
        Assert.InRange(_lector.LecturasDe(CatalogoPanel.Grupos), 2, 5);
        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Productos));
        Assert.False(_cola.HayPendiente(CatalogoPanel.Grupos));
    }

    [Fact]
    public async Task Con_una_sincronizacion_sin_confirmar_en_la_cola_no_se_abre_otra()
    {
        _api.Caido = true;
        await Ciclos();
        Assert.True(_cola.HayPendiente(CatalogoPanel.Grupos));

        IrAlDiaSiguiente();
        await Ciclos();

        Assert.Equal(1, _lector.LecturasDe(CatalogoPanel.Grupos));
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("'grupos' tiene una sincronización sin confirmar"));
    }

    [Theory]
    [InlineData("El usuario SQL puede escribir en SoftRestaurant: db_datawriter.")]
    [InlineData("No se pudieron revisar los permisos del usuario SQL (TimeoutException).")]
    public async Task Sin_usuario_de_solo_lectura_confirmado_no_lee_nada(string mensaje)
    {
        _lector.Permisos = new PermisosLectura(false, mensaje);

        await Ciclos(20); // 10 min

        Assert.Equal(0, _lector.Total);
        Assert.Empty(_api.Envios);
        Assert.Equal(1, _lector.RevisionesPermisos); // no revisa en cada ciclo
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains(mensaje) && m.Contains("SOLO LECTURA"));

        _lector.Permisos = new PermisosLectura(true, null);
        await Ciclos(12);
        Assert.Equal(11, _lector.Total);
    }

    [Fact]
    public async Task Producto_con_varias_filas_de_detalle_cierra_con_el_total_de_registros()
    {
        _lector.Tablas[CatalogoPanel.Productos] = () => FixturesSr.Productos(
            ("P001", "Tacos", "G01", 55m, false), ("P001", "Tacos", "G01", 55m, false), ("P002", "Agua", "G02", 20m, false));

        await CicloYVaciar();

        var cierre = _api.Envios.Single(p => p.EsCierre && p.Catalogo == "productos");
        Assert.Equal(2, cierre.Cuerpo!.Value.GetProperty("total").GetInt32());
        var pagina = _api.Envios.Single(p => p.EsPagina && p.Catalogo == "productos");
        Assert.Equal(2, pagina.Cuerpo!.Value.GetProperty("registros").GetArrayLength());
    }
}
