using ArkonAgente.Actualizacion;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>El worker y la auto-actualización (F2-143).</summary>
public partial class WorkerTests
{
    /// <summary>Revisor que anota cuándo corrió (cuántos ciclos de envío había) y puede tronar.</summary>
    private sealed class RevisorFalso(EnvioFalso envio, bool truena) : IRevisorActualizacion
    {
        private readonly List<int> _enviosAlRevisar = [];

        public IReadOnlyList<int> EnviosAlRevisar
        {
            get { lock (_enviosAlRevisar) { return _enviosAlRevisar.ToList(); } }
        }

        public bool Liberado { get; private set; }

        public Task CicloAsync(CancellationToken cancelacion)
        {
            lock (_enviosAlRevisar)
            {
                _enviosAlRevisar.Add(envio.Ciclos);
            }

            return truena ? throw new IOException("disco lleno (sintético)") : Task.CompletedTask;
        }

        public void Dispose() => Liberado = true;
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task La_auto_actualizacion_corre_DESPUES_del_envio_y_si_truena_el_heartbeat_sigue(bool truena)
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var revisor = new RevisorFalso(envio, truena);
        var config = Datos.Config() with { IntervaloSegundos = ConfiguracionAgente.IntervaloMinimo };
        var dep = new DependenciasWorker(
            carpeta.Rutas,
            _ => new ResultadoConfiguracion(config, [], []),
            _ => [],
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            (_, _) => envio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina,
            (_, _) => revisor);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => revisor.EnviosAlRevisar.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        // En el primer ciclo, el revisor corrió con el envío ya hecho (el heartbeat ya salió).
        Assert.Equal(1, revisor.EnviosAlRevisar[0]);
        Assert.Single(envio.HeartbeatsPorCiclo.Take(1));
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.True(revisor.Liberado);
        Assert.Contains("Agente detenido.", log.Todo);
        var errores = log.De(LogLevel.Error).Where(m => m.Contains("Auto-actualización", StringComparison.Ordinal)).ToList();
        Assert.Equal(truena ? 1 : 0, errores.Count);
    }
}
