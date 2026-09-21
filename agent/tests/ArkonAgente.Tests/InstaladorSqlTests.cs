using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace ArkonAgente.Tests;

/// <summary>
/// Guardia de la regla de oro convertida en permisos (F1-026): el script que crea el
/// usuario del agente en el SQL Server del POS sólo puede otorgar <c>db_datareader</c>.
/// Se parsea con el parser de SQL Server 2008 (lo más viejo que puede traer un SR) y se
/// recorre el árbol: sólo se admiten las sentencias que el script necesita, y el único
/// procedimiento que puede llamar es <c>sp_addrolemember 'db_datareader'</c>.
/// </summary>
/// <remarks>
/// Este test NO prueba que el script corra bien contra un SQL Server: nunca se ha
/// ejecutado (crear un login es escribir en el servidor del POS). Eso es F1-020b.
/// </remarks>
public class InstaladorSqlTests
{
    private const string PasswordFalsa = "Prueba-12345abc";

    /// <summary>Todo lo que el script puede hacer. Cualquier otra sentencia es un hallazgo.</summary>
    private static readonly HashSet<Type> SentenciasPermitidas =
    [
        typeof(UseStatement),
        typeof(PredicateSetStatement), // SET NOCOUNT ON
        typeof(DeclareVariableStatement),
        typeof(SetVariableStatement),
        typeof(IfStatement),
        typeof(BeginEndBlockStatement),
        typeof(RaiseErrorStatement),
        typeof(ReturnStatement),
        typeof(PrintStatement),
        typeof(CreateLoginStatement),
        typeof(AlterLoginOptionsStatement), // sólo WITH PASSWORD (se revisa abajo)
        typeof(CreateUserStatement),
        typeof(ExecuteStatement), // sólo sp_addrolemember 'db_datareader' (se revisa abajo)
    ];

    [Fact]
    public void El_script_del_instalador_existe_y_usa_las_variables_de_sqlcmd()
    {
        var sql = Instalador.LeerTexto("crear-usuario-lector.sql");

        Assert.Contains("$(BASE_SR)", sql);
        Assert.Contains("$(PASSWORD_LECTOR)", sql);
        Assert.Contains(":on error exit", sql);
        // Ninguna contraseña escrita en el archivo: sólo la variable.
        Assert.DoesNotMatch(@"PASSWORD\s*=\s*N?'(?!\$\(PASSWORD_LECTOR\)')", sql);
    }

    [Fact]
    public void El_script_del_instalador_solo_otorga_db_datareader()
    {
        var problemas = Validar(Instalador.LeerTexto("crear-usuario-lector.sql"));

        Assert.Empty(problemas);
    }

    [Fact]
    public void El_script_del_instalador_agrega_al_lector_a_db_datareader()
    {
        // Que la guardia no pase por vacía: el script SÍ tiene que dar lectura.
        var llamadas = Llamadas(Parsear(Preparar(Instalador.LeerTexto("crear-usuario-lector.sql"))).Arbol!);

        Assert.Contains(("sp_addrolemember", "db_datareader", "monitor_lector"), llamadas);
    }

