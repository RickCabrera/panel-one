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

    [Fact]
    public void Existen_las_consultas_esperadas()
    {
        Assert.Contains("diagnostico", ConsultasEmbebidas.Nombres());
        Assert.StartsWith("--", ConsultasEmbebidas.Leer("diagnostico"));
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

    private static string SinComentariosNiTextos(string sql)
    {
        var sinBloques = Regex.Replace(sql, @"/\*.*?\*/", " ", RegexOptions.Singleline);
        var sinLineas = Regex.Replace(sinBloques, @"--[^\n]*", " ");
        return Regex.Replace(sinLineas, @"N?'(?:[^']|'')*'", "''");
    }
}
