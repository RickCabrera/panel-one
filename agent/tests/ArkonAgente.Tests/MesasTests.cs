using System.Data;
using System.Text.Json;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Mesas;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>
/// Fixtures de <c>sr_mesas_abiertas.sql</c> (F1-023). Reproducen a propósito las cuentas que se vieron
/// en la SR 10 de DEMO local (docs/esquema-sr.md §5: mesas 41 y 42, sus totales y comensales, el
/// folio de ticket 22), con nombres de mesero y producto inventados. No es dato de ningún cliente:
/// es la base de demostración que se operó a mano en F1-090.
/// </summary>
internal static class FixturesMesas
{
    public static DataTable Cuentas(
        params (long Folio, decimal? Numcheque, string? Mesa, string? Mesero, DateTime? Abierto, decimal? Comensales,
            bool? Impreso, decimal? Total)[] filas)
    {
        var t = new DataTable("cuentas");
        t.Columns.Add("folio", typeof(long));
        t.Columns.Add("numcheque", typeof(decimal));
        t.Columns.Add("mesa", typeof(string));
        t.Columns.Add("mesero", typeof(string));
        t.Columns.Add("abierto", typeof(DateTime));
        t.Columns.Add("comensales", typeof(decimal));
        t.Columns.Add("impreso", typeof(bool));
        t.Columns.Add("total", typeof(decimal));
        foreach (var f in filas)
        {
            t.Rows.Add(f.Folio, N(f.Numcheque), N(f.Mesa), N(f.Mesero), N(f.Abierto), N(f.Comensales), N(f.Impreso), N(f.Total));
        }

        return t;
    }

    public static DataTable Partidas(
        params (long Folio, int Movimiento, string Clave, string? Producto, string? Categoria, decimal Cantidad,
            decimal Precio, decimal Descuento, bool Modificador, bool? Comanda)[] filas)
    {
        var t = new DataTable("partidas");
        t.Columns.Add("folio", typeof(long));
        t.Columns.Add("movimiento", typeof(decimal));
        t.Columns.Add("clave", typeof(string));
        t.Columns.Add("producto", typeof(string));
        t.Columns.Add("categoria", typeof(string));
        t.Columns.Add("cantidad", typeof(decimal));
        t.Columns.Add("precio", typeof(decimal));
        t.Columns.Add("descuento", typeof(decimal));
        t.Columns.Add("modificador", typeof(bool));
        t.Columns.Add("comanda_impresa", typeof(bool));
        foreach (var f in filas)
        {
            t.Rows.Add(f.Folio, f.Movimiento, f.Clave, N(f.Producto), N(f.Categoria), f.Cantidad, f.Precio, f.Descuento,
                f.Modificador, N(f.Comanda));
        }

        return t;
    }

    /// <summary>UTC−6 fijo, sin horario de verano: no depende de la zona de la máquina de pruebas.</summary>
    public static readonly TimeZoneInfo Zona =
        TimeZoneInfo.CreateCustomTimeZone("prueba-6", TimeSpan.FromHours(-6), "prueba-6", "prueba-6");

    public static readonly DateTime Apertura = new(2026, 10, 22, 9, 5, 42);

    /// <summary>La forma de lo que se vio: una abierta sin imprimir, una impresa sin cobrar y una dividida.</summary>
    public static (DataTable Cuentas, DataTable Partidas) Tipicas() =>
    (
        Cuentas(
            (2, 0, "41", "MESERO A", Apertura, 3, false, 120.0000m),
            (3, 22, "42", "MESERO A  ", Apertura.AddMinutes(2), 1, true, 75.0000m),
            (5, 0, "15-A", null, Apertura.AddMinutes(4), 1, false, 68.1250m)),
        Partidas(
            (2, 1, "P1", "JARRA", "BEBIDAS", 1.000000m, 80.0000m, 0m, false, true),
            (2, 2, "P2", "AGUA", "BEBIDAS", 1.000000m, 40.0000m, 0m, false, true),
            (3, 1, "P3", "LIMONADA", "BEBIDAS", 2.000000m, 20.0000m, 20m, false, false),
            (3, 2, "M1", "EXTRA HIELO", "BEBIDAS", 1.000000m, 0.0000m, 0m, true, true),
            (9, 1, "P9", "COBRADA ENTRE LECTURAS", null, 1m, 10m, 0m, false, true),
            (5, 1, "M2      ", null, null, 0.750000m, 90.8333m, 0m, true, null))
    );

