using ArkonAgente;
using ArkonAgente.Actualizacion;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Serilog;
using Serilog.Events;

// Sólo aquí se lee ARKON_AGENTE_DIR: el resto recibe la carpeta ya resuelta.
var rutas = RutasAgente.PorDefecto(Environment.GetEnvironmentVariable(RutasAgente.VariableCarpeta));

// F2-143: el watchdog de la auto-actualización. Es un SERVICIO, no un comando de consola.
if (args is ["actualizador"])
{
    return await CorrerActualizadorAsync(rutas);
}

if (args.Length > 0)
{
    // La consola de Windows arranca en la página OEM (850): sin esto, "Configuración"
    // sale como "Configuraci�n" en el reporte de `agente test`.
    Console.OutputEncoding = new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
    return await LineaDeComandos.EjecutarAsync(args, rutas, Console.Out);
}

// Sin argumentos: el servicio (o el proceso en consola, para desarrollo). El log
// no depende de la config: si config.json está mal, el error tiene dónde quedar.
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
    .MinimumLevel.Override("System.Net.Http", LogEventLevel.Warning)
    .WriteTo.Console()
    .WriteTo.File(
        rutas.PlantillaLog,
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14,
        shared: true)
    .CreateLogger();

try
{
    var builder = Host.CreateApplicationBuilder();
    builder.Services.AddWindowsService(o => o.ServiceName = LineaDeComandos.NombreServicio);
    builder.Services.AddSerilog();
    var estadoSr = new EstadoSoftRestaurant();
    builder.Services.AddSingleton(estadoSr);
    builder.Services.AddSingleton(DependenciasWorker.Reales(rutas, estadoSr));
    builder.Services.AddHostedService<Worker>();

    await builder.Build().RunAsync();
    return 0;
}
catch (Exception ex)
{
    Log.Fatal(ex, "El agente terminó por un error no controlado.");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}

// El servicio ArkonAgenteActualizador (F2-143). Su log va aparte (logs\actualizador-AAAAMMDD.log)
// para que un problema del swap no se pierda entre los del agente.
static async Task<int> CorrerActualizadorAsync(RutasAgente rutas)
{
    Log.Logger = new LoggerConfiguration()
        .MinimumLevel.Information()
        .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
        .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
        .WriteTo.Console()
        .WriteTo.File(
            Path.Combine(rutas.CarpetaLogs, "actualizador-.log"),
            rollingInterval: RollingInterval.Day,
            retainedFileCountLimit: 14,
            shared: true)
        .CreateLogger();

    try
    {
        if (!OperatingSystem.IsWindows())
        {
            Log.Fatal("El actualizador sólo corre en Windows (controla un servicio de Windows).");
            return 1;
        }

        var exeAgente = ServicioActualizador.ExeAgenteDesde(AppContext.BaseDirectory);
        // Fuera del lambda: el análisis de plataforma (CA1416) no ve la guarda de arriba adentro de él.
        IControlServicio control = new ControlServicioWindows(LineaDeComandos.NombreServicio);
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddWindowsService(o => o.ServiceName = ServicioActualizador.NombreServicio);
        builder.Services.AddSerilog();
        builder.Services.AddSingleton(sp => new Actualizador(
            CarpetaActualizacion.De(rutas),
            exeAgente,
            control,
            new ProcesosSistema(),
            (espera, cancelacion) => Task.Delay(espera, cancelacion),
            TimeProvider.System,
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<Actualizador>()));
        builder.Services.AddHostedService<ServicioActualizador>();
        Log.Information("Actualizador: agente en {Exe}, intercambio en {Carpeta}.", exeAgente, CarpetaActualizacion.De(rutas).Ruta);

        await builder.Build().RunAsync();
        return 0;
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "El actualizador terminó por un error no controlado.");
        return 1;
    }
    finally
    {
        await Log.CloseAndFlushAsync();
    }
}
