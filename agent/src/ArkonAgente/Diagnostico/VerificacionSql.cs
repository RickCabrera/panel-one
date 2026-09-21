using System.Data;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Diagnostico;

/// <summary>
/// Comprueba la conexión al SQL Server de SoftRestaurant y que el usuario sea de
/// solo lectura. Ejecuta únicamente <c>Sql/Consultas/diagnostico.sql</c>, que lee
/// funciones de sistema y no toca ninguna tabla del POS.
/// </summary>
internal sealed class VerificacionSql : IVerificacion
{
    private readonly ConexionSoftRestaurant _conexion;

    public VerificacionSql(ConexionSoftRestaurant conexion)
    {
        _conexion = conexion;
    }

    public string Nombre => "SQL Server (SoftRestaurant)";

    public async Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion)
    {
        var avisos = new List<string>();
        if (_conexion.UsaAutenticacionWindows)
        {
            avisos.Add(AvisoAutenticacionWindows);
        }

        FilaDiagnostico fila;
        try
        {
            await using var conexion = _conexion.CrearConexion();
            await conexion.OpenAsync(cancelacion);

            await using var comando = conexion.CreateCommand();
            comando.CommandText = ConsultasEmbebidas.Leer("diagnostico");
            comando.CommandType = CommandType.Text;
            comando.CommandTimeout = ConexionSoftRestaurant.TimeoutComandoSegundos;

            await using var lector = await comando.ExecuteReaderAsync(CommandBehavior.SingleRow, cancelacion);
            if (!await lector.ReadAsync(cancelacion))
            {
                return ResultadoVerificacion.Falla(Nombre, "La consulta de diagnóstico no devolvió filas.", avisos: avisos);
            }

            fila = FilaDiagnostico.Leer(lector);
        }
        catch (SqlException ex)
        {
            var (detalle, sugerencia) = ClasificarError(ex, _conexion);
            return ResultadoVerificacion.Falla(Nombre, detalle, sugerencia, avisos);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Pool agotado, autenticación integrada no disponible en la plataforma, etc.
            // Sólo el tipo: el mensaje podría citar la cadena de conexión.
            return ResultadoVerificacion.Falla(Nombre, $"No se pudo abrir la conexión ({ex.GetType().Name}).", avisos: avisos);
        }

        return Evaluar(fila, _conexion, avisos);
    }

    internal const string AvisoAutenticacionWindows =
        "La cadena usa autenticación de Windows: el servicio entra a SQL Server como su propia cuenta " +
        "(LocalSystem = NT AUTHORITY\\SYSTEM) y 'agente test' como la tuya, así que este diagnóstico puede no " +
        "reflejar lo que verá el servicio. Usa un usuario SQL de solo lectura (User ID / Password).";

    /// <summary>
    /// Conectó: decide con los permisos. Un usuario que PUEDE escribir en la base de
    /// SoftRestaurant es FALLA, aunque la conexión funcione. El agente nunca escribe,
    /// pero la regla la tiene que sostener el permiso, no la buena voluntad del código.
    /// </summary>
    internal static ResultadoVerificacion Evaluar(FilaDiagnostico fila, ConexionSoftRestaurant conexion, IReadOnlyList<string> avisos)
    {
        var nombre = "SQL Server (SoftRestaurant)";
        var detalle =
            $"Conectó a {conexion.Resumen()} como '{fila.Login}' " +
            $"(SQL Server {fila.VersionProducto}, {fila.Edicion}).";

        var permisos = fila.PermisosDeEscritura();
        if (permisos.Count > 0)
        {
            return ResultadoVerificacion.Falla(
                nombre,
                $"{detalle} Pero el usuario tiene permisos de escritura: {string.Join(", ", permisos)}.",
                "El agente sólo puede usar un usuario de SOLO LECTURA (rol db_datareader y nada más) sobre la base " +
                "de SoftRestaurant. Crea uno así y pon ese en 'connectionString'.",
                avisos);
        }

        // No se revisan permisos por objeto (un GRANT sobre una tabla concreta): el texto
        // dice exactamente lo que se comprobó, no más.
        return ResultadoVerificacion.Bien(
            nombre, $"{detalle} Sin permisos de escritura a nivel servidor, base ni esquema dbo.", avisos);
    }

    internal static (string Detalle, string? Sugerencia) ClasificarError(SqlException ex, ConexionSoftRestaurant conexion)
    {
        var destino = conexion.Resumen();
        var mensaje = ex.Message;

        if (mensaje.Contains("certificate", StringComparison.OrdinalIgnoreCase)
            || mensaje.Contains("certificado", StringComparison.OrdinalIgnoreCase))
        {
            return (
                $"El servidor respondió, pero su certificado TLS no es de confianza ({destino}).",
                "Es lo normal en un SQL Server Express local con certificado autofirmado: agrega " +
                "'TrustServerCertificate=True' a 'connectionString'.");
        }

        if (mensaje.Contains("SSL", StringComparison.Ordinal) || mensaje.Contains("TLS", StringComparison.Ordinal))
        {
            return (
                $"Falló el cifrado de la conexión con el servidor ({destino}).",
                "Un SQL Server viejo sin parches puede no hablar TLS 1.2. Actualízalo, o prueba 'Encrypt=False' " +
                "si la base está en esta misma PC.");
        }

        return ex.Number switch
        {
            18456 => (
                $"El servidor rechazó el usuario o la contraseña ({destino}).",
                "Revisa 'User ID' y 'Password' en 'connectionString', y que el servidor acepte autenticación SQL (modo mixto)."),
            4060 or 916 => (
                $"Conectó al servidor, pero no pudo abrir la base ({destino}).",
                "Revisa que 'Database' sea la base de SoftRestaurant y que el usuario tenga acceso a ella."),
            -2 => (
                $"El servidor no respondió a tiempo ({destino}).",
                "Revisa que el servicio de SQL Server esté encendido."),
            _ => (
                $"No se pudo llegar al servidor SQL ({destino}; error {ex.Number}).",
                "Revisa el nombre del servidor e instancia (p. ej. .\\SQLEXPRESS o 127.0.0.1\\NATIONALSOFT), " +
                "que el servicio de SQL Server esté encendido y, si es por red, que TCP/IP esté habilitado y el firewall lo permita."),
        };
    }
}