    public static IDataReader Lector(DataTable cuentas, DataTable partidas) => new DataTableReader([cuentas, partidas]);

    private static object N<T>(T? v) => v is null ? DBNull.Value : v;
}

public class MapeoMesasTests
{
    private static MesasLeidas Tipicas()
    {
        var (c, p) = FixturesMesas.Tipicas();
        return MapeoMesas.Mapear(FixturesMesas.Lector(c, p), FixturesMesas.Zona);
    }

    [Fact]
    public void Una_abierta_sin_imprimir_no_trae_folio_del_ticket_y_su_total_va_a_2_decimales()
    {
        var m = Tipicas().Mesas[0];

        Assert.Equal("2", m.Folio);
        Assert.Null(m.FolioTicket); // numcheque 0 = todavía no se imprime
        Assert.Equal("41", m.Mesa);
        Assert.Equal("MESERO A", m.Mesero);
        Assert.Equal(3, m.Comensales);
        Assert.False(m.Impreso);
        Assert.Equal("120.00", m.Total);
        Assert.Equal(2, m.Partidas.Count);
    }

    [Fact]
    public void Una_impresa_sin_cobrar_trae_el_folio_del_ticket_aparte_y_su_folio_estable_no_cambia()
    {
        var m = Tipicas().Mesas[1];

        Assert.Equal("3", m.Folio);
        Assert.Equal("22", m.FolioTicket);
        Assert.True(m.Impreso);
        Assert.Equal("MESERO A", m.Mesero); // el char de SR viene relleno de espacios
        Assert.Equal("75.00", m.Total);
    }

    [Fact]
    public void La_apertura_es_hora_local_del_POS_y_viaja_en_UTC()
    {
        Assert.Equal("2026-10-22T15:05:42.000Z", Tipicas().Mesas[0].AbiertoAt);
    }

    [Fact]
    public void Una_cuenta_dividida_sale_como_otra_mesa_y_su_total_se_redondea_mitad_lejos_de_cero()
    {
        var m = Tipicas().Mesas[2];

        Assert.Equal("15-A", m.Mesa);
        Assert.Null(m.Mesero);
        Assert.Equal("68.13", m.Total); // 68.1250
    }

    [Fact]
    public void La_partida_lleva_el_descuento_en_porcentaje_ya_aplicado_y_la_cantidad_como_la_lee_el_POS()
    {
        var limonada = Tipicas().Mesas[1].Partidas[0];

        Assert.Equal("LIMONADA", limonada.Producto);
        Assert.Equal("2", limonada.Cantidad);
        Assert.Equal("20.00", limonada.PrecioUnit);
        Assert.Equal("32.00", limonada.Total); // 2 × 20 × (1 − 20/100)
        Assert.False(limonada.ComandaImpresa);
    }

    [Fact]
    public void Un_modificador_cuelga_de_la_partida_anterior_y_no_es_otra_partida()
    {
        var partidas = Tipicas().Mesas[1].Partidas;

        Assert.Single(partidas);
        var modificador = Assert.Single(partidas[0].Modificadores);
        Assert.Equal("EXTRA HIELO", modificador.Nombre);
        Assert.Equal("0.00", modificador.Precio);
    }

