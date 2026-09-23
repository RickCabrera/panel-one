using System.Globalization;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Una foto de existencias pendiente de mandar, tal como sale de la cola.</summary>
internal sealed record EnvioExistencias(string Almacen, string CapturadoAt, int Registros, string Payload);

/// <summary>
/// El carril de existencias de la cola local (F2-241): tablas propias en <c>cola.db</c>, para que
/// una foto atorada nunca frene cheques, heartbeat ni catálogos, ni al revés.
/// </summary>
/// <remarks>
/// <para>
/// A diferencia de eventos y catálogos, aquí no se guarda una fila por envío sino <b>UNA foto
/// pendiente por almacén</b>: una foto es estado, no historia, y una más nueva la reemplaza (la
/// vieja el API la ignoraría de todos modos con <c>aplicado=false</c>). Así el carril no crece
/// aunque el API esté caído días: a lo más una foto por almacén.
/// </para>
/// <para>
/// Es estado PROPIO del agente: vive aquí, nunca en la base de SoftRestaurant. Tablas:
/// <c>existencias_pendientes</c> y la marca de la última lectura en <c>agente_marcas</c> (la misma
/// tabla de <see cref="ColaCatalogos"/>; ambas la crean con <c>IF NOT EXISTS</c>).
/// </para>
/// </remarks>
internal sealed class ColaExistencias
{
    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS existencias_pendientes (
            almacen      TEXT    PRIMARY KEY,
            capturado_at TEXT    NOT NULL,
            registros    INTEGER NOT NULL,
            payload      TEXT    NOT NULL,
            creado_at    TEXT    NOT NULL,
            intentos     INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS agente_marcas (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
        """;

    private readonly string _cadena;
    private readonly TimeProvider _reloj;

    private ColaExistencias(string ruta, TimeProvider reloj)
    {
        _reloj = reloj;
        _cadena = new SqliteConnectionStringBuilder
        {
            DataSource = ruta,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = 10,
        }.ToString();
    }

    public static ColaExistencias Abrir(string ruta, TimeProvider reloj)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var cola = new ColaExistencias(ruta, reloj);
        using var conexion = cola.Conectar();
        Ejecutar(conexion, null, Esquema);
        return cola;
    }

    public int ContarPendientes() => (int)Escalar<long>("SELECT COUNT(*) FROM existencias_pendientes;");

    /// <summary>
    /// Guarda TODAS las fotos de una lectura en una transacción; cada una reemplaza a la pendiente
    /// de su almacén (con sus intentos en cero).
    /// </summary>
    public void Guardar(IEnumerable<EnvioExistencias> fotos)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var ahora = Ahora();
        foreach (var foto in fotos)
        {
            Ejecutar(
                conexion, tx,
                """
                INSERT INTO existencias_pendientes (almacen, capturado_at, registros, payload, creado_at, intentos)
                VALUES ($a, $c, $r, $p, $n, 0)
                ON CONFLICT (almacen) DO UPDATE SET capturado_at = excluded.capturado_at, registros = excluded.registros,
                    payload = excluded.payload, creado_at = excluded.creado_at, intentos = 0;
                """,
                ("$a", foto.Almacen), ("$c", foto.CapturadoAt), ("$r", foto.Registros), ("$p", foto.Payload), ("$n", ahora));
        }

        tx.Commit();
    }

    /// <summary>La pendiente más vieja (por cuándo se guardó, luego almacén), o null.</summary>
    public EnvioExistencias? TomarSiguiente()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText =
            "SELECT almacen, capturado_at, registros, payload FROM existencias_pendientes ORDER BY creado_at, almacen LIMIT 1;";
        using var lector = comando.ExecuteReader();
        return lector.Read()
            ? new EnvioExistencias(lector.GetString(0), lector.GetString(1), lector.GetInt32(2), lector.GetString(3))
            : null;
    }

    /// <summary>
    /// Saca la foto mandada (o descartada) de la cola, sólo si sigue siendo ESA foto: si mientras
    /// tanto llegó una más nueva de ese almacén, la nueva se queda.
    /// </summary>
    public void Quitar(EnvioExistencias envio)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null, "DELETE FROM existencias_pendientes WHERE almacen = $a AND capturado_at = $c;",
            ("$a", envio.Almacen), ("$c", envio.CapturadoAt));
    }

    public void SumarIntento(EnvioExistencias envio)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null,
            "UPDATE existencias_pendientes SET intentos = intentos + 1 WHERE almacen = $a AND capturado_at = $c;",
            ("$a", envio.Almacen), ("$c", envio.CapturadoAt));
    }

    public string? Marca(string clave) =>
        Escalar<string?>("SELECT valor FROM agente_marcas WHERE clave = $k;", ("$k", clave));

    public void GuardarMarca(string clave, string valor)
    {
        using var conexion = Conectar();
        Ejecutar(
            conexion, null,
            "INSERT INTO agente_marcas (clave, valor) VALUES ($k, $v) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor;",
            ("$k", clave), ("$v", valor));
    }

    private T Escalar<T>(string sentencia, params (string Nombre, object? Valor)[] parametros)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = sentencia;
        foreach (var (nombre, valor) in parametros)
        {
            comando.Parameters.AddWithValue(nombre, valor ?? DBNull.Value);
        }

        var resultado = comando.ExecuteScalar();
        return resultado is null or DBNull ? default! : (T)resultado;
    }

    private SqliteConnection Conectar()
    {
        var conexion = new SqliteConnection(_cadena);
        conexion.Open();
        Ejecutar(conexion, null, "PRAGMA synchronous = FULL;");
        return conexion;
    }

    private static int Ejecutar(
        SqliteConnection conexion, SqliteTransaction? tx, string sentencia, params (string Nombre, object? Valor)[] parametros)
    {
        using var comando = conexion.CreateCommand();
        comando.Transaction = tx;
        comando.CommandText = sentencia;
        foreach (var (nombre, valor) in parametros)
        {
            comando.Parameters.AddWithValue(nombre, valor ?? DBNull.Value);
        }

        return comando.ExecuteNonQuery();
    }

    private string Ahora() => ColaLocal.Formatear(_reloj.GetUtcNow());

    /// <summary>Para leer marcas guardadas con <see cref="ColaLocal.Formatear"/>.</summary>
    public static DateTimeOffset LeerFecha(string texto) =>
        DateTimeOffset.ParseExact(
            texto, ColaLocal.FormatoFecha, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
