namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Acceso de SOLO LECTURA a la base de SoftRestaurant de una versión concreta. El
/// agente elige la implementación al arrancar según la versión detectada
/// (<see cref="SelectorReader"/>).
/// </summary>
/// <remarks>
/// Todavía no tiene métodos de lectura: la lectura de cheques cerrados la agrega
/// F1-022 y la de cuentas abiertas F1-023, cuando el mapeo de tablas se valide en
/// F1-090. Toda query que agreguen va en un <c>.sql</c> embebido, con
/// <c>WITH (NOLOCK)</c> y el comando de <c>ConexionSoftRestaurant.CrearComando</c>
/// (timeout corto).
/// </remarks>
internal interface ISoftRestaurantReader
{
    /// <summary>Nombre de la implementación, para el log.</summary>
    string Nombre { get; }

    /// <summary>Versión de la base contra la que se eligió.</summary>
    VersionSr Version { get; }
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
}
