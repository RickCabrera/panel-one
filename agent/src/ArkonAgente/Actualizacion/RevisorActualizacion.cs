using Microsoft.Extensions.Logging;

namespace ArkonAgente.Actualizacion;

/// <summary>Lo que el worker hace con la auto-actualización en cada ciclo; los tests lo sustituyen.</summary>
internal interface IRevisorActualizacion : IDisposable
{
    Task CicloAsync(CancellationToken cancelacion);
}

/// <summary>
/// El lado del SERVICIO del agente en la auto-actualización (F2-143). Una vez por ciclo:
/// <list type="number">
/// <item>Si el watchdog dejó un <c>resultado.json</c>, lo reporta al api y lo borra (sólo con 2xx).</item>
/// <item>Pregunta al canal (<c>GET /agente/version</c>). Sin bandera, sin vigente o con la MISMA
/// versión que corre (sin el <c>+commit</c>): nada.</item>
/// <item>Si ese binario ya se aplicó una vez y el agente sigue reportando otra versión: lo reporta
/// UNA vez como <c>version_distinta</c> y no lo vuelve a intentar (sin esto, un Stop/Start por ciclo).</item>
/// <item>Si el backoff de ese binario lo permite: lo baja, verifica tamaño y SHA-256 contra el canal
/// y, sólo si cuadran, lo deja como <c>preparado.exe</c> y escribe <c>solicitud.json</c>.</item>
/// </list>
/// Nunca toca su propio exe ni el servicio: eso lo hace el watchdog (<see cref="Actualizador"/>).
/// </summary>
internal sealed class RevisorActualizacion : IRevisorActualizacion
{
    private readonly CarpetaActualizacion _carpeta;
    private readonly IClienteCanal _canal;
    private readonly EstadoActualizacion _estado;
    private readonly string _versionAgente;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;
    private readonly IDisposable? _recursos;
    private string? _ultimoError;

    public RevisorActualizacion(
        CarpetaActualizacion carpeta,
        IClienteCanal canal,
        EstadoActualizacion estado,
        string versionAgente,
        TimeProvider reloj,
        ILogger logger,
        IDisposable? recursos = null)
    {
        _carpeta = carpeta;
        _canal = canal;
        _estado = estado;
        _versionAgente = versionAgente;
        _reloj = reloj;
        _logger = logger;
        _recursos = recursos;
    }

    public async Task CicloAsync(CancellationToken cancelacion)
    {
        try
        {
            _carpeta.Crear();
            await ReportarResultadoAsync(cancelacion);
            await RevisarCanalAsync(cancelacion);
            if (_ultimoError is not null)
            {
                _logger.LogInformation("Auto-actualización: el canal de versiones vuelve a responder.");
                _ultimoError = null;
            }
        }
        catch (CanalInvalidoException ex)
        {
            if (ex.Message != _ultimoError)
            {
                _logger.LogWarning("Auto-actualización: {Error} Se vuelve a intentar en el siguiente ciclo.", ex.Message);
                _ultimoError = ex.Message;
            }
        }
    }

    /// <summary>El resultado del watchdog: se reporta, se anota y se borra (sólo si el api lo guardó).</summary>
    private async Task ReportarResultadoAsync(CancellationToken cancelacion)
    {
        if (!File.Exists(_carpeta.Resultado))
        {
            return;
        }

        var resultado = ArchivoIntercambio.Leer<ResultadoActualizacion>(_carpeta.Resultado);
        if (resultado is null || !VersionCanal.EsValida(resultado.Version) || !VersionCanal.EsShaValido(resultado.Sha256))
        {
            _logger.LogWarning("Auto-actualización: resultado.json ilegible; se descarta.");
            ArchivoIntercambio.BorrarSiExiste(_carpeta.Resultado);
            return;
        }

        var ahora = _reloj.GetUtcNow();
        if (resultado.Resultado == ResultadoActualizacion.Aplicada)
        {
            _estado.RegistrarAplicada(resultado.Version, resultado.Sha256, ahora);
            _logger.LogInformation("Auto-actualización: el watchdog instaló la versión {Version}.", resultado.Version);
        }
        else
        {
            _estado.RegistrarFalla(resultado.Version, resultado.Sha256, ahora);
            _logger.LogError(
                "Auto-actualización: el watchdog NO instaló la versión {Version} ({Motivo}): {Detalle}",
                resultado.Version, resultado.Motivo, resultado.Detalle);
        }

        if (await _canal.ReportarAsync(resultado, cancelacion))
        {
            ArchivoIntercambio.BorrarSiExiste(_carpeta.Resultado);
        }
    }

