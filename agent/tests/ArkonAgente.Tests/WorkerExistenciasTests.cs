using ArkonAgente.Catalogos;
using ArkonAgente.Configuracion;
using ArkonAgente.Inventario;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>El worker y las existencias (F2-241).</summary>
public partial class WorkerTests
{
    /// <summary>Anota cuántos ciclos de envío había al correr; puede tronar.</summary>
    private sealed class ExistenciasFalsas(EnvioFalso envio, bool truena) : ISincronizadorExistencias
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

    private DependenciasWorker ConExistencias(
        CarpetaTemporal carpeta, EnvioFalso envio, ISincronizadorCatalogos? catalogos, ExistenciasFalsas existencias) =>
        new(
            carpeta.Rutas,
            _ => new ResultadoConfiguracion(Datos.Config() with { IntervaloSegundos = ConfiguracionAgente.IntervaloMinimo }, [], []),
            _ => [],
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            (_, _) => envio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina,
            CrearCatalogos: catalogos is null ? null : (_, _) => catalogos,
            CrearExistencias: (_, _) => existencias);

    [Fact]
    public async Task Las_existencias_corren_despues_del_heartbeat_y_de_los_catalogos_y_si_truenan_el_ciclo_sigue()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var catalogos = new CatalogosFalsos(envio, truena: true, TimeSpan.Zero);
        var existencias = new ExistenciasFalsas(envio, truena: true);
        var worker = new Worker(log, ConExistencias(carpeta, envio, catalogos, existencias));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => existencias.EnviosAlCorrer.Count >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(1, existencias.EnviosAlCorrer[0]); // el heartbeat ya había salido
        Assert.True(catalogos.EnviosAlCorrer.Count >= existencias.EnviosAlCorrer.Count); // aunque catálogos trone
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n)); // un heartbeat por ciclo, siempre
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.True(existencias.Liberado);
        Assert.Single(log.De(LogLevel.Error), m => m.Contains("Existencias: falla interna")); // una vez, no por ciclo
        Assert.Empty(log.De(LogLevel.Critical));
    }

    [Fact]
    public async Task Sin_reader_elegido_no_se_tocan_las_existencias()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var existencias = new ExistenciasFalsas(envio, truena: false);
        var dep = ConExistencias(carpeta, envio, null, existencias) with
        {
            DetectarSr = (_, _) => Task.FromResult(ResultadoDeteccion.NoSoportada("versión desconocida")),
        };
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Empty(existencias.EnviosAlCorrer);
    }
}
