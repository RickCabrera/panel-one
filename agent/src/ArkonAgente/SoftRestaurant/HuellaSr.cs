namespace ArkonAgente.SoftRestaurant;

/// <summary>Lo que las dos queries de detección vieron en la base.</summary>
/// <param name="BaseDatos">Base de la cadena de conexión, para los mensajes.</param>
/// <param name="TablasPresentes">Tablas candidatas que existen en <c>dbo</c> (sr_estructura.sql).</param>
/// <param name="TieneVersionDb">Si existe <c>dbo.parametros2.versiondb</c>.</param>
/// <param name="Versiones">Valores de <c>versiondb</c> (hasta 2 filas; <c>null</c> = NULL en la base).</param>
internal sealed record HuellaSr(
    string BaseDatos,
    IReadOnlySet<string> TablasPresentes,
    bool TieneVersionDb,
    IReadOnlyList<string?> Versiones)
{
    /// <summary>
    /// Arma la huella con las filas de las dos queries. Los nombres se comparan
    /// EXACTOS (ordinal), tal como los devuelve el catálogo: la instalación vista es
    /// CI y los tiene en minúsculas; una con collation CS no se ha visto (§12).
    /// </summary>
    public static HuellaSr Desde(
        string baseDatos,
        IEnumerable<(string Tabla, bool TieneVersionDb)> filasEstructura,
        IEnumerable<string?> versiones)
    {
        var tablas = new HashSet<string>(StringComparer.Ordinal);
        var tieneVersionDb = false;
        foreach (var (tabla, tieneColumna) in filasEstructura)
        {
            tablas.Add(tabla);
            tieneVersionDb |= tabla == SelectorReader.TablaVersion && tieneColumna;
        }

        return new HuellaSr(baseDatos, tablas, tieneVersionDb, versiones.ToList());
    }
}
