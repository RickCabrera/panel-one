using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

public partial class WorkerTests
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
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            SinEnvio,
            TimeProvider.System,
            VersionDePrueba,
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
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            SinEnvio,
            TimeProvider.System,
            VersionDePrueba,
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
            carpeta.Rutas, _ => new ResultadoConfiguracion(Datos.Config(), [], []), _ => [api], DetectaSr10, SondeoOk,
            new EstadoSoftRestaurant(), SinEnvio, TimeProvider.System, VersionDePrueba,
            Reintento, NoTermina);
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => api.Llamadas == 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Contains("Configuración cargada", log.Todo);
        Assert.DoesNotContain(Datos.ApiKey, log.Todo);
        Assert.DoesNotContain(Datos.Password, log.Todo);
    }

    private static DependenciasWorker ConDeteccion(
        CarpetaTemporal carpeta, Func<ResultadoDeteccion> detectar, EstadoSoftRestaurant estado) =>
        new(carpeta.Rutas,
            _ => new ResultadoConfiguracion(Datos.Config() with { IntervaloSegundos = 1 }, [], []),
            _ => [],
            (_, _) => Task.FromResult(detectar()),
            SondeoOk,
            estado,
            SinEnvio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina);

    [Fact]
    public async Task Vacia_la_cola_al_arrancar_y_en_cada_ciclo_y_la_libera_al_detenerse()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var dep = ConDeteccion(carpeta, () => ResultadoDeteccion.Soportada(new SrV11Reader(new VersionSr("10.021800", 10))),
            new EstadoSoftRestaurant()) with { CrearEnvio = (_, _) => envio };
        var worker = new Worker(new LogEnMemoria(), dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 3); // el de arranque y dos ticks de 1 s
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.True(envio.Liberado);
    }

    [Fact]
    public void La_composicion_real_crea_la_cola_en_cola_db_de_la_carpeta_del_agente()
    {
        using var carpeta = new CarpetaTemporal();
        var dep = DependenciasWorker.Reales(carpeta.Rutas, new EstadoSoftRestaurant());

        using var envio = dep.CrearEnvio(Datos.Config(), new LogEnMemoria());

        var real = Assert.IsType<EnviadorCola>(envio);
        Assert.Equal(Path.Combine(carpeta.Ruta, "cola.db"), real.Cola.Ruta);
        Assert.True(File.Exists(Path.Combine(carpeta.Ruta, "cola.db")));
        Assert.Equal(0, real.Cola.ContarPendientes());
    }

    [Fact]
    public void RutasAgente_pone_la_cola_junto_al_config()
    {
        Assert.Equal(Path.Combine("C:\\x", "cola.db"), new RutasAgente("C:\\x").ArchivoCola);
    }

    [Fact]
    public async Task Version_de_SR_no_soportada_se_registra_una_vez_y_el_servicio_sigue()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var estado = new EstadoSoftRestaurant();
        var detecciones = 0;
        var worker = new Worker(log, ConDeteccion(carpeta, () =>
        {
            Interlocked.Increment(ref detecciones);
            return ResultadoDeteccion.NoSoportada("SoftRestaurant versión 12.000000 no soportada.", "12.000000");
        }, estado));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => Volatile.Read(ref detecciones) >= 3); // reintenta en cada ciclo
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        var error = Assert.Single(log.De(LogLevel.Error));
        Assert.Contains("12.000000 no soportada", error);
        Assert.Contains("no leerá ventas", error);
        Assert.Null(estado.Reader);
        Assert.Equal("12.000000", estado.VersionSr);
        Assert.Equal("SoftRestaurant versión 12.000000 no soportada.", estado.UltimoError);
        Assert.Contains("Agente detenido.", log.Todo);
    }

    [Fact]
    public async Task Sin_conexion_reintenta_y_al_detectar_elige_el_reader_y_deja_de_detectar()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var estado = new EstadoSoftRestaurant();
        var detecciones = 0;
        var worker = new Worker(log, ConDeteccion(carpeta, () =>
            Interlocked.Increment(ref detecciones) < 3
                ? ResultadoDeteccion.SinConexion("No se pudo detectar la versión de SoftRestaurant. Servidor apagado.")
                : ResultadoDeteccion.Soportada(new SrV11Reader(new VersionSr("10.021800", 10))),
            estado));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => estado.Reader is not null);
        await Task.Delay(TimeSpan.FromSeconds(2.5)); // al menos dos ciclos más de 1 s
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(3, Volatile.Read(ref detecciones));
        Assert.IsType<SrV11Reader>(estado.Reader);
        Assert.Equal("10.021800", estado.VersionSr);
        Assert.Null(estado.UltimoError);
        Assert.Single(log.De(LogLevel.Warning), m => m.Contains("Servidor apagado."));
        Assert.Empty(log.De(LogLevel.Error));
        Assert.Contains(log.De(LogLevel.Information),
            m => m.Contains("SoftRestaurant versión 10.021800 detectado; se lee con SrV11Reader."));
    }

    [Fact]
    public async Task Version_11_elige_el_reader_con_advertencia()
    {
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var estado = new EstadoSoftRestaurant();
        var worker = new Worker(log, ConDeteccion(carpeta, () =>
            ResultadoDeteccion.Soportada(new SrV11Reader(new VersionSr("11.0", 11)), "SoftRestaurant 11 no se ha validado."),
            estado));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => estado.Reader is not null);
        await worker.StopAsync(CancellationToken.None);

        Assert.Contains(log.De(LogLevel.Warning), m => m.Contains("SoftRestaurant 11 no se ha validado."));
        Assert.Contains(log.De(LogLevel.Information), m => m.Contains("versión 11.0 detectado"));
    }

    [Fact]
    public async Task Una_excepcion_al_detectar_no_corta_el_ciclo_el_heartbeat_sale_con_el_error()
    {
        // F1-025 (observación obligatoria del revisor): si una excepción de la detección
        // cortara el ciclo, no saldría el heartbeat y el panel vería "desconectado" con el
        // agente vivo. Antes de F1-025 esto terminaba el proceso con código 1.
        using var carpeta = new CarpetaTemporal();
        var log = new LogEnMemoria();
        var envio = new EnvioFalso();
        var dep = ConDeteccion(carpeta, () => throw new InvalidOperationException("bug con " + Datos.Password),
            new EstadoSoftRestaurant()) with { CrearEnvio = (_, _) => envio };
        var worker = new Worker(log, dep);

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Ciclos >= 3);
        await worker.StopAsync(CancellationToken.None);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.All(envio.HeartbeatsPorCiclo, n => Assert.Equal(1, n));
        var hb = envio.Heartbeats[^1];
        Assert.Contains("Falla interna del agente al consultar SoftRestaurant (InvalidOperationException)",
            hb.GetProperty("ultimoError").GetString());
        Assert.DoesNotContain(Datos.Password, hb.GetRawText());
        Assert.Single(log.De(LogLevel.Error)); // una vez, no en cada ciclo
        Assert.Empty(log.De(LogLevel.Critical));
    }

    private static Task<ResultadoDeteccion> DetectaSr10(ConfiguracionAgente config, CancellationToken cancelacion) =>
        Task.FromResult(ResultadoDeteccion.Soportada(new SrV11Reader(new VersionSr("10.021800", 10))));

    private static ICicloEnvio SinEnvio(ConfiguracionAgente config, ILogger logger) => new EnvioFalso();

    internal const string VersionDePrueba = "9.9.9+abcdef0";

    internal static readonly DateTimeOffset InstanteSondeo = new(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);

    private static Task<ResultadoSondeo> SondeoOk(ConfiguracionAgente config, CancellationToken cancelacion) =>
        Task.FromResult(ResultadoSondeo.Exito(InstanteSondeo, 7));

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
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            SinEnvio,
            TimeProvider.System,
            VersionDePrueba,
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
