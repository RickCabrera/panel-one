using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Un evento que todavía no llega al API, tal como sale de la cola.</summary>
internal sealed record EventoPendiente(long Id, TipoEvento Tipo, string Payload);

/// <summary>Un evento que el API rechazó sin reintento, como quedó en la cola.</summary>
/// <param name="Clave">El <c>folioSr</c> si es cheque; el <c>turnoSr</c> si es turno.</param>
internal sealed record RechazoGuardado(TipoEvento Tipo, string? Clave, string Motivo, DateTimeOffset RechazadoAt);

/// <summary>Cuántos rechazos definitivos hay en la cola (7 días) y el más reciente.</summary>
internal sealed record ResumenRechazos(int Total, int Cheques, RechazoGuardado? Ultimo)
{
    public static readonly ResumenRechazos Ninguno = new(0, 0, null);
}

/// <summary>
/// La cola local del agente (F1-024): <c>cola.db</c>, un SQLite en la carpeta del
/// agente. Es el estado PROPIO del agente y vive aquí, nunca en la base de
/// SoftRestaurant.
/// </summary>
/// <remarks>
/// <para>
/// Las sentencias van en constantes de esta clase y no en <c>Sql/Consultas/</c>: aquéllas
/// son las de SQL Server (SoftRestaurant, sólo lectura, con su guardia de
/// <c>ConsultasEmbebidasTests</c>); éstas escriben, y sólo en este archivo.
/// </para>
/// <para>
/// Fechas en UTC, como texto de ancho fijo (<c>yyyy-MM-ddTHH:mm:ss.fffffffZ</c>) para
/// que comparar textos sea comparar instantes. <c>synchronous=FULL</c>: un cheque
/// encolado no se pierde por un apagón (el volumen del agente es mínimo).
/// <c>Pooling=False</c>: el archivo no queda abierto entre operaciones.
/// </para>
/// <para>
/// Sólo el último pendiente importa en cuatro casos, y encolar borra el anterior en la
/// misma transacción:
/// <list type="bullet">
/// <item><b>snapshot</b>: son las mesas completas, no un delta (así lo pide el backlog).</item>
/// <item><b>cheque con el mismo <c>folioSr</c></b>: SR reprocesa cheques (reaperturas,
/// cancelaciones) y el API sobrescribe sin mirar versiones. Si la versión vieja siguiera
/// pendiente, un reintento suyo pisaría a la nueva en el panel.</item>
/// <item><b>turno con el mismo <c>turnoSr</c></b> (MVP de cortes): el mismo caso que el cheque.</item>
/// <item><b>heartbeat</b>: ver la DECISION PROVISIONAL abajo.</item>
/// </list>
/// </para>
/// </remarks>
internal sealed class ColaLocal
{
    public const string NombreArchivo = "cola.db";
    public static readonly TimeSpan Retencion = TimeSpan.FromDays(7);

    /// <summary>
    /// La versión del esquema de <c>eventos</c>. 1 = F1-024; 2 = MVP de cortes (el tipo
    /// <c>turno</c> en el CHECK). Un <c>cola.db</c> de antes se migra al abrirlo (<see cref="Migrar"/>)
    /// sin perder un solo evento.
    /// </summary>
    public const int VersionEsquema = 2;

    private const string Columnas = """
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo           TEXT    NOT NULL CHECK (tipo IN ('cheque', 'snapshot', 'heartbeat', 'turno')),
            clave          TEXT    NULL,
            payload        TEXT    NOT NULL,
            creado_at      TEXT    NOT NULL,
            intentos       INTEGER NOT NULL DEFAULT 0,
            enviado_at     TEXT    NULL,
            rechazado_at   TEXT    NULL,
            motivo_rechazo TEXT    NULL
        """;

    private const string Indices = """
        CREATE INDEX IF NOT EXISTS ix_eventos_pendientes ON eventos (id)
            WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_pendientes_clave ON eventos (tipo, clave)
            WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_enviado ON eventos (enviado_at) WHERE enviado_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_rechazado ON eventos (rechazado_at) WHERE rechazado_at IS NOT NULL;
        """;

    private const string Esquema =
        "PRAGMA journal_mode = WAL;\n" +
        "CREATE TABLE IF NOT EXISTS eventos (\n" + Columnas + "\n);\n" +
        Indices;

    private const string Pendiente = "enviado_at IS NULL AND rechazado_at IS NULL";

    /// <summary>Los tipos que entiende CUALQUIER agente desde F1-024 (los del CHECK de la versión 1).</summary>
    internal const string TiposOriginales = "'cheque', 'snapshot', 'heartbeat'";

