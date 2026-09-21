using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Tests;

/// <summary>Un evento tal como lo recibió el API falso (ya inflado el gzip).</summary>
internal sealed record EventoRecibido(string Id, string Tipo, JsonElement Datos)
{
    public string? Folio => Datos.TryGetProperty("folioSr", out var f) ? f.GetString() : null;

    public string? Version => Datos.TryGetProperty("version", out var v) ? v.GetString() : null;
}

/// <summary>Lo que llegó en una petición al API falso.</summary>
internal sealed record PeticionRecibida(
    Uri? Url, string? ApiKey, IReadOnlyList<string> ContentEncoding, string? ContentType, IReadOnlyList<EventoRecibido> Eventos);

/// <summary>
/// Simula <c>POST /ingesta/eventos</c>: infla el gzip, lee el lote y responde. Por
/// defecto guarda todo y lo devuelve en <c>procesados</c>. Con <see cref="Caido"/>
/// simula la red cortada en el cliente HTTP (así lo pide el backlog para el AC).
/// </summary>
internal sealed class ApiFalso : HttpMessageHandler
{
    private readonly object _candado = new();

    /// <summary>Sin red: cada petición lanza <see cref="HttpRequestException"/>.</summary>
    public bool Caido { get; set; }

    /// <summary>El API guarda el lote pero la respuesta nunca llega (timeout del lado del agente).</summary>
    public bool PerderRespuesta { get; set; }

    /// <summary>Respuesta a la medida; si devuelve null, se usa la de por defecto (guardar todo).</summary>
    public Func<IReadOnlyList<EventoRecibido>, HttpResponseMessage?>? Responder { get; set; }

    public List<PeticionRecibida> Peticiones { get; } = [];

    /// <summary>Copia de <see cref="Peticiones"/>, segura mientras el envío sigue corriendo en otro hilo.</summary>
    public List<PeticionRecibida> CopiaPeticiones()
    {
        lock (_candado)
        {
            return Peticiones.ToList();
        }
    }

    /// <summary>Lo que el API "guardó", en orden de llegada (con repeticiones si las hubo).</summary>
    public List<EventoRecibido> Guardados { get; } = [];

    public int Intentos { get; private set; }

    public static HttpResponseMessage Resultado(IEnumerable<string> procesados, params object[] rechazados) =>
        Json(HttpStatusCode.OK, new { procesados, rechazados });

    public static HttpResponseMessage Json(HttpStatusCode codigo, object cuerpo) =>
        new(codigo)
        {
            Content = new StringContent(JsonSerializer.Serialize(cuerpo), Encoding.UTF8, "application/json"),
        };

    public static IReadOnlyList<EventoRecibido> Leer(byte[] gzip)
    {
        using var entrada = new GZipStream(new MemoryStream(gzip), CompressionMode.Decompress);
        using var documento = JsonDocument.Parse(entrada);
        return documento.RootElement.GetProperty("eventos").EnumerateArray()
            .Select(e => new EventoRecibido(
                e.GetProperty("id").GetString()!, e.GetProperty("tipo").GetString()!, e.GetProperty("datos").Clone()))
            .ToList();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        lock (_candado)
        {
            Intentos++;
        }

        if (Caido)
        {
            throw new HttpRequestException(HttpRequestError.ConnectionError, "Sin red (simulado).");
        }

        var eventos = Leer(await request.Content!.ReadAsByteArrayAsync(cancellationToken));
        lock (_candado)
        {
            Peticiones.Add(new PeticionRecibida(
                request.RequestUri,
                request.Headers.TryGetValues("X-Api-Key", out var keys) ? keys.Single() : null,
                request.Content.Headers.ContentEncoding.ToList(),
                request.Content.Headers.ContentType?.MediaType,
                eventos));
        }

        var respuesta = Responder?.Invoke(eventos);
        if (respuesta is not null)
        {
            return respuesta;
        }

        lock (_candado)
        {
            Guardados.AddRange(eventos);
        }

        if (PerderRespuesta)
        {
            // Lo que ve HttpClient cuando vence el timeout de la petición.
            throw new TaskCanceledException("La respuesta se perdió (simulado).");
        }

        return Resultado(eventos.Select(e => e.Id));
    }
}
