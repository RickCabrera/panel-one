using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ArkonAgente.Inventario;

/// <summary>
/// Los tres contratos de "lote con <c>leidoAt</c>" del panel que el agente llena desde SR (F2-241b):
/// pólizas de inventario (F2-122), compras (F2-126) y recetas (F2-125).
/// </summary>
internal enum TipoDocumentoInventario
{
    Movimientos,
    Compras,
    Recetas,
}

internal static class TiposDocumentoInventario
{
    public static readonly IReadOnlyList<TipoDocumentoInventario> Todos =
        [TipoDocumentoInventario.Movimientos, TipoDocumentoInventario.Compras, TipoDocumentoInventario.Recetas];

    /// <summary>Como se guarda en el SQLite y se escribe en el log.</summary>
    public static string Texto(this TipoDocumentoInventario tipo) => tipo switch
    {
        TipoDocumentoInventario.Movimientos => "movimientos",
        TipoDocumentoInventario.Compras => "compras",
        TipoDocumentoInventario.Recetas => "recetas",
        _ => throw new ArgumentOutOfRangeException(nameof(tipo)),
    };

    public static TipoDocumentoInventario Desde(string texto) =>
        Todos.Single(t => t.Texto() == texto);

    /// <summary>Ruta relativa a <c>apiUrl</c>.</summary>
    public static string Ruta(this TipoDocumentoInventario tipo) => "ingesta/" + tipo.Texto();

    /// <summary>El arreglo del sobre: <c>polizas</c>, <c>compras</c> o <c>recetas</c>.</summary>
    public static string Campo(this TipoDocumentoInventario tipo) => tipo switch
    {
        TipoDocumentoInventario.Movimientos => "polizas",
        TipoDocumentoInventario.Compras => "compras",
        _ => "recetas",
    };

    /// <summary>La clave del documento en el rechazo del API.</summary>
    public static string CampoClave(this TipoDocumentoInventario tipo) =>
        tipo == TipoDocumentoInventario.Recetas ? "productoOrigenSrId" : "origenSrId";

    /// <summary>Tope de documentos por lote (MAX_POLIZAS_LOTE, MAX_COMPRAS_LOTE, MAX_RECETAS_LOTE).</summary>
    public static int MaxDocumentos(this TipoDocumentoInventario tipo) =>
        tipo == TipoDocumentoInventario.Recetas ? 500 : 200;

    /// <summary>Tope de partidas / renglones EN TOTAL por lote (los tres contratos: 5000).</summary>
    public static int MaxRenglones(this TipoDocumentoInventario tipo) => 5000;

    /// <summary>¿Se lee por ventana de fecha (cursor)? Las recetas se leen completas.</summary>
    public static bool ConVentana(this TipoDocumentoInventario tipo) => tipo != TipoDocumentoInventario.Recetas;
}

/// <summary>
/// Un documento listo para el contrato: su JSON (campos en orden fijo) y la variante que se manda
/// si deja de verse en SR (<paramref name="JsonAusente"/>: póliza o compra con <c>cancelada=true</c>,
/// receta con <c>renglones: []</c>), porque el panel nunca borra: hay que decírselo.
/// </summary>
/// <param name="Clave">El <c>origenSrId</c> (o <c>productoOrigenSrId</c>) del documento.</param>
/// <param name="FechaVentana">La fecha MÁS NUEVA del documento en hora local de SR (null en recetas): decide si sigue en la ventana.</param>
/// <param name="Renglones">Partidas o renglones: cuentan para el tope del lote.</param>
internal sealed record DocumentoInventario(string Clave, DateTime? FechaVentana, int Renglones, string Json, string JsonAusente);

