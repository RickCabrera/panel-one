using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ArkonAgente.Catalogos;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Cola;

/// <summary>Lo que dice <c>GET /ingesta/catalogos/solicitud</c>: si un admin pidió sincronizar.</summary>
internal sealed record SolicitudCatalogos(string? SolicitadaAt, bool Pendiente);

/// <summary>
/// Vacía el carril de catálogos (<see cref="ColaCatalogos"/>) hacia el contrato de F2-230:
/// páginas a <c>POST {apiUrl}/ingesta/catalogos</c> y cierres a <c>POST …/ingesta/catalogos/cierre</c>,
/// en gzip y con <c>X-Api-Key</c>, una petición por página, en orden FIFO. También consulta el
/// forzado del panel (<c>GET …/ingesta/catalogos/solicitud</c>).
/// </summary>
/// <remarks>
/// <para>
/// Backoff PROPIO (30 s que se duplica hasta 10 min, igual que <see cref="EnviadorCola"/>): una
/// falla aquí no frena el carril de eventos, ni al revés. Tope por ciclo de
/// <see cref="PeticionesPorCiclo"/>: con el intervalo mínimo (5 s) son 12 por minuto, que junto con
/// las ≤ 60 del carril de eventos quedan lejos de las 120 por minuto y sucursal del API.
/// </para>
/// <para>
/// Qué pasa con cada respuesta:
/// <list type="bullet">
/// <item>200 de una página: queda enviada y se guarda su <c>rechazadosSinFila</c>; cada rechazo va
/// al log con su índice, su <c>origenSrId</c> y el motivo del API (que nunca repite valores:
/// los clientes traen datos personales). <c>obsoletos</c> &gt; 0 va como Warning: suele ser el
/// reloj de la PC corrido hacia atrás (F2-230).</item>
/// <item>200 de un cierre: se manda con <c>rechazados</c> = Σ <c>rechazadosSinFila</c> de SUS
/// páginas, calculado al enviarlo; <c>aplicado=false</c> va como Warning.</item>
/// <item>Red caída, timeout, 401, 429 y 5xx salvo 500: nada sale de la cola; backoff.</item>
/// <item>400, 409, 413, 500, cualquier otro código o un 2xx ilegible: reenviar lo mismo va a fallar
/// igual (409 = "abrir una nueva", 500 = "determinista"). Se ABANDONA la sincronización entera
/// (<see cref="ColaCatalogos.Abandonar"/>): sale de la cola con su motivo, se borra el hash del
/// catálogo y se vuelve a leer en <see cref="EsperaTrasAbandono"/>, no antes. Así ningún error deja
/// el carril atorado para siempre ni relee el POS en cada ciclo.</item>
/// </list>
/// </para>
/// </remarks>
internal sealed class EnviadorCatalogos : IDisposable
{
    public const int MaxPeticionesPorCiclo = 5;

    public static readonly TimeSpan BackoffInicial = EnviadorCola.BackoffInicial;
    public static readonly TimeSpan BackoffMaximo = EnviadorCola.BackoffMaximo;
    public static readonly TimeSpan EsperaTrasAbandono = TimeSpan.FromMinutes(15);

    /// <summary>Cuántos rechazos de una página se escriben en el log (el resto, sólo la cuenta).</summary>
    private const int RechazosEnLog = 5;

    private static readonly JsonSerializerOptions OpcionesJson = new(JsonSerializerDefaults.Web);

    private readonly ColaCatalogos _cola;
    private readonly ConfiguracionAgente _config;
    private readonly ILogger _logger;
    private readonly TimeProvider _reloj;
    private readonly HttpClient _cliente;
    private readonly TimeSpan _timeout;
    private readonly Uri _base;

    private int _fallasSeguidas;
    private DateTimeOffset _proximoIntento = DateTimeOffset.MinValue;
    private string? _ultimaFalla;

