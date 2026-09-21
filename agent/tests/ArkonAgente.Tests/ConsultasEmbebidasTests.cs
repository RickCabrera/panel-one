using System.Text.RegularExpressions;
using ArkonAgente.Sql;

namespace ArkonAgente.Tests;

/// <summary>
/// Guardia de la regla de oro: ninguna consulta embebida escribe en la base de
/// SoftRestaurant. Se mira el SQL sin comentarios ni literales de texto (la query
/// de diagnóstico pregunta por el permiso 'INSERT' como texto, y eso no escribe).
/// </summary>
public partial class ConsultasEmbebidasTests
{
    [GeneratedRegex(
        @"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BACKUP|RESTORE|DBCC|sp_\w+|xp_\w+)\b",
        RegexOptions.IgnoreCase)]
    private static partial Regex PalabrasQueEscriben();

    /// <summary>Cada objeto después de FROM / JOIN, con alias opcional, y su hint si lo trae.</summary>
    [GeneratedRegex(
        @"\b(?:FROM|JOIN)\s+(?!\()(?<objeto>(?:\[[^\]]+\]|\w+)(?:\.(?:\[[^\]]+\]|\w+))*)(?:\s+(?:AS\s+)?(?!WITH\b|WHERE\b|JOIN\b|INNER\b|LEFT\b|RIGHT\b|FULL\b|CROSS\b|OUTER\b|ON\b|GROUP\b|ORDER\b|UNION\b)\w+)?(?<hint>\s+WITH\s*\(\s*NOLOCK\s*\))?",
        RegexOptions.IgnoreCase)]
    private static partial Regex ObjetoLeido();

    /// <summary>Formas de leer una tabla que la guardia de NOLOCK no sabe revisar: se prohíben.</summary>
    [GeneratedRegex(@"\bAPPLY\b|WITH\s*\(\s*NOLOCK\s*\)\s*,|\bFROM\s+[\w.\[\]]+(?:\s+(?:AS\s+)?\w+)?\s*,", RegexOptions.IgnoreCase)]
    private static partial Regex LecturaNoRevisable();

    [Fact]
    public void Existen_las_consultas_esperadas()
    {
        var nombres = ConsultasEmbebidas.Nombres();
        foreach (var esperada in new[] { "diagnostico", "sr_estructura", "sr_version" })
        {
            Assert.Contains(esperada, nombres);
            Assert.StartsWith("--", ConsultasEmbebidas.Leer(esperada));
        }
    }

    [Fact]
    public void Toda_tabla_o_vista_que_lee_una_consulta_embebida_lleva_NOLOCK()
    {
        foreach (var nombre in ConsultasEmbebidas.Nombres())
        {
            Assert.Empty(ProblemasDeNolock(ConsultasEmbebidas.Leer(nombre)).Select(p => $"{nombre}.sql: {p}"));
        }
    }

    [Theory]
    [InlineData("SELECT a FROM dbo.cheques")]
    [InlineData("SELECT a FROM dbo.cheques AS c WHERE c.a = 1")]
    [InlineData("SELECT a FROM dbo.cheques c WITH (NOLOCK) JOIN dbo.cheqdet d ON d.f = c.f")]
    [InlineData("SELECT a FROM [dbo].[cheques]")]
    [InlineData("SELECT a FROM dbo.cheques c WITH (NOLOCK), dbo.cheqdet d WITH (NOLOCK)")]
    [InlineData("SELECT a FROM dbo.cheques c, dbo.cheqdet d")]
    [InlineData("SELECT a FROM dbo.cheques c WITH (NOLOCK) CROSS APPLY dbo.fn(c.a) x")]
    [InlineData("SELECT (SELECT 1 FROM dbo.x) AS y FROM dbo.z WITH (NOLOCK)")]
    public void La_guardia_de_NOLOCK_detecta_lecturas_sin_hint(string sql)
    {
        Assert.NotEmpty(ProblemasDeNolock(sql));
    }

    [Theory]
    [InlineData("SELECT SERVERPROPERTY('Edition'), DB_NAME()")] // como diagnostico.sql: sin FROM
    [InlineData("SELECT a FROM dbo.cheques WITH (NOLOCK)")]
    [InlineData("SELECT a FROM dbo.cheques AS c WITH (NOLOCK) JOIN dbo.cheqdet AS d WITH(NOLOCK) ON d.f = c.f")]
    [InlineData("SELECT a FROM [dbo].[cheques] c with ( nolock ) WHERE c.a = 1")]
    [InlineData("SELECT a FROM (SELECT b FROM dbo.x WITH (NOLOCK)) AS t")]
    [InlineData("-- FROM dbo.x sin hint en un comentario\nSELECT 1")]
    [InlineData("SELECT 'FROM dbo.x, y' AS texto")]
    public void La_guardia_de_NOLOCK_acepta_lecturas_con_hint(string sql)
    {
        Assert.Empty(ProblemasDeNolock(sql));
    }

    [Fact]
    public void Ninguna_consulta_embebida_escribe()
    {
        var nombres = ConsultasEmbebidas.Nombres();
        Assert.NotEmpty(nombres);

        foreach (var nombre in nombres)
        {
            var codigo = SinComentariosNiTextos(ConsultasEmbebidas.Leer(nombre));
            var encontrada = PalabrasQueEscriben().Match(codigo);
            Assert.False(encontrada.Success, $"{nombre}.sql contiene '{encontrada.Value}' fuera de comentarios y textos.");
        }
    }

    [Theory]
    [InlineData("SELECT 1; INSERT dbo.cheques VALUES (1)")]
    [InlineData("SELECT * INTO #t FROM cheques")]
    [InlineData("select 1\nexec dbo.algo")]
    [InlineData("SELECT 'x' /* comentario */ ; update t set a = 1")]
    [InlineData("SELECT 'it''s' ; DELETE FROM t")]
    public void La_guardia_detecta_escrituras(string sql)
    {
        Assert.Matches(PalabrasQueEscriben(), SinComentariosNiTextos(sql));
    }

    [Theory]
    [InlineData("SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT')")]
    [InlineData("-- INSERT en comentario\nSELECT 1")]
    [InlineData("/* DELETE\n varias lineas */ SELECT 1")]
    [InlineData("SELECT updated_at, deleted FROM t WITH (NOLOCK)")]
    public void La_guardia_no_se_confunde_con_textos_ni_comentarios(string sql)
    {
        Assert.DoesNotMatch(PalabrasQueEscriben(), SinComentariosNiTextos(sql));
    }

    private static List<string> ProblemasDeNolock(string sql)
    {
        var codigo = SinComentariosNiTextos(sql);
        var problemas = ObjetoLeido().Matches(codigo)
            .Where(m => !m.Groups["hint"].Success)
            .Select(m => $"'{m.Groups["objeto"].Value}' sin WITH (NOLOCK)")
            .ToList();
        problemas.AddRange(LecturaNoRevisable().Matches(codigo).Select(m => $"'{m.Value.Trim()}' (join con coma o APPLY)"));
        return problemas;
    }

    private static string SinComentariosNiTextos(string sql)
    {
        var sinBloques = Regex.Replace(sql, @"/\*.*?\*/", " ", RegexOptions.Singleline);
        var sinLineas = Regex.Replace(sinBloques, @"--[^\n]*", " ");
        return Regex.Replace(sinLineas, @"N?'(?:[^']|'')*'", "''");
    }
}
