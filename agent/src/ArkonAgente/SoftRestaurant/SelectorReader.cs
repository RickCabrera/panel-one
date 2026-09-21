namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Decide qué reader usar a partir de la <see cref="HuellaSr"/>. Es puro: no toca
/// la base, para que cada caso se pruebe sin SQL Server. Ver docs/esquema-sr.md §1.
/// </summary>
internal static class SelectorReader
{
    public const string TablaVersion = "parametros2";

    /// <summary>
    /// Tablas que F1-022 / F1-023 van a leer. ✅ Existen en SR 10.0.323; sin ellas
    /// no hay nada que leer aunque la versión se reconozca.
    /// </summary>
    public static readonly IReadOnlyList<string> TablasNucleo =
        ["cheques", "cheqdet", "chequespagos", "tempcheques", "tempcheqdet"];

    /// <summary>La única versión mayor vista en una instalación real.</summary>
    public const int MayorValidada = 10;

    public static ResultadoDeteccion Elegir(HuellaSr huella)
    {
        var enBase = $"en la base '{huella.BaseDatos}'";
        var faltantes = TablasNucleo.Where(t => !huella.TablasPresentes.Contains(t)).ToList();

        if (!huella.TieneVersionDb)
        {
            // Con db_datareader, sys.tables sólo lista lo que el usuario puede leer:
            // que "no exista" también puede ser falta de permiso.
            var causas =
                "Puede ser que 'Database' en 'connectionString' no sea la base de SoftRestaurant, que el usuario " +
                "no tenga permiso de lectura (rol db_datareader) o que sea una versión de SoftRestaurant que el " +
                "agente no conoce.";
            return faltantes.Count == TablasNucleo.Count
                ? ResultadoDeteccion.NoSoportada(
                    $"No se encontró dbo.{TablaVersion}.versiondb ni las tablas de cuentas {enBase}. {causas}")
                : ResultadoDeteccion.NoSoportada(
                    $"No se encontró dbo.{TablaVersion}.versiondb {enBase}, que es donde SoftRestaurant 10 guarda " +
                    $"su versión. {causas}");
        }

        if (huella.Versiones.Count == 0)
        {
            return ResultadoDeteccion.NoSoportada(
                $"No se pudo saber la versión de SoftRestaurant: dbo.{TablaVersion} está vacía {enBase}.");
        }

        // Varias filas nunca se han visto (en SR 10 hay una). Si todas dicen lo mismo
        // no hay duda; si difieren, no se elige una al azar.
        if (huella.Versiones.Distinct(StringComparer.Ordinal).Count() > 1)
        {
            return ResultadoDeteccion.NoSoportada(
                $"No se pudo saber la versión de SoftRestaurant: dbo.{TablaVersion} tiene varias filas con " +
                $"versiones distintas {enBase}.");
        }

        var texto = huella.Versiones[0];
        var version = VersionSr.Interpretar(texto);
        if (version is null)
        {
            var mostrado = texto is null ? "NULL" : $"'{Recortar(texto)}'";
            return ResultadoDeteccion.NoSoportada(
                $"No se pudo interpretar la versión de SoftRestaurant: dbo.{TablaVersion}.versiondb vale {mostrado} {enBase}.");
        }

        if (!SrV11Reader.MayoresSoportados.Contains(version.Mayor))
        {
            return ResultadoDeteccion.NoSoportada(
                $"SoftRestaurant versión {version.Texto} no soportada {enBase}. El agente lee las versiones " +
                $"{string.Join(" y ", SrV11Reader.MayoresSoportados)}.",
                version.Texto);
        }

        if (faltantes.Count > 0)
        {
            return ResultadoDeteccion.NoSoportada(
                $"SoftRestaurant versión {version.Texto} {enBase}, pero no se encontraron las tablas " +
                $"{string.Join(", ", faltantes.Select(t => "dbo." + t))} (o el usuario no tiene permiso de leerlas).",
                version.Texto);
        }

        var aviso = version.Mayor == MayorValidada
            ? null
            : $"SoftRestaurant {version.Mayor} no se ha validado contra una instalación real: se lee con el mismo " +
              $"esquema que la {MayorValidada}. Ver docs/esquema-sr.md §1.";
        return ResultadoDeteccion.Soportada(new SrV11Reader(version), aviso);
    }

    // El texto viene de la base: se acota para que el mensaje quepa en el heartbeat.
    private static string Recortar(string texto) => texto.Length <= 40 ? texto : texto[..40] + "…";
}
