using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Tests;

/// <summary>Una petición al API falso de catálogos (cuerpo ya inflado).</summary>
internal sealed record PeticionCatalogo(
    HttpMethod Metodo, string Ruta, string? ApiKey, IReadOnlyList<string> ContentEncoding, JsonElement? Cuerpo)
{
    public bool EsPagina => Metodo == HttpMethod.Post && Ruta.EndsWith("/ingesta/catalogos", StringComparison.Ordinal);

    public bool EsCierre => Ruta.EndsWith("/ingesta/catalogos/cierre", StringComparison.Ordinal);

    public string? Catalogo => Cuerpo?.GetProperty("catalogo").GetString();
}

/// <summary>
/// Simula el contrato de F2-230: <c>POST /ingesta/catalogos</c>, <c>/cierre</c> y
/// <c>GET /solicitud</c>. Por defecto guarda todo sin rechazos y aplica cada cierre.
/// </summary>
internal sealed class ApiCatalogosFalso : HttpMessageHandler
{
    private readonly object _candado = new();

    public bool Caido { get; set; }

    /// <summary>Respuesta a la medida; null = la de por defecto.</summary>
    public Func<PeticionCatalogo, HttpResponseMessage?>? Responder { get; set; }

    /// <summary>Lo que devuelve <c>GET /solicitud</c>.</summary>
    public (string? SolicitadaAt, bool Pendiente) Solicitud { get; set; } = (null, false);

    public List<PeticionCatalogo> Peticiones { get; } = [];

    public List<PeticionCatalogo> Envios
    {
        get { lock (_candado) { return Peticiones.Where(p => p.Metodo == HttpMethod.Post).ToList(); } }
    }

    public int ConsultasSolicitud
    {
        get { lock (_candado) { return Peticiones.Count(p => p.Metodo == HttpMethod.Get); } }
    }

    public static HttpResponseMessage Json(HttpStatusCode codigo, object cuerpo) =>
        new(codigo) { Content = new StringContent(JsonSerializer.Serialize(cuerpo), Encoding.UTF8, "application/json") };

    public static HttpResponseMessage Pagina(int recibidos, int rechazadosSinFila = 0, int obsoletos = 0, params object[] rechazados) =>
        Json(HttpStatusCode.OK, new
        {
            catalogo = "x", recibidos, creados = recibidos, actualizados = 0, sinCambios = 0, obsoletos, vistos = 0,
            rechazadosSinFila, rechazados,
        });

    public static HttpResponseMessage Cierre(bool aplicado = true, int activos = 0, int desactivados = 0) =>
        Json(HttpStatusCode.OK, new { aplicado, desactivados, activos });

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Caido)
        {
            throw new HttpRequestException(HttpRequestError.ConnectionError, "Sin red (simulado).");
        }

        JsonElement? cuerpo = null;
        if (request.Content is not null)
        {
            var bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
            using var entrada = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress);
            using var documento = JsonDocument.Parse(entrada);
            cuerpo = documento.RootElement.Clone();
        }

        var peticion = new PeticionCatalogo(
            request.Method,
            request.RequestUri!.AbsolutePath,
            request.Headers.TryGetValues("X-Api-Key", out var keys) ? keys.Single() : null,
            request.Content?.Headers.ContentEncoding.ToList() ?? [],
            cuerpo);
        lock (_candado)
        {
            Peticiones.Add(peticion);
        }

        if (Responder?.Invoke(peticion) is { } medida)
        {
            return medida;
        }

        if (request.Method == HttpMethod.Get)
        {
            return Json(HttpStatusCode.OK, new { solicitadaAt = Solicitud.SolicitadaAt, pendiente = Solicitud.Pendiente });
        }

        return peticion.EsCierre
            ? Cierre(activos: cuerpo!.Value.GetProperty("total").GetInt32())
            : Pagina(cuerpo!.Value.GetProperty("registros").GetArrayLength());
    }
}