    public EnviadorCatalogos(
        ColaCatalogos cola,
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

    public ColaCatalogos Cola => _cola;

    /// <summary>Cuándo se permite el siguiente envío (MinValue = ya).</summary>
    public DateTimeOffset ProximoIntento => _proximoIntento;

    /// <summary>Un sexto de los segundos del intervalo, entre 1 y 5: ≤ 12 peticiones por minuto.</summary>
    public static int PeticionesPorCiclo(int intervaloSegundos) =>
        Math.Clamp(intervaloSegundos / 6, 1, MaxPeticionesPorCiclo);

    public void Dispose() => _cliente.Dispose();

    /// <summary>Purga lo viejo y, si no está en backoff, manda hasta <see cref="PeticionesPorCiclo"/> pendientes.</summary>
    public async Task CicloAsync(CancellationToken cancelacion)
    {
        _cola.Purgar();
        if (_reloj.GetUtcNow() < _proximoIntento)
        {
            return;
        }

        for (var i = 0; i < PeticionesPorCiclo(_config.IntervaloSegundos); i++)
        {
            var envio = _cola.TomarSiguiente();
            if (envio is null)
            {
                break;
            }

            if (!await EnviarAsync(envio, cancelacion))
            {
                AplicarBackoff();
                return;
            }

            Recuperado();
        }
    }

    /// <summary>
    /// <c>GET /ingesta/catalogos/solicitud</c>. Null si el API no contestó algo usable (se registra
    /// una vez por mensaje distinto; el forzado se vuelve a consultar más tarde).
    /// </summary>
    public async Task<SolicitudCatalogos?> ConsultarSolicitudAsync(CancellationToken cancelacion)
    {
        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);
        using var peticion = new HttpRequestMessage(HttpMethod.Get, new Uri(_base, "ingesta/catalogos/solicitud"));
        peticion.Headers.Add(VerificacionApi.HeaderApiKey, _config.ApiKey);
        try
        {
            using var respuesta = await _cliente.SendAsync(peticion, limite.Token);
            if (!respuesta.IsSuccessStatusCode)
            {
                return null;
            }

            var dto = await respuesta.Content.ReadFromJsonAsync<SolicitudDto>(OpcionesJson, limite.Token);
            return dto?.Pendiente is { } pendiente ? new SolicitudCatalogos(dto.SolicitadaAt, pendiente) : null;
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return null;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or NotSupportedException)
        {
            return null;
        }
    }

    /// <returns><c>false</c> si hay que esperar (falla reintentable).</returns>
    private async Task<bool> EnviarAsync(EnvioCatalogo envio, CancellationToken cancelacion)
    {
        var cuerpo = envio.EsCierre ? CuerpoCierre(envio) : envio.Payload;
        var ruta = envio.EsCierre ? "ingesta/catalogos/cierre" : "ingesta/catalogos";
        var tipo = envio.EsCierre ? "el cierre" : "una página";
        var catalogo = envio.Catalogo.Texto();

        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);
        using var peticion = new HttpRequestMessage(HttpMethod.Post, new Uri(_base, ruta)) { Content = Gzip(cuerpo) };
        peticion.Headers.Add(VerificacionApi.HeaderApiKey, _config.ApiKey);

