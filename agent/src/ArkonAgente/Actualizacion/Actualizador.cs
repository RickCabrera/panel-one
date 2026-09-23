using Microsoft.Extensions.Logging;

namespace ArkonAgente.Actualizacion;

/// <summary>Estado del servicio del agente, visto por el watchdog.</summary>
internal enum EstadoServicio
{
    Detenido,
    Corriendo,
    EnTransicion,
    NoExiste,
}

/// <summary>El administrador de servicios de Windows, para el servicio del agente; los tests lo sustituyen.</summary>
internal interface IControlServicio
{
    EstadoServicio Estado();

    /// <summary>Pide detenerlo (no espera).</summary>
    void Detener();

    /// <summary>Pide arrancarlo (no espera).</summary>
    void Arrancar();
}

/// <summary>Los procesos del sistema; los tests lo sustituyen.</summary>
internal interface IProcesos
{
    /// <summary>Cuántos procesos corren EXACTAMENTE ese exe (ruta completa, sin distinguir mayúsculas).</summary>
    int ContarCorriendo(string rutaExe);
}

/// <summary>Tiempos del watchdog. Los tests los achican.</summary>
internal sealed record TiemposActualizador(
    TimeSpan EsperaDetenido,
    TimeSpan EsperaProcesos,
    TimeSpan EsperaArranque,
    TimeSpan Estabilidad,
    TimeSpan Sondeo)
{
    public static readonly TiemposActualizador PorDefecto = new(
        EsperaDetenido: TimeSpan.FromSeconds(60),
        EsperaProcesos: TimeSpan.FromSeconds(30),
        EsperaArranque: TimeSpan.FromSeconds(30),
        Estabilidad: TimeSpan.FromSeconds(60),
        Sondeo: TimeSpan.FromSeconds(2));
}

/// <summary>
/// El WATCHDOG de la auto-actualización (F2-143): el segundo servicio mínimo
/// (<c>ArkonAgenteActualizador</c>) que cambia el binario del agente. No lee config, ni SQL
/// Server, ni red: sólo la carpeta de intercambio y el administrador de servicios.
/// </summary>
/// <remarks>
/// <para>Con una <c>solicitud.json</c> válida, en este orden:</para>
/// <list type="number">
/// <item>Valida la solicitud (versión X.Y.Z, SHA de 64 hex, tamaño ≤ 128 MB) y rechaza reparse
/// points. La ruta del preparado es FIJA (<see cref="CarpetaActualizacion.Preparado"/>): nunca la
/// toma de la solicitud.</item>
/// <item>Copia el preparado junto al exe del agente (<c>agente.exe.nuevo</c>, en Program Files, que
/// la cuenta del agente no puede escribir) y verifica el SHA-256 de ESA copia. Distinto →
/// <c>hash_invalido</c> y no se toca nada.</item>
/// <item>Detiene el servicio del agente y espera <c>Detenido</c>, y además cero procesos con la ruta
/// EXACTA de su exe (el watchdog corre otra copia en otra carpeta y no cuenta). Si no → <c>detener</c>,
/// sin reemplazar nada.</item>
/// <item>Reemplaza: <c>agente.exe</c> → <c>agente.exe.anterior</c>, <c>agente.exe.nuevo</c> →
/// <c>agente.exe</c>. Un error de disco restaura el anterior → <c>reemplazo</c>.</item>
/// <item>Arranca y exige que se quede corriendo <see cref="TiemposActualizador.Estabilidad"/>. Si
/// se cae → lo detiene, restaura el anterior y lo arranca (rollback) → <c>arranque</c>.</item>
/// </list>
/// <para>
/// NUNCA dos agentes corriendo: sólo se arranca con el servicio <c>Detenido</c> confirmado y cero
/// procesos del exe. El servicio de Windows es de una sola instancia por definición; lo que se
/// cuida es que el proceso viejo haya salido antes de poner el nuevo.
/// </para>
/// <para>
/// El SHA-256 de la solicitud lo escribió la cuenta del agente: re-verificarlo protege la
/// INTEGRIDAD (un archivo cortado o cambiado entre la descarga y el swap), no la AUTENTICIDAD. Ver
/// <c>docs/actualizacion-agente.md</c>, "Seguridad" (la firma Authenticode es decisión abierta, F2-191).
/// </para>
/// </remarks>
internal sealed class Actualizador
{
    private readonly CarpetaActualizacion _carpeta;
    private readonly string _exeAgente;
    private readonly IControlServicio _servicio;
    private readonly IProcesos _procesos;
    private readonly Func<TimeSpan, CancellationToken, Task> _esperar;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;
    private readonly TiemposActualizador _tiempos;