/// <summary>La única fila de <c>diagnostico.sql</c>. NULL en un permiso cuenta como "no".</summary>
internal sealed record FilaDiagnostico(
    string VersionProducto,
    string Edicion,
    string BaseDatos,
    string Login,
    bool EsSysadmin,
    bool EsDbOwner,
    bool EsDbDatawriter,
    bool EsDbDdladmin,
    bool PuedeInsert,
    bool PuedeUpdate,
    bool PuedeDelete,
    bool PuedeAlter,
    bool PuedeCreateTable,
    bool DboPuedeInsert,
    bool DboPuedeUpdate,
    bool DboPuedeDelete,
    bool DboPuedeAlter)
{
    public IReadOnlyList<string> PermisosDeEscritura()
    {
        var lista = new List<string>();
        if (EsSysadmin) lista.Add("sysadmin");
        if (EsDbOwner) lista.Add("db_owner");
        if (EsDbDatawriter) lista.Add("db_datawriter");
        if (EsDbDdladmin) lista.Add("db_ddladmin");
        if (PuedeInsert) lista.Add("INSERT");
        if (PuedeUpdate) lista.Add("UPDATE");
        if (PuedeDelete) lista.Add("DELETE");
        if (PuedeAlter) lista.Add("ALTER");
        if (PuedeCreateTable) lista.Add("CREATE TABLE");
        if (DboPuedeInsert) lista.Add("INSERT en el esquema dbo");
        if (DboPuedeUpdate) lista.Add("UPDATE en el esquema dbo");
        if (DboPuedeDelete) lista.Add("DELETE en el esquema dbo");
        if (DboPuedeAlter) lista.Add("ALTER en el esquema dbo");
        return lista;
    }

    public static FilaDiagnostico Leer(IDataRecord r) => new(
        Texto(r, "version_producto"),
        Texto(r, "edicion"),
        Texto(r, "base_datos"),
        Texto(r, "login_sql"),
        Bandera(r, "es_sysadmin"),
        Bandera(r, "es_db_owner"),
        Bandera(r, "es_db_datawriter"),
        Bandera(r, "es_db_ddladmin"),
        Bandera(r, "puede_insert"),
        Bandera(r, "puede_update"),
        Bandera(r, "puede_delete"),
        Bandera(r, "puede_alter"),
        Bandera(r, "puede_create_table"),
        Bandera(r, "dbo_puede_insert"),
        Bandera(r, "dbo_puede_update"),
        Bandera(r, "dbo_puede_delete"),
        Bandera(r, "dbo_puede_alter"));

    private static string Texto(IDataRecord r, string columna)
    {
        var i = r.GetOrdinal(columna);
        return r.IsDBNull(i) ? "?" : r.GetString(i);
    }

    private static bool Bandera(IDataRecord r, string columna)
    {
        var i = r.GetOrdinal(columna);
        return !r.IsDBNull(i) && Convert.ToInt32(r.GetValue(i)) == 1;
    }
}
