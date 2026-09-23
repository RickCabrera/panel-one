using Microsoft.Data.SqlClient;

namespace ArkonAgente.Sql;

/// <summary>
/// Cadena de conexión efectiva hacia el SQL Server de SoftRestaurant, a partir de
/// la que puso el técnico en <c>config.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// Lo que se fuerza y por qué:
/// <list type="bullet">
/// <item><c>Application Name=ArkonAgente</c>: que el encargado del POS nos vea con
/// nombre en <c>sp_who2</c> / el Monitor de actividad si algo se pone lento.</item>
/// <item><c>ApplicationIntent=ReadOnly</c>: es sólo una pista para un grupo de
/// disponibilidad; en un SQL Express suelto no hace nada. <b>No es un control de
/// seguridad</b>: el que impide escribir es el usuario de solo lectura.</item>
/// <item><c>Connect Timeout</c> corto (5 s por defecto, 15 s de tope): el agente
/// no se queda colgado esperando a un servidor apagado.</item>
/// <item><c>Enlist=false</c> (F2-241): la conexión nunca se une a una transacción ambiental
/// (<c>TransactionScope</c>). El agente no abre transacciones contra el POS; un test lo
/// vigila en el IL del ensamblado (<c>SoloLecturaTests</c>).</item>
/// </list>
/// Lo que NO se toca: <c>Encrypt</c> / <c>TrustServerCertificate</c> ni las
/// credenciales. Ver docs/esquema-sr.md §11 (supuestos de conexión).
/// </para>
/// </remarks>
internal sealed class ConexionSoftRestaurant
{
    public const string NombreAplicacion = "ArkonAgente";
    public const int TimeoutConexionPorDefecto = 5;
    public const int TimeoutConexionMaximo = 15;

    /// <summary>Timeout de cada comando contra SR. SUPUESTO no validado (§11).</summary>
    public const int TimeoutComandoSegundos = 5;

    private readonly SqlConnectionStringBuilder _constructor;

    public ConexionSoftRestaurant(string cadenaDeConfig)
    {
        _constructor = new SqlConnectionStringBuilder(cadenaDeConfig)
        {
            ApplicationName = NombreAplicacion,
            ApplicationIntent = ApplicationIntent.ReadOnly,
            Enlist = false,
        };

        _constructor.ConnectTimeout = TieneTimeoutExplicito(cadenaDeConfig)
            ? Math.Clamp(_constructor.ConnectTimeout, 1, TimeoutConexionMaximo)
            : TimeoutConexionPorDefecto;
    }

    public string CadenaEfectiva => _constructor.ConnectionString;

    public int TimeoutConexion => _constructor.ConnectTimeout;

    /// <summary>
    /// Autenticación de Windows: el login es la cuenta que corre el proceso
    /// (la cuenta del servicio —NT SERVICE\ArkonAgente o LocalSystem, ver instalar.ps1—,
    /// el administrador en <c>agente test</c>).
    /// </summary>
    public bool UsaAutenticacionWindows => _constructor.IntegratedSecurity;

    /// <summary>Para logs y consola: servidor, base y usuario. Nunca el password.</summary>
    public string Resumen()
    {
        var usuario = UsaAutenticacionWindows
            ? "autenticación de Windows"
            : string.IsNullOrEmpty(_constructor.UserID) ? "(sin usuario)" : _constructor.UserID;
        return $"servidor={_constructor.DataSource}, base={_constructor.InitialCatalog}, usuario={usuario}";
    }

    /// <summary>Base de SoftRestaurant de la cadena (<c>Database</c>), para los mensajes.</summary>
    public string BaseDatos => _constructor.InitialCatalog;

    public SqlConnection CrearConexion() => new(CadenaEfectiva);

    /// <summary>
    /// Comando con una consulta embebida (<c>Sql/Consultas/&lt;nombre&gt;.sql</c>) y el
    /// timeout corto de <see cref="TimeoutComandoSegundos"/>. Toda query contra SR se
    /// arma aquí: así ninguna se queda con el default de 30 s de SqlClient.
    /// </summary>
    public static SqlCommand CrearComando(SqlConnection conexion, string consulta)
    {
        var comando = conexion.CreateCommand();
        comando.CommandText = ConsultasEmbebidas.Leer(consulta);
        comando.CommandType = System.Data.CommandType.Text;
        comando.CommandTimeout = TimeoutComandoSegundos;
        return comando;
    }

    private static bool TieneTimeoutExplicito(string cadena)
    {
        // "Connect Timeout", "Connection Timeout" y "Timeout" son sinónimos para
        // SqlClient; "Command Timeout" no lo es. Se decide por clave, no por texto.
        var original = new System.Data.Common.DbConnectionStringBuilder { ConnectionString = cadena };
        return original.Keys.Cast<string>().Any(k =>
            k.Equals("connect timeout", StringComparison.OrdinalIgnoreCase)
            || k.Equals("connection timeout", StringComparison.OrdinalIgnoreCase)
            || k.Equals("timeout", StringComparison.OrdinalIgnoreCase));
    }
}
