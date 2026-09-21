using System.Net;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Configuracion;

/// <summary>
/// Resultado de cargar <c>config.json</c>: la config válida, o la lista de errores
/// que impiden usarla. Los avisos no impiden nada, pero se muestran.
/// </summary>
internal sealed record ResultadoConfiguracion(
    ConfiguracionAgente? Configuracion,
    IReadOnlyList<string> Errores,
    IReadOnlyList<string> Avisos)
{
    public bool Ok => Configuracion is not null;
}

/// <summary>
/// Lee y valida <c>config.json</c>:
/// <c>{ apiUrl, apiKey, connectionString, intervaloSegundos }</c>.
/// </summary>
/// <remarks>
/// El archivo lo edita a mano un técnico en la PC del restaurante, así que se
/// toleran comentarios y comas finales, y cada error dice qué campo está mal y
/// qué hacer. Ningún mensaje repite el valor de <c>apiKey</c> ni de
/// <c>connectionString</c>: los dos son secretos del cliente y los mensajes
/// terminan en la consola y en el log.
/// </remarks>
internal static class CargadorConfiguracion
{
    private static readonly JsonDocumentOptions OpcionesJson = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>El intervalo con el que el panel calcula "desconectado" (3 × 30 s = 90 s, F1-061).</summary>
    internal const int IntervaloQueSuponeElPanel = 30;

    private static readonly string[] CamposConocidos =
        ["apiUrl", "apiKey", "connectionString", "intervaloSegundos"];

    public static ResultadoConfiguracion Cargar(string rutaArchivo)
    {
        if (!File.Exists(rutaArchivo))
        {
            return Fallo(
                $"No existe el archivo de configuración '{rutaArchivo}'. " +
                "Cópialo de la plantilla (infra/config.example.json) y llena sus valores.");
        }

        string texto;
        try
        {
            texto = File.ReadAllText(rutaArchivo);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Fallo(
                $"No se pudo leer '{rutaArchivo}' ({ex.GetType().Name}). " +
                "Si es por permisos, corre el comando desde una consola de administrador.");
        }

        return Interpretar(texto, rutaArchivo);
    }

    /// <summary>Valida el contenido ya leído. <paramref name="origen"/> sólo va en los mensajes.</summary>
    public static ResultadoConfiguracion Interpretar(string texto, string origen)
    {
        JsonDocument documento;
        try
        {
            documento = JsonDocument.Parse(texto, OpcionesJson);
        }
        catch (JsonException ex)
        {
            // Sin ex.Message: puede citar un pedazo del archivo, y el archivo trae secretos.
            var linea = (ex.LineNumber ?? 0) + 1;
            var columna = (ex.BytePositionInLine ?? 0) + 1;
            return Fallo(
                $"'{origen}' no es JSON válido cerca de la línea {linea}, columna {columna}. " +
                "Revisa comillas, comas y llaves.");
        }

        using (documento)
        {
            var raiz = documento.RootElement;
            if (raiz.ValueKind != JsonValueKind.Object)
            {
                return Fallo($"'{origen}' debe ser un objeto JSON {{ ... }} con apiUrl, apiKey y connectionString.");
            }

            var errores = new List<string>();
            var avisos = new List<string>();

            foreach (var propiedad in raiz.EnumerateObject())
            {
                if (!CamposConocidos.Contains(propiedad.Name, StringComparer.Ordinal))
                {
                    avisos.Add(
                        $"Campo desconocido '{propiedad.Name}' en la configuración; se ignora. " +
                        $"Los campos válidos son: {string.Join(", ", CamposConocidos)} (respeta mayúsculas).");
                }
            }

            var apiUrl = ValidarApiUrl(TextoObligatorio(raiz, "apiUrl", errores), errores);
            var apiKey = TextoObligatorio(raiz, "apiKey", errores);
            var cadena = ValidarCadena(TextoObligatorio(raiz, "connectionString", errores), errores);
            var intervalo = ValidarIntervalo(raiz, errores);

            // DECISION PROVISIONAL (nocturno): el panel (F1-061) marca "desconectado" a los
            // 90 s fijos (3 × 30 s), no a 3 × el intervalo de cada agente. El heartbeat no
            // manda el intervalo; si Ricardo lo quiere por sucursal, es tarea aparte (cruza a
            // /web y al Monitor de Mesas). Mientras tanto, se avisa aquí.
            if (errores.Count == 0 && intervalo > IntervaloQueSuponeElPanel)
            {
                avisos.Add(
                    $"'intervaloSegundos' vale {intervalo}: el panel marca una sucursal como desconectada " +
                    $"a los {3 * IntervaloQueSuponeElPanel} s sin reportar, así que con más de " +
                    $"{IntervaloQueSuponeElPanel} s saldrá desconectada en falso entre ciclo y ciclo.");
            }

            if (errores.Count > 0 || apiUrl is null || apiKey is null || cadena is null)
            {
                return new ResultadoConfiguracion(null, errores, avisos);
            }

            return new ResultadoConfiguracion(
                new ConfiguracionAgente(apiUrl, apiKey, cadena, intervalo), [], avisos);
        }
    }

