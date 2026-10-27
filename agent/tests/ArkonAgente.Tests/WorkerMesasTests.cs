using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Mesas;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Ventas;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>El worker y las mesas abiertas (F1-023).</summary>
public partial class WorkerTests
{
    /// <summary>Encola un snapshot mínimo (o registra un error, o truena) y anota los ciclos de envío que vio.</summary>
    private sealed class MesasFalsas(EnvioFalso envio, EstadoSoftRestaurant estado, string? error, bool truena)
        : ISincronizadorMesas
    {
        private readonly List<int> _enviosAlCorrer = [];

        public IReadOnlyList<int> EnviosAlCorrer
        {
            get { lock (_enviosAlCorrer) { return _enviosAlCorrer.ToList(); } }
        }

        public Task CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion)
        {
            lock (_enviosAlCorrer)
            {
                _enviosAlCorrer.Add(envio.Ciclos);
            }

            if (truena)
            {
                throw new IOException("cola.db bloqueado (sintético)");
            }

            if (error is not null)
            {
                estado.RegistrarErrorMesas(error);
                return Task.CompletedTask;
            }

            cola.Encolar(TipoEvento.Snapshot, """{"capturadoAt":"2026-10-22T15:00:00.000Z","mesas":[]}""");
            return Task.CompletedTask;
        }
    }

    /// <summary>Cuenta los snapshots que salieron en cada ciclo de envío.</summary>
    private sealed class EnvioQueCuentaSnapshots : ICicloEnvio
    {
        private readonly EnvioFalso _interno = new();
        private readonly List<int> _snapshotsPorCiclo = [];

        public ColaLocal Cola => _interno.Cola;
        public EstadoEnvio Estado => _interno.Estado;
        public EnvioFalso Interno => _interno;

        public IReadOnlyList<int> SnapshotsPorCiclo
        {
            get { lock (_snapshotsPorCiclo) { return _snapshotsPorCiclo.ToList(); } }
        }

        public Task CicloAsync(CancellationToken cancelacion)
        {
            var snapshots = Cola.TomarPendientes(100).Count(e => e.Tipo == TipoEvento.Snapshot);
            lock (_snapshotsPorCiclo)
            {
                _snapshotsPorCiclo.Add(snapshots);
            }

            return _interno.CicloAsync(cancelacion);
        }

        public void Dispose() => _interno.Dispose();
    }

    private static Task<ResultadoSondeo> SondeoCaido(ConfiguracionAgente config, CancellationToken cancelacion) =>
        Task.FromResult(ResultadoSondeo.Falla(InstanteSondeo, "SoftRestaurant no respondió (sintético)."));

    private DependenciasWorker ConMesas(
        CarpetaTemporal carpeta, ICicloEnvio envio, EstadoSoftRestaurant estado, ISincronizadorMesas mesas,
        Func<ConfiguracionAgente, CancellationToken, Task<ResultadoSondeo>>? sondeo = null,
        ISincronizadorCheques? cheques = null) =>
        new(
            carpeta.Rutas,
            _ => new ResultadoConfiguracion(Datos.Config() with { IntervaloSegundos = ConfiguracionAgente.IntervaloMinimo }, [], []),
            _ => [],
            DetectaSr10,
            sondeo ?? SondeoOk,
            estado,
            (_, _) => envio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina,
            CrearCheques: cheques is null ? null : (_, _) => cheques,
            CrearMesas: (_, _) => mesas);

    [Fact]
    public async Task El_snapshot_de_mesas_se_encola_antes_del_envio_y_sale_en_el_mismo_ciclo()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioQueCuentaSnapshots();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio.Interno, estado, error: null, truena: false);
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.SnapshotsPorCiclo.Count >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, mesas.EnviosAlCorrer[0]); // antes del primer envío
        Assert.All(envio.SnapshotsPorCiclo, n => Assert.Equal(1, n)); // uno por ciclo, en ese mismo lote
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task Con_la_sonda_del_ciclo_caida_no_lee_mesas_y_el_heartbeat_sale_igual_diciendo_por_que()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: null, truena: false);
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas, SondeoCaido));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Empty(mesas.EnviosAlCorrer); // nunca se intentó leer mesas
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        Assert.Contains("no respondió a la sonda", envio.Heartbeats[0].GetProperty("ultimoError").GetString());
    }

    [Fact]
    public async Task Si_la_sonda_responde_pero_fallan_los_cheques_las_mesas_se_leen_igual()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: null, truena: false);
        var cheques = new ChequesFalsos(envio, ResultadoSondeo.Falla(DateTimeOffset.UtcNow, "No se leen las ventas (sintético)."));
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas, cheques: cheques));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Heartbeats.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, mesas.EnviosAlCorrer[0]); // la falla de cheques no salta las mesas
        var error = envio.Heartbeats[0].GetProperty("ultimoError").GetString();
        Assert.Equal("No se leen las ventas (sintético).", error);
        Assert.DoesNotContain("no respondió a la sonda", error);
    }

    /// <summary>Unos cheques cuya lectura truena con una excepción no prevista.</summary>
    private sealed class ChequesQueTruenan : ISincronizadorCheques
    {
        public Task<ResultadoSondeo> CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion) =>
            throw new IOException("cola.db bloqueado (sintético)");
    }

    [Fact]
    public async Task Si_la_lectura_de_cheques_truena_las_mesas_se_leen_igual()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: null, truena: false);
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas, cheques: new ChequesQueTruenan()));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Heartbeats.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, mesas.EnviosAlCorrer[0]); // la sonda respondió: la excepción de cheques no salta las mesas
        var error = envio.Heartbeats[0].GetProperty("ultimoError").GetString();
        Assert.Contains("Falla interna del agente al consultar SoftRestaurant (IOException)", error);
        Assert.DoesNotContain("no respondió a la sonda", error);
    }

    [Fact]
    public async Task Si_la_sonda_truena_no_lee_mesas_y_el_heartbeat_sale_igual()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: null, truena: false);
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas,
            (_, _) => throw new System.Net.Sockets.SocketException(10054)));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Empty(mesas.EnviosAlCorrer);
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        Assert.Contains("no respondió a la sonda", envio.Heartbeats[0].GetProperty("ultimoError").GetString());
    }

    [Fact]
    public async Task El_error_de_mesas_sale_en_el_ultimoError_del_heartbeat()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: "Mesas abiertas: no se leen (sintético).", truena: false);
        var worker = new Worker(new LogEnMemoria(), ConMesas(carpeta, envio, estado, mesas));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Heartbeats.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Contains("Mesas abiertas: no se leen (sintético).", envio.Heartbeats[0].GetProperty("ultimoError").GetString());
    }

    [Fact]
    public async Task Si_las_mesas_truenan_el_heartbeat_sale_igual_lo_dice_y_el_ciclo_sigue()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var estado = new EstadoSoftRestaurant();
        var mesas = new MesasFalsas(envio, estado, error: null, truena: true);
        var worker = new Worker(log, ConMesas(carpeta, envio, estado, mesas));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        Assert.Contains("encolar las mesas abiertas", envio.Heartbeats[0].GetProperty("ultimoError").GetString());
        Assert.Single(log.De(LogLevel.Error), m => m.Contains("Mesas abiertas: falla interna")); // una vez
        Assert.Empty(log.De(LogLevel.Critical));
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }
}
