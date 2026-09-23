using ArkonAgente.Catalogos;
using ArkonAgente.Configuracion;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>El worker y los catálogos (F2-240).</summary>
public partial class WorkerTests
{
    /// <summary>Anota cuántos ciclos de envío había al correr; puede tronar o tardar mucho.</summary>
    private sealed class CatalogosFalsos(EnvioFalso envio, bool truena, TimeSpan tarda) : ISincronizadorCatalogos
    {
        private readonly List<int> _enviosAlCorrer = [];

        public IReadOnlyList<int> EnviosAlCorrer
        {
            get { lock (_enviosAlCorrer) { return _enviosAlCorrer.ToList(); } }
        }

        public bool Liberado { get; private set; }

        public async Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion)
        {
            lock (_enviosAlCorrer)
            {
                _enviosAlCorrer.Add(envio.Ciclos);
            }

            if (truena)
            {
                throw new IOException("disco lleno (sintético)");
            }

            await Task.Delay(tarda, cancelacion);
        }

        public void Dispose() => Liberado = true;
    }

    private DependenciasWorker ConCatalogos(
        CarpetaTemporal carpeta, EnvioFalso envio, CatalogosFalsos catalogos,
        Func<ConfiguracionAgente, CancellationToken, Task<ResultadoDeteccion>>? detectar = null) =>
        new(
            carpeta.Rutas,
            _ => new ResultadoConfiguracion(Datos.Config() with { IntervaloSegundos = ConfiguracionAgente.IntervaloMinimo }, [], []),
            _ => [],
            detectar ?? DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            (_, _) => envio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina,
            CrearCatalogos: (_, _) => catalogos);

    [Fact]
    public async Task Los_catalogos_corren_DESPUES_del_heartbeat_y_si_truenan_el_heartbeat_sigue()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var catalogos = new CatalogosFalsos(envio, truena: true, TimeSpan.Zero);
        var worker = new Worker(log, ConCatalogos(carpeta, envio, catalogos));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => catalogos.EnviosAlCorrer.Count >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(1, catalogos.EnviosAlCorrer[0]); // el envío (con el heartbeat) ya había salido
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.True(catalogos.Liberado);
        Assert.Single(log.De(LogLevel.Error), m => m.Contains("Catálogos: falla interna")); // una vez, no por ciclo
        Assert.Empty(log.De(LogLevel.Critical));
    }

    [Fact]
    public async Task Unos_catalogos_lentos_no_retrasan_el_primer_heartbeat()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var catalogos = new CatalogosFalsos(envio, truena: false, TimeSpan.FromMinutes(5));
        var worker = new Worker(log, ConCatalogos(carpeta, envio, catalogos));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => catalogos.EnviosAlCorrer.Count >= 1);
        await worker.StopAsync(CancellationToken.None); // la parada corta la espera

        Assert.Single(envio.Heartbeats); // salió antes de que los catálogos empezaran
        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task Sin_reader_elegido_no_se_tocan_los_catalogos()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var catalogos = new CatalogosFalsos(envio, truena: false, TimeSpan.Zero);
        var worker = new Worker(log, ConCatalogos(carpeta, envio, catalogos,
            (_, _) => Task.FromResult(ResultadoDeteccion.NoSoportada("versión desconocida"))));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 2);
        await worker.StopAsync(CancellationToken.None);

        Assert.Empty(catalogos.EnviosAlCorrer);
    }
}
