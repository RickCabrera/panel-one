using ArkonAgente.Configuracion;
using ArkonAgente.Inventario;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>El worker y los movimientos, compras y recetas (F2-241b).</summary>
public partial class WorkerTests
{
    /// <summary>Anota cuántos ciclos de envío había al correr; puede tronar.</summary>
    private sealed class InventarioFalso(EnvioFalso envio, bool truena) : ISincronizadorInventario
    {
        private readonly List<int> _enviosAlCorrer = [];

        public IReadOnlyList<int> EnviosAlCorrer
        {
            get { lock (_enviosAlCorrer) { return _enviosAlCorrer.ToList(); } }
        }

        public bool Liberado { get; private set; }

        public Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion)
        {
            lock (_enviosAlCorrer)
            {
                _enviosAlCorrer.Add(envio.Ciclos);
            }

            return truena ? throw new IOException("cola.db bloqueado (sintético)") : Task.CompletedTask;
        }

        public void Dispose() => Liberado = true;
    }

    private DependenciasWorker ConInventario(
        CarpetaTemporal carpeta, EnvioFalso envio, ExistenciasFalsas existencias, InventarioFalso inventario) =>
        ConExistencias(carpeta, envio, null, existencias) with { CrearInventario = (_, _) => inventario };

    [Fact]
    public async Task El_inventario_corre_despues_del_heartbeat_y_de_las_existencias_y_si_truena_el_ciclo_sigue()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var existencias = new ExistenciasFalsas(envio, truena: true);
        var inventario = new InventarioFalso(envio, truena: true);
        var worker = new Worker(log, ConInventario(carpeta, envio, existencias, inventario));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => inventario.EnviosAlCorrer.Count >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(1, inventario.EnviosAlCorrer[0]); // el heartbeat ya había salido
        Assert.True(existencias.EnviosAlCorrer.Count >= inventario.EnviosAlCorrer.Count); // aunque existencias trone
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.True(inventario.Liberado);
        Assert.Single(log.De(LogLevel.Error), m => m.Contains("Inventario: falla interna")); // una vez, no por ciclo
        Assert.Empty(log.De(LogLevel.Critical));
    }

    [Fact]
    public async Task Sin_reader_elegido_no_se_toca_el_inventario()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var inventario = new InventarioFalso(envio, truena: false);
        var dep = ConInventario(carpeta, envio, new ExistenciasFalsas(envio, truena: false), inventario) with
        {
            DetectarSr = (_, _) => Task.FromResult(ResultadoDeteccion.NoSoportada("versión desconocida")),
        };
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Empty(inventario.EnviosAlCorrer);
    }
}
