using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.Inventario;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Cola;

/// <summary>
/// Vacía el carril de inventario (<see cref="ColaInventario"/>) hacia los tres contratos de "lote con
/// <c>leidoAt</c>": <c>POST {apiUrl}/ingesta/movimientos</c> (F2-122), <c>/ingesta/compras</c> (F2-126)
/// y <c>/ingesta/recetas</c> (F2-125), un lote por petición, en gzip y con <c>X-Api-Key</c>.
/// </summary>
/// <remarks>
/// <para>
/// Backoff PROPIO (30 s que se duplica hasta 10 min, como <see cref="EnviadorExistencias"/>): una falla
/// aquí no frena otro carril, ni al revés. Tope de <see cref="EnviadorCatalogos.PeticionesPorCiclo"/>
/// por ciclo.
/// </para>
/// <para>
/// Qué pasa con cada respuesta:
/// <list type="bullet">
/// <item>200: el lote sale de la cola. Cada documento rechazado va al log con su índice, su clave y el
/// motivo del API (que nunca repite valores); un rechazo no es reintentable, así que su hash se
/// conserva y no se reenvía hasta que cambie en SR.</item>
/// <item>Red caída, timeout, 401, 429 y 5xx salvo 500: el lote se queda; backoff.</item>
/// <item>400, 413, 500, otro código o un 2xx ilegible: reenviarlo igual va a fallar igual, así que se
/// DESCARTA con un Error, y sus documentos quedan marcados para reenviarse en la siguiente lectura
/// (<see cref="ColaInventario.Descartar"/>). Nada se queda atorado ni se pierde una cancelación.</item>
/// </list>
/// </para>
/// </remarks>
internal sealed class EnviadorInventario : IDisposable
{
    private const int RechazosEnLog = 5;

    private static readonly JsonSerializerOptions OpcionesJson = new(JsonSerializerDefaults.Web);

    private readonly ColaInventario _cola;
    private readonly ConfiguracionAgente _config;
    private readonly ILogger _logger;
    private readonly TimeProvider _reloj;
    private readonly HttpClient _cliente;
    private readonly TimeSpan _timeout;
    private readonly Uri _base;

    private int _fallasSeguidas;
    private DateTimeOffset _proximoIntento = DateTimeOffset.MinValue;
    private string? _ultimaFalla;

