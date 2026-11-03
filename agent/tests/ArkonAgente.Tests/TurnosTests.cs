using System.Text.Json;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using ArkonAgente.Ventas;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>
/// Fixtures SINTÉTICAS de turnos con la forma de <c>sr_turnos.sql</c> (MVP de cortes). Sólo la FORMA
/// sigue lo visto en SR 10 (esquema-sr §2, "Turnos"); importes inventados.
/// </summary>
internal static class FixturesTurnos
{
    public static FilaTurno Turno(
        long? id = 7,
        DateTime? apertura = null,
        DateTime? cierre = null,
        bool abierto = false,
        string? estacion = "CAJA1",
        decimal? fondo = 500m,
        decimal? efectivo = 1000m,
        decimal? tarjeta = 228m,
        decimal? vales = 0m,
        decimal? credito = 0m) =>
        new(id, apertura ?? new DateTime(2026, 10, 19, 9, 0, 0),
            abierto ? null : cierre ?? new DateTime(2026, 10, 22, 14, 5, 0), estacion, fondo, efectivo, tarjeta, vales, credito);
}

public class MapeoTurnosTests
{
    private static TurnosMapeados Mapear(params FilaTurno[] filas) =>
        MapeoTurnos.Mapear(filas, FixturesCheques.ZonaMenos6);

    [Fact]
    public void Un_turno_cerrado_sale_con_la_forma_exacta_del_contrato()
    {
        var mapeo = Mapear(FixturesTurnos.Turno(estacion: "  CAJA1 ", tarjeta: 228.0050m));

        var t = JsonDocument.Parse(Assert.Single(mapeo.Turnos).Payload).RootElement;
        Assert.Equal(
            ["turnoSr", "aperturaAt", "cierreAt", "estacion", "fondo", "declaradoEfectivo", "declaradoTarjeta",
             "declaradoVales", "declaradoCredito"],
            t.EnumerateObject().Select(p => p.Name));
        Assert.Equal("7", t.GetProperty("turnoSr").GetString());
        // Hora local de la PC del POS con su offset, igual que los cheques.
        Assert.Equal("2026-10-19T09:00:00.000-06:00", t.GetProperty("aperturaAt").GetString());
        Assert.Equal("2026-10-22T14:05:00.000-06:00", t.GetProperty("cierreAt").GetString());
        Assert.Equal("CAJA1", t.GetProperty("estacion").GetString());
        Assert.Equal("500", t.GetProperty("fondo").GetString());
        Assert.Equal("1000", t.GetProperty("declaradoEfectivo").GetString());
        Assert.Equal("228.005", t.GetProperty("declaradoTarjeta").GetString());
        Assert.Equal("0", t.GetProperty("declaradoVales").GetString());
        Assert.Empty(mapeo.Avisos);
    }

