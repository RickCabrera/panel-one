using System.Globalization;
using ArkonAgente.Catalogos;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Una página o un cierre de una sincronización de catálogo, tal como sale de la cola.</summary>
/// <param name="Payload">El JSON del sobre. El del cierre no trae <c>rechazados</c>: se calcula al enviarlo.</param>
internal sealed record EnvioCatalogo(
    long Id, CatalogoPanel Catalogo, string SincronizacionId, bool EsCierre, string Payload);

/// <summary>Una sincronización completa ya armada: sus páginas (JSON) y el sobre de su cierre.</summary>
internal sealed record SincronizacionArmada(
    CatalogoPanel Catalogo, string SincronizacionId, IReadOnlyList<string> Paginas, string Cierre, string Hash);

/// <summary>
/// El carril de catálogos de la cola local (F2-240): las mismas garantías que <see cref="ColaLocal"/>
/// (SQLite en <c>cola.db</c>, persistente, FIFO, al menos una vez, purga a 7 días) en tablas
/// propias, para que un catálogo atorado nunca frene cheques ni heartbeat, ni al revés.
/// </summary>
/// <remarks>
/// <para>
/// Es estado PROPIO del agente: vive aquí, nunca en la base de SoftRestaurant. Como en
/// <see cref="ColaLocal"/>, las sentencias van en esta clase (escriben, y sólo en el SQLite).
/// </para>
/// <para>
/// Tablas: <c>catalogo_envios</c> (páginas y cierres pendientes), <c>catalogo_estado</c> (el hash
/// de lo último que se encoló por catálogo y cuándo reintentar uno que falló) y
/// <c>agente_marcas</c> (el día de la última sincronización diaria y el último forzado atendido).
/// Se crean con <c>IF NOT EXISTS</c> sobre el mismo archivo: un <c>cola.db</c> de antes se abre
/// sin perder un solo evento, y no se toca el <c>user_version</c> de <see cref="ColaLocal"/>.
/// </para>
/// <para>
/// Los payloads de clientes llevan datos personales (nombre, teléfono, correo, RFC) y quedan
/// hasta 7 días en este archivo, en la PC del POS que ya los tiene (agent/README.md).
/// </para>
/// </remarks>
internal sealed class ColaCatalogos
{
    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS catalogo_envios (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            catalogo            TEXT    NOT NULL,
            sincronizacion_id   TEXT    NOT NULL,
            clase               TEXT    NOT NULL CHECK (clase IN ('pagina', 'cierre')),
            payload             TEXT    NOT NULL,
            rechazados_sin_fila INTEGER NOT NULL DEFAULT 0,
            creado_at           TEXT    NOT NULL,
            intentos            INTEGER NOT NULL DEFAULT 0,
            enviado_at          TEXT    NULL,
            rechazado_at        TEXT    NULL,
            motivo_rechazo      TEXT    NULL
        );
        CREATE INDEX IF NOT EXISTS ix_catalogo_envios_pendientes ON catalogo_envios (id)
            WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        CREATE INDEX IF NOT EXISTS ix_catalogo_envios_sinc ON catalogo_envios (sincronizacion_id);
        CREATE TABLE IF NOT EXISTS catalogo_estado (
            catalogo         TEXT PRIMARY KEY,
            hash             TEXT NULL,
            encolado_at      TEXT NULL,
            reintentar_desde TEXT NULL
        );
        CREATE TABLE IF NOT EXISTS agente_marcas (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
        """;

    private const string Pendiente = "enviado_at IS NULL AND rechazado_at IS NULL";

    private readonly string _cadena;
    private readonly TimeProvider _reloj;

    private ColaCatalogos(string ruta, TimeProvider reloj)
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

    public static ColaCatalogos Abrir(string ruta, TimeProvider reloj)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var cola = new ColaCatalogos(ruta, reloj);
        using var conexion = cola.Conectar();
        Ejecutar(conexion, null, Esquema);
        return cola;
    }

    /// <summary>¿Hay páginas o cierre de este catálogo sin confirmar? Entonces no se abre otra (F2-230).</summary>
    public bool HayPendiente(CatalogoPanel catalogo) =>
        Escalar<long>($"SELECT COUNT(*) FROM catalogo_envios WHERE catalogo = $c AND {Pendiente};", ("$c", catalogo.Texto())) > 0;

    public int ContarPendientes() =>
        (int)Escalar<long>($"SELECT COUNT(*) FROM catalogo_envios WHERE {Pendiente};");

    /// <summary>El hash de lo último que se encoló de este catálogo; null = nunca, o se abandonó.</summary>
    public string? Hash(CatalogoPanel catalogo) =>
        Escalar<string?>("SELECT hash FROM catalogo_estado WHERE catalogo = $c;", ("$c", catalogo.Texto()));

    /// <summary>Desde cuándo reintentar un catálogo que falló; null = no hay reintento pendiente.</summary>
    public DateTimeOffset? ReintentarDesde(CatalogoPanel catalogo) =>
        Escalar<string?>("SELECT reintentar_desde FROM catalogo_estado WHERE catalogo = $c;", ("$c", catalogo.Texto()))
            is { } texto ? Leer(texto) : null;

    /// <summary>Un catálogo cuya lectura falló: se vuelve a leer solo, no antes de <paramref name="desde"/>.</summary>
    public void ProgramarReintento(CatalogoPanel catalogo, DateTimeOffset desde)
    {
        using var conexion = Conectar();
        Ejecutar(
            conexion, null,
            """
            INSERT INTO catalogo_estado (catalogo, reintentar_desde) VALUES ($c, $d)
            ON CONFLICT (catalogo) DO UPDATE SET reintentar_desde = excluded.reintentar_desde;
            """,
            ("$c", catalogo.Texto()), ("$d", ColaLocal.Formatear(desde)));
    }

    /// <summary>El catálogo se leyó bien y no hubo que mandar nada: ya no hay reintento pendiente.</summary>
    public void QuitarReintento(CatalogoPanel catalogo)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null, "UPDATE catalogo_estado SET reintentar_desde = NULL WHERE catalogo = $c;",
            ("$c", catalogo.Texto()));
    }

    /// <summary>
    /// Encola TODA la sincronización en una transacción: sus páginas, su cierre y el hash nuevo
    /// (y quita el reintento). Un corte a medias no deja media sincronización en la cola.
    /// </summary>
    public void EncolarSincronizacion(SincronizacionArmada sinc)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var ahora = Ahora();
        foreach (var pagina in sinc.Paginas)
        {
            Insertar(conexion, tx, sinc, "pagina", pagina, ahora);
        }

        Insertar(conexion, tx, sinc, "cierre", sinc.Cierre, ahora);
        Ejecutar(
            conexion, tx,
            """
            INSERT INTO catalogo_estado (catalogo, hash, encolado_at, reintentar_desde) VALUES ($c, $h, $a, NULL)
            ON CONFLICT (catalogo) DO UPDATE SET hash = excluded.hash, encolado_at = excluded.encolado_at,
                reintentar_desde = NULL;
            """,
            ("$c", sinc.Catalogo.Texto()), ("$h", sinc.Hash), ("$a", ahora));
        tx.Commit();
    }

    /// <summary>El pendiente más viejo del carril (FIFO), o null.</summary>
    public EnvioCatalogo? TomarSiguiente()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText =
            $"SELECT id, catalogo, sincronizacion_id, clase, payload FROM catalogo_envios WHERE {Pendiente} ORDER BY id LIMIT 1;";
        using var lector = comando.ExecuteReader();
        return lector.Read()
            ? new EnvioCatalogo(
                lector.GetInt64(0), CatalogosPanel.Parsear(lector.GetString(1)), lector.GetString(2),
                lector.GetString(3) == "cierre", lector.GetString(4))
            : null;
    }

    /// <summary>El API guardó la página o aplicó el cierre. De una página se guarda su <c>rechazadosSinFila</c>.</summary>
    public void MarcarEnviado(long id, int rechazadosSinFila = 0)
    {
        using var conexion = Conectar();
        Ejecutar(
            conexion, null,
            $"UPDATE catalogo_envios SET enviado_at = $a, rechazados_sin_fila = $r WHERE id = $id AND {Pendiente};",
            ("$a", Ahora()), ("$r", rechazadosSinFila), ("$id", id));
    }

    public void SumarIntento(long id)
    {
        using var conexion = Conectar();
        Ejecutar(conexion, null, $"UPDATE catalogo_envios SET intentos = intentos + 1 WHERE id = $id AND {Pendiente};",
            ("$id", id));
    }

    /// <summary>El <c>rechazados</c> del cierre: la suma de <c>rechazadosSinFila</c> de sus páginas.</summary>
    public int RechazadosSinFila(string sincronizacionId) =>
        (int)Escalar<long>(
            "SELECT COALESCE(SUM(rechazados_sin_fila), 0) FROM catalogo_envios WHERE sincronizacion_id = $s AND clase = 'pagina';",
            ("$s", sincronizacionId));

    /// <summary>
    /// El API rechazó algo de esta sincronización sin posibilidad de que reenviarlo igual sirva:
    /// todo lo pendiente de ella sale de la cola con el motivo, se BORRA el hash del catálogo (la
    /// próxima lectura se manda completa con otro id) y se programa su reintento para
    /// <paramref name="reintentarDesde"/> (no antes: un error que no se va no relee el POS en cada ciclo).
    /// </summary>
    public int Abandonar(EnvioCatalogo envio, string motivo, DateTimeOffset reintentarDesde)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var n = Ejecutar(
            conexion, tx,
            $"UPDATE catalogo_envios SET rechazado_at = $a, motivo_rechazo = $m WHERE sincronizacion_id = $s AND {Pendiente};",
            ("$a", Ahora()), ("$m", motivo), ("$s", envio.SincronizacionId));
        Ejecutar(
            conexion, tx,
            """
            INSERT INTO catalogo_estado (catalogo, hash, reintentar_desde) VALUES ($c, NULL, $d)
            ON CONFLICT (catalogo) DO UPDATE SET hash = NULL, reintentar_desde = excluded.reintentar_desde;
            """,
            ("$c", envio.Catalogo.Texto()), ("$d", ColaLocal.Formatear(reintentarDesde)));
        tx.Commit();
        return n;
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

    /// <summary>Borra lo enviado o rechazado hace más de 7 días. Nunca un pendiente.</summary>
    public int Purgar()
    {
        var limite = ColaLocal.Formatear(_reloj.GetUtcNow() - ColaLocal.Retencion);
        using var conexion = Conectar();
        return Ejecutar(
            conexion, null,
            "DELETE FROM catalogo_envios WHERE (enviado_at IS NOT NULL AND enviado_at < $l) " +
            "OR (rechazado_at IS NOT NULL AND rechazado_at < $l);",
            ("$l", limite));
    }

    private static void Insertar(
        SqliteConnection conexion, SqliteTransaction tx, SincronizacionArmada sinc, string clase, string payload, string ahora) =>
        Ejecutar(
            conexion, tx,
            """
            INSERT INTO catalogo_envios (catalogo, sincronizacion_id, clase, payload, creado_at)
            VALUES ($c, $s, $k, $p, $a);
            """,
            ("$c", sinc.Catalogo.Texto()), ("$s", sinc.SincronizacionId), ("$k", clase), ("$p", payload), ("$a", ahora));

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

    private static DateTimeOffset Leer(string texto) =>
        DateTimeOffset.ParseExact(
            texto, ColaLocal.FormatoFecha, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