    public Actualizador(
        CarpetaActualizacion carpeta,
        string exeAgente,
        IControlServicio servicio,
        IProcesos procesos,
        Func<TimeSpan, CancellationToken, Task> esperar,
        TimeProvider reloj,
        ILogger logger,
        TiemposActualizador? tiempos = null)
    {
        _carpeta = carpeta;
        _exeAgente = Path.GetFullPath(exeAgente);
        _servicio = servicio;
        _procesos = procesos;
        _esperar = esperar;
        _reloj = reloj;
        _logger = logger;
        _tiempos = tiempos ?? TiemposActualizador.PorDefecto;
    }

    public string ExeNuevo => _exeAgente + ".nuevo";

    public string ExeAnterior => _exeAgente + ".anterior";

    public string ExeFallido => _exeAgente + ".fallido";

    /// <summary>Una vuelta: null si no había solicitud (o era ilegible); si no, lo que se hizo con ella.</summary>
    public async Task<ResultadoActualizacion?> UnaVueltaAsync(CancellationToken cancelacion)
    {
        if (!File.Exists(_carpeta.Solicitud))
        {
            return null;
        }

        if (ArchivoIntercambio.EsReparsePoint(_carpeta.Ruta) || ArchivoIntercambio.EsReparsePoint(_carpeta.Solicitud))
        {
            _logger.LogError("Actualizador: la carpeta de intercambio o la solicitud es un enlace; se descarta sin tocar nada.");
            Limpiar();
            return null;
        }

        var solicitud = ArchivoIntercambio.Leer<SolicitudActualizacion>(_carpeta.Solicitud);
        if (solicitud is null || !solicitud.EsValida())
        {
            // Sin versión válida no hay a quién reportarle nada: el api la rechazaría.
            _logger.LogError("Actualizador: solicitud.json inválida; se descarta sin tocar nada.");
            Limpiar();
            return null;
        }

        var resultado = await AplicarAsync(solicitud, cancelacion);
        ArchivoIntercambio.EscribirAtomico(_carpeta.Resultado, resultado);
        Limpiar();
        if (resultado.Resultado == ResultadoActualizacion.Aplicada)
        {
            _logger.LogInformation("Actualizador: versión {Version} instalada y corriendo.", solicitud.Version);
        }
        else
        {
            _logger.LogError(
                "Actualizador: versión {Version} NO instalada ({Motivo}): {Detalle}",
                solicitud.Version, resultado.Motivo, resultado.Detalle);
        }

        return resultado;
    }

    private async Task<ResultadoActualizacion> AplicarAsync(SolicitudActualizacion s, CancellationToken cancelacion)
    {
        // 1. El preparado: fijo, sin enlaces, del tamaño pedido. Se copia junto al exe y se
        //    verifica ESA copia (la que se va a instalar), no el original.
        var preparado = new FileInfo(_carpeta.Preparado);
        if (!preparado.Exists || ArchivoIntercambio.EsReparsePoint(preparado.FullName) || preparado.Length != s.TamanoBytes)
        {
            return ResultadoActualizacion.Falla(s, MotivoFalla.HashInvalido,
                "El binario preparado falta, es un enlace o no mide lo que dice la solicitud. No se tocó nada.");
        }

        try
        {
            File.Copy(preparado.FullName, ExeNuevo, overwrite: true);
        }
        catch (IOException ex)
        {
            return ResultadoActualizacion.Falla(s, MotivoFalla.Reemplazo,
                $"No se pudo copiar el binario junto al agente ({ex.GetType().Name}). No se tocó nada.");
        }
        catch (UnauthorizedAccessException ex)
        {
            return ResultadoActualizacion.Falla(s, MotivoFalla.Reemplazo,
                $"No se pudo copiar el binario junto al agente ({ex.GetType().Name}). No se tocó nada.");
        }

        var sha = await VersionCanal.ShaDeArchivoAsync(ExeNuevo, cancelacion);
        if (sha != s.Sha256)
        {
            ArchivoIntercambio.BorrarSiExiste(ExeNuevo);
            return ResultadoActualizacion.Falla(s, MotivoFalla.HashInvalido,
                "El binario a instalar no tiene el SHA-256 de la solicitud. No se tocó nada.");
        }

        // 2. Detener, y confirmar que no queda NINGÚN proceso del exe del agente.
        if (!await DetenerAsync(cancelacion))
        {
            ArchivoIntercambio.BorrarSiExiste(ExeNuevo);
            // Si quedó detenido pero con un proceso colgado, NO se arranca: serían dos.
            if (_servicio.Estado() == EstadoServicio.Detenido && _procesos.ContarCorriendo(_exeAgente) == 0)
            {
                _servicio.Arrancar();
            }

            return ResultadoActualizacion.Falla(s, MotivoFalla.Detener,
                "El servicio del agente no se detuvo a tiempo (o su proceso siguió vivo). No se reemplazó nada.");
        }

        // 3. El reemplazo.
        try
        {
            File.Move(_exeAgente, ExeAnterior, overwrite: true);
            File.Move(ExeNuevo, _exeAgente);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Restaurar();
            await ArrancarSiSePuedeAsync(cancelacion);
            return ResultadoActualizacion.Falla(s, MotivoFalla.Reemplazo,
                $"No se pudo reemplazar el exe ({ex.GetType().Name}); se restauró el anterior.");
        }

        // 4. Arrancar y exigir que se quede corriendo; si no, rollback.
        _servicio.Arrancar();
        if (await QuedaCorriendoAsync(cancelacion))
        {
            return ResultadoActualizacion.Bien(s);
        }

        _logger.LogWarning("Actualizador: la versión {Version} no se quedó corriendo; se regresa a la anterior.", s.Version);
        var detenido = await DetenerAsync(cancelacion);
        if (!detenido)
        {
            return ResultadoActualizacion.Falla(s, MotivoFalla.Arranque,
                "La versión nueva no se quedó corriendo y tampoco se pudo detener para regresar a la anterior. " +
                "Revisa el servicio en la PC.");
        }

        try
        {
            File.Move(_exeAgente, ExeFallido, overwrite: true);
            File.Move(ExeAnterior, _exeAgente);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ResultadoActualizacion.Falla(s, MotivoFalla.Arranque,
                $"La versión nueva no se quedó corriendo y no se pudo restaurar la anterior ({ex.GetType().Name}). " +
                "Revisa el servicio en la PC.");
        }

        await ArrancarSiSePuedeAsync(cancelacion);
        return ResultadoActualizacion.Falla(s, MotivoFalla.Arranque,
            "La versión nueva no se quedó corriendo; se regresó a la anterior.");
    }

