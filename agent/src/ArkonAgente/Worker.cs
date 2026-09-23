using ArkonAgente.Actualizacion;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.Salud;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;

namespace ArkonAgente;

/// <summary>Lo que el worker necesita de afuera; los tests lo sustituyen.</summary>
internal sealed record DependenciasWorker(
    RutasAgente Rutas,
    Func<string, ResultadoConfiguracion> CargarConfig,
    Func<ConfiguracionAgente, IReadOnlyList<IVerificacion>> CrearVerificaciones,
    Func<ConfiguracionAgente, CancellationToken, Task<ResultadoDeteccion>> DetectarSr,
    Func<ConfiguracionAgente, CancellationToken, Task<ResultadoSondeo>> SondearSr,
    EstadoSoftRestaurant EstadoSr,
    Func<ConfiguracionAgente, ILogger, ICicloEnvio> CrearEnvio,
    TimeProvider Reloj,
    string VersionAgente,
    TimeSpan ReintentoConfig,
    Action<int> TerminarProceso,
    Func<ConfiguracionAgente, ILogger, IRevisorActualizacion>? CrearRevisor = null)
{
    public static readonly TimeSpan ReintentoConfigPorDefecto = TimeSpan.FromSeconds(60);

    public static DependenciasWorker Reales(RutasAgente rutas, EstadoSoftRestaurant estadoSr) =>
        new(rutas, CargadorConfiguracion.Cargar, Diagnosticador.VerificacionesPara, DetectarDeVerdad, SondearDeVerdad,
            estadoSr, (config, logger) => CrearEnvioDeVerdad(rutas, config, logger), TimeProvider.System,
            ArmadorHeartbeat.VersionAgente(), ReintentoConfigPorDefecto, TerminarDeVerdad,
            (config, logger) => CrearRevisorDeVerdad(rutas, config, logger));

    /// <summary>La auto-actualización real (F2-143): el canal del api y el estado en <c>actualizacion\estado.db</c>.</summary>
    internal static RevisorActualizacion CrearRevisorDeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger)
    {
        var carpeta = CarpetaActualizacion.De(rutas);
        var cliente = new ClienteCanal(config);
        return new RevisorActualizacion(
            carpeta, cliente, EstadoActualizacion.Abrir(carpeta.Estado), ArmadorHeartbeat.VersionAgente(),
            TimeProvider.System, logger, cliente);
    }

    /// <summary>La cola real: <c>cola.db</c> en la carpeta del agente, y el envío al API.</summary>
    internal static EnviadorCola CrearEnvioDeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger) =>
        new(ColaLocal.Abrir(rutas.ArchivoCola, TimeProvider.System), config, logger, TimeProvider.System);

    private static Task<ResultadoDeteccion> DetectarDeVerdad(ConfiguracionAgente config, CancellationToken cancelacion) =>
        new DetectorVersionSr(new ConexionSoftRestaurant(config.ConnectionString)).DetectarAsync(cancelacion);

    private static Task<ResultadoSondeo> SondearDeVerdad(ConfiguracionAgente config, CancellationToken cancelacion) =>
        new SondeoSr(new ConexionSoftRestaurant(config.ConnectionString), TimeProvider.System).SondearAsync(cancelacion);

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
/// conexiones, detecta la versión de SoftRestaurant y elige el reader (F1-021), y
/// entra al ciclo cada <c>intervaloSegundos</c>: sonda a SR, heartbeat a la cola
/// (F1-025) y la cola hacia el API (F1-024). Leer ventas y encolarlas llega en
/// F1-022 / F1-023.
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
    private string? _ultimoMensajeDeteccion;
    private string? _ultimoErrorSondeo;
    private string? _ultimaFallaInterna;
    private string? _ultimaFallaActualizacion;

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
                // Warning y el servicio sigue. Hasta F1-021 el agente sólo lee vistas de
                // catálogo y una fila de dbo.parametros2 (la versión), nunca tablas de
                // operación. Si el agente debe NEGARSE a leer con un usuario que puede
                // escribir es decisión abierta para Ricardo; si F1-022 llega sin
                // decidirse, lo conservador es NO leer las tablas de operación con ese
                // usuario (ficha de F1-022 en backlog.md).
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
        // Una falla de la cola (disco lleno, cola.db corrupto) no se atrapa: es falla
        // interna, el proceso muere con código 1 y `sc failure` lo levanta.
        using var envio = _dep.CrearEnvio(config, _logger);
        using var revisor = _dep.CrearRevisor?.Invoke(config, _logger);
        // El primer ciclo corre al arrancar: lo pendiente de antes de un reinicio sale
        // sin esperar al primer tick, y el panel ve al agente de inmediato.
        await UnCicloAsync(config, envio, revisor, stoppingToken);

        using var temporizador = new PeriodicTimer(TimeSpan.FromSeconds(config.IntervaloSegundos));
        while (await temporizador.WaitForNextTickAsync(stoppingToken))
        {
            await UnCicloAsync(config, envio, revisor, stoppingToken);
        }
    }

    /// <summary>
    /// Un ciclo: consultar SR, encolar el heartbeat y vaciar la cola. El heartbeat se
    /// encola SIEMPRE, antes de enviar: así sale un lote por ciclo aunque no haya cheques,
    /// que es lo que el panel lee como "conectado" (F1-061). F1-022 / F1-023 encolan
    /// cheques y snapshot aquí, también antes de enviar.
    /// </summary>
    private async Task UnCicloAsync(
        ConfiguracionAgente config, ICicloEnvio envio, IRevisorActualizacion? revisor, CancellationToken stoppingToken)
    {
        await ConsultarSrAsync(config, stoppingToken);
        EncolarHeartbeat(envio);
        await envio.CicloAsync(stoppingToken);
        if (revisor is not null)
        {
            await RevisarActualizacionAsync(revisor, stoppingToken);
        }
    }

    /// <summary>
    /// La auto-actualización (F2-143), DESPUÉS del heartbeat y del envío: una falla aquí nunca deja
    /// al panel sin reporte. Una excepción no prevista (disco, SQLite del estado) queda en el log una
    /// vez por tipo y el ciclo sigue: el agente viejo es mejor que ningún agente.
    /// </summary>
    private async Task RevisarActualizacionAsync(IRevisorActualizacion revisor, CancellationToken stoppingToken)
    {
        try
        {
            await revisor.CicloAsync(stoppingToken);
            _ultimaFallaActualizacion = null;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (ex.GetType().FullName != _ultimaFallaActualizacion)
            {
                _ultimaFallaActualizacion = ex.GetType().FullName;
                _logger.LogError(ex, "Auto-actualización: falla interna; el agente sigue con su versión actual.");
            }
        }
    }

    /// <summary>
    /// Detección (mientras no haya reader) y sonda (con reader). Una excepción de aquí que
    /// no sea la parada del servicio NO corta el ciclo: si lo cortara, no saldría el
    /// heartbeat y el panel vería "desconectado" cuando el agente está vivo y el problema es
    /// otro. Queda en el log y en el <c>ultimoError</c> del heartbeat.
    /// </summary>
    private async Task ConsultarSrAsync(ConfiguracionAgente config, CancellationToken stoppingToken)
    {
        try
        {
            await DetectarSiFaltaAsync(config, stoppingToken);
            if (_dep.EstadoSr.Reader is not null)
            {
                await SondearAsync(config, stoppingToken);
            }

            _ultimaFallaInterna = null;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Sólo el tipo en el heartbeat: el mensaje podría citar la cadena de conexión.
            var mensaje = $"Falla interna del agente al consultar SoftRestaurant ({ex.GetType().Name}); " +
                          "el detalle está en el log del agente.";
            if (_dep.EstadoSr.Reader is null)
            {
                _dep.EstadoSr.Registrar(ResultadoDeteccion.SinConexion(mensaje));
            }
            else
            {
                _dep.EstadoSr.RegistrarSondeo(ResultadoSondeo.Falla(_dep.Reloj.GetUtcNow(), mensaje));
            }

            if (ex.GetType().FullName != _ultimaFallaInterna)
            {
                _ultimaFallaInterna = ex.GetType().FullName;
                _logger.LogError(ex, "{Mensaje} El agente sigue y lo vuelve a intentar en el siguiente ciclo.", mensaje);
            }
        }
    }

    private async Task SondearAsync(ConfiguracionAgente config, CancellationToken stoppingToken)
    {
        var resultado = await _dep.SondearSr(config, stoppingToken);
        _dep.EstadoSr.RegistrarSondeo(resultado);

        if (resultado.Error == _ultimoErrorSondeo)
        {
            return;
        }

        if (resultado.Error is { } error)
        {
            _logger.LogWarning("{Error} Se vuelve a intentar cada {Segundos} s.", error, config.IntervaloSegundos);
        }
        else
        {
            _logger.LogInformation("SoftRestaurant vuelve a responder ({Ms} ms).", resultado.LatenciaMs);
        }

        _ultimoErrorSondeo = resultado.Error;
    }

    /// <summary>
    /// El heartbeat del ciclo (F1-025). Una falla de SQLite aquí no se atrapa: es falla
    /// interna, código 1 y <c>sc failure</c>, igual que en el envío.
    /// </summary>
    private void EncolarHeartbeat(ICicloEnvio envio)
    {
        var sr = _dep.EstadoSr;
        var entrada = new EntradaHeartbeat(
            _dep.VersionAgente,
            sr.VersionSr,
            sr.Reader is null ? sr.UltimoError : sr.ErrorLectura,
            sr.UltimaLecturaAt,
            sr.Reader is null ? null : sr.LatenciaQueryMs,
            envio.Cola.ContarPendientesSinHeartbeat(),
            envio.Estado,
            envio.Cola.ResumenRechazados(),
            _dep.Reloj.GetUtcNow());
        envio.Cola.Encolar(TipoEvento.Heartbeat, ArmadorHeartbeat.ArmarJson(entrada));
    }

    /// <summary>
    /// Mientras no haya reader, detecta la versión de SoftRestaurant en cada ciclo:
    /// el servidor puede estar apagado al arrancar o el técnico puede corregir la
    /// base. Una versión no soportada o una base inalcanzable NO tumban el servicio:
    /// quedan en el log (una vez por cada mensaje distinto) y en
    /// <see cref="EstadoSoftRestaurant"/> para el heartbeat. Con el reader elegido
    /// ya no se vuelve a detectar; si SR se actualiza, basta reiniciar el servicio.
    /// </summary>
    private async Task DetectarSiFaltaAsync(ConfiguracionAgente config, CancellationToken stoppingToken)
    {
        if (_dep.EstadoSr.Reader is not null)
        {
            return;
        }

        var resultado = await _dep.DetectarSr(config, stoppingToken);
        _dep.EstadoSr.Registrar(resultado);

        var mensaje = resultado.Error ?? resultado.VersionSr;
        if (mensaje == _ultimoMensajeDeteccion)
        {
            return;
        }

        _ultimoMensajeDeteccion = mensaje;
        switch (resultado.Estado)
        {
            case EstadoDeteccion.Soportada:
                _logger.LogInformation(
                    "SoftRestaurant versión {VersionSr} detectado; se lee con {Reader}.",
                    resultado.VersionSr, resultado.Reader!.Nombre);
                if (resultado.Aviso is { } aviso)
                {
                    _logger.LogWarning("SoftRestaurant: {Aviso}", aviso);
                }

                break;
            case EstadoDeteccion.NoSoportada:
                _logger.LogError(
                    "SoftRestaurant: {Error} El agente no leerá ventas hasta resolverlo; lo vuelve a intentar cada {Segundos} s.",
                    resultado.Error, config.IntervaloSegundos);
                break;
            default:
                _logger.LogWarning(
                    "{Error} Se vuelve a intentar cada {Segundos} s.", resultado.Error, config.IntervaloSegundos);
                break;
        }
    }
}