    private static string? TextoObligatorio(JsonElement raiz, string campo, List<string> errores)
    {
        if (!raiz.TryGetProperty(campo, out var valor) || valor.ValueKind == JsonValueKind.Null)
        {
            errores.Add($"Falta el campo '{campo}'.");
            return null;
        }

        if (valor.ValueKind != JsonValueKind.String)
        {
            errores.Add($"El campo '{campo}' debe ser texto entre comillas.");
            return null;
        }

        var texto = valor.GetString()!.Trim();
        if (texto.Length == 0)
        {
            errores.Add($"El campo '{campo}' está vacío.");
            return null;
        }

        return texto;
    }

    private static Uri? ValidarApiUrl(string? texto, List<string> errores)
    {
        if (texto is null)
        {
            return null;
        }

        if (!Uri.TryCreate(texto, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            errores.Add("'apiUrl' debe ser una URL completa, por ejemplo https://monitor.ejemplo.com.");
            return null;
        }

        // La API key viaja en un header: por http plano la lee cualquiera en la red del
        // restaurante. http sólo se acepta contra la propia máquina (desarrollo).
        if (uri.Scheme == Uri.UriSchemeHttp && !EsLoopback(uri))
        {
            errores.Add("'apiUrl' debe usar https:// (la API key viaja en cada petición). http:// sólo se acepta para localhost.");
            return null;
        }

        if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
        {
            errores.Add("'apiUrl' es la URL base del API: sin '?' ni '#'.");
            return null;
        }

        return uri;
    }

    private static bool EsLoopback(Uri uri) =>
        uri.IsLoopback
        || (IPAddress.TryParse(uri.Host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip));

    private static string? ValidarCadena(string? texto, List<string> errores)
    {
        if (texto is null)
        {
            return null;
        }

        SqlConnectionStringBuilder constructor;
        try
        {
            constructor = new SqlConnectionStringBuilder(texto);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or KeyNotFoundException)
        {
            // Sin ex.Message: puede citar la cadena, y la cadena trae el password.
            errores.Add(
                "'connectionString' no tiene el formato de una cadena de conexión de SQL Server " +
                "(pares Clave=Valor separados por ';', por ejemplo Server=...;Database=...;User ID=...;Password=...).");
            return null;
        }

        if (string.IsNullOrWhiteSpace(constructor.DataSource))
        {
            errores.Add("'connectionString' no dice a qué servidor conectarse (falta Server= o Data Source=).");
        }

        if (string.IsNullOrWhiteSpace(constructor.InitialCatalog))
        {
            errores.Add("'connectionString' no dice qué base leer (falta Database= o Initial Catalog= con la base de SoftRestaurant).");
        }

        return texto;
    }

    private static int ValidarIntervalo(JsonElement raiz, List<string> errores)
    {
        if (!raiz.TryGetProperty("intervaloSegundos", out var valor) || valor.ValueKind == JsonValueKind.Null)
        {
            return ConfiguracionAgente.IntervaloPorDefecto;
        }

        if (valor.ValueKind != JsonValueKind.Number || !valor.TryGetInt32(out var segundos))
        {
            errores.Add("'intervaloSegundos' debe ser un número entero de segundos (sin comillas).");
            return ConfiguracionAgente.IntervaloPorDefecto;
        }

        if (segundos < ConfiguracionAgente.IntervaloMinimo || segundos > ConfiguracionAgente.IntervaloMaximo)
        {
            errores.Add(
                $"'intervaloSegundos' debe estar entre {ConfiguracionAgente.IntervaloMinimo} y " +
                $"{ConfiguracionAgente.IntervaloMaximo}; vale {segundos}.");
        }

        return segundos;
    }

    private static ResultadoConfiguracion Fallo(string error) => new(null, [error], []);
}
