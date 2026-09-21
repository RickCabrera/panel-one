using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Cola;

/// <summary>Lo que el worker hace con la cola en cada ciclo; los tests lo sustituyen.</summary>
internal interface ICicloEnvio : IDisposable
{
    Task CicloAsync(CancellationToken cancelacion);
}

/// <summary>
/// Vacía la cola local hacia <c>POST {apiUrl}/ingesta/eventos</c> (F1-024): lotes de
/// hasta 100 eventos en orden FIFO, body en gzip, backoff exponencial ante fallas.
/// </summary>
/// <remarks>
/// <para>
/// Garantía: <b>al menos una vez</b>. Si el API guardó un lote y la respuesta se perdió,
/// el lote se reenvía; la idempotencia la pone el API (upsert por
/// <c>(sucursal, folioSr)</c>). Nada sale de la cola sin que el API lo confirme.
/// </para>
/// <para>
/// Qué pasa con cada respuesta:
/// <list type="bullet">
/// <item>2xx: los <c>procesados</c> quedan enviados; un rechazo con
/// <c>reintentable: false</c> sale de la cola como rechazado (el contrato pide no
/// reintentarlo en bucle); uno reintentable, o un evento que no viene en ninguna
/// lista, sigue pendiente y activa el backoff.</item>
/// <item>413: el lote se parte a la mitad y se reintenta de inmediato. Un evento solo
/// que sigue dando 413 no va a caber nunca: rechazado.</item>
/// <item>Red caída, timeout, 400, 401, 429, 5xx, cualquier otro código o un 2xx
/// ilegible: no se descarta nada, un intento más y backoff. El 400 NO se parte: el
/// sobre lo arma el agente, y un 400 masivo (un proxy, un API de otra versión)
/// descartaría la cola entera.</item>
/// </list>
/// </para>
/// <para>
/// Backoff de 30 s que se duplica hasta 10 min, medido con el <see cref="TimeProvider"/>
/// (nunca con el reloj real directo) y en memoria: al reiniciar el servicio se intenta
/// de inmediato. El <see cref="HttpClient"/> se crea a mano, igual que en
/// <see cref="VerificacionApi"/>: la API key no llega a ningún log.
/// </para>
/// </remarks>
internal sealed class EnviadorCola : ICicloEnvio
{
    public const int MaxEventosPorLote = 100;

    /// <summary>Tope de lotes por ciclo, con el intervalo por defecto (30 s) o más largo.</summary>
    public const int MaxLotesPorCiclo = 20;

    public static readonly TimeSpan BackoffInicial = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan BackoffMaximo = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan TimeoutPorDefecto = TimeSpan.FromSeconds(30);

    private static readonly JsonSerializerOptions OpcionesJson = new(JsonSerializerDefaults.Web);

    private readonly ColaLocal _cola;
    private readonly ConfiguracionAgente _config;
    private readonly ILogger _logger;
    private readonly TimeProvider _reloj;
    private readonly HttpClient _cliente;
    private readonly TimeSpan _timeout;
    private readonly Uri _url;

    private int _fallasSeguidas;
    private DateTimeOffset _proximoIntento = DateTimeOffset.MinValue;
    private string? _ultimaFalla;

