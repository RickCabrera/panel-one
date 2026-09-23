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
        foreach (var esperada in new[]
                 {
                     "diagnostico", "sr_estructura", "sr_version", "sr_sondeo", "sr_catalogo_grupos", "sr_catalogo_productos",
                     "sr_catalogo_meseros", "sr_catalogo_areas", "sr_catalogo_canales", "sr_catalogo_clientes",
                     "sr_catalogo_unidades", "sr_catalogo_grupos_insumo", "sr_catalogo_insumos", "sr_catalogo_almacenes",
                     "sr_catalogo_proveedores", "sr_existencias",
                 })
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

    /// <summary>Cada <c>dbo.tabla</c> que aparece después de FROM / JOIN.</summary>
    [GeneratedRegex(@"\b(?:FROM|JOIN)\s+dbo\.(?<tabla>\w+)", RegexOptions.IgnoreCase)]
    private static partial Regex TablaDbo();

    [Fact]
    public void Toda_tabla_que_lee_una_consulta_sr_esta_en_la_sonda_de_permisos_por_tabla_del_diagnostico()
    {
        // F2-240: si una consulta nueva lee una tabla que la sonda no revisa, un GRANT de escritura
        // sobre ella pasaría sin que 'agente test' falle.
        var diagnostico = ConsultasEmbebidas.Leer("diagnostico");
        var nombres = Regex.Matches(diagnostico, @"N'dbo\.(\w+)'").Select(m => m.Groups[1].Value.ToLowerInvariant()).ToList();
        // La lista va dos veces (el conteo y el ejemplo): las dos tienen que ser la misma.
        Assert.All(nombres.GroupBy(n => n), g => Assert.True(g.Count() == 2, $"dbo.{g.Key} no está en las dos listas"));
        var revisadas = nombres.ToHashSet();
        var leidas = ConsultasEmbebidas.Nombres()
            .Where(n => n.StartsWith("sr_", StringComparison.Ordinal))
            .SelectMany(n => TablaDbo().Matches(SinComentariosNiTextos(ConsultasEmbebidas.Leer(n)))
                .Select(m => (Consulta: n, Tabla: m.Groups["tabla"].Value.ToLowerInvariant())))
            .ToList();

        Assert.Contains(leidas, l => l.Tabla == "productosdetalle");
        Assert.Contains(leidas, l => l.Tabla == "acumuladoinsumos"); // F2-241
        Assert.Empty(leidas.Where(l => !revisadas.Contains(l.Tabla)).Select(l => $"{l.Consulta}.sql lee dbo.{l.Tabla}"));
    }

    [Fact]
    public void Las_consultas_de_catalogo_no_leen_contrasenas_ni_fotos_ni_columnas_de_mas()
    {
        var meseros = SinComentariosNiTextos(ConsultasEmbebidas.Leer("sr_catalogo_meseros"));
        Assert.DoesNotContain("contrase", meseros, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("fotografia", meseros, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("*", meseros);
        var clientes = SinComentariosNiTextos(ConsultasEmbebidas.Leer("sr_catalogo_clientes"));
        foreach (var prohibida in new[] { "fotografia", "curp", "direccion", "limitedecredito", "notas", "*" })
        {
            Assert.DoesNotContain(prohibida, clientes, StringComparison.OrdinalIgnoreCase);
        }

        // F2-241: el proveedor sólo lleva id, nombre y estado; nada de RFC, contacto ni datos bancarios.
        var proveedores = SinComentariosNiTextos(ConsultasEmbebidas.Leer("sr_catalogo_proveedores"));
        foreach (var prohibida in new[] { "rfc", "razonsocial", "direccion", "telefono", "email", "nombrebanco", "nocuenta", "cuentaclave", "*" })
        {
            Assert.DoesNotContain(prohibida, proveedores, StringComparison.OrdinalIgnoreCase);
        }

        // El catálogo de insumos no lleva costo: el contrato lo rechaza (va con las existencias).
        var insumos = SinComentariosNiTextos(ConsultasEmbebidas.Leer("sr_catalogo_insumos"));
        Assert.DoesNotContain("costo", insumos, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("*", insumos);
    }

    [Fact]
    public void Las_consultas_embebidas_son_TSQL_valido_de_SQL_Server_2008_en_adelante()
    {
        // SR 10 trae SQL Server 2014; el parser de 2008 (TSql100) es el piso: nada de STRING_AGG ni similares.
        foreach (var nombre in ConsultasEmbebidas.Nombres())
        {
            var parser = new Microsoft.SqlServer.TransactSql.ScriptDom.TSql100Parser(initialQuotedIdentifiers: true);
            parser.Parse(new StringReader(ConsultasEmbebidas.Leer(nombre)), out var errores);
            Assert.Empty(errores.Select(e => $"{nombre}.sql línea {e.Line}: {e.Message}"));
        }
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