    [Fact]
    public void Un_modificador_sin_partida_antes_se_manda_como_partida_con_su_clave_y_lo_avisa()
    {
        var leidas = Tipicas();
        var partida = Assert.Single(leidas.Mesas[2].Partidas);

        Assert.Equal("M2", partida.Producto); // sin nombre de producto: la clave recortada
        Assert.Equal("0.75", partida.Cantidad);
        Assert.Equal("68.12", partida.Total); // 0.75 × 90.8333 = 68.124975
        Assert.Null(partida.ComandaImpresa);
        Assert.Contains(leidas.Avisos, a => a.Contains("sin partida antes"));
    }

    [Fact]
    public void La_comanda_impresa_sale_de_comanda_impresa_por_partida()
    {
        Assert.All(Tipicas().Mesas[0].Partidas, p => Assert.True(p.ComandaImpresa));
    }

    [Fact]
    public void Una_partida_de_una_cuenta_que_ya_no_esta_en_las_cuentas_se_ignora()
    {
        Assert.DoesNotContain(Tipicas().Mesas.SelectMany(m => m.Partidas), p => p.Producto == "COBRADA ENTRE LECTURAS");
    }

    [Fact]
    public void Una_cuenta_repetida_por_un_mesero_duplicado_se_toma_una_vez_y_se_avisa()
    {
        var cuentas = FixturesMesas.Cuentas(
            (7, 0, "7", "UNO", FixturesMesas.Apertura, 2, false, 10m),
            (7, 0, "7", "OTRO", FixturesMesas.Apertura, 2, false, 10m));

        var leidas = MapeoMesas.Mapear(FixturesMesas.Lector(cuentas, FixturesMesas.Partidas()), FixturesMesas.Zona);

        Assert.Equal("UNO", Assert.Single(leidas.Mesas).Mesero);
        Assert.Contains(leidas.Avisos, a => a.Contains("repetidas"));
    }

    [Fact]
    public void Sin_el_resultado_de_partidas_la_lectura_falla_en_vez_de_mandar_cuentas_sin_partidas()
    {
        var (c, _) = FixturesMesas.Tipicas();

        Assert.Throws<InvalidDataException>(() => MapeoMesas.Mapear(new DataTableReader(c), FixturesMesas.Zona));
    }

    [Fact]
    public void El_payload_tiene_la_forma_que_lee_el_panel()
    {
        var capturadoAt = new DateTimeOffset(2026, 10, 22, 15, 30, 0, TimeSpan.Zero);
        using var json = JsonDocument.Parse(MapeoMesas.Payload(Tipicas().Mesas, capturadoAt));
        var raiz = json.RootElement;

        Assert.Equal("2026-10-22T15:30:00.000Z", raiz.GetProperty("capturadoAt").GetString());
        var mesa = raiz.GetProperty("mesas")[1];
        Assert.Equal("3", mesa.GetProperty("folio").GetString());
        Assert.Equal("22", mesa.GetProperty("folioTicket").GetString());
        Assert.Equal("42", mesa.GetProperty("mesa").GetString());
        Assert.Equal(1, mesa.GetProperty("comensales").GetInt32());
        Assert.True(mesa.GetProperty("impreso").GetBoolean());
        Assert.Equal("75.00", mesa.GetProperty("total").GetString());
        var partida = mesa.GetProperty("partidas")[0];
        Assert.Equal("32.00", partida.GetProperty("total").GetString());
        Assert.False(partida.GetProperty("comandaImpresa").GetBoolean());
        Assert.Equal("EXTRA HIELO", partida.GetProperty("modificadores")[0].GetProperty("nombre").GetString());
        Assert.Equal(JsonValueKind.Null, raiz.GetProperty("mesas")[0].GetProperty("folioTicket").ValueKind);
    }

    [Fact]
    public void Sin_cuentas_abiertas_el_snapshot_va_vacio_no_se_omite()
    {
        var leidas = MapeoMesas.Mapear(
            FixturesMesas.Lector(FixturesMesas.Cuentas(), FixturesMesas.Partidas()), FixturesMesas.Zona);
        using var json = JsonDocument.Parse(MapeoMesas.Payload(leidas.Mesas, DateTimeOffset.UnixEpoch));

        Assert.Equal(0, json.RootElement.GetProperty("mesas").GetArrayLength());
    }
}

