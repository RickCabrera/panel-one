using ArkonAgente.Cola;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Tests;

public class ColaLocalTests
{
    internal static string Cheque(string folio, string version = "1") =>
        $$"""{"folioSr":"{{folio}}","version":"{{version}}"}""";

    internal const string Snapshot = """{"capturadoAt":"2026-09-21T12:00:00Z","mesas":[]}""";
    internal const string Heartbeat = """{"versionAgente":"0.1.0"}""";

    [Fact]
    public void Lo_encolado_sobrevive_a_reabrir_el_archivo()
    {
        using var carpeta = new CarpetaTemporal();
        var ruta = carpeta.Rutas.ArchivoCola;
        var reloj = new RelojFalso();

        var cola = ColaLocal.Abrir(ruta, reloj);
        cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        cola.Encolar(TipoEvento.Cheque, Cheque("B"));

        var reabierta = ColaLocal.Abrir(ruta, reloj);
        Assert.Equal(2, reabierta.ContarPendientes());
        Assert.Equal(["A", "B"], reabierta.TomarPendientes(10).Select(Folio));
        Assert.True(File.Exists(Path.Combine(carpeta.Ruta, "cola.db")));
    }

    [Fact]
    public void Entrega_en_orden_de_llegada_y_respeta_el_maximo()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        for (var i = 0; i < 5; i++)
        {
            cola.Encolar(TipoEvento.Cheque, Cheque($"F{i}"));
        }

