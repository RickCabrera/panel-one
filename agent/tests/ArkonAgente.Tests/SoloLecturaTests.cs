using System.Reflection;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Tests;

/// <summary>
/// F2-241, "Listo cuando": el agente nunca abre una transacción de escritura contra el POS. Se
/// afirma en tres capas: el MODO de la conexión (intención de lectura y sin unirse a una
/// transacción ambiental), el comando que arma <see cref="ConexionSoftRestaurant.CrearComando"/>
/// (sin transacción y con el timeout corto) y el IL del ensamblado del agente (nadie llama
/// <c>BeginTransaction</c> ni crea un <c>TransactionScope</c> fuera de SQLite, y nadie arma un
/// comando de SQL Server fuera de <c>CrearComando</c>).
/// </summary>
public class SoloLecturaTests
{
    private static readonly Assembly Agente = typeof(ConexionSoftRestaurant).Assembly;

    [Theory]
    [InlineData("Server=.\\NATIONALSOFT;Database=softrestaurant10;Integrated Security=true")]
    [InlineData("Server=x;Database=y;User ID=u;Password=p;Enlist=true;ApplicationIntent=ReadWrite")]
    public void La_conexion_es_de_intencion_de_lectura_y_nunca_se_une_a_una_transaccion(string config)
    {
        var efectiva = new SqlConnectionStringBuilder(new ConexionSoftRestaurant(config).CadenaEfectiva);

        Assert.Equal(ApplicationIntent.ReadOnly, efectiva.ApplicationIntent);
        Assert.False(efectiva.Enlist); // aunque el técnico ponga Enlist=true
        using var conexion = new ConexionSoftRestaurant(config).CrearConexion();
        Assert.Contains("Enlist=False", conexion.ConnectionString, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Todo_comando_contra_SR_sale_sin_transaccion_y_con_el_timeout_corto()
    {
        using var conexion = new ConexionSoftRestaurant("Server=x;Database=y;Integrated Security=true").CrearConexion();
        var consultas = ConsultasEmbebidas.Nombres();
        Assert.Contains("sr_existencias", consultas);
        Assert.Contains("sr_catalogo_insumos", consultas);

        foreach (var nombre in consultas)
        {
            using var comando = ConexionSoftRestaurant.CrearComando(conexion, nombre);
            Assert.Null(comando.Transaction);
            Assert.Equal(ConexionSoftRestaurant.TimeoutComandoSegundos, comando.CommandTimeout);
            Assert.Equal(System.Data.CommandType.Text, comando.CommandType);
        }

        Assert.InRange(ConexionSoftRestaurant.TimeoutComandoSegundos, 1, 10);
    }

    [Fact]
    public void Nadie_abre_una_transaccion_fuera_del_SQLite_propio()
    {
        var llamadas = LlamadasDelAgente().ToList();
        bool EsTransaccion((MethodBase Llamado, string Desde) l) =>
            l.Llamado.Name.StartsWith("BeginTransaction", StringComparison.Ordinal)
            || l.Llamado.Name.StartsWith("EnlistTransaction", StringComparison.Ordinal)
            || l.Llamado.DeclaringType?.FullName == "System.Transactions.TransactionScope";

        var transacciones = llamadas.Where(EsTransaccion).ToList();

        // El escáner sí ve las transacciones (las del SQLite de la cola): si no viera ninguna, este
        // test pasaría en falso.
        Assert.Contains(transacciones, l => l.Llamado.DeclaringType?.Namespace == "Microsoft.Data.Sqlite");
        Assert.Empty(transacciones
            .Where(l => l.Llamado.DeclaringType?.Namespace != "Microsoft.Data.Sqlite")
            .Select(l => $"{l.Desde} llama {l.Llamado.DeclaringType?.FullName}.{l.Llamado.Name}"));
    }

    [Fact]
    public void Nadie_arma_un_comando_de_SQL_Server_fuera_de_CrearComando()
    {
        var llamadas = LlamadasDelAgente().ToList();
        var comandos = llamadas.Where(l =>
                (l.Llamado.DeclaringType == typeof(SqlConnection) && l.Llamado.Name == "CreateCommand")
                || l.Llamado.DeclaringType == typeof(SqlCommand) && l.Llamado.IsConstructor
                || (l.Llamado.DeclaringType?.FullName == "System.Data.Common.DbConnection" && l.Llamado.Name == "CreateCommand"))
            .ToList();

        Assert.Contains(comandos, l => l.Desde == "ConexionSoftRestaurant.CrearComando");
        Assert.All(comandos, l => Assert.Equal("ConexionSoftRestaurant.CrearComando", l.Desde));
    }

    /// <summary>
    /// Cada <c>call</c>/<c>callvirt</c>/<c>newobj</c> del IL de TODOS los métodos del agente (tipos
    /// anidados y máquinas de estado de <c>async</c> incluidos), con el método que la hace. El
    /// "desde" de una máquina de estado es su método <c>async</c> (el nombre entre <c>&lt;&gt;</c>).
    /// </summary>
    private static IEnumerable<(MethodBase Llamado, string Desde)> LlamadasDelAgente()
    {
        const BindingFlags todo = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
                                  BindingFlags.Static | BindingFlags.DeclaredOnly;
        foreach (var tipo in Agente.GetTypes())
        {
            var metodos = tipo.GetMethods(todo).Cast<MethodBase>().Concat(tipo.GetConstructors(todo));
            foreach (var metodo in metodos)
            {
                var il = metodo.GetMethodBody()?.GetILAsByteArray();
                if (il is null)
                {
                    continue;
                }

                for (var i = 0; i + 4 < il.Length; i++)
                {
                    if (il[i] is not (0x28 or 0x6F or 0x73)) // call, callvirt, newobj
                    {
                        continue;
                    }

                    var token = BitConverter.ToInt32(il, i + 1);
                    if ((token >> 24) is not (0x06 or 0x0A or 0x2B))
                    {
                        continue;
                    }

                    MethodBase? llamado;
                    try
                    {
                        llamado = tipo.Module.ResolveMethod(
                            token,
                            tipo.IsGenericType ? tipo.GetGenericArguments() : null,
                            metodo.IsGenericMethod ? metodo.GetGenericArguments() : null);
                    }
                    catch (Exception ex) when (ex is ArgumentException or BadImageFormatException)
                    {
                        continue; // bytes que no eran un opcode: el escaneo es por bytes
                    }

                    if (llamado is not null)
                    {
                        yield return (llamado, Desde(tipo, metodo));
                    }
                }
            }
        }
    }

    private static string Desde(Type tipo, MethodBase metodo)
    {
        // Máquina de estado: <CrearComando>d__3 anidada en ConexionSoftRestaurant.
        if (tipo.DeclaringType is { } externo && tipo.Name.StartsWith('<'))
        {
            return $"{externo.Name}.{tipo.Name[1..tipo.Name.IndexOf('>')]}";
        }

        return $"{tipo.Name}.{metodo.Name}";
    }
}
