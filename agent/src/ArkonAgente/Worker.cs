using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.Sql;

namespace ArkonAgente;

/// <summary>Lo que el worker necesita de afuera; los tests lo sustituyen.</summary>
internal sealed record DependenciasWorker(
    RutasAgente Rutas,
    Func<string, ResultadoConfiguracion> CargarConfig,
    Func<ConfiguracionAgente, IReadOnlyList<IVerificacion>> CrearVerificaciones,
    TimeSpan ReintentoConfig,
    Action<int> TerminarProceso)
{
    public static readonly TimeSpan ReintentoConfigPorDefecto = TimeSpan.FromSeconds(60);

    public static DependenciasWorker Reales(RutasAgente rutas) =>
        new(rutas, CargadorConfiguracion.Cargar, Diagnosticador.VerificacionesPara, ReintentoConfigPorDefecto, TerminarDeVerdad);

    /// <summary>
    /// Mata el proceso con código distinto de cero, como indica la guía de Microsoft
    /// para servicios con BackgroundService. Con el default de .NET 8
    /// (<c>BackgroundServiceExceptionBehavior.StopHost</c>) una excepción en el worker
    /// detiene el host "limpio", el servicio se reporta detenido sin error y
    /// <c>sc failure</c> nunca lo reinicia.
    /// </summary>
    private static void TerminarDeVerdad(int codigo)
    {
        Serilog.Log.CloseAndFlush();
        Environment.Exit(codigo);
    }
}

/// <summary>
/// El servicio. Carga la config, deja en el log un diagnóstico de las dos
/// conexiones y entra al ciclo cada <c>intervaloSegundos</c>. El trabajo del ciclo
/// —leer SoftRestaurant, encolar en el SQLite local y enviar al API— llega en
/// F1-021 / F1-024.
/// </summary>
/// <remarks>
/// <para>
/// Con la config inválida el proceso NO termina: registra los errores y la vuelve
/// a leer cada minuto. Si terminara, <c>sc failure</c> lo reiniciaría en bucle sin
/// arreglar nada; así, en cuanto el técnico corrige el archivo, el servicio sigue
/// solo. Los errores se registran una vez por cada cambio, no cada minuto.
/// </para>
/// <para>
/// La lectura del POS es SOLO LECTURA: nada de INSERT, UPDATE, DELETE ni CREATE
/// contra la base de SoftRestaurant, ni siquiera una tabla auxiliar para el cursor.
/// El estado propio del agente vive en su SQLite.
/// </para>
/// </remarks>
internal sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly DependenciasWorker _dep;

    public Worker(ILogger<Worker> logger, DependenciasWorker dependencias)
    {
        _logger = logger;
        _dep = dependencias;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Agente iniciado. Carpeta: {Carpeta}", _dep.Rutas.Carpeta);

        try
        {
            var config = await EsperarConfigValidaAsync(stoppingToken);
            await DiagnosticarAsync(config, stoppingToken);
            await CicloAsync(config, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Parada normal del servicio: no es un error y no se registra como tal.
        }
        catch (Exception ex)
        {
            // Falla interna no prevista: el proceso muere con código 1 para que el
            // administrador de servicios aplique `sc failure` y lo levante de nuevo.
            _logger.LogCritical(ex, "El agente falló y se termina con código 1 para que Windows lo reinicie.");
            _dep.TerminarProceso(1);
            return;
        }

        _logger.LogInformation("Agente detenido.");
    }

    private async Task<ConfiguracionAgente> EsperarConfigValidaAsync(CancellationToken stoppingToken)
    {
        string? ultimosErrores = null;
        while (true)
        {
            var resultado = _dep.CargarConfig(_dep.Rutas.ArchivoConfig);
            foreach (var aviso in resultado.Avisos)
            {
                _logger.LogWarning("Configuración: {Aviso}", aviso);
            }

            if (resultado.Configuracion is { } config)
            {
                if (ultimosErrores is not null)
                {
                    _logger.LogInformation("La configuración ya es válida.");
                }

                return config;
            }

            var errores = string.Join(" | ", resultado.Errores);
            if (errores != ultimosErrores)
            {
                _logger.LogError(
                    "Configuración inválida en {Archivo}: {Errores} Se vuelve a leer cada {Segundos} s; " +
                    "corre 'agente test' para ver el detalle.",
                    _dep.Rutas.ArchivoConfig, errores, _dep.ReintentoConfig.TotalSeconds);
                ultimosErrores = errores;
            }

            await Task.Delay(_dep.ReintentoConfig, stoppingToken);
        }
    }

    private async Task DiagnosticarAsync(ConfiguracionAgente config, CancellationToken stoppingToken)
    {
        var conexion = new ConexionSoftRestaurant(config.ConnectionString);
        _logger.LogInformation(
            "Configuración cargada: api={ApiUrl}, sql=[{Sql}], intervalo={Intervalo} s",
            config.ApiUrl, conexion.Resumen(), config.IntervaloSegundos);

        var reporte = await Diagnosticador.EjecutarAsync(
            _dep.Rutas.ArchivoConfig, new ResultadoConfiguracion(config, [], []), _dep.CrearVerificaciones, stoppingToken);

        foreach (var v in reporte.Verificaciones)
        {
            if (v.Ok)
            {
                _logger.LogInformation("Diagnóstico {Nombre}: OK. {Detalle}", v.Nombre, v.Detalle);
            }
            else
            {
                // DECISION PROVISIONAL (nocturno): una conexión que falla al arrancar
                // (incluido un usuario SQL con permisos de escritura) se registra como
                // Warning y el servicio sigue. En F1-020 todavía no lee SR, así que no hay
                // nada que negarle. Si el agente debe NEGARSE a leer con un usuario que
                // puede escribir es decisión abierta para Ricardo (ver nocturno-log).
                _logger.LogWarning(
                    "Diagnóstico {Nombre}: FALLA. {Detalle} {Sugerencia}", v.Nombre, v.Detalle, v.Sugerencia ?? "");
            }

            foreach (var aviso in v.AvisosOVacio)
            {
                _logger.LogWarning("Diagnóstico {Nombre}: {Aviso}", v.Nombre, aviso);
            }
        }
    }

    private async Task CicloAsync(ConfiguracionAgente config, CancellationToken stoppingToken)
    {
        using var temporizador = new PeriodicTimer(TimeSpan.FromSeconds(config.IntervaloSegundos));
        while (await temporizador.WaitForNextTickAsync(stoppingToken))
        {
            // F1-021 / F1-024: leer SR, encolar y enviar.
            _logger.LogDebug("Ciclo sin trabajo configurado todavía.");
        }
    }
}