        var pendientes = cola.TomarPendientes(3);
        Assert.Equal(["F0", "F1", "F2"], pendientes.Select(Folio));
        Assert.True(pendientes[0].Id < pendientes[1].Id && pendientes[1].Id < pendientes[2].Id);
        Assert.All(pendientes, p => Assert.Equal(TipoEvento.Cheque, p.Tipo));
    }

    [Fact]
    public void Un_snapshot_nuevo_reemplaza_al_pendiente_pero_no_toca_uno_ya_enviado()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        var enviado = cola.Encolar(TipoEvento.Snapshot, Snapshot);
        cola.MarcarEnviados([enviado]);

        cola.Encolar(TipoEvento.Snapshot, Snapshot);
        cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var ultimo = cola.Encolar(TipoEvento.Snapshot, Snapshot);

        var pendientes = cola.TomarPendientes(10);
        Assert.Equal(2, pendientes.Count);
        Assert.Equal(ultimo, Assert.Single(pendientes, p => p.Tipo == TipoEvento.Snapshot).Id);
        Assert.Equal(1, ContarFilas(cola, $"id = {enviado} AND enviado_at IS NOT NULL"));
    }

    [Fact]
    public void Un_heartbeat_nuevo_reemplaza_al_pendiente()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        cola.Encolar(TipoEvento.Heartbeat, Heartbeat);
        cola.Encolar(TipoEvento.Heartbeat, Heartbeat);
        var ultimo = cola.Encolar(TipoEvento.Heartbeat, Heartbeat);

        Assert.Equal(ultimo, Assert.Single(cola.TomarPendientes(10)).Id);
    }

    [Fact]
    public void Un_cheque_reprocesado_reemplaza_su_version_pendiente_y_no_toca_otros_folios()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        cola.Encolar(TipoEvento.Cheque, Cheque("A", "1"));
        cola.Encolar(TipoEvento.Cheque, Cheque("B", "1"));
        cola.Encolar(TipoEvento.Cheque, Cheque("A", "2"));

        var pendientes = cola.TomarPendientes(10);
        Assert.Equal(["B", "A"], pendientes.Select(Folio));
        Assert.Contains("\"version\":\"2\"", pendientes[1].Payload);
    }

    [Fact]
    public void Un_cheque_ya_enviado_no_se_borra_al_encolar_otra_version()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        var v1 = cola.Encolar(TipoEvento.Cheque, Cheque("A", "1"));
        cola.MarcarEnviados([v1]);
        cola.Encolar(TipoEvento.Cheque, Cheque("A", "2"));

        Assert.Single(cola.TomarPendientes(10));
        Assert.Equal(2, ContarFilas(cola, "1 = 1"));
    }

    [Theory]
    [InlineData("no es json")]
    [InlineData("[1,2]")]
    [InlineData("\"texto\"")]
    public void Un_payload_que_no_es_objeto_JSON_truena_y_no_se_encola(string payload)
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());

        Assert.Throws<ArgumentException>(() => cola.Encolar(TipoEvento.Snapshot, payload));
        Assert.Equal(0, cola.ContarPendientes());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"folioSr":""}""")]
    [InlineData("""{"folioSr":123}""")]
    public void Un_cheque_sin_folioSr_truena(string payload)
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());

        var ex = Assert.Throws<ArgumentException>(() => cola.Encolar(TipoEvento.Cheque, payload));
        Assert.Contains("folioSr", ex.Message);
    }

    [Fact]
    public void Rechazados_y_enviados_salen_de_pendientes_y_los_intentos_se_suman()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        var a = cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var b = cola.Encolar(TipoEvento.Cheque, Cheque("B"));
        var c = cola.Encolar(TipoEvento.Cheque, Cheque("C"));

        cola.MarcarEnviados([a]);
        cola.MarcarRechazados([(b, "datos.total inválido")]);
        cola.SumarIntento([c]);
        cola.SumarIntento([c]);

        Assert.Equal([c], cola.TomarPendientes(10).Select(p => p.Id));
        Assert.Equal(1, ContarFilas(cola, $"id = {b} AND motivo_rechazo = 'datos.total inválido'"));
        Assert.Equal(1, ContarFilas(cola, $"id = {c} AND intentos = 2"));
    }

    [Fact]
    public void La_purga_borra_enviados_y_rechazados_de_mas_de_7_dias_y_nunca_un_pendiente()
    {
        using var carpeta = new CarpetaTemporal();
        var reloj = new RelojFalso();
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        var viejoEnviado = cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var viejoRechazado = cola.Encolar(TipoEvento.Cheque, Cheque("B"));
        var viejoPendiente = cola.Encolar(TipoEvento.Cheque, Cheque("C"));
        cola.MarcarEnviados([viejoEnviado]);
        cola.MarcarRechazados([(viejoRechazado, "malo")]);

        reloj.Avanzar(TimeSpan.FromDays(6));
        var reciente = cola.Encolar(TipoEvento.Cheque, Cheque("D"));
        cola.MarcarEnviados([reciente]);

        reloj.Avanzar(TimeSpan.FromDays(1) + TimeSpan.FromMinutes(1));
        Assert.Equal(2, cola.Purgar());

        Assert.Equal(2, ContarFilas(cola, "1 = 1"));
        Assert.Equal([viejoPendiente], cola.TomarPendientes(10).Select(p => p.Id));
        Assert.Equal(1, ContarFilas(cola, $"id = {reciente}"));
    }

    [Fact]
    public void Las_fechas_se_guardan_en_UTC_con_ancho_fijo()
    {
        Assert.Equal(
            "2026-09-21T18:00:00.0000000Z",
            ColaLocal.Formatear(new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.FromHours(-6))));
    }

    private static string Folio(EventoPendiente p) =>
        System.Text.Json.JsonDocument.Parse(p.Payload).RootElement.GetProperty("folioSr").GetString()!;

    internal static int ContarFilas(ColaLocal cola, string condicion)
    {
        using var conexion = new SqliteConnection($"Data Source={cola.Ruta};Pooling=False");
        conexion.Open();
        using var comando = conexion.CreateCommand();
        comando.CommandText = $"SELECT COUNT(*) FROM eventos WHERE {condicion};";
        return Convert.ToInt32(comando.ExecuteScalar());
    }
}