    public EnviadorCola(
        ColaLocal cola,
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
        _timeout = timeout ?? TimeoutPorDefecto;
        _url = UrlIngesta(config.ApiUrl);
        // El timeout lo pone un CTS enlazado por petición, no HttpClient.Timeout, para
        // distinguirlo de la parada del servicio.
        _cliente = new HttpClient(handler ?? new SocketsHttpHandler(), disposeHandler: handler is null)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public ColaLocal Cola => _cola;

    /// <summary>Cuándo se permite el siguiente envío (MinValue = ya).</summary>
    public DateTimeOffset ProximoIntento => _proximoIntento;

    /// <summary>
    /// Lotes por ciclo: tantos como segundos tiene el intervalo, con tope de 20. Así nunca
    /// pasan de 60 peticiones por minuto (60 / intervalo ciclos × intervalo lotes), la
    /// mitad del límite de 120 por minuto y sucursal del API (F1-012): el resto queda para
    /// el heartbeat de F1-025 y para los reintentos de un 413. Con 30 s: 20 lotes, 40 por minuto.
    /// </summary>
    public static int LotesPorCiclo(int intervaloSegundos) => Math.Clamp(intervaloSegundos, 1, MaxLotesPorCiclo);

    /// <summary><c>apiUrl</c> más <c>ingesta/eventos</c>, con o sin barra final.</summary>
    public static Uri UrlIngesta(Uri apiUrl)
    {
        var baseConBarra = apiUrl.AbsoluteUri.EndsWith('/') ? apiUrl : new Uri(apiUrl.AbsoluteUri + "/");
        return new Uri(baseConBarra, "ingesta/eventos");
    }

    /// <summary>
    /// Purga lo viejo y, si no está en backoff, manda lo pendiente: hasta
    /// <see cref="LotesPorCiclo"/> lotes o hasta la primera falla.
    /// </summary>
    public async Task CicloAsync(CancellationToken cancelacion)
    {
        _cola.Purgar();

        if (_reloj.GetUtcNow() < _proximoIntento)
        {
            return;
        }

        for (var lotes = 0; lotes < LotesPorCiclo(_config.IntervaloSegundos); lotes++)
        {
            var pendientes = _cola.TomarPendientes(MaxEventosPorLote);
            if (pendientes.Count == 0)
            {
                break;
            }

            if (!await EnviarLoteAsync(pendientes, cancelacion))
            {
                AplicarBackoff();
                return;
            }

            Recuperado();
        }
    }

    public void Dispose() => _cliente.Dispose();

    /// <returns><c>false</c> si algo del lote quedó pendiente por una falla.</returns>
    private async Task<bool> EnviarLoteAsync(IReadOnlyList<EventoPendiente> lote, CancellationToken cancelacion)
    {
        var respuesta = await PostAsync(lote, cancelacion);

        switch (respuesta)
        {
            case Respuesta.DemasiadoGrande when lote.Count == 1:
                var motivo = "El evento no cabe en el límite de tamaño del API (413) ni solo.";
                _cola.MarcarRechazados([(lote[0].Id, motivo)]);
                _logger.LogError(
                    "Cola: el evento {Id} ({Tipo}) se descartó: {Motivo}", lote[0].Id, lote[0].Tipo.Texto(), motivo);
                return true;

            case Respuesta.DemasiadoGrande:
                var mitad = lote.Count / 2;
                return await EnviarLoteAsync(lote.Take(mitad).ToList(), cancelacion)
                    && await EnviarLoteAsync(lote.Skip(mitad).ToList(), cancelacion);

            case Respuesta.Falla falla:
                _cola.SumarIntento(lote.Select(e => e.Id));
                RegistrarFalla(falla.Mensaje);
                return false;

            case Respuesta.Aceptado aceptado:
                return AplicarResultado(lote, aceptado.Resultado);

            default:
                throw new InvalidOperationException($"Respuesta no prevista: {respuesta}");
        }
    }

    private bool AplicarResultado(IReadOnlyList<EventoPendiente> lote, ResultadoIngesta resultado)
    {
        var porId = lote.ToDictionary(e => e.Id.ToString(System.Globalization.CultureInfo.InvariantCulture));
        var enviados = new List<long>();
        foreach (var id in resultado.Procesados!)
        {
            if (porId.TryGetValue(id, out var evento))
            {
                enviados.Add(evento.Id);
            }
        }

        var rechazados = new List<(long Id, string Motivo)>();
        var reintentables = new List<string>();
        foreach (var rechazo in resultado.Rechazados!)
        {
            // Se ubica por la posición en el lote: el id podría venir nulo.
            if (rechazo.Indice < 0 || rechazo.Indice >= lote.Count)
            {
                continue;
            }

            var evento = lote[rechazo.Indice];
            if (rechazo.Reintentable)
            {
                reintentables.Add(rechazo.Motivo ?? "sin motivo");
            }
            else
            {
                rechazados.Add((evento.Id, rechazo.Motivo ?? "sin motivo"));
                _logger.LogError(
                    "Cola: el API rechazó el evento {Id} ({Tipo}) y no se reintentará: {Motivo}",
                    evento.Id, evento.Tipo.Texto(), rechazo.Motivo);
            }
        }

        _cola.MarcarEnviados(enviados);
        _cola.MarcarRechazados(rechazados);

        var cerrados = enviados.Concat(rechazados.Select(r => r.Id)).ToHashSet();
        var siguenPendientes = lote.Where(e => !cerrados.Contains(e.Id)).Select(e => e.Id).ToList();
        if (siguenPendientes.Count == 0)
        {
            return true;
        }

        _cola.SumarIntento(siguenPendientes);
        RegistrarFalla(
            $"El API no pudo guardar {siguenPendientes.Count} evento(s) por una falla de su lado " +
            $"({reintentables.FirstOrDefault() ?? "no vinieron en la respuesta"}).");
        return false;
    }

    private async Task<Respuesta> PostAsync(IReadOnlyList<EventoPendiente> lote, CancellationToken cancelacion)
    {
        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);

        using var peticion = new HttpRequestMessage(HttpMethod.Post, _url) { Content = Cuerpo(lote) };
        peticion.Headers.Add(VerificacionApi.HeaderApiKey, _config.ApiKey);

        try
        {
            using var respuesta = await _cliente.SendAsync(peticion, limite.Token);
            var codigo = (int)respuesta.StatusCode;
            if (respuesta.StatusCode == HttpStatusCode.RequestEntityTooLarge)
            {
                return new Respuesta.DemasiadoGrande();
            }

            if (!respuesta.IsSuccessStatusCode)
            {
                return new Respuesta.Falla(respuesta.StatusCode switch
                {
                    HttpStatusCode.Unauthorized =>
                        "El API rechazó la API key (401): la key es incorrecta, fue rotada o la sucursal está inactiva. " +
                        "Corre 'agente test'.",
                    HttpStatusCode.TooManyRequests => "El API pidió bajar el ritmo (429).",
                    HttpStatusCode.BadRequest =>
                        "El API rechazó el lote completo (400). Puede ser un proxy o un API de otra versión; " +
                        "no se descarta nada y se reintenta.",
                    _ when codigo >= 500 => $"El API tiene un problema de su lado ({codigo}).",
                    _ => $"El API respondió algo inesperado ({codigo}).",
                });
            }

            ResultadoIngesta? resultado;
            try
            {
                resultado = await respuesta.Content.ReadFromJsonAsync<ResultadoIngesta>(OpcionesJson, limite.Token);
            }
            catch (Exception ex) when (ex is JsonException or NotSupportedException)
            {
                resultado = null;
            }

            return resultado is { Procesados: not null, Rechazados: not null }
                ? new Respuesta.Aceptado(resultado)
                : new Respuesta.Falla($"El API respondió {codigo} sin el resultado de la ingesta: 'apiUrl' no parece ser el API del monitor.");
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return new Respuesta.Falla($"El API no respondió en {_timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException ex)
        {
            return new Respuesta.Falla($"No se pudo conectar con el API ({ex.HttpRequestError}).");
        }
    }

    /// <summary><c>{"eventos":[{"id","tipo","datos"}]}</c> en gzip.</summary>
    internal static HttpContent Cuerpo(IReadOnlyList<EventoPendiente> lote)
    {
        using var memoria = new MemoryStream();
        using (var gzip = new GZipStream(memoria, CompressionLevel.Optimal, leaveOpen: true))
        using (var json = new Utf8JsonWriter(gzip))
        {
            json.WriteStartObject();
            json.WriteStartArray("eventos");
            foreach (var evento in lote)
            {
                json.WriteStartObject();
                json.WriteString("id", evento.Id.ToString(System.Globalization.CultureInfo.InvariantCulture));
                json.WriteString("tipo", evento.Tipo.Texto());
                json.WritePropertyName("datos");
                json.WriteRawValue(evento.Payload);
                json.WriteEndObject();
            }

            json.WriteEndArray();
            json.WriteEndObject();
        }

        var contenido = new ByteArrayContent(memoria.ToArray());
        contenido.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
        contenido.Headers.ContentEncoding.Add("gzip");
        return contenido;
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
        if (_fallasSeguidas > 0 || _ultimaFalla is not null)
        {
            _logger.LogInformation(
                "Cola: se restableció el envío al API. Pendientes: {Pendientes}.", _cola.ContarPendientes());
        }

        _fallasSeguidas = 0;
        _proximoIntento = DateTimeOffset.MinValue;
        _ultimaFalla = null;
    }

    /// <summary>Cada falla distinta se registra una vez, no en cada reintento.</summary>
    private void RegistrarFalla(string mensaje)
    {
        if (mensaje == _ultimaFalla)
        {
            return;
        }

        _ultimaFalla = mensaje;
        _logger.LogError(
            "Cola: no se pudo enviar al API. {Mensaje} Nada se pierde: se reintenta con espera creciente " +
            "(de {Inicial} s a {Maximo} min). Pendientes: {Pendientes}.",
            mensaje, BackoffInicial.TotalSeconds, BackoffMaximo.TotalMinutes, _cola.ContarPendientes());
    }

    /// <summary>Forma de <c>ResultadoIngestaDto</c> (api/src/ingesta/dto/ingesta.dto.ts).</summary>
    internal sealed record ResultadoIngesta(List<string>? Procesados, List<Rechazo>? Rechazados);

    internal sealed record Rechazo(string? Id, int Indice, string? Motivo, bool Reintentable);

    private abstract record Respuesta
    {
        public sealed record Aceptado(ResultadoIngesta Resultado) : Respuesta;

        public sealed record DemasiadoGrande : Respuesta;

        public sealed record Falla(string Mensaje) : Respuesta;
    }
}
