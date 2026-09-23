using ArkonAgente.Catalogos;

namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Acceso de SOLO LECTURA a la base de SoftRestaurant de una versión concreta. El
/// agente elige la implementación al arrancar según la versión detectada
/// (<see cref="SelectorReader"/>).
/// </summary>
/// <remarks>
/// Los catálogos (F2-240) dicen aquí qué consulta usan. La lectura de cheques cerrados
/// la agrega F1-022 y la de cuentas abiertas F1-023, cuando el mapeo de tablas se valide
/// en F1-090. Toda query que agreguen va en un <c>.sql</c> embebido, con
/// <c>WITH (NOLOCK)</c> y el comando de <c>ConexionSoftRestaurant.CrearComando</c>
/// (timeout corto).
/// </remarks>
internal interface ISoftRestaurantReader
{
    /// <summary>Nombre de la implementación, para el log.</summary>
    string Nombre { get; }

    /// <summary>Versión de la base contra la que se eligió.</summary>
    VersionSr Version { get; }

    /// <summary>
    /// La consulta embebida (<c>Sql/Consultas/&lt;nombre&gt;.sql</c>) que lee
    /// <paramref name="catalogo"/> en ESTA versión (F2-240). Cuelga del reader para que una
    /// versión con otro esquema tenga sus propias consultas y pase por
    /// <see cref="SelectorReader"/> antes de leer nada.
    /// </summary>
    string ConsultaCatalogo(CatalogoPanel catalogo);

    /// <summary>La consulta embebida que lee las existencias por almacén en ESTA versión (F2-241).</summary>
    string ConsultaExistencias { get; }
}

/// <summary>
/// Reader de SoftRestaurant 10 y 11. ✅ La 10 se vio en una instalación real
/// (versiondb 10.021800); ⚠️ la 11 es SUPUESTO: se da por hecho que comparte
/// esquema con la 10 hasta que F1-090 lo confirme.
/// </summary>
internal sealed class SrV11Reader(VersionSr version) : ISoftRestaurantReader
{
    /// <summary>Versiones mayores que este reader acepta.</summary>
    public static readonly IReadOnlyList<int> MayoresSoportados = [10, 11];

    public string Nombre => nameof(SrV11Reader);

    public VersionSr Version { get; } = version;

    /// <summary>
    /// ✅ Columnas vistas en SR 10 (2026-09-23, sólo metadatos); ⚠️ en la 11 son SUPUESTO,
    /// como el resto de este reader. docs/esquema-sr.md §6–§8.
    /// </summary>
    public string ConsultaCatalogo(CatalogoPanel catalogo) => "sr_catalogo_" + catalogo.Texto();

    /// <summary>
    /// ✅ Tablas y triggers vistos en SR 10 (2026-09-23, sólo metadatos; sin movimientos en la
    /// base); ⚠️ en la 11, SUPUESTO. docs/esquema-sr.md §10.
    /// </summary>
    public string ConsultaExistencias => "sr_existencias";
}
