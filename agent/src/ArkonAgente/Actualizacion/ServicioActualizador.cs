using System.Diagnostics;
using System.Runtime.Versioning;
using System.ServiceProcess;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Actualizacion;

/// <summary>El servicio del agente en el administrador de servicios de Windows.</summary>
[SupportedOSPlatform("windows")]
internal sealed class ControlServicioWindows(string nombreServicio) : IControlServicio
{
    public EstadoServicio Estado()
    {
        try
        {
            using var sc = new ServiceController(nombreServicio);
            return sc.Status switch
            {
                ServiceControllerStatus.Stopped => EstadoServicio.Detenido,
                ServiceControllerStatus.Running => EstadoServicio.Corriendo,
                _ => EstadoServicio.EnTransicion,
            };
        }
        catch (InvalidOperationException)
        {
            // El servicio no existe (o no se puede consultar).
            return EstadoServicio.NoExiste;
        }
    }

    public void Detener()
    {
        using var sc = new ServiceController(nombreServicio);
        if (sc.Status is not (ServiceControllerStatus.Stopped or ServiceControllerStatus.StopPending))
        {
            sc.Stop();
        }
    }

    public void Arrancar()
    {
        using var sc = new ServiceController(nombreServicio);
        if (sc.Status == ServiceControllerStatus.Stopped)
        {
            sc.Start();
        }
    }
}

/// <summary>Los procesos del sistema, por la ruta EXACTA de su exe.</summary>
internal sealed class ProcesosSistema : IProcesos
{
    public int ContarCorriendo(string rutaExe)
    {
        var nombre = Path.GetFileNameWithoutExtension(rutaExe);
        var cuantos = 0;
        foreach (var proceso in Process.GetProcessesByName(nombre))
        {
            using (proceso)
            {
                try
                {
                    if (string.Equals(proceso.MainModule?.FileName, rutaExe, StringComparison.OrdinalIgnoreCase))
                    {
                        cuantos++;
                    }
                }
                catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
                {
                    // Sin acceso a su módulo o ya terminó. DECISION PROVISIONAL (nocturno): un proceso
                    // "agente" que no se puede inspeccionar cuenta como corriendo: lo conservador es no
                    // arrancar otro encima (el watchdog corre como SYSTEM y debería poder verlos todos).
                    if (!proceso.HasExited)
                    {
                        cuantos++;
                    }
                }
            }
        }

        return cuantos;
    }
}

/// <summary>
/// El servicio <c>ArkonAgenteActualizador</c> (F2-143): <c>agente.exe actualizador</c>, instalado como
/// COPIA en <c>C:\Program Files\ArkonAgente\actualizador\</c> para que el exe del agente nunca esté
/// bloqueado por él. Cada <see cref="Intervalo"/> corre una vuelta de <see cref="Actualizador"/>.
/// </summary>
internal sealed class ServicioActualizador(Actualizador actualizador, ILogger<ServicioActualizador> logger)
    : Microsoft.Extensions.Hosting.BackgroundService
{
    public const string NombreServicio = "ArkonAgenteActualizador";

    public static readonly TimeSpan Intervalo = TimeSpan.FromSeconds(30);

    /// <summary>El exe del agente: el <c>agente.exe</c> de la carpeta de arriba de la del watchdog.</summary>
    public static string ExeAgenteDesde(string carpetaWatchdog) =>
        Path.GetFullPath(Path.Combine(carpetaWatchdog, "..", "agente.exe"));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Actualizador iniciado. Revisa la carpeta de intercambio cada {Segundos} s.", Intervalo.TotalSeconds);
        using var temporizador = new PeriodicTimer(Intervalo);
        do
        {
            try
            {
                await actualizador.UnaVueltaAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Una vuelta que truena no tumba al watchdog: queda en el log y se reintenta.
                logger.LogError(ex, "Actualizador: la vuelta falló; se reintenta en {Segundos} s.", Intervalo.TotalSeconds);
            }
        }
        while (await temporizador.WaitForNextTickAsync(stoppingToken));
    }
}