    [Fact]
    public void Un_turno_abierto_manda_cierre_nulo_y_un_NULL_de_SR_en_importes_es_cero()
    {
        var t = JsonDocument.Parse(Assert.Single(
            Mapear(FixturesTurnos.Turno(abierto: true, estacion: "  ", efectivo: null, fondo: null)).Turnos).Payload).RootElement;

        Assert.Equal(JsonValueKind.Null, t.GetProperty("cierreAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, t.GetProperty("estacion").ValueKind);
        Assert.Equal("0", t.GetProperty("fondo").GetString());
        Assert.Equal("0", t.GetProperty("declaradoEfectivo").GetString());
    }

    [Fact]
    public void Sin_idturno_o_sin_apertura_no_se_manda_y_queda_el_aviso()
    {
        var mapeo = Mapear(
            FixturesTurnos.Turno(id: null),
            FixturesTurnos.Turno(id: 0),
            new FilaTurno(9, null, null, null, 0m, 0m, 0m, 0m, 0m),
            FixturesTurnos.Turno(id: 8));

        Assert.Equal(["8"], mapeo.Turnos.Select(t => t.TurnoSr));
        Assert.Equal(3, mapeo.Avisos.Count);
    }

    [Fact]
    public void Un_idturno_repetido_en_la_lectura_no_manda_ninguno_de_los_dos()
    {
        var mapeo = Mapear(
            FixturesTurnos.Turno(id: 7),
            FixturesTurnos.Turno(id: 7, apertura: new DateTime(2026, 10, 25, 8, 0, 0)),
            FixturesTurnos.Turno(id: 8));

        Assert.Equal(["8"], mapeo.Turnos.Select(t => t.TurnoSr));
        Assert.Contains(mapeo.Avisos, a => a.Contains("más de una vez"));
    }

    [Fact]
    public void La_huella_cambia_si_cambia_el_turno_y_no_si_es_el_mismo()
    {
        string Huella(FilaTurno f) => Assert.Single(Mapear(f).Turnos).Huella;
        Assert.Equal(Huella(FixturesTurnos.Turno()), Huella(FixturesTurnos.Turno()));
        Assert.NotEqual(Huella(FixturesTurnos.Turno(abierto: true)), Huella(FixturesTurnos.Turno()));
        Assert.NotEqual(Huella(FixturesTurnos.Turno(efectivo: 0m)), Huella(FixturesTurnos.Turno()));
    }

    [Fact]
    public void La_consulta_de_turnos_es_la_del_reader_y_no_lee_mas_que_dbo_turnos()
    {
        Assert.Equal("sr_turnos", new SrV11Reader(new VersionSr("10.021800", 10)).ConsultaTurnos);
        var sql = ConsultasEmbebidas.Leer("sr_turnos");
        Assert.Contains("FROM dbo.turnos AS tu WITH (NOLOCK)", sql);
        Assert.Contains("@desde", sql);
        Assert.Contains("N'dbo.turnos'", ConsultasEmbebidas.Leer("diagnostico"));
        // Y la de cheques trae el idturno del cobro de las dos tablas.
        var cheques = ConsultasEmbebidas.Leer("sr_cheques");
        Assert.Contains("CAST(t.idturno AS bigint)", cheques);
        Assert.Contains("CAST(c.idturno AS bigint)", cheques);
    }
}

internal sealed class LectorTurnosFalso : ILectorTurnos
{
    public List<FilaTurno> Filas { get; } = [];

    public Func<Exception>? Falla { get; set; }

    public PermisosLectura Permisos { get; set; } = new(true, null);

    public List<DateTime> Desdes { get; } = [];

    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) => Task.FromResult(Permisos);

    public Task<LecturaTurnos> LeerAsync(DateTime desde, CancellationToken cancelacion)
    {
        Desdes.Add(desde);
        if (Falla is not null)
        {
            throw Falla();
        }

        return Task.FromResult(new LecturaTurnos(Filas.ToList(), 3));
    }
}

public class SincronizadorTurnosTests : IDisposable
{
    private static readonly ISoftRestaurantReader Reader = new SrV11Reader(new VersionSr("10.021800", 10));

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new(); // 2026-09-21 12:00 UTC = 06:00 en UTC−6
    private readonly LogSimple _log = new();
    private readonly LectorTurnosFalso _lector = new();
    private readonly ColaLocal _cola;
    private SincronizadorTurnos _sinc;

    public SincronizadorTurnosTests()
    {
        _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _sinc = Nuevo();
    }

    public void Dispose() => _carpeta.Dispose();

    private SincronizadorTurnos Nuevo() =>
        new(_ => _lector, Datos.Config(), _reloj, FixturesCheques.ZonaMenos6, _log);

    private async Task Ciclo()
    {
        await _sinc.CicloAsync(Reader, _cola, CancellationToken.None);
        _reloj.Avanzar(TimeSpan.FromSeconds(30));
    }

    private List<JsonElement> Pendientes() =>
        _cola.TomarPendientes(1000).Where(e => e.Tipo == TipoEvento.Turno)
            .Select(e => JsonDocument.Parse(e.Payload).RootElement.Clone()).ToList();

    [Fact]
    public async Task Encola_cada_turno_una_vez_lee_la_ventana_de_7_dias_en_hora_local_y_no_reenvia_sin_cambios()
    {
        _lector.Filas.Add(FixturesTurnos.Turno(id: 7));
        _lector.Filas.Add(FixturesTurnos.Turno(id: 8, apertura: new DateTime(2026, 10, 22, 14, 6, 0), abierto: true));

        await Ciclo();
        await Ciclo();

        Assert.Equal(["7", "8"], Pendientes().Select(t => t.GetProperty("turnoSr").GetString()));
        // 12:00 UTC = 06:00 en la PC (UTC−6), menos 7 días.
        Assert.Equal(new DateTime(2026, 9, 14, 6, 0, 0), _lector.Desdes[0]);
        Assert.Single(_log.De(LogLevel.Information), m => m.Contains("encolados 2"));
    }

    [Fact]
    public async Task Cuando_el_turno_cambia_se_vuelve_a_encolar_y_en_la_cola_solo_queda_su_ultima_version()
    {
        _lector.Filas.Add(FixturesTurnos.Turno(id: 8, abierto: true, efectivo: 0m));
        await Ciclo();

        // El corte: SR le pone cierre y el cajero declara.
        _lector.Filas[0] = FixturesTurnos.Turno(id: 8, efectivo: 950m);
        await Ciclo();

        var t = Assert.Single(Pendientes());
        Assert.Equal("2026-10-22T14:05:00.000-06:00", t.GetProperty("cierreAt").GetString());
        Assert.Equal("950", t.GetProperty("declaradoEfectivo").GetString());
    }

