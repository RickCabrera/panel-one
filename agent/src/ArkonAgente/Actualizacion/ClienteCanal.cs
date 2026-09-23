using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using ArkonAgente.Configuracion;

namespace ArkonAgente.Actualizacion;

/// <summary>Lo que el canal le dice a esta sucursal (<c>GET /agente/version</c>).</summary>
internal sealed record VersionOfrecida(string Version, string Sha256, long TamanoBytes, Uri Url);

/// <summary>Un binario bajado a disco: su SHA-256 (hex minúsculas) y sus bytes.</summary>
internal sealed record Descargado(string Sha256, long Bytes);

/// <summary>La conversación del agente con el canal de versiones; los tests la sustituyen.</summary>
internal interface IClienteCanal
{
    /// <summary>Null = no hay nada para esta sucursal (sin bandera o sin vigente).</summary>
    Task<VersionOfrecida?> ConsultarAsync(CancellationToken cancelacion);

    /// <summary>Baja <paramref name="url"/> a <paramref name="destino"/>, con tope de bytes.</summary>
    Task<Descargado> DescargarAsync(Uri url, string destino, long tamanoEsperado, CancellationToken cancelacion);

    /// <summary>True si el api lo guardó (2xx).</summary>
    Task<bool> ReportarAsync(ResultadoActualizacion resultado, CancellationToken cancelacion);
}

/// <summary>El canal no contestó algo que se pueda usar (red, 4xx/5xx, JSON raro, URL insegura).</summary>
internal sealed class CanalInvalidoException(string mensaje) : Exception(mensaje);

/// <summary>
/// Cliente del canal de versiones del api (F2-143).
/// </summary>
/// <remarks>
/// <para>
/// La consulta y el reporte van con <c>X-Api-Key</c> a <c>{apiUrl}/agente/…</c>. La DESCARGA no:
/// el enlace viene firmado (la firma es la credencial) y la key no se manda nunca a él, por si un
/// día el binario vive en otro host. El enlace se resuelve contra <c>apiUrl</c> y sólo se acepta
/// <c>https</c>, o <c>http</c> a la propia máquina (la misma regla que <c>apiUrl</c>).
/// </para>
/// <para>
/// La descarga no confía en nada: tope de <see cref="VersionCanal.TamanoMaximo"/> y del tamaño que
/// dijo el canal (un byte de más corta la descarga), y el SHA-256 se calcula mientras se escribe.
/// Quien la llama compara ese SHA contra el del canal ANTES de usar el archivo.
/// </para>
/// </remarks>
internal sealed class ClienteCanal : IClienteCanal, IDisposable
{
    public static readonly TimeSpan TimeoutConsulta = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan TimeoutDescarga = TimeSpan.FromMinutes(15);

    private static readonly JsonSerializerOptions OpcionesJson = new(JsonSerializerDefaults.Web);

    private readonly ConfiguracionAgente _config;
    private readonly HttpClient _cliente;
    private readonly Uri _base;

    public ClienteCanal(ConfiguracionAgente config, HttpMessageHandler? handler = null)
    {
        _config = config;
        _base = config.ApiUrl.AbsoluteUri.EndsWith('/') ? config.ApiUrl : new Uri(config.ApiUrl.AbsoluteUri + "/");
        _cliente = new HttpClient(handler ?? new SocketsHttpHandler(), disposeHandler: handler is null)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    /// <summary>
    /// El enlace del canal resuelto contra <paramref name="apiUrl"/>. Null si no es https (o http a
    /// la propia máquina): el binario que va a correr en la PC del POS no viaja en claro.
    /// </summary>
    public static Uri? ResolverEnlace(Uri apiUrl, string enlace)
    {
        var baseConBarra = apiUrl.AbsoluteUri.EndsWith('/') ? apiUrl : new Uri(apiUrl.AbsoluteUri + "/");
        if (!Uri.TryCreate(baseConBarra, enlace, out var url))
        {
            return null;
        }

        var segura = url.Scheme == Uri.UriSchemeHttps || (url.Scheme == Uri.UriSchemeHttp && url.IsLoopback);
        return segura && string.IsNullOrEmpty(url.UserInfo) ? url : null;
    }

    public async Task<VersionOfrecida?> ConsultarAsync(CancellationToken cancelacion)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        cts.CancelAfter(TimeoutConsulta);
        using var peticion = new HttpRequestMessage(HttpMethod.Get, new Uri(_base, "agente/version"));
        peticion.Headers.Add("X-Api-Key", _config.ApiKey);
        using var respuesta = await Enviar(peticion, cts.Token, cancelacion);
        if (!respuesta.IsSuccessStatusCode)
        {
            throw new CanalInvalidoException($"El canal de versiones respondió {(int)respuesta.StatusCode}.");
        }

        CanalDto? dto;
        try
        {
            dto = await respuesta.Content.ReadFromJsonAsync<CanalDto>(OpcionesJson, cts.Token);
        }
        catch (JsonException)
        {
            throw new CanalInvalidoException("El canal de versiones respondió algo que no es el JSON esperado.");
        }

        if (dto is null || !dto.Disponible)
        {
            return null;
        }

        if (!VersionCanal.EsValida(dto.Version) || !VersionCanal.EsShaValido(dto.Sha256) ||
            dto.TamanoBytes is not (> 0 and <= VersionCanal.TamanoMaximo) || string.IsNullOrWhiteSpace(dto.Url))
        {
            throw new CanalInvalidoException("El canal de versiones ofreció una versión con datos inválidos.");
        }

        var url = ResolverEnlace(_config.ApiUrl, dto.Url)
            ?? throw new CanalInvalidoException(
                "El canal de versiones ofreció un enlace que no es https: no se descarga un binario en claro.");
        return new VersionOfrecida(dto.Version!, dto.Sha256!, dto.TamanoBytes!.Value, url);
    }