    /// <summary>Pide detener y espera Detenido y cero procesos del exe. False si no se logró a tiempo.</summary>
    private async Task<bool> DetenerAsync(CancellationToken cancelacion)
    {
        var estado = _servicio.Estado();
        if (estado != EstadoServicio.Detenido && estado != EstadoServicio.NoExiste)
        {
            _servicio.Detener();
        }

        if (!await EsperarAsync(() => _servicio.Estado() is EstadoServicio.Detenido or EstadoServicio.NoExiste,
                _tiempos.EsperaDetenido, cancelacion))
        {
            return false;
        }

        return await EsperarAsync(() => _procesos.ContarCorriendo(_exeAgente) == 0, _tiempos.EsperaProcesos, cancelacion);
    }

    /// <summary>Corriendo dentro de la espera de arranque, y sin caerse durante toda la estabilidad.</summary>
    private async Task<bool> QuedaCorriendoAsync(CancellationToken cancelacion)
    {
        if (!await EsperarAsync(() => _servicio.Estado() == EstadoServicio.Corriendo, _tiempos.EsperaArranque, cancelacion))
        {
            return false;
        }

        var hasta = _reloj.GetUtcNow() + _tiempos.Estabilidad;
        while (_reloj.GetUtcNow() < hasta)
        {
            await _esperar(_tiempos.Sondeo, cancelacion);
            if (_servicio.Estado() != EstadoServicio.Corriendo)
            {
                return false;
            }
        }

        return true;
    }

    private async Task ArrancarSiSePuedeAsync(CancellationToken cancelacion)
    {
        if (_servicio.Estado() == EstadoServicio.Detenido && _procesos.ContarCorriendo(_exeAgente) == 0)
        {
            _servicio.Arrancar();
            await EsperarAsync(() => _servicio.Estado() == EstadoServicio.Corriendo, _tiempos.EsperaArranque, cancelacion);
        }
    }

    private void Restaurar()
    {
        if (!File.Exists(_exeAgente) && File.Exists(ExeAnterior))
        {
            File.Move(ExeAnterior, _exeAgente);
        }

        ArchivoIntercambio.BorrarSiExiste(ExeNuevo);
    }

    private async Task<bool> EsperarAsync(Func<bool> condicion, TimeSpan tope, CancellationToken cancelacion)
    {
        var hasta = _reloj.GetUtcNow() + tope;
        while (true)
        {
            if (condicion())
            {
                return true;
            }

            if (_reloj.GetUtcNow() >= hasta)
            {
                return false;
            }

            await _esperar(_tiempos.Sondeo, cancelacion);
        }
    }

    /// <summary>La solicitud y el preparado se van siempre: el resultado ya dice qué pasó.</summary>
    private void Limpiar()
    {
        ArchivoIntercambio.BorrarSiExiste(_carpeta.Solicitud);
        if (!ArchivoIntercambio.EsReparsePoint(_carpeta.Ruta))
        {
            ArchivoIntercambio.BorrarSiExiste(_carpeta.Preparado);
        }
    }
}