    // La guardia se prueba a sí misma: cada mutación sobre el script real tiene que
    // dejar al menos un hallazgo.
    [Theory]
    [InlineData("N'db_datareader', N'monitor_lector'", "N'db_owner', N'monitor_lector'")]
    [InlineData("N'db_datareader', N'monitor_lector'", "N'db_datawriter', N'monitor_lector'")]
    [InlineData("N'db_datareader', N'monitor_lector'", "N'db_datareader', N'otro_usuario'")]
    [InlineData("EXEC sp_addrolemember", "EXEC sp_addsrvrolemember")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "EXEC (N'EXEC sp_addrolemember ''db_owner'', ''monitor_lector''');")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "EXEC sp_executesql N'EXEC sp_addrolemember ''db_owner'', ''monitor_lector''';")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "DECLARE @s nvarchar(200); SET @s = N'x'; EXEC (@s);")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "GRANT INSERT ON SCHEMA::dbo TO [monitor_lector];")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "GRANT SELECT ON SCHEMA::dbo TO [monitor_lector];")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "ALTER ROLE db_owner ADD MEMBER [monitor_lector];")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "EXEC sp_addrolemember N'db_datareader', N'monitor_lector'; INSERT INTO dbo.cheques (folio) VALUES (1);")]
    [InlineData("EXEC sp_addrolemember N'db_datareader', N'monitor_lector';",
        "EXEC sp_addrolemember N'db_datareader', N'monitor_lector'; CREATE TABLE dbo.cursor_agente (id int);")]
    [InlineData("ALTER LOGIN [monitor_lector] WITH PASSWORD = N'$(PASSWORD_LECTOR)';",
        "ALTER LOGIN [monitor_lector] WITH DEFAULT_DATABASE = [softrestaurant10];")]
    [InlineData("CREATE USER [monitor_lector] FOR LOGIN [monitor_lector];",
        "CREATE USER [monitor_lector] FOR LOGIN [monitor_lector]; EXEC sp_addrolemember N'db_owner', N'monitor_lector';")]
    public void La_guardia_detecta_un_script_que_otorga_de_mas(string original, string mutado)
    {
        var sql = Instalador.LeerTexto("crear-usuario-lector.sql");
        Assert.Contains(original, sql);

        var problemas = Validar(sql.Replace(original, mutado, StringComparison.Ordinal));

        Assert.NotEmpty(problemas);
    }

    // --- La guardia -------------------------------------------------------------------

    private static List<string> Validar(string sqlConVariables)
    {
        var (arbol, errores) = Parsear(Preparar(sqlConVariables));
        var problemas = errores.Select(e => $"no parsea como T-SQL de SQL Server 2008 (línea {e.Line}): {e.Message}").ToList();
        if (arbol is null)
        {
            return problemas;
        }

        var visitante = new VisitanteSentencias();
        arbol.Accept(visitante);

        foreach (var sentencia in visitante.Sentencias)
        {
            if (!SentenciasPermitidas.Contains(sentencia.GetType()))
            {
                problemas.Add($"sentencia no permitida: {sentencia.GetType().Name}");
            }
        }

        foreach (var alter in visitante.Sentencias.OfType<AlterLoginOptionsStatement>())
        {
            if (alter.Options.Any(o => o is not PasswordAlterPrincipalOption))
            {
                problemas.Add("ALTER LOGIN sólo puede reponer la contraseña");
            }
        }

        foreach (var exec in visitante.Sentencias.OfType<ExecuteStatement>())
        {
            if (exec.ExecuteSpecification.ExecutableEntity is not ExecutableProcedureReference)
            {
                problemas.Add("SQL dinámico (EXEC de un texto o de una variable)");
            }
        }

        foreach (var llamada in Llamadas(arbol))
        {
            if (llamada != ("sp_addrolemember", "db_datareader", "monitor_lector"))
            {
                problemas.Add($"llamada no permitida: {llamada}");
            }
        }

        return problemas;
    }

    /// <summary>Cada EXEC de procedimiento: (nombre, primer parámetro, segundo parámetro) en minúsculas.</summary>
    private static List<(string, string?, string?)> Llamadas(TSqlFragment arbol)
    {
        var visitante = new VisitanteSentencias();
        arbol.Accept(visitante);
        var llamadas = new List<(string, string?, string?)>();
        foreach (var exec in visitante.Sentencias.OfType<ExecuteStatement>())
        {
            if (exec.ExecuteSpecification.ExecutableEntity is not ExecutableProcedureReference proc)
            {
                continue;
            }

            var nombre = proc.ProcedureReference?.ProcedureReference?.Name?.BaseIdentifier?.Value ?? "(variable)";
            string? Parametro(int i) =>
                proc.Parameters.Count > i && proc.Parameters[i].ParameterValue is StringLiteral s
                    ? s.Value.ToLowerInvariant()
                    : null;
            llamadas.Add((nombre.ToLowerInvariant(), Parametro(0), Parametro(1)));
        }

        return llamadas;
    }

    /// <summary>Lo que hace sqlcmd antes de mandar el texto: quita sus comandos y sustituye variables.</summary>
    private static string Preparar(string sql)
    {
        var lineas = sql.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Split('\n')
            .Where(l => !l.TrimStart().StartsWith(':'));
        var texto = string.Join("\n", lineas)
            .Replace("$(BASE_SR)", "softrestaurant10", StringComparison.Ordinal)
            .Replace("$(PASSWORD_LECTOR)", PasswordFalsa, StringComparison.Ordinal);
        Assert.DoesNotContain("$(", texto);
        return texto;
    }

    private static (TSqlFragment? Arbol, IList<ParseError> Errores) Parsear(string sql)
    {
        var parser = new TSql100Parser(initialQuotedIdentifiers: true);
        using var lector = new StringReader(sql);
        var arbol = parser.Parse(lector, out var errores);
        return (errores.Count == 0 ? arbol : null, errores);
    }

    private sealed class VisitanteSentencias : TSqlFragmentVisitor
    {
        public List<TSqlStatement> Sentencias { get; } = [];

        public override void Visit(TSqlStatement node) => Sentencias.Add(node);
    }
}