public class ConsultaMesasAbiertasTests
{
    /// <summary>
    /// Las cobradas del turno siguen en <c>tempcheques</c> hasta el corte (§2): si alguien quita el
    /// filtro, saldrían como mesas abiertas. Los dos resultados (cuentas y partidas) lo traen.
    /// </summary>
    [Fact]
    public void Los_dos_resultados_excluyen_las_cuentas_cobradas_y_las_canceladas()
    {
        var sql = string.Join('\n', ConsultasEmbebidas.Leer("sr_mesas_abiertas").Split('\n')
            .Where(l => !l.TrimStart().StartsWith("--", StringComparison.Ordinal)));
        var selects = sql.Split("SELECT", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        Assert.Equal(2, selects.Length);
        Assert.All(selects, s =>
        {
            Assert.Contains("ISNULL(c.pagado, 0) = 0", s, StringComparison.Ordinal);
            Assert.Contains("ISNULL(c.cancelado, 0) = 0", s, StringComparison.Ordinal);
        });
    }
}

public class SincronizadorMesasTests
{
    private sealed class LectorFalso : ILectorMesas
    {
        public PermisosLectura Permisos { get; set; } = new(true, null);
        public Func<LecturaMesas> Leer { get; set; } = () =>
        {
            var (c, p) = FixturesMesas.Tipicas();
            return new LecturaMesas(MapeoMesas.Mapear(FixturesMesas.Lector(c, p), FixturesMesas.Zona), 3);
        };

        public int Revisiones { get; private set; }
        public int Lecturas { get; private set; }

        public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion)
        {
            Revisiones++;
            return Task.FromResult(Permisos);
        }

        public Task<LecturaMesas> LeerAsync(CancellationToken cancelacion)
        {
            Lecturas++;
            return Task.FromResult(Leer());
        }
    }

    private sealed class LogLista : ILogger
    {
        public List<(LogLevel Nivel, string Mensaje)> Entradas { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Entradas.Add((logLevel, formatter(state, exception)));
    }

    private sealed class Montaje : IDisposable
    {
        private readonly CarpetaTemporal _carpeta = new();

        public Montaje()
        {
            Cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, Reloj);
            Sincronizador = new SincronizadorMesas(_ => Lector, Estado, Datos.Config(), Reloj, Log);
        }

        public RelojFalso Reloj { get; } = new();
        public LectorFalso Lector { get; } = new();
        public EstadoSoftRestaurant Estado { get; } = new();
        public LogLista Log { get; } = new();
        public ColaLocal Cola { get; }
        public SincronizadorMesas Sincronizador { get; }
        public ISoftRestaurantReader Reader { get; } = new SrV11Reader(VersionSr.Interpretar("10.021800")!);

        public Task Ciclo() => Sincronizador.CicloAsync(Reader, Cola, CancellationToken.None);

        public IReadOnlyList<EventoPendiente> Snapshots() =>
            Cola.TomarPendientes(100).Where(e => e.Tipo == TipoEvento.Snapshot).ToList();

        public void Dispose() => _carpeta.Dispose();
    }

    [Fact]
    public async Task Con_solo_lectura_confirmada_encola_un_snapshot_y_deja_limpio_el_error()
    {
        using var m = new Montaje();
        m.Estado.RegistrarErrorMesas("viejo");

        await m.Ciclo();

        var snapshot = Assert.Single(m.Snapshots());
        using var json = JsonDocument.Parse(snapshot.Payload);
        Assert.Equal(3, json.RootElement.GetProperty("mesas").GetArrayLength());
        Assert.Null(m.Estado.ErrorMesas);
    }