    /// <summary>Los tipos que entiende ESTA versión (los del CHECK de <see cref="Columnas"/>).</summary>
    internal const string TiposConocidos = "'cheque', 'snapshot', 'heartbeat', 'turno'";

    /// <summary>
    /// Donde el watchdog aparta los eventos de tipos que un agente ANTERIOR no conoce, antes de
    /// arrancarlo (<see cref="ApartarTiposNuevos"/>). Sin CHECK de tipo, a propósito.
    /// </summary>
    private const string EsquemaApartados = """
        CREATE TABLE IF NOT EXISTS eventos_apartados (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            id_original    INTEGER NOT NULL,
            tipo           TEXT    NOT NULL,
            clave          TEXT    NULL,
            payload        TEXT    NOT NULL,
            creado_at      TEXT    NOT NULL,
            intentos       INTEGER NOT NULL DEFAULT 0,
            enviado_at     TEXT    NULL,
            rechazado_at   TEXT    NULL,
            motivo_rechazo TEXT    NULL,
            apartado_at    TEXT    NOT NULL
        );
        """;

    private readonly string _cadena;
    private readonly TimeProvider _reloj;

    private ColaLocal(string ruta, TimeProvider reloj)
    {
        Ruta = ruta;
        _reloj = reloj;
        _cadena = new SqliteConnectionStringBuilder
        {
            DataSource = ruta,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = 10,
        }.ToString();
    }

    public string Ruta { get; }