        HttpResponseMessage respuesta;
        try
        {
            respuesta = await _cliente.SendAsync(peticion, limite.Token);
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return Reintentable(envio, $"El API no respondió en {_timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException ex)
        {
            return Reintentable(envio, $"No se pudo conectar con el API ({ex.HttpRequestError}).");
        }

        using (respuesta)
        {
            var codigo = (int)respuesta.StatusCode;
            if (respuesta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.TooManyRequests
                || (codigo >= 500 && codigo != 500))
            {
                return Reintentable(envio, $"El API respondió {codigo} a {tipo} de '{catalogo}'.");
            }

            if (!respuesta.IsSuccessStatusCode)
            {
                Abandonar(envio, $"El API respondió {codigo} a {tipo} de '{catalogo}'{Explicacion(respuesta.StatusCode)}");
                return true;
            }

            try
            {
                if (envio.EsCierre)
                {
                    var cierre = await respuesta.Content.ReadFromJsonAsync<ResultadoCierreDto>(OpcionesJson, limite.Token);
                    if (cierre?.Aplicado is not { } aplicado || cierre.Activos is null || cierre.Desactivados is null)
                    {
                        throw new JsonException("sin el resultado del cierre");
                    }

                    _cola.MarcarEnviado(envio.Id);
                    if (aplicado)
                    {
                        _logger.LogInformation(
                            "Catálogos: '{Catalogo}' sincronizado en el panel: {Activos} activos, {Desactivados} dados de baja.",
                            catalogo, cierre.Activos, cierre.Desactivados);
                    }
                    else
                    {
                        _logger.LogWarning(
                            "Catálogos: el panel ignoró el cierre de '{Catalogo}' porque ya aplicó una sincronización más nueva.",
                            catalogo);
                    }
                }
                else
                {
                    var pagina = await respuesta.Content.ReadFromJsonAsync<ResultadoPaginaDto>(OpcionesJson, limite.Token);
                    if (pagina?.RechazadosSinFila is not { } sinFila || pagina.Rechazados is null)
                    {
                        throw new JsonException("sin el resultado de la página");
                    }

                    _cola.MarcarEnviado(envio.Id, sinFila);
                    RegistrarPagina(catalogo, pagina);
                }
            }
            catch (Exception ex) when (ex is JsonException or NotSupportedException)
            {
                Abandonar(envio, $"El API respondió {codigo} a {tipo} de '{catalogo}' sin el resultado esperado: " +
                                 "'apiUrl' no parece ser el API del monitor.");
            }
            catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
            {
                return Reintentable(envio, $"El API no terminó de responder en {_timeout.TotalSeconds:0} s.");
            }

            return true;
        }
    }

    private void RegistrarPagina(string catalogo, ResultadoPaginaDto pagina)
    {
        foreach (var rechazo in pagina.Rechazados!.Take(RechazosEnLog))
        {
            // Sólo índice, origenSrId y el motivo del API: nunca el registro (datos personales).
            _logger.LogWarning(
                "Catálogos: el panel rechazó el registro {Indice} ({OrigenSrId}) de '{Catalogo}': {Motivo}",
                rechazo.Indice, rechazo.OrigenSrId ?? "sin id válido", catalogo, rechazo.Motivo);
        }

        if (pagina.Rechazados!.Count > RechazosEnLog)
        {
            _logger.LogWarning(
                "Catálogos: … y {Mas} rechazo(s) más en esa página de '{Catalogo}'.",
                pagina.Rechazados.Count - RechazosEnLog, catalogo);
        }

        if (pagina.Obsoletos is > 0)
        {
            _logger.LogWarning(
                "Catálogos: el panel ignoró {Obsoletos} registro(s) de '{Catalogo}' por venir de una lectura más vieja " +
                "que la última que aplicó. Si se repite, revisa el reloj de esta PC.",
                pagina.Obsoletos, catalogo);
        }
    }

    /// <summary>El cierre guardado más el <c>rechazados</c> de sus páginas (nunca mayor que <c>total</c>).</summary>
    private string CuerpoCierre(EnvioCatalogo envio)
    {
        var nodo = JsonNode.Parse(envio.Payload)!.AsObject();
        var total = nodo["total"]!.GetValue<int>();
        nodo["rechazados"] = Math.Min(total, _cola.RechazadosSinFila(envio.SincronizacionId));
        return nodo.ToJsonString();
    }

    private static string Explicacion(HttpStatusCode codigo) => codigo switch
    {
        HttpStatusCode.Conflict => ": el cierre no cuadra con las páginas recibidas.",
        HttpStatusCode.BadRequest => ": el sobre es inválido (¿reloj de la PC adelantado más de 5 min?).",
        HttpStatusCode.RequestEntityTooLarge => ": la página no cabe en el límite del API.",
        HttpStatusCode.InternalServerError => ": falla determinista del API.",
        _ => ".",
    };

    private void Abandonar(EnvioCatalogo envio, string motivo)
    {
        var desde = _reloj.GetUtcNow() + EsperaTrasAbandono;
        var n = _cola.Abandonar(envio, motivo, desde);
        _logger.LogError(
            "Catálogos: {Motivo} Se descarta esa sincronización ({N} envío(s) pendientes) y el catálogo se vuelve a " +
            "leer completo en {Minutos} min.",
            motivo, n, EsperaTrasAbandono.TotalMinutes);
    }

    private bool Reintentable(EnvioCatalogo envio, string mensaje)
    {
        _cola.SumarIntento(envio.Id);
        if (mensaje != _ultimaFalla)
        {
            _ultimaFalla = mensaje;
            _logger.LogError(
                "Catálogos: no se pudo enviar al API. {Mensaje} Nada se pierde: se reintenta con espera creciente. " +
                "Pendientes de catálogos: {Pendientes}.",
                mensaje, _cola.ContarPendientes());
        }

        return false;
    }

    private void AplicarBackoff()
    {
        _fallasSeguidas++;
        var espera = TimeSpan.FromTicks(Math.Min(
            BackoffMaximo.Ticks,
            BackoffInicial.Ticks * (1L << Math.Min(_fallasSeguidas - 1, 20))));
        _proximoIntento = _reloj.GetUtcNow() + espera;
    }

    private void Recuperado()
    {
        if (_ultimaFalla is not null)
        {
            _logger.LogInformation("Catálogos: se restableció el envío al API.");
        }

        _fallasSeguidas = 0;
        _proximoIntento = DateTimeOffset.MinValue;
        _ultimaFalla = null;
    }

    internal static ByteArrayContent Gzip(string json)
    {
        using var memoria = new MemoryStream();
        using (var gzip = new GZipStream(memoria, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(Encoding.UTF8.GetBytes(json));
        }

        var contenido = new ByteArrayContent(memoria.ToArray());
        contenido.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
        contenido.Headers.ContentEncoding.Add("gzip");
        return contenido;
    }

    /// <summary>Forma de <c>SolicitudAgenteDto</c> (api/src/ingesta/dto/catalogos.dto.ts).</summary>
    private sealed record SolicitudDto(string? SolicitadaAt, bool? Pendiente);

    /// <summary>Forma de <c>ResultadoPaginaDto</c>.</summary>
    internal sealed record ResultadoPaginaDto(int? Obsoletos, int? RechazadosSinFila, List<RechazoDto>? Rechazados);

    internal sealed record RechazoDto(int Indice, string? OrigenSrId, string? Motivo);

    /// <summary>Forma de <c>ResultadoCierreDto</c>.</summary>
    internal sealed record ResultadoCierreDto(bool? Aplicado, int? Desactivados, int? Activos);
}
