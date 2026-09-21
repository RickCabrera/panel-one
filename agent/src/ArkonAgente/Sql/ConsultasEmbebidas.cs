using System.Reflection;

namespace ArkonAgente.Sql;

/// <summary>
/// Lee las queries <c>.sql</c> embebidas en el ensamblado (carpeta
/// <c>Sql/Consultas</c>). Las queries contra SQL Server nunca van en strings inline:
/// así se revisan como SQL, y el test de guardia puede comprobar que ninguna escribe.
/// </summary>
internal static class ConsultasEmbebidas
{
    private const string Prefijo = "ArkonAgente.Sql.";
    private static readonly Assembly Ensamblado = typeof(ConsultasEmbebidas).Assembly;

    /// <summary>Texto de <c>Sql/Consultas/&lt;nombre&gt;.sql</c>.</summary>
    public static string Leer(string nombre)
    {
        using var flujo = Ensamblado.GetManifestResourceStream(Prefijo + nombre + ".sql")
            ?? throw new InvalidOperationException($"No existe la consulta embebida '{nombre}.sql'.");
        using var lector = new StreamReader(flujo);
        return lector.ReadToEnd();
    }

    /// <summary>Nombres (sin extensión) de todas las consultas embebidas.</summary>
    public static IReadOnlyList<string> Nombres() =>
        Ensamblado.GetManifestResourceNames()
            .Where(n => n.StartsWith(Prefijo, StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal))
            .Select(n => n[Prefijo.Length..^".sql".Length])
            .ToList();
}
