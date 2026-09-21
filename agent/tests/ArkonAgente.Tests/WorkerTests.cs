using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

public class WorkerTests
{
    private static readonly TimeSpan Reintento = TimeSpan.FromMilliseconds(20);

    [Fact]
    public async Task Config_invalida_no_tumba_el_proceso_y_el_error_se_registra_una_vez()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var lecturas = 0;
        var dep = new DependenciasWorker(
            carpeta.Rutas,
            _ => { Interlocked.Increment(ref lecturas); return new ResultadoConfiguracion(null, ["Falta el campo 'apiKey'."], []); },
            _ => throw new InvalidOperationException("no debe diagnosticar sin config"),
            Reintento,
            NoTermina);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => Volatile.Read(ref lecturas) >= 5);
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        var errores = log.De(LogLevel.Error);
        var error = Assert.Single(errores);
        Assert.Contains("Falta el campo 'apiKey'.", error);
        Assert.Contains(Path.Combine(carpeta.Ruta, "config.json"), error);
        Assert.Contains("Agente detenido.", log.Todo);
    }

    [Fact]
    public async Task Cuando_la_config_se_corrige_sigue_solo_y_diagnostica()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var lecturas = 0;
        var sql = new VerificacionFija("SQL Server (SoftRestaurant)", false);
        var api = new VerificacionFija("API del monitor", true);
        var dep = new DependenciasWorker(
            carpeta.Rutas,
            _ => Interlocked.Increment(ref lecturas) < 3
                ? new ResultadoConfiguracion(null, ["mal"], [])
                : new ResultadoConfiguracion(Datos.Config(), [], []),
            _ => [sql, api],
            Reintento,
            NoTermina);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => api.Llamadas == 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.Single(log.De(LogLevel.Error));
        Assert.Contains("La configuración ya es válida.", log.Todo);
        Assert.Contains(log.De(LogLevel.Warning), m => m.Contains("SQL Server (SoftRestaurant): FALLA"));
        Assert.Contains(log.De(LogLevel.Information), m => m.Contains("API del monitor: OK"));
        Assert.Equal(1, sql.Llamadas);
    }

    [Fact]
    public async Task El_log_no_trae_secretos()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var api = new VerificacionFija("API", true);
        var dep = new DependenciasWorker(
            carpeta.Rutas, _ => new ResultadoConfiguracion(Datos.Config(), [], []), _ => [api], Reintento, NoTermina);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => api.Llamadas == 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Contains("Configuración cargada", log.Todo);
        Assert.DoesNotContain(Datos.ApiKey, log.Todo);
        Assert.DoesNotContain(Datos.Password, log.Todo);
    }

    private static void NoTermina(int codigo) => Assert.Fail($"El worker no debía terminar el proceso (código {codigo}).");

    [Fact]
    public async Task Falla_interna_se_registra_como_critica_y_termina_el_proceso_con_codigo_1()
    {
        // Con el default de .NET 8 (StopHost) el servicio se detendría "limpio" y
        // `sc failure` no lo reiniciaría: el worker tiene que matar el proceso.
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        int? codigo = null;
        var dep = new DependenciasWorker(
            carpeta.Rutas,
            _ => throw new IOException("disco lleno"),
            _ => [],
            Reintento,
            c => codigo = c);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => codigo is not null);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(1, codigo);
        Assert.Contains(log.De(LogLevel.Critical), m => m.Contains("código 1"));
        Assert.DoesNotContain("Agente detenido.", log.Todo);
    }

    private static async Task Esperar(Func<bool> condicion)
    {
        var limite = DateTime.UtcNow.AddSeconds(10);
        while (!condicion())
        {
            Assert.True(DateTime.UtcNow < limite, "La condición no se cumplió en 10 s.");
            await Task.Delay(10);
        }
    }

    private sealed class LogEnMemoria : ILogger<Worker>
    {
        private readonly List<(LogLevel Nivel, string Mensaje)> _entradas = [];

        public string Todo
        {
            get { lock (_entradas) { return string.Join("\n", _entradas.Select(e => e.Mensaje)); } }
        }

        public IReadOnlyList<string> De(LogLevel nivel)
        {
            lock (_entradas)
            {
                return _entradas.Where(e => e.Nivel == nivel).Select(e => e.Mensaje).ToList();
            }
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (_entradas)
            {
                _entradas.Add((logLevel, formatter(state, exception)));
            }
        }
    }
}

public class RutasAgenteTests
{
    [Fact]
    public void Por_defecto_es_ProgramData_ArkonAgente()
    {
        var rutas = RutasAgente.PorDefecto(null);
        var esperada = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ArkonAgente");

        Assert.Equal(esperada, rutas.Carpeta);
        Assert.Equal(Path.Combine(esperada, "config.json"), rutas.ArchivoConfig);
        Assert.Equal(Path.Combine(esperada, "logs", "agente-.log"), rutas.PlantillaLog);
    }

    [Fact]
    public void La_variable_cambia_la_carpeta()
    {
        Assert.Equal("D:\\otra", RutasAgente.PorDefecto("D:\\otra").Carpeta);
        Assert.Equal(RutasAgente.PorDefecto(null), RutasAgente.PorDefecto("  "));
    }
}
