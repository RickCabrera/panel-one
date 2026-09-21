namespace ArkonAgente;

/// <summary>
/// Esqueleto del worker: arranca, deja constancia en el log y espera a que lo
/// paren. El ciclo real —leer SoftRestaurant, encolar en el SQLite local y
/// enviar al API— llega en F1-020 / F1-021 / F1-024.
/// </summary>
/// <remarks>
/// Cuando ese ciclo exista, la lectura del POS es SOLO LECTURA: nada de INSERT,
/// UPDATE, DELETE ni CREATE contra la base de SoftRestaurant, ni siquiera una
/// tabla auxiliar para el cursor. El estado propio del agente vive en su SQLite.
/// </remarks>
public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;

    public Worker(ILogger<Worker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Agente iniciado. Sin ciclo de lectura configurado todavia (F1-020).");

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Parada normal del servicio: no es un error y no se registra como tal.
        }

        _logger.LogInformation("Agente detenido.");
    }
}