    /// <summary>Abre (o crea) la cola en <paramref name="ruta"/>.</summary>
    public static ColaLocal Abrir(string ruta, TimeProvider reloj)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var cola = new ColaLocal(ruta, reloj);
        using var conexion = cola.Conectar();
        Ejecutar(conexion, null, Esquema);
        Migrar(conexion);
        Recuperar(conexion);
        return cola;
    }

    /// <summary>
    /// Lo que hace el WATCHDOG antes de arrancar un exe recién puesto (actualización o rollback):
    /// mueve a <c>eventos_apartados</c>, en UNA transacción, TODOS los eventos (pendientes, enviados o
    /// rechazados) cuyo tipo no está en <see cref="TiposOriginales"/>. Un agente anterior al tipo
    /// <c>turno</c> truena al leer uno (en <c>TomarPendientes</c> y en <c>ResumenRechazados</c>); así
    /// arranca con sólo lo que entiende. Un agente que sí los conoce los recupera al abrir la cola
    /// (<see cref="Recuperar"/>). Con el agente detenido: el watchdog lo garantiza. Sin archivo, no
    /// hace nada. Devuelve cuántos movió.
    /// </summary>
    public static int ApartarTiposNuevos(string ruta, TimeProvider reloj)
    {
        if (!File.Exists(ruta))
        {
            return 0;
        }

        var cadena = new SqliteConnectionStringBuilder
        {
            DataSource = ruta,
            Mode = SqliteOpenMode.ReadWrite,
            Pooling = false,
            DefaultTimeout = 10,
        }.ToString();
        using var conexion = new SqliteConnection(cadena);
        conexion.Open();
        Ejecutar(conexion, null, "PRAGMA synchronous = FULL;");
        if (!ExisteTabla(conexion, "eventos"))
        {
            return 0;
        }

        using var tx = conexion.BeginTransaction();
        Ejecutar(conexion, tx, EsquemaApartados);
        Ejecutar(
            conexion, tx,
            "INSERT INTO eventos_apartados (id_original, tipo, clave, payload, creado_at, intentos, enviado_at, " +
            "rechazado_at, motivo_rechazo, apartado_at) " +
            "SELECT id, tipo, clave, payload, creado_at, intentos, enviado_at, rechazado_at, motivo_rechazo, $ahora " +
            $"FROM eventos WHERE tipo NOT IN ({TiposOriginales}) ORDER BY id;",
            ("$ahora", Formatear(reloj.GetUtcNow())));
        var movidos = Ejecutar(conexion, tx, $"DELETE FROM eventos WHERE tipo NOT IN ({TiposOriginales});");
        tx.Commit();
        return movidos;
    }

    /// <summary>
    /// Regresa a la cola los PENDIENTES que el watchdog apartó y que esta versión entiende (con id
    /// nuevo, al final). Si ya hay un pendiente más nuevo del mismo tipo y clave, gana ése (el
    /// apartado es una versión vieja). Los enviados o rechazados apartados ya no sirven y se borran.
    /// Lo que esta versión tampoco entiende se queda apartado.
    /// </summary>
    private static void Recuperar(SqliteConnection conexion)
    {
        if (!ExisteTabla(conexion, "eventos_apartados"))
        {
            return;
        }

        using var tx = conexion.BeginTransaction();
        Ejecutar(
            conexion, tx,
            "INSERT INTO eventos (tipo, clave, payload, creado_at, intentos) " +
            "SELECT a.tipo, a.clave, a.payload, a.creado_at, a.intentos FROM eventos_apartados AS a " +
            $"WHERE a.enviado_at IS NULL AND a.rechazado_at IS NULL AND a.tipo IN ({TiposConocidos}) " +
            "AND NOT EXISTS (SELECT 1 FROM eventos AS e WHERE e.tipo = a.tipo AND e.clave IS a.clave " +
            "AND e.enviado_at IS NULL AND e.rechazado_at IS NULL) ORDER BY a.id_original;");
        Ejecutar(conexion, tx, $"DELETE FROM eventos_apartados WHERE tipo IN ({TiposConocidos});");
        tx.Commit();
    }

    private static bool ExisteTabla(SqliteConnection conexion, string nombre)
    {
        using var comando = conexion.CreateCommand();
        comando.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $n;";
        comando.Parameters.AddWithValue("$n", nombre);
        return Convert.ToInt64(comando.ExecuteScalar(), CultureInfo.InvariantCulture) > 0;
    }

    /// <summary>
    /// Lleva un <c>cola.db</c> de antes al esquema de ahora. SQLite no deja cambiar un CHECK: la
    /// tabla <c>eventos</c> con el CHECK viejo (sin <c>turno</c>) se reconstruye en UNA transacción
    /// (crear la nueva, copiar TODAS las filas con su id, borrar la vieja, renombrar y rehacer los
    /// índices), y el contador de AUTOINCREMENT se conserva: un id ya usado no se repite. Si algo
    /// falla, el rollback deja el archivo como estaba y la excepción sube (falla interna: el
    /// servicio se reinicia). Idempotente: con el CHECK nuevo no hace nada más que fijar la versión.
    /// </summary>
    private static void Migrar(SqliteConnection conexion)
    {
        string? definicion;
        using (var leer = conexion.CreateCommand())
        {
            leer.CommandText = "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'eventos';";
            definicion = leer.ExecuteScalar() as string;
        }

        if (definicion is not null && !definicion.Contains("'turno'", StringComparison.Ordinal))
        {
            using var tx = conexion.BeginTransaction();
            long? secuencia;
            using (var leer = conexion.CreateCommand())
            {
                leer.Transaction = tx;
                leer.CommandText = "SELECT seq FROM sqlite_sequence WHERE name = 'eventos';";
                var valor = leer.ExecuteScalar();
                secuencia = valor is null or DBNull ? null : Convert.ToInt64(valor, CultureInfo.InvariantCulture);
            }

            Ejecutar(conexion, tx, "CREATE TABLE eventos_nueva (\n" + Columnas + "\n);");
            Ejecutar(
                conexion, tx,
                "INSERT INTO eventos_nueva (id, tipo, clave, payload, creado_at, intentos, enviado_at, rechazado_at, motivo_rechazo) " +
                "SELECT id, tipo, clave, payload, creado_at, intentos, enviado_at, rechazado_at, motivo_rechazo FROM eventos;");
            Ejecutar(conexion, tx, "DROP TABLE eventos;");
            Ejecutar(conexion, tx, "ALTER TABLE eventos_nueva RENAME TO eventos;");
            Ejecutar(conexion, tx, Indices);
            if (secuencia is { } seq)
            {
                Ejecutar(
                    conexion, tx,
                    "INSERT INTO sqlite_sequence (name, seq) SELECT 'eventos', 0 " +
                    "WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'eventos');");
                Ejecutar(
                    conexion, tx, "UPDATE sqlite_sequence SET seq = $s WHERE name = 'eventos' AND seq < $s;", ("$s", seq));
            }

            tx.Commit();
        }

        Ejecutar(conexion, null, $"PRAGMA user_version = {VersionEsquema};");
    }

    /// <summary>
    /// Encola un evento. <paramref name="payloadJson"/> es el <c>datos</c> del contrato y
    /// tiene que ser un objeto JSON; un cheque tiene que traer <c>folioSr</c>. Si no, es
    /// un bug del productor y truena aquí, antes de envenenar un lote.
    /// </summary>
    /// <returns>El id del evento, que es también su id en el lote.</returns>
    public long Encolar(TipoEvento tipo, string payloadJson)
    {
        var clave = ValidarPayload(tipo, payloadJson);

        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();

        switch (tipo)
        {
            case TipoEvento.Snapshot:
            // DECISION PROVISIONAL (nocturno): el heartbeat también se colapsa, aunque el
            // backlog sólo lo dice del snapshot. El API guarda sólo el último estado (e
            // ignora un heartbeat que llega tarde) y el contacto del agente sale del lote,
            // no del heartbeat: no se pierde nada. Sin esto, un corte de días acumula
            // 2 880 heartbeats diarios y la cola sí crece sin límite.
            case TipoEvento.Heartbeat:
                Ejecutar(conexion, tx, $"DELETE FROM eventos WHERE tipo = $tipo AND {Pendiente};", ("$tipo", tipo.Texto()));
                break;
            // MVP de cortes: un turno se reenvía cuando cambia (se cierra, se declara); sólo el último
            // pendiente del mismo turnoSr importa, igual que con un cheque.
            case TipoEvento.Cheque:
            case TipoEvento.Turno:
                Ejecutar(
                    conexion, tx, $"DELETE FROM eventos WHERE tipo = $tipo AND clave = $clave AND {Pendiente};",
                    ("$tipo", tipo.Texto()), ("$clave", clave));
                break;
        }

        using var insertar = conexion.CreateCommand();
        insertar.Transaction = tx;
        insertar.CommandText = """
            INSERT INTO eventos (tipo, clave, payload, creado_at) VALUES ($tipo, $clave, $payload, $ahora);
            SELECT last_insert_rowid();
            """;
        insertar.Parameters.AddWithValue("$tipo", tipo.Texto());
        insertar.Parameters.AddWithValue("$clave", (object?)clave ?? DBNull.Value);
        insertar.Parameters.AddWithValue("$payload", payloadJson);
        insertar.Parameters.AddWithValue("$ahora", Ahora());
        var id = (long)insertar.ExecuteScalar()!;

        tx.Commit();
        return id;
    }

    /// <summary>Hasta <paramref name="maximo"/> pendientes, en orden de llegada (FIFO).</summary>
    public IReadOnlyList<EventoPendiente> TomarPendientes(int maximo)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = $"SELECT id, tipo, payload FROM eventos WHERE {Pendiente} ORDER BY id LIMIT $max;";
        comando.Parameters.AddWithValue("$max", maximo);

        var eventos = new List<EventoPendiente>();
        using var lector = comando.ExecuteReader();
        while (lector.Read())
        {
            eventos.Add(new EventoPendiente(lector.GetInt64(0), ParsearTipo(lector.GetString(1)), lector.GetString(2)));
        }

        return eventos;
    }

    public int ContarPendientes()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = $"SELECT COUNT(*) FROM eventos WHERE {Pendiente};";
        return Convert.ToInt32(comando.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// El <c>tamanoCola</c> del heartbeat (F1-025): pendientes SIN contar el heartbeat.
    /// Se aparta a propósito de la nota de F1-024 (que decía <see cref="ContarPendientes"/>):
    /// el heartbeat pendiente se colapsa y viaja en el mismo lote que lo reporta, así que
    /// contarlo sólo mete un 0/1 de ruido en la cifra. No "corregir".
    /// </summary>
    public int ContarPendientesSinHeartbeat()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = $"SELECT COUNT(*) FROM eventos WHERE {Pendiente} AND tipo <> $tipo;";
        comando.Parameters.AddWithValue("$tipo", TipoEvento.Heartbeat.Texto());
        return Convert.ToInt32(comando.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Los rechazos definitivos que siguen en la cola (la purga los borra a los 7 días),
    /// para que el heartbeat los lleve al panel (F1-025): un cheque rechazado es una venta
    /// que falta.
    /// </summary>
    public ResumenRechazos ResumenRechazados()
    {
        using var conexion = Conectar();
        using var contar = conexion.CreateCommand();
        contar.CommandText = """
            SELECT COUNT(*), COALESCE(SUM(CASE WHEN tipo = $cheque THEN 1 ELSE 0 END), 0)
            FROM eventos WHERE rechazado_at IS NOT NULL;
            """;
        contar.Parameters.AddWithValue("$cheque", TipoEvento.Cheque.Texto());
        int total, cheques;
        using (var lector = contar.ExecuteReader())
        {
            lector.Read();
            total = lector.GetInt32(0);
            cheques = lector.GetInt32(1);
        }

        if (total == 0)
        {
            return ResumenRechazos.Ninguno;
        }

        using var ultimo = conexion.CreateCommand();
        ultimo.CommandText = """
            SELECT tipo, clave, motivo_rechazo, rechazado_at FROM eventos
            WHERE rechazado_at IS NOT NULL ORDER BY rechazado_at DESC, id DESC LIMIT 1;
            """;
        using var fila = ultimo.ExecuteReader();
        fila.Read();
        var rechazo = new RechazoGuardado(
            ParsearTipo(fila.GetString(0)),
            fila.IsDBNull(1) ? null : fila.GetString(1),
            fila.IsDBNull(2) ? "sin motivo" : fila.GetString(2),
            DateTimeOffset.ParseExact(
                fila.GetString(3), FormatoFecha, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal));
        return new ResumenRechazos(total, cheques, rechazo);
    }

    /// <summary>El API los guardó: quedan como enviados y salen de los pendientes.</summary>
    public void MarcarEnviados(IEnumerable<long> ids) =>
        PorCadaId(ids, $"UPDATE eventos SET enviado_at = $ahora WHERE id = $id AND {Pendiente};");

    /// <summary>
    /// El API los rechazó sin posibilidad de reintento (<c>reintentable: false</c>) o
    /// nunca van a caber: salen de los pendientes y se guardan con su motivo hasta la purga.
    /// </summary>
    public void MarcarRechazados(IEnumerable<(long Id, string Motivo)> rechazos)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        foreach (var (id, motivo) in rechazos)
        {
            Ejecutar(
                conexion, tx,
                $"UPDATE eventos SET rechazado_at = $ahora, motivo_rechazo = $motivo WHERE id = $id AND {Pendiente};",
                ("$ahora", Ahora()), ("$motivo", motivo), ("$id", id));
        }

        tx.Commit();
    }

    /// <summary>Un intento fallido más; siguen pendientes.</summary>
    public void SumarIntento(IEnumerable<long> ids) =>
        PorCadaId(ids, $"UPDATE eventos SET intentos = intentos + 1 WHERE id = $id AND {Pendiente};");

    /// <summary>Borra los enviados y los rechazados de hace más de 7 días. Nunca un pendiente.</summary>
    public int Purgar()
    {
        var limite = Formatear(_reloj.GetUtcNow() - Retencion);
        using var conexion = Conectar();
        return Ejecutar(
            conexion, null,
            "DELETE FROM eventos WHERE (enviado_at IS NOT NULL AND enviado_at < $limite) " +
            "OR (rechazado_at IS NOT NULL AND rechazado_at < $limite);",
            ("$limite", limite));
    }

    private void PorCadaId(IEnumerable<long> ids, string sentencia)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var ahora = Ahora();
        foreach (var id in ids)
        {
            Ejecutar(conexion, tx, sentencia, ("$ahora", ahora), ("$id", id));
        }

        tx.Commit();
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

    private string Ahora() => Formatear(_reloj.GetUtcNow());

    /// <summary>
    /// El único formato de fecha de la cola: lo escribe <see cref="Formatear"/> y lo lee
    /// <see cref="ResumenRechazados"/>. Si divergieran, leer un rechazo tronaría en cada ciclo.
    /// </summary>
    internal const string FormatoFecha = "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'";

    internal static string Formatear(DateTimeOffset instante) =>
        instante.UtcDateTime.ToString(FormatoFecha, CultureInfo.InvariantCulture);

    private static string? ValidarPayload(TipoEvento tipo, string payloadJson)
    {
        JsonDocument documento;
        try
        {
            documento = JsonDocument.Parse(payloadJson);
        }
        catch (JsonException ex)
        {
            throw new ArgumentException($"El payload de un evento {tipo.Texto()} no es JSON válido.", nameof(payloadJson), ex);
        }

        using (documento)
        {
            if (documento.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException($"El payload de un evento {tipo.Texto()} tiene que ser un objeto JSON.", nameof(payloadJson));
            }

            var llave = tipo switch
            {
                TipoEvento.Cheque => "folioSr",
                TipoEvento.Turno => "turnoSr",
                _ => null,
            };
            if (llave is null)
            {
                return null;
            }

            if (documento.RootElement.TryGetProperty(llave, out var valor)
                && valor.ValueKind == JsonValueKind.String
                && valor.GetString() is { Length: > 0 } clave)
            {
                return clave;
            }

            throw new ArgumentException(
                $"Un evento {tipo.Texto()} tiene que traer '{llave}' (texto no vacío).", nameof(payloadJson));
        }
    }

    private static TipoEvento ParsearTipo(string texto) => texto switch
    {
        "cheque" => TipoEvento.Cheque,
        "snapshot" => TipoEvento.Snapshot,
        "heartbeat" => TipoEvento.Heartbeat,
        "turno" => TipoEvento.Turno,
        _ => throw new InvalidDataException($"Tipo de evento desconocido en la cola: '{texto}'."),
    };
}
