using System.Text.Json;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;
using static ArkonAgente.Tests.ColaLocalTests;

namespace ArkonAgente.Tests;

/// <summary>El heartbeat en el ciclo del worker (F1-025).</summary>
public partial class WorkerTests
{
    private static ResultadoDeteccion Sr10() => ResultadoDeteccion.Soportada(new SrV11Reader(new VersionSr("10.021800", 10)));

    [Fact]
    public async Task Cada_ciclo_encola_UN_heartbeat_antes_de_enviar_aunque_no_haya_cheques()
    {
        // Es lo que sostiene el "conectado" del panel (F1-061): un lote por ciclo.
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var dep = ConDeteccion(carpeta, Sr10, new EstadoSoftRestaurant()) with { CrearEnvio = (_, _) => envio };
        var worker = new Worker(new LogEnMemoria(), dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 3);
        await worker.StopAsync(CancellationToken.None);

        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        var hb = envio.Heartbeats[^1];
        Assert.Equal(VersionDePrueba, hb.GetProperty("versionAgente").GetString());
        Assert.Equal("10.021800", hb.GetProperty("versionSr").GetString());
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("ultimoError").ValueKind);
        Assert.Equal("2026-09-21T12:00:00.000Z", hb.GetProperty("ultimaLecturaAt").GetString());
        Assert.Equal(7, hb.GetProperty("latenciaQueryMs").GetInt32());
        Assert.Equal(0, hb.GetProperty("tamanoCola").GetInt32());
    }

    [Fact]
    public async Task Version_no_soportada_no_sondea_y_el_heartbeat_lleva_la_version_y_el_error()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var sondeos = 0;
        var dep = ConDeteccion(carpeta,
            () => ResultadoDeteccion.NoSoportada("SoftRestaurant versión 12.000000 no soportada.", "12.000000"),
            new EstadoSoftRestaurant()) with
        {
            CrearEnvio = (_, _) => envio,
            SondearSr = (_, _) =>
            {
                Interlocked.Increment(ref sondeos);
                return Task.FromResult(ResultadoSondeo.Exito(InstanteSondeo, 1));
            },
        };
        var worker = new Worker(new LogEnMemoria(), dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, Volatile.Read(ref sondeos));
        var hb = envio.Heartbeats[^1];
        Assert.Equal("12.000000", hb.GetProperty("versionSr").GetString());
        Assert.Equal("SoftRestaurant versión 12.000000 no soportada.", hb.GetProperty("ultimoError").GetString());
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("ultimaLecturaAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("latenciaQueryMs").ValueKind);
    }

    [Fact]
    public async Task Si_la_sonda_falla_la_ultima_lectura_se_congela_y_el_error_va_al_heartbeat_y_al_log_una_vez()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var reloj = new RelojFalso();
        var sondeos = 0;
        var dep = ConDeteccion(carpeta, Sr10, new EstadoSoftRestaurant()) with
        {
            CrearEnvio = (_, _) => envio,
            Reloj = reloj,
            SondearSr = (_, _) =>
            {
                var n = Interlocked.Increment(ref sondeos);
                return Task.FromResult(n == 1
                    ? ResultadoSondeo.Exito(InstanteSondeo, 5)
                    : ResultadoSondeo.Falla(InstanteSondeo.AddSeconds(n), "SoftRestaurant no respondió a la consulta del ciclo. Apagado."));
            },
        };
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 4);
        await worker.StopAsync(CancellationToken.None);

        var hb = envio.Heartbeats[^1];
        Assert.Equal("2026-09-21T12:00:00.000Z", hb.GetProperty("ultimaLecturaAt").GetString()); // la del sondeo bueno
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("latenciaQueryMs").ValueKind);
        Assert.Equal("SoftRestaurant no respondió a la consulta del ciclo. Apagado.", hb.GetProperty("ultimoError").GetString());
        Assert.Equal("10.021800", hb.GetProperty("versionSr").GetString());
        Assert.Single(log.De(LogLevel.Warning), m => m.Contains("Apagado."));
    }

    [Fact]
    public async Task Una_excepcion_de_la_sonda_no_corta_el_ciclo_y_el_heartbeat_igual_sale()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var dep = ConDeteccion(carpeta, Sr10, new EstadoSoftRestaurant()) with
        {
            CrearEnvio = (_, _) => envio,
            SondearSr = (_, _) => throw new System.Net.Sockets.SocketException(10054),
        };
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 3);
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        var hb = envio.Heartbeats[^1];
        Assert.Contains("(SocketException)", hb.GetProperty("ultimoError").GetString());
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("ultimaLecturaAt").ValueKind);
        Assert.Single(log.De(LogLevel.Error));
    }

    [Fact]
    public async Task El_tamano_de_cola_y_la_falla_de_envio_vienen_del_envio()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso
        {
            Estado = new EstadoEnvio("El API rechazó la API key (401).", InstanteSondeo, 3, null),
        };
        // Un snapshot pendiente de antes: el primer heartbeat se arma ANTES de enviar y lo cuenta.
        envio.Cola.Encolar(TipoEvento.Snapshot, Snapshot);
        var dep = ConDeteccion(carpeta, Sr10, new EstadoSoftRestaurant()) with { CrearEnvio = (_, _) => envio };
        var worker = new Worker(new LogEnMemoria(), dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 1);
        await worker.StopAsync(CancellationToken.None);

        var hb = envio.Heartbeats[0];
        Assert.Equal(1, hb.GetProperty("tamanoCola").GetInt32());
        Assert.Contains("El envío al API falla desde 2026-09-21T12:00:00.000Z (3 intento(s)): El API rechazó la API key (401).",
            hb.GetProperty("ultimoError").GetString());
    }

    [Fact]
    public async Task De_punta_a_punta_con_el_envio_real_el_rechazo_de_un_cheque_llega_al_API_en_el_heartbeat()
    {
        // Worker + EnviadorCola + ColaLocal reales; sólo el API es falso. Un cheque que el
        // API rechaza sin reintento tiene que volver al API dentro del siguiente heartbeat.
        using var carpeta = new CarpetaTemporal();
        var api = new ApiFalso
        {
            Responder = eventos => ApiFalso.Resultado(
                eventos.Where(e => e.Tipo != "cheque").Select(e => e.Id),
                eventos.Select((e, i) => (e, i)).Where(x => x.e.Tipo == "cheque")
                    .Select(x => (object)new { id = x.e.Id, indice = x.i, motivo = "datos.total: importe inválido", reintentable = false })
                    .ToArray()),
        };
        var cola = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, TimeProvider.System);
        cola.Encolar(TipoEvento.Cheque, Cheque("F-900"));
        var dep = ConDeteccion(carpeta, Sr10, new EstadoSoftRestaurant()) with
        {
            CrearEnvio = (config, logger) => new EnviadorCola(cola, config, logger, TimeProvider.System, api),
        };
        var worker = new Worker(new LogEnMemoria(), dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => HeartbeatsDe(api).Any(h =>
            h.GetProperty("ultimoError").GetString()?.Contains("cheque folio F-900") == true));
        await worker.StopAsync(CancellationToken.None);

        var hb = HeartbeatsDe(api).Last(h => h.GetProperty("ultimoError").ValueKind == JsonValueKind.String);
        Assert.Contains("datos.total: importe inválido", hb.GetProperty("ultimoError").GetString());
        Assert.Equal("10.021800", hb.GetProperty("versionSr").GetString());
        Assert.All(api.CopiaPeticiones(), p => Assert.Equal(Datos.ApiKey, p.ApiKey)); // sólo en el header
        var cuerpos = string.Join("\n", api.CopiaPeticiones().SelectMany(p => p.Eventos).Select(e => e.Datos.GetRawText()));
        Assert.DoesNotContain(Datos.ApiKey, cuerpos);
        Assert.DoesNotContain(Datos.Password, cuerpos);
        Assert.DoesNotContain("127.0.0.1", cuerpos); // ni el servidor de la cadena de conexión
    }

    private static List<JsonElement> HeartbeatsDe(ApiFalso api)
    {
        return api.CopiaPeticiones().SelectMany(p => p.Eventos).Where(e => e.Tipo == "heartbeat").Select(e => e.Datos).ToList();
    }
}