    public EnviadorInventario(
        ColaInventario cola,
        ConfiguracionAgente config,
        ILogger logger,
        TimeProvider reloj,
        HttpMessageHandler? handler = null,
        TimeSpan? timeout = null)
    {
        _cola = cola;
        _config = config;
        _logger = logger;
        _reloj = reloj;
        _timeout = timeout ?? EnviadorCola.TimeoutPorDefecto;
        _base = config.ApiUrl.AbsoluteUri.EndsWith('/') ? config.ApiUrl : new Uri(config.ApiUrl.AbsoluteUri + "/");
        _cliente = new HttpClient(handler ?? new SocketsHttpHandler(), disposeHandler: handler is null)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public DateTimeOffset ProximoIntento => _proximoIntento;

    public void Dispose() => _cliente.Dispose();

    public async Task CicloAsync(CancellationToken cancelacion)
    {
        if (_reloj.GetUtcNow() < _proximoIntento)
        {
            return;
        }

        for (var i = 0; i < EnviadorCatalogos.PeticionesPorCiclo(_config.IntervaloSegundos); i++)
        {
            var lote = _cola.TomarSiguiente();
            if (lote is null)
            {
                break;
            }

            if (!await EnviarAsync(lote, cancelacion))
            {
                AplicarBackoff();
                return;
            }

            Recuperado();
        }
    }

    private static string Nombre(LoteInventario lote) => $"lote de {lote.Tipo.Texto()} ({lote.Claves.Count} documento(s))";

    /// <returns><c>false</c> si hay que esperar (falla reintentable).</returns>
    private async Task<bool> EnviarAsync(LoteInventario lote, CancellationToken cancelacion)
    {
        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);
        using var peticion = new HttpRequestMessage(HttpMethod.Post, new Uri(_base, lote.Tipo.Ruta()))
        {
            Content = EnviadorCatalogos.Gzip(lote.Payload),
        };
        peticion.Headers.Add(VerificacionApi.HeaderApiKey, _config.ApiKey);

        HttpResponseMessage respuesta;
        try
        {
            respuesta = await _cliente.SendAsync(peticion, limite.Token);
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return Reintentable(lote, $"El API no respondió en {_timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException ex)
        {
            return Reintentable(lote, $"No se pudo conectar con el API ({ex.HttpRequestError}).");
        }

        using (respuesta)
        {
            var codigo = (int)respuesta.StatusCode;
            if (respuesta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.TooManyRequests
                || (codigo >= 500 && codigo != 500))
            {
                return Reintentable(lote, $"El API respondió {codigo} al {Nombre(lote)}.");
            }

            if (!respuesta.IsSuccessStatusCode)
            {
                Descartar(lote, $"El API respondió {codigo} al {Nombre(lote)}{Explicacion(respuesta.StatusCode)}");
                return true;
            }

            try
            {
                var r = await respuesta.Content.ReadFromJsonAsync<ResultadoDto>(OpcionesJson, limite.Token);
                if (r?.Recibidas is null || r.Rechazadas is null)
                {
                    throw new JsonException("sin el resultado del lote");
                }

                _cola.Quitar(lote);
                Registrar(lote, r);
            }
            catch (Exception ex) when (ex is JsonException or NotSupportedException)
            {
                Descartar(lote, $"El API respondió {codigo} al {Nombre(lote)} sin el resultado esperado: 'apiUrl' no " +
                                "parece ser el API del monitor.");
            }
            catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
            {
                return Reintentable(lote, $"El API no terminó de responder en {_timeout.TotalSeconds:0} s.");
            }

            return true;
        }
    }

    private void Registrar(LoteInventario lote, ResultadoDto r)
    {
        var tipo = lote.Tipo.Texto();
        _logger.LogInformation(
            "Inventario: lote de {Tipo} aplicado en el panel: {Recibidas} recibido(s), {Creadas} nuevo(s), {Actualizadas} " +
            "con cambios, {SinCambios} sin cambios, {Obsoletas} ya más nuevo(s) en el panel, {Rechazadas} rechazado(s).",
            tipo, r.Recibidas, r.Creadas, r.Actualizadas, r.SinCambios, r.Obsoletas, r.Rechazadas!.Count);

        foreach (var rechazo in r.Rechazadas.Take(RechazosEnLog))
        {
            _logger.LogWarning(
                "Inventario: el panel rechazó el documento {Indice} ({Clave}) del lote de {Tipo}: {Motivo}",
                rechazo.Indice, rechazo.OrigenSrId ?? rechazo.ProductoOrigenSrId ?? "sin clave válida", tipo, rechazo.Motivo);
        }

        if (r.Rechazadas.Count > RechazosEnLog)
        {
            _logger.LogWarning(
                "Inventario: … y {Mas} rechazo(s) más en el lote de {Tipo}.", r.Rechazadas.Count - RechazosEnLog, tipo);
        }
    }

    private static string Explicacion(HttpStatusCode codigo) => codigo switch
    {
        HttpStatusCode.BadRequest => ": el sobre es inválido (¿reloj de la PC adelantado más de 5 min?).",
        HttpStatusCode.RequestEntityTooLarge => ": el lote no cabe en el límite del API.",
        HttpStatusCode.InternalServerError => ": falla determinista del API.",
        _ => ".",
    };

    private void Descartar(LoteInventario lote, string motivo)
    {
        _cola.Descartar(lote);
        _logger.LogError(
            "Inventario: {Motivo} Se descarta ese lote; sus documentos se vuelven a mandar en la siguiente lectura.", motivo);
    }

    private bool Reintentable(LoteInventario lote, string mensaje)
    {
        _cola.SumarIntento(lote);
        if (mensaje != _ultimaFalla)
        {
            _ultimaFalla = mensaje;
            _logger.LogError(
                "Inventario: no se pudo enviar al API. {Mensaje} El lote se conserva y se reintenta con espera creciente. " +
                "Lotes pendientes: {Pendientes}.",
                mensaje, _cola.ContarPendientes());
        }

        return false;
    }

    private void AplicarBackoff()
    {
        _fallasSeguidas++;
        var espera = TimeSpan.FromTicks(Math.Min(
            EnviadorCola.BackoffMaximo.Ticks,
            EnviadorCola.BackoffInicial.Ticks * (1L << Math.Min(_fallasSeguidas - 1, 20))));
        _proximoIntento = _reloj.GetUtcNow() + espera;
    }

    private void Recuperado()
    {
        if (_ultimaFalla is not null)
        {
            _logger.LogInformation("Inventario: se restableció el envío al API.");
        }

        _fallasSeguidas = 0;
        _proximoIntento = DateTimeOffset.MinValue;
        _ultimaFalla = null;
    }

    /// <summary>Forma común de <c>ResultadoMovimientosDto</c>, <c>ResultadoComprasDto</c> y <c>ResultadoRecetasDto</c>.</summary>
    internal sealed record ResultadoDto(
        int? Recibidas, int? Creadas, int? Actualizadas, int? SinCambios, int? Obsoletas, List<RechazoDto>? Rechazadas);

    internal sealed record RechazoDto(int Indice, string? OrigenSrId, string? ProductoOrigenSrId, string? Motivo);
}