    [Fact]
    public async Task Tras_reiniciar_el_servicio_los_turnos_se_vuelven_a_encolar_una_vez_y_el_API_los_deja_iguales()
    {
        _lector.Filas.Add(FixturesTurnos.Turno(id: 7));
        await Ciclo();
        var enviados = _cola.TomarPendientes(10).Select(e => e.Id).ToList();
        _cola.MarcarEnviados(enviados);

        _sinc = Nuevo(); // reinicio: la huella vivía en memoria
        await Ciclo();
        await Ciclo();

        Assert.Single(Pendientes());
    }

    [Fact]
    public async Task Un_turno_que_reaparece_con_otra_apertura_no_se_manda_y_va_al_log_como_Error()
    {
        _lector.Filas.Add(FixturesTurnos.Turno(id: 7));
        await Ciclo();
        _cola.MarcarEnviados(_cola.TomarPendientes(10).Select(e => e.Id));

        _lector.Filas[0] = FixturesTurnos.Turno(id: 7, apertura: new DateTime(2026, 11, 1, 8, 0, 0));
        await Ciclo();
        await Ciclo();

        Assert.Empty(Pendientes());
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("reusó el número de turno"));
    }

    [Fact]
    public async Task Si_la_lectura_falla_no_encola_nada_lo_registra_una_vez_y_al_volver_lee()
    {
        _lector.Falla = () => new InvalidOperationException("sintético");
        _lector.Filas.Add(FixturesTurnos.Turno(id: 7));
        await Ciclo();
        await Ciclo();

        Assert.Empty(Pendientes());
        Assert.Single(_log.De(LogLevel.Error));

        _lector.Falla = null;
        await Ciclo();
        Assert.Single(Pendientes());
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("vuelve a responder"));
    }

    [Fact]
    public async Task Con_un_usuario_que_puede_escribir_no_lee_los_turnos()
    {
        _lector.Permisos = new PermisosLectura(false, "El usuario puede escribir (sintético).");
        _lector.Filas.Add(FixturesTurnos.Turno(id: 7));
        await Ciclo();

        Assert.Empty(_lector.Desdes);
        Assert.Empty(Pendientes());
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("SOLO LECTURA"));
    }
}

/// <summary>
/// La cola local con turnos (MVP de cortes): el evento nuevo, la migración de un <c>cola.db</c> de
/// antes y el viaje completo sin red (encolar, reintentar, llegar una vez).
/// </summary>
public class ColaTurnosTests : IDisposable
{
    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();

    public void Dispose() => _carpeta.Dispose();

    internal static string Turno(string id, string efectivo = "0") =>
        $$"""{"turnoSr":"{{id}}","aperturaAt":"2026-10-19T09:00:00.000-06:00","declaradoEfectivo":"{{efectivo}}"}""";

    /// <summary>El esquema de <c>eventos</c> de F1-024 tal cual (antes del tipo <c>turno</c>).</summary>
    private const string EsquemaViejo = """
        CREATE TABLE eventos (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo           TEXT    NOT NULL CHECK (tipo IN ('cheque', 'snapshot', 'heartbeat')),
            clave          TEXT    NULL,
            payload        TEXT    NOT NULL,
            creado_at      TEXT    NOT NULL,
            intentos       INTEGER NOT NULL DEFAULT 0,
            enviado_at     TEXT    NULL,
            rechazado_at   TEXT    NULL,
            motivo_rechazo TEXT    NULL
        );
        CREATE INDEX ix_eventos_pendientes ON eventos (id) WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        PRAGMA user_version = 1;
        """;

    private static object? Escalar(string ruta, string sql)
    {
        using var conexion = new SqliteConnection($"Data Source={ruta};Pooling=False");
        conexion.Open();
        using var comando = conexion.CreateCommand();
        comando.CommandText = sql;
        return comando.ExecuteScalar();
    }

    [Fact]
    public void Un_turno_reprocesado_reemplaza_su_version_pendiente_y_no_toca_otros_turnos()
    {
        var cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.Encolar(TipoEvento.Turno, Turno("7"));
        cola.Encolar(TipoEvento.Turno, Turno("8"));
        cola.Encolar(TipoEvento.Turno, Turno("7", "950"));

        var pendientes = cola.TomarPendientes(10);
        Assert.Equal(["8", "7"], pendientes.Select(e => JsonDocument.Parse(e.Payload).RootElement.GetProperty("turnoSr").GetString()));
        Assert.Contains("950", pendientes[1].Payload);
        Assert.Throws<ArgumentException>(() => cola.Encolar(TipoEvento.Turno, """{"aperturaAt":"x"}"""));
    }