    [Fact]
    public async Task Cada_ciclo_manda_el_snapshot_completo_y_la_cola_guarda_solo_el_ultimo()
    {
        using var m = new Montaje();

        await m.Ciclo();
        m.Reloj.Avanzar(TimeSpan.FromSeconds(30));
        await m.Ciclo();

        Assert.Single(m.Snapshots());
        Assert.Equal(2, m.Lector.Lecturas);
        Assert.Equal(1, m.Lector.Revisiones); // los permisos se confirman cada 15 min, no cada ciclo
    }

    [Fact]
    public async Task Con_un_usuario_que_puede_escribir_no_lee_las_tablas_de_operacion_y_lo_dice_en_log_y_heartbeat()
    {
        using var m = new Montaje();
        m.Lector.Permisos = new PermisosLectura(false, "El usuario SQL puede escribir en SoftRestaurant: dbo.tempcheques: UPDATE.");

        await m.Ciclo();
        m.Reloj.Avanzar(TimeSpan.FromSeconds(30));
        await m.Ciclo();

        Assert.Equal(0, m.Lector.Lecturas);
        Assert.Empty(m.Snapshots());
        Assert.Contains("SOLO LECTURA", m.Estado.ErrorMesas);
        Assert.Single(m.Log.Entradas, e => e.Nivel == LogLevel.Error); // una vez, no por ciclo
        Assert.Equal(1, m.Lector.Revisiones); // se vuelve a revisar en 5 min

        m.Reloj.Avanzar(SincronizadorMesas.EsperaReintento);
        m.Lector.Permisos = new PermisosLectura(true, null);
        await m.Ciclo();
        Assert.Single(m.Snapshots());
        Assert.Null(m.Estado.ErrorMesas);
    }

    [Fact]
    public async Task Si_la_revision_de_permisos_misma_falla_reintenta_en_el_siguiente_ciclo_y_no_en_5_min()
    {
        using var m = new Montaje();
        m.Lector.Permisos = new PermisosLectura(false, "No se pudieron revisar los permisos del usuario SQL. Timeout.", NoSeSupo: true);

        await m.Ciclo();
        Assert.Equal(0, m.Lector.Lecturas);
        Assert.Empty(m.Snapshots());
        Assert.Contains("siguiente ciclo", m.Estado.ErrorMesas);

        m.Reloj.Avanzar(TimeSpan.FromSeconds(30)); // un ciclo, muy por debajo de EsperaReintento
        m.Lector.Permisos = new PermisosLectura(true, null);
        await m.Ciclo();

        Assert.Equal(2, m.Lector.Revisiones);
        Assert.Single(m.Snapshots());
        Assert.Null(m.Estado.ErrorMesas);
    }

    [Fact]
    public async Task Una_lectura_que_falla_no_manda_un_snapshot_vacio()
    {
        using var m = new Montaje();
        m.Lector.Leer = () => throw new InvalidDataException("columna (sintético)");

        await m.Ciclo();

        Assert.Empty(m.Snapshots());
        Assert.Contains("Mesas abiertas: no se pudieron leer", m.Estado.ErrorMesas);
    }

    [Fact]
    public async Task Sin_cuentas_abiertas_si_manda_el_snapshot_vacio()
    {
        using var m = new Montaje();
        m.Lector.Leer = () => new LecturaMesas(new MesasLeidas([], []), 1);

        await m.Ciclo();

        using var json = JsonDocument.Parse(Assert.Single(m.Snapshots()).Payload);
        Assert.Equal(0, json.RootElement.GetProperty("mesas").GetArrayLength());
    }

    [Fact]
    public async Task Mas_mesas_de_las_que_admite_el_contrato_no_se_mandan_recortadas()
    {
        using var m = new Montaje();
        var una = new MesaAbierta("1", null, "1", null, null, 1, false, "1.00", []);
        m.Lector.Leer = () => new LecturaMesas(new MesasLeidas(
            Enumerable.Range(0, MapeoMesas.MaxMesas + 1).Select(i => una with { Folio = i.ToString() }).ToList(), []), 1);

        await m.Ciclo();

        Assert.Empty(m.Snapshots());
        Assert.Contains("a lo más 500", m.Estado.ErrorMesas);
    }
}
