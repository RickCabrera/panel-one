using System.Text.Json;
using ArkonAgente.Inventario;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Un lote pendiente de mandar, tal como sale de la cola.</summary>
/// <param name="Claves">Los documentos que lleva (para olvidar sus hashes si se descarta).</param>
internal sealed record LoteInventario(
    long Id, TipoDocumentoInventario Tipo, string Payload, IReadOnlyList<string> Claves, int Renglones);

/// <summary>Lo último que se encoló de un documento: su hash (null = hay que reenviarlo) y cuándo es.</summary>
/// <param name="FechaVentana">La fecha MÁS NUEVA del documento en hora de SR (null en recetas).</param>
internal sealed record EstadoDocumento(string? Hash, DateTime? FechaVentana, string JsonAusente, int RenglonesAusente);

/// <summary>Un cambio al estado de un documento, que se aplica junto con los lotes que lo mandan.</summary>
internal sealed record CambioEstado(string Clave, string Hash, DateTime? FechaVentana, string JsonAusente, int RenglonesAusente);

/// <summary>
/// El carril de movimientos, compras y recetas de la cola local (F2-241b): tablas propias en
/// <c>cola.db</c>, así un lote atorado no frena cheques, heartbeat, catálogos ni existencias.
/// </summary>
/// <remarks>
/// <para>
/// Es estado PROPIO del agente: vive aquí, nunca en la base de SoftRestaurant (ahí ni una tabla
/// auxiliar para el cursor). Tablas:
/// <list type="bullet">
/// <item><c>inventario_lotes</c>: los lotes por mandar, FIFO, al menos una vez.</item>
/// <item><c>inventario_documentos</c>: el hash de lo último encolado de cada documento, para mandar sólo
/// lo nuevo o cambiado, y su variante "ausente" para avisar al panel si SR deja de tenerlo.</item>
/// <item><c>agente_marcas</c> (compartida con catálogos y existencias): cursores y última lectura.</item>
/// </list>
/// </para>
/// <para>
/// <see cref="Aplicar"/> encola los lotes, cambia el estado y mueve las marcas en UNA transacción: un
/// corte de luz a la mitad no deja un cursor adelantado sin sus lotes, ni lotes sin su estado.
/// </para>
/// </remarks>
internal sealed class ColaInventario
{
    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS inventario_lotes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo      TEXT    NOT NULL,
            payload   TEXT    NOT NULL,
            claves    TEXT    NOT NULL,
            renglones INTEGER NOT NULL,
            creado_at TEXT    NOT NULL,
            intentos  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS inventario_documentos (
            tipo          TEXT NOT NULL,
            clave         TEXT NOT NULL,
            hash          TEXT NULL,
            fecha_ventana TEXT NULL,
            json_ausente  TEXT NOT NULL,
            renglones_ausente INTEGER NOT NULL,
            PRIMARY KEY (tipo, clave)
        );
        CREATE TABLE IF NOT EXISTS agente_marcas (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
        """;

    private readonly string _cadena;
    private readonly TimeProvider _reloj;

    private ColaInventario(string ruta, TimeProvider reloj)
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

    public static ColaInventario Abrir(string ruta, TimeProvider reloj)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var cola = new ColaInventario(ruta, reloj);
        using var conexion = cola.Conectar();
        Ejecutar(conexion, null, Esquema);
        return cola;
    }

    public int ContarPendientes() => (int)Escalar<long>("SELECT COUNT(*) FROM inventario_lotes;");

    /// <summary>El estado guardado de todos los documentos de un tipo.</summary>
    public Dictionary<string, EstadoDocumento> Estado(TipoDocumentoInventario tipo)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = "SELECT clave, hash, fecha_ventana, json_ausente, renglones_ausente FROM inventario_documentos WHERE tipo = $t;";
        comando.Parameters.AddWithValue("$t", tipo.Texto());
        using var lector = comando.ExecuteReader();
        var estado = new Dictionary<string, EstadoDocumento>(StringComparer.Ordinal);
        while (lector.Read())
        {
            estado[lector.GetString(0)] = new EstadoDocumento(
                lector.IsDBNull(1) ? null : lector.GetString(1),
                lector.IsDBNull(2) ? null : ApoyoMapeo.LeerFechaSr(lector.GetString(2)),
                lector.GetString(3),
                lector.GetInt32(4));
        }

        return estado;
    }

    /// <summary>
    /// En UNA transacción: encola <paramref name="lotes"/> (payload, claves, renglones), guarda
    /// <paramref name="cambios"/>, borra del estado <paramref name="purgar"/> y guarda <paramref name="marcas"/>.
    /// </summary>
    public void Aplicar(
        TipoDocumentoInventario tipo,
        IEnumerable<(string Payload, IReadOnlyList<string> Claves, int Renglones)> lotes,
        IEnumerable<CambioEstado> cambios,
        IEnumerable<string> purgar,
        IEnumerable<(string Clave, string Valor)> marcas)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var ahora = ColaLocal.Formatear(_reloj.GetUtcNow());
        foreach (var (payload, claves, renglones) in lotes)
        {
            Ejecutar(
                conexion, tx,
                "INSERT INTO inventario_lotes (tipo, payload, claves, renglones, creado_at) VALUES ($t, $p, $c, $r, $n);",
                ("$t", tipo.Texto()), ("$p", payload), ("$c", JsonSerializer.Serialize(claves)), ("$r", renglones), ("$n", ahora));
        }

        foreach (var c in cambios)
        {
            Ejecutar(
                conexion, tx,
                """
                INSERT INTO inventario_documentos (tipo, clave, hash, fecha_ventana, json_ausente, renglones_ausente)
                VALUES ($t, $c, $h, $f, $a, $r)
                ON CONFLICT (tipo, clave) DO UPDATE SET hash = excluded.hash, fecha_ventana = excluded.fecha_ventana,
                    json_ausente = excluded.json_ausente, renglones_ausente = excluded.renglones_ausente;
                """,
                ("$t", tipo.Texto()), ("$c", c.Clave), ("$h", c.Hash),
                ("$f", c.FechaVentana is { } f ? ApoyoMapeo.FechaSrTexto(f) : null), ("$a", c.JsonAusente), ("$r", c.RenglonesAusente));
        }

        foreach (var clave in purgar)
        {
            Ejecutar(conexion, tx, "DELETE FROM inventario_documentos WHERE tipo = $t AND clave = $c;",
                ("$t", tipo.Texto()), ("$c", clave));
        }

        foreach (var (clave, valor) in marcas)
        {
            Ejecutar(
                conexion, tx,
                "INSERT INTO agente_marcas (clave, valor) VALUES ($k, $v) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor;",
                ("$k", clave), ("$v", valor));
        }

        tx.Commit();
    }

    /// <summary>El lote más viejo, o null.</summary>
    public LoteInventario? TomarSiguiente()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = "SELECT id, tipo, payload, claves, renglones FROM inventario_lotes ORDER BY id LIMIT 1;";
        using var lector = comando.ExecuteReader();
        return lector.Read()
            ? new LoteInventario(
                lector.GetInt64(0), TiposDocumentoInventario.Desde(lector.GetString(1)), lector.GetString(2),
                JsonSerializer.Deserialize<List<string>>(lector.GetString(3))!, lector.GetInt32(4))
            : null;
    }

    public void Quitar(LoteInventario lote)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null, "DELETE FROM inventario_lotes WHERE id = $i;", ("$i", lote.Id));
    }

    /// <summary>
    /// Saca un lote que el API no va a aceptar nunca (400, 413, 500) y pone en NULL el hash de sus
    /// documentos, sin borrar su fila: la siguiente lectura los vuelve a encolar si SR los tiene, y si ya
    /// no, los detecta como ausentes y reenvía su variante cancelada/vacía. Así un descarte no pierde
    /// una cancelación.
    /// </summary>
    public void Descartar(LoteInventario lote)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        Ejecutar(conexion, tx, "DELETE FROM inventario_lotes WHERE id = $i;", ("$i", lote.Id));
        foreach (var clave in lote.Claves)
        {
            Ejecutar(conexion, tx, "UPDATE inventario_documentos SET hash = NULL WHERE tipo = $t AND clave = $c;",
                ("$t", lote.Tipo.Texto()), ("$c", clave));
        }

        tx.Commit();
    }

    public void SumarIntento(LoteInventario lote)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null, "UPDATE inventario_lotes SET intentos = intentos + 1 WHERE id = $i;", ("$i", lote.Id));
    }

    public string? Marca(string clave) =>
        Escalar<string?>("SELECT valor FROM agente_marcas WHERE clave = $k;", ("$k", clave));

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
}
