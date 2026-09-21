using System.Net;
using System.Net.Http.Json;
using System.Security.Authentication;
using System.Text.Json;
using ArkonAgente.Configuracion;

namespace ArkonAgente.Diagnostico;

/// <summary>
/// Comprueba que el API responde y acepta la API key: <c>GET {apiUrl}/agente/yo</c>
/// con <c>X-Api-Key</c>, que devuelve la sucursal dueña de la key.
/// </summary>
/// <remarks>
/// El <see cref="HttpClient"/> se crea a mano con su handler (sin
/// <c>IHttpClientFactory</c>): la factory registra las peticiones en el log, y a
/// nivel Trace puede volcar headers. La API key no debe llegar a ningún log.
/// </remarks>
internal sealed class VerificacionApi : IVerificacion
{
    public const string HeaderApiKey = "X-Api-Key";
    public static readonly TimeSpan TimeoutPorDefecto = TimeSpan.FromSeconds(10);

    private readonly ConfiguracionAgente _config;
    private readonly HttpMessageHandler? _handlerInyectado;
    private readonly TimeSpan _timeout;

    public VerificacionApi(ConfiguracionAgente config, HttpMessageHandler? handler = null, TimeSpan? timeout = null)
    {
        _config = config;
        _handlerInyectado = handler;
        _timeout = timeout ?? TimeoutPorDefecto;
    }

    public string Nombre => "API del monitor";

    /// <summary>
    /// <c>apiUrl</c> es la URL base (puede traer prefijo de ruta, p. ej.
    /// <c>https://x.com/api</c>); se le cuelga <c>agente/yo</c> con o sin barra final.
    /// </summary>
    public static Uri UrlYo(Uri apiUrl)
    {
        var baseConBarra = apiUrl.AbsoluteUri.EndsWith('/') ? apiUrl : new Uri(apiUrl.AbsoluteUri + "/");
        return new Uri(baseConBarra, "agente/yo");
    }

    public async Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion)
    {
        var url = UrlYo(_config.ApiUrl);
        // El timeout lo pone `limite`, no HttpClient.Timeout, para distinguirlo de la
        // cancelación del servicio que se detiene.
        using var cliente = new HttpClient(_handlerInyectado ?? new SocketsHttpHandler(), disposeHandler: _handlerInyectado is null)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);

        using var peticion = new HttpRequestMessage(HttpMethod.Get, url);
        peticion.Headers.Add(HeaderApiKey, _config.ApiKey);

        try
        {
            using var respuesta = await cliente.SendAsync(peticion, limite.Token);
            return await InterpretarRespuestaAsync(respuesta, url, limite.Token);
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return ResultadoVerificacion.Falla(
                Nombre,
                $"El API no respondió en {_timeout.TotalSeconds:0} s ({url.GetLeftPart(UriPartial.Authority)}).",
                "Revisa la conexión a internet de esta PC y que 'apiUrl' sea la correcta.");
        }
        catch (HttpRequestException ex)
        {
            return ClasificarErrorDeRed(ex, url);
        }
    }

    private ResultadoVerificacion ClasificarErrorDeRed(HttpRequestException ex, Uri url)
    {
        var servidor = url.GetLeftPart(UriPartial.Authority);
        if (ex.InnerException is AuthenticationException || ex.HttpRequestError == HttpRequestError.SecureConnectionError)
        {
            return ResultadoVerificacion.Falla(
                Nombre,
                $"Falló la conexión segura (TLS) con {servidor}.",
                "Revisa que la fecha y hora de esta PC sean correctas y que ningún antivirus o proxy intercepte HTTPS.");
        }

        if (ex.HttpRequestError == HttpRequestError.NameResolutionError)
        {
            return ResultadoVerificacion.Falla(
                Nombre,
                $"No se encontró el servidor '{url.Host}' (DNS).",
                "Revisa que 'apiUrl' esté bien escrita y que esta PC tenga internet.");
        }

        return ResultadoVerificacion.Falla(
            Nombre,
            $"No se pudo conectar con {servidor} ({ex.HttpRequestError}).",
            "Revisa la conexión a internet de esta PC, el firewall y que 'apiUrl' sea la correcta.");
    }

    private async Task<ResultadoVerificacion> InterpretarRespuestaAsync(
        HttpResponseMessage respuesta, Uri url, CancellationToken cancelacion)
    {
        var codigo = (int)respuesta.StatusCode;
        switch (respuesta.StatusCode)
        {
            case HttpStatusCode.OK:
                return await LeerSucursalAsync(respuesta, cancelacion);

            case HttpStatusCode.Unauthorized:
                // El API responde lo mismo para key desconocida, rotada o de una sucursal
                // inactiva (a propósito, para no filtrar cuál es): no se intenta distinguir.
                return ResultadoVerificacion.Falla(
                    Nombre,
                    "El API respondió, pero rechazó la API key (401).",
                    "La key es incorrecta, fue rotada, o la sucursal o la empresa están inactivas. " +
                    "Genera una key nueva desde el panel (Administración) y cópiala completa en 'apiKey'.");

            case HttpStatusCode.NotFound:
                return ResultadoVerificacion.Falla(
                    Nombre,
                    $"{url} no existe (404): 'apiUrl' no apunta al API del monitor.",
                    "Usa la URL base del API, sin '/agente/yo' al final.");

            default:
                return ResultadoVerificacion.Falla(
                    Nombre,
                    codigo >= 500
                        ? $"El API tiene un problema de su lado ({codigo})."
                        : $"El API respondió algo inesperado ({codigo}).",
                    codigo >= 500 ? "Intenta de nuevo en unos minutos; si sigue, avisa a soporte." : null);
        }
    }

    private async Task<ResultadoVerificacion> LeerSucursalAsync(HttpResponseMessage respuesta, CancellationToken cancelacion)
    {
        AgenteYo? yo;
        try
        {
            yo = await respuesta.Content.ReadFromJsonAsync<AgenteYo>(
                new JsonSerializerOptions(JsonSerializerDefaults.Web), cancelacion);
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            yo = null;
        }

        if (yo is null || string.IsNullOrEmpty(yo.SucursalId))
        {
            return ResultadoVerificacion.Falla(
                Nombre,
                "El API respondió 200 pero sin los datos de la sucursal: 'apiUrl' no parece ser el API del monitor.");
        }

        return ResultadoVerificacion.Bien(
            Nombre,
            $"API key válida: sucursal '{yo.Nombre}' ({yo.SucursalId}), zona horaria {yo.ZonaHoraria}.");
    }

    /// <summary>Forma de <c>AgenteYoDto</c> (api/src/agentes/dto/agentes.dto.ts).</summary>
    private sealed record AgenteYo(string SucursalId, string Nombre, string ZonaHoraria);
}