    [Fact]
    public void Un_cola_db_de_antes_se_migra_sin_perder_eventos_ni_repetir_ids()
    {
        var ruta = _carpeta.Rutas.ArchivoCola;
        Directory.CreateDirectory(Path.GetDirectoryName(ruta)!);
        using (var conexion = new SqliteConnection($"Data Source={ruta};Pooling=False"))
        {
            conexion.Open();
            using var comando = conexion.CreateCommand();
            comando.CommandText = EsquemaViejo + """
                INSERT INTO eventos (tipo, clave, payload, creado_at) VALUES ('cheque', 'A', '{"folioSr":"A"}', '2026-09-21T12:00:00.0000000Z');
                INSERT INTO eventos (tipo, clave, payload, creado_at, enviado_at) VALUES ('cheque', 'B', '{"folioSr":"B"}', '2026-09-21T12:00:00.0000000Z', '2026-09-21T12:00:01.0000000Z');
                INSERT INTO eventos (tipo, clave, payload, creado_at) VALUES ('heartbeat', NULL, '{"versionAgente":"0.1.0"}', '2026-09-21T12:00:00.0000000Z');
                DELETE FROM eventos WHERE id = 3;
                """;
            comando.ExecuteNonQuery();
        }

        Assert.Throws<SqliteException>(() => Escalar(ruta,
            "INSERT INTO eventos (tipo, payload, creado_at) VALUES ('turno', '{}', 'x');"));

        var cola = ColaLocal.Abrir(ruta, _reloj);

        // El pendiente sigue pendiente, el enviado sigue enviado; nada se perdió.
        Assert.Equal(["A"], cola.TomarPendientes(10).Select(e => e.Payload.Contains("\"A\"") ? "A" : "?"));
        Assert.Equal(2L, Escalar(ruta, "SELECT COUNT(*) FROM eventos;"));
        Assert.Equal((long)ColaLocal.VersionEsquema, Escalar(ruta, "PRAGMA user_version;"));
        // El id 3 ya se usó (y se borró): el siguiente no lo repite.
        var id = cola.Encolar(TipoEvento.Turno, Turno("7"));
        Assert.Equal(4L, id);
        Assert.Equal(2, cola.ContarPendientes());

        // Abrir otra vez no vuelve a migrar ni pierde nada.
        var otra = ColaLocal.Abrir(ruta, _reloj);
        Assert.Equal(2, otra.ContarPendientes());
        Assert.Contains("'turno'", (string)Escalar(ruta, "SELECT sql FROM sqlite_master WHERE name = 'eventos';")!);
        Assert.Equal(4L, Escalar(ruta, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = 'eventos';"));
    }

    /// <summary>
    /// Sin internet (o sin luz: el proceso muere y vuelve a abrir el mismo <c>cola.db</c>) los turnos
    /// y los cheques se quedan en la cola; al volver la red salen en orden y una sola vez.
    /// </summary>
    [Fact]
    public async Task Sin_red_y_con_un_reinicio_a_la_mitad_turnos_y_cheques_llegan_una_vez_al_volver()
    {
        var api = new ApiFalso { Caido = true };
        var log = new LogSimple();
        var cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        var envio = new EnviadorCola(cola, Datos.Config(), log, _reloj, api);

        cola.Encolar(TipoEvento.Turno, Turno("8"));
        cola.Encolar(TipoEvento.Cheque, ColaLocalTests.Cheque("21"));
        await envio.CicloAsync(CancellationToken.None);
        Assert.Equal(2, cola.ContarPendientes());

        // Se va la luz: proceso nuevo sobre el mismo archivo. Mientras tanto se cerró el turno.
        envio.Dispose();
        cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        envio = new EnviadorCola(cola, Datos.Config(), log, _reloj, api);
        cola.Encolar(TipoEvento.Turno, Turno("8", "950"));
        await envio.CicloAsync(CancellationToken.None);
        Assert.Empty(api.Guardados);

        api.Caido = false;
        _reloj.Avanzar(EnviadorCola.BackoffMaximo);
        await envio.CicloAsync(CancellationToken.None);
        envio.Dispose();

        Assert.Equal(0, cola.ContarPendientes());
        Assert.Equal(["cheque", "turno"], api.Guardados.Select(e => e.Tipo));
        var turno = api.Guardados.Single(e => e.Tipo == "turno");
        Assert.Equal("950", turno.Datos.GetProperty("declaradoEfectivo").GetString());
    }
}