    public async Task<Descargado> DescargarAsync(Uri url, string destino, long tamanoEsperado, CancellationToken cancelacion)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        cts.CancelAfter(TimeoutDescarga);
        // SIN X-Api-Key: la firma del enlace es la credencial.
        using var peticion = new HttpRequestMessage(HttpMethod.Get, url);
        using var respuesta = await Enviar(peticion, cts.Token, cancelacion, HttpCompletionOption.ResponseHeadersRead);
        if (!respuesta.IsSuccessStatusCode)
        {
            throw new CanalInvalidoException($"La descarga del binario respondió {(int)respuesta.StatusCode}.");
        }

        var tope = Math.Min(tamanoEsperado, VersionCanal.TamanoMaximo);
        if (respuesta.Content.Headers.ContentLength is { } declarado && declarado > tope)
        {
            throw new CanalInvalidoException($"El binario mide {declarado} bytes y el canal dijo {tamanoEsperado}.");
        }

        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long total = 0;
        try
        {
            await using var entrada = await respuesta.Content.ReadAsStreamAsync(cts.Token);
            await using var salida = new FileStream(destino, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            var bufer = new byte[81920];
            int leidos;
            while ((leidos = await entrada.ReadAsync(bufer, cts.Token)) > 0)
            {
                total += leidos;
                if (total > tope)
                {
                    throw new CanalInvalidoException($"El binario pasa de los {tamanoEsperado} bytes que dijo el canal.");
                }

                sha.AppendData(bufer, 0, leidos);
                await salida.WriteAsync(bufer.AsMemory(0, leidos), cts.Token);
            }

            await salida.FlushAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            throw new CanalInvalidoException("La descarga del binario tardó demasiado.");
        }
        catch (HttpRequestException ex)
        {
            throw new CanalInvalidoException($"La descarga del binario se cortó ({ex.HttpRequestError}).");
        }

        return new Descargado(Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant(), total);
    }

    public async Task<bool> ReportarAsync(ResultadoActualizacion resultado, CancellationToken cancelacion)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        cts.CancelAfter(TimeoutConsulta);
        using var peticion = new HttpRequestMessage(HttpMethod.Post, new Uri(_base, "agente/actualizacion"))
        {
            Content = JsonContent.Create(
                new
                {
                    version = resultado.Version,
                    resultado = resultado.Resultado,
                    motivo = resultado.Motivo,
                    detalle = Acotar(resultado.Detalle, 500),
                },
                options: OpcionesJson),
        };
        peticion.Headers.Add("X-Api-Key", _config.ApiKey);
        try
        {
            using var respuesta = await Enviar(peticion, cts.Token, cancelacion);
            return respuesta.IsSuccessStatusCode;
        }
        catch (CanalInvalidoException)
        {
            return false;
        }
    }

    public void Dispose() => _cliente.Dispose();

    private async Task<HttpResponseMessage> Enviar(
        HttpRequestMessage peticion,
        CancellationToken conTimeout,
        CancellationToken delServicio,
        HttpCompletionOption opcion = HttpCompletionOption.ResponseContentRead)
    {
        try
        {
            return await _cliente.SendAsync(peticion, opcion, conTimeout);
        }
        catch (OperationCanceledException) when (!delServicio.IsCancellationRequested)
        {
            throw new CanalInvalidoException("El api no respondió a tiempo.");
        }
        catch (HttpRequestException ex)
        {
            // Sólo el tipo de error: el mensaje podría citar la URL con la firma.
            throw new CanalInvalidoException($"No se pudo hablar con el api ({ex.HttpRequestError}).");
        }
    }

    private static string? Acotar(string? texto, int largo) =>
        texto is null || texto.Length <= largo ? texto : texto[..(largo - 1)] + "…";

    private sealed record CanalDto(bool Disponible, string? Version, string? Sha256, long? TamanoBytes, string? Url);
}