    private async Task RevisarCanalAsync(CancellationToken cancelacion)
    {
        // Una solicitud pendiente es del watchdog: no se pisa ni se descarga otra encima.
        if (File.Exists(_carpeta.Solicitud))
        {
            return;
        }

        var ofrecida = await _canal.ConsultarAsync(cancelacion);
        if (ofrecida is null || VersionCanal.SinCommit(_versionAgente) == ofrecida.Version)
        {
            return;
        }

        var ahora = _reloj.GetUtcNow();
        var decision = _estado.Decidir(ofrecida.Version, ofrecida.Sha256, ahora);
        if (decision.Aplicada)
        {
            if (!decision.VersionDistintaReportada)
            {
                var detalle =
                    $"Se instaló el binario de la versión {ofrecida.Version}, pero el agente que quedó corriendo " +
                    $"reporta {_versionAgente}. No se vuelve a intentar ese binario: publica uno cuya versión coincida.";
                _logger.LogError("Auto-actualización: {Detalle}", detalle);
                var reporte = new ResultadoActualizacion(
                    ResultadoActualizacion.Fallida, ofrecida.Version, ofrecida.Sha256, MotivoFalla.VersionDistinta, detalle);
                if (await _canal.ReportarAsync(reporte, cancelacion))
                {
                    _estado.MarcarVersionDistintaReportada(ofrecida.Version, ofrecida.Sha256);
                }
            }

            return;
        }

        if (!decision.PuedeIntentar)
        {
            return;
        }

        await DescargarYPrepararAsync(ofrecida, cancelacion);
    }

    private async Task DescargarYPrepararAsync(VersionOfrecida ofrecida, CancellationToken cancelacion)
    {
        _logger.LogInformation(
            "Auto-actualización: el canal ofrece la versión {Version} (corre {Actual}); se descarga.",
            ofrecida.Version, _versionAgente);
        ArchivoIntercambio.BorrarSiExiste(_carpeta.Descarga);
        Descargado bajado;
        try
        {
            bajado = await _canal.DescargarAsync(ofrecida.Url, _carpeta.Descarga, ofrecida.TamanoBytes, cancelacion);
        }
        catch (CanalInvalidoException ex)
        {
            ArchivoIntercambio.BorrarSiExiste(_carpeta.Descarga);
            await FallaAsync(ofrecida, MotivoFalla.Descarga, ex.Message, cancelacion);
            return;
        }

        if (bajado.Bytes != ofrecida.TamanoBytes || bajado.Sha256 != ofrecida.Sha256)
        {
            ArchivoIntercambio.BorrarSiExiste(_carpeta.Descarga);
            await FallaAsync(
                ofrecida,
                MotivoFalla.HashInvalido,
                $"El binario descargado ({bajado.Bytes} bytes, SHA-256 {bajado.Sha256[..12]}…) no es el del canal " +
                $"({ofrecida.TamanoBytes} bytes, SHA-256 {ofrecida.Sha256[..12]}…). Se descartó sin instalar nada.",
                cancelacion);
            return;
        }

        File.Move(_carpeta.Descarga, _carpeta.Preparado, overwrite: true);
        ArchivoIntercambio.EscribirAtomico(
            _carpeta.Solicitud, new SolicitudActualizacion(ofrecida.Version, ofrecida.Sha256, ofrecida.TamanoBytes));
        _logger.LogInformation(
            "Auto-actualización: versión {Version} descargada y verificada (SHA-256 {Sha}…); el watchdog la instala.",
            ofrecida.Version, ofrecida.Sha256[..12]);
    }

    private async Task FallaAsync(VersionOfrecida ofrecida, string motivo, string detalle, CancellationToken cancelacion)
    {
        var ahora = _reloj.GetUtcNow();
        _estado.RegistrarFalla(ofrecida.Version, ofrecida.Sha256, ahora);
        var decision = _estado.Decidir(ofrecida.Version, ofrecida.Sha256, ahora);
        _logger.LogError(
            "Auto-actualización: la versión {Version} NO se instaló ({Motivo}): {Detalle} Siguiente intento: {Hasta:u}.",
            ofrecida.Version, motivo, detalle, decision.EsperarHasta);
        await _canal.ReportarAsync(
            new ResultadoActualizacion(ResultadoActualizacion.Fallida, ofrecida.Version, ofrecida.Sha256, motivo, detalle),
            cancelacion);
    }

    public void Dispose() => _recursos?.Dispose();
}