/// <summary>Lo que salió de leer un tipo de documento en SoftRestaurant.</summary>
/// <param name="Documentos">Los que se pueden mandar.</param>
/// <param name="Omitidos">Claves que SÍ están en SR pero no se mandan (sin fecha, varias empresas
/// distintas…): no cuentan como desaparecidas.</param>
/// <param name="FilasSql">Filas que devolvió la consulta.</param>
/// <param name="FechaMaxima">La fecha de SR más nueva que se vio (para el cursor); null si ninguna.</param>
/// <param name="Avisos">Rarezas del POS que van al log (sin cantidades ni costos).</param>
internal sealed record DocumentosLeidos(
    IReadOnlyList<DocumentoInventario> Documentos,
    IReadOnlyList<string> Omitidos,
    int FilasSql,
    DateTime? FechaMaxima,
    IReadOnlyList<string> Avisos);

/// <summary>Lo que comparten los tres mapeos: texto del contrato, columnas y fechas. Todo en <c>decimal</c>.</summary>
internal static class ApoyoMapeo
{
    /// <summary>Formato del cursor en el SQLite: hora LOCAL de SR, sin zona.</summary>
    public const string FormatoFechaSr = "yyyy-MM-dd'T'HH:mm:ss.fff";

    /// <summary>Texto invariante; un cero negativo (−0.0004 redondeado) viaja como cero.</summary>
    public static string Formatear(decimal valor) =>
        (valor == 0m ? 0m : valor).ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// DECISION PROVISIONAL (nocturno): SR guarda las cantidades con 4 decimales y el contrato admite 3
    /// (NUMERIC(12,3)): se redondea mitad lejos de cero, como las existencias (F2-241).
    /// </summary>
    public static decimal Cantidad3(decimal valor) => Math.Round(valor, 3, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Una fecha de SR (hora local del POS, sin zona) al instante del contrato, ISO-8601 UTC con
    /// milisegundos. DECISION PROVISIONAL (nocturno): la zona es la de Windows en la PC del agente
    /// (la misma que usan los catálogos y el reloj de las existencias); una hora ambigua o que no
    /// existe (cambio de horario) toma el desfase estándar, sin lanzar.
    /// </summary>
    public static string Instante(DateTime fechaSr, TimeZoneInfo zona)
    {
        var local = DateTime.SpecifyKind(fechaSr, DateTimeKind.Unspecified);
        var desfase = zona.IsInvalidTime(local) || zona.IsAmbiguousTime(local) ? zona.BaseUtcOffset : zona.GetUtcOffset(local);
        return new DateTimeOffset(local, desfase).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    public static string FechaSrTexto(DateTime fechaSr) => fechaSr.ToString(FormatoFechaSr, CultureInfo.InvariantCulture);

    public static DateTime LeerFechaSr(string texto) =>
        DateTime.ParseExact(texto, FormatoFechaSr, CultureInfo.InvariantCulture, DateTimeStyles.None);

    /// <summary>SHA-256 del JSON: lo que se compara contra el SQLite para no reenviar lo igual.</summary>
    public static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));

    /// <summary>Texto recortado a la derecha (los char de SR vienen con relleno); vacío = null.</summary>
    public static string? Texto(IDataRecord r, int i)
    {
        if (r.IsDBNull(i))
        {
            return null;
        }

        var texto = Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture)?.TrimEnd(' ');
        return string.IsNullOrEmpty(texto) ? null : texto;
    }

    public static decimal? Decimal(IDataRecord r, int i) =>
        r.IsDBNull(i) ? null : Convert.ToDecimal(r.GetValue(i), CultureInfo.InvariantCulture);

    public static DateTime? Fecha(IDataRecord r, int i) =>
        r.IsDBNull(i) ? null : Convert.ToDateTime(r.GetValue(i), CultureInfo.InvariantCulture);

    /// <summary>Un número de documento de SR (numeric(8,0), bigint) como texto; NULL o 0 = no hay.</summary>
    public static string? Numero(IDataRecord r, int i)
    {
        var valor = Decimal(r, i);
        return valor is null or 0m ? null : Formatear(valor.Value);
    }

    public static Func<string, int> Indices(IDataRecord registro)
    {
        var indices = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < registro.FieldCount; i++)
        {
            indices.TryAdd(registro.GetName(i), i);
        }

        return columna => indices.TryGetValue(columna, out var i)
            ? i
            : throw new InvalidDataException($"La consulta no trae la columna '{columna}'.");
    }
}
