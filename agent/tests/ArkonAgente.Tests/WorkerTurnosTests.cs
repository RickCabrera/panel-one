using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Ventas;

namespace ArkonAgente.Tests;

/// <summary>El worker y los turnos (MVP de cortes).</summary>
public partial class WorkerTests
{
    /// <summary>Encola un turno (o truena) y anota los ciclos de envío que vio.</summary>
    private sealed class TurnosFalsos(EnvioFalso envio, bool truena) : ISincronizadorTurnos
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

            cola.Encolar(TipoEvento.Turno, ColaTurnosTests.Turno("7"));
            return Task.CompletedTask;
        }
    }

    private DependenciasWorker ConTurnos(
        CarpetaTemporal carpeta, ICicloEnvio envio, EstadoSoftRestaurant estado, ISincronizadorTurnos turnos,
        Func<ConfiguracionAgente, CancellationToken, Task<ResultadoSondeo>>? sondeo = null) =>
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
            CrearTurnos: (_, _) => turnos);

    [Fact]
    public async Task Los_turnos_se_encolan_antes_del_envio_de_cada_ciclo()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var turnos = new TurnosFalsos(envio, truena: false);
        var worker = new Worker(new LogEnMemoria(), ConTurnos(carpeta, envio, new EstadoSoftRestaurant(), turnos));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, turnos.EnviosAlCorrer[0]); // antes del primer envío
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task Con_la_sonda_caida_no_se_leen_turnos_y_una_falla_interna_no_corta_el_ciclo()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var caidos = new TurnosFalsos(envio, truena: false);
        var worker = new Worker(
            new LogEnMemoria(), ConTurnos(carpeta, envio, new EstadoSoftRestaurant(), caidos, SondeoCaido));
        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);
        Assert.Empty(caidos.EnviosAlCorrer);

        using var otra = new CarpetaTemporal();
        var envio2 = new EnvioFalso();
        var truenan = new TurnosFalsos(envio2, truena: true);
        var log = new LogEnMemoria();
        var worker2 = new Worker(log, ConTurnos(otra, envio2, new EstadoSoftRestaurant(), truenan));
        await worker2.StartAsync(CancellationToken.None);
        await Esperar(() => envio2.Ciclos >= 2);
        await worker2.StopAsync(CancellationToken.None);

        Assert.True(worker2.ExecuteTask!.IsCompletedSuccessfully);
        Assert.Single(log.De(Microsoft.Extensions.Logging.LogLevel.Error), m => m.Contains("Turnos: falla interna"));
    }
}
