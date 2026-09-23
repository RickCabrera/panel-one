using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Un evento que todavía no llega al API, tal como sale de la cola.</summary>
internal sealed record EventoPendiente(long Id, TipoEvento Tipo, string Payload);

/// <summary>Un evento que el API rechazó sin reintento, como quedó en la cola.</summary>
/// <param name="Clave">El <c>folioSr</c> si es cheque.</param>
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
/// Sólo el último pendiente importa en tres casos, y encolar borra el anterior en la
/// misma transacción:
/// <list type="bullet">
/// <item><b>snapshot</b>: son las mesas completas, no un delta (así lo pide el backlog).</item>
/// <item><b>cheque con el mismo <c>folioSr</c></b>: SR reprocesa cheques (reaperturas,
/// cancelaciones) y el API sobrescribe sin mirar versiones. Si la versión vieja siguiera
/// pendiente, un reintento suyo pisaría a la nueva en el panel.</item>
/// <item><b>heartbeat</b>: ver la DECISION PROVISIONAL abajo.</item>
/// </list>
/// </para>
/// </remarks>
internal sealed class ColaLocal
{
    public const string NombreArchivo = "cola.db";
    public static readonly TimeSpan Retencion = TimeSpan.FromDays(7);

    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS eventos (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo           TEXT    NOT NULL CHECK (tipo IN ('cheque', 'snapshot', 'heartbeat')),
            clave          TEXT    NULL,
            payload        TEXT    NOT NULL,
            creado_at      TEXT    NOT NULL,
            intentos       INTEGER NOT NULL DEFAULT 0,
            enviado_at     TEXT    NULL,
            rechazado_at   TEXT    NULL,
            motivo_rechazo TEXT    NULL
        );
        CREATE INDEX IF NOT EXISTS ix_eventos_pendientes ON eventos (id)
            WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_pendientes_clave ON eventos (tipo, clave)
            WHERE enviado_at IS NULL AND rechazado_at IS NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_enviado ON eventos (enviado_at) WHERE enviado_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS ix_eventos_rechazado ON eventos (rechazado_at) WHERE rechazado_at IS NOT NULL;
        PRAGMA user_version = 1;
        """;

    private const string Pendiente = "enviado_at IS NULL AND rechazado_at IS NULL";

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
        return cola;
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
            case TipoEvento.Cheque:
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

            if (tipo != TipoEvento.Cheque)
            {
                return null;
            }

            if (documento.RootElement.TryGetProperty("folioSr", out var folio)
                && folio.ValueKind == JsonValueKind.String
                && folio.GetString() is { Length: > 0 } clave)
            {
                return clave;
            }

            throw new ArgumentException("Un evento cheque tiene que traer 'folioSr' (texto no vacío).", nameof(payloadJson));
        }
    }

    private static TipoEvento ParsearTipo(string texto) => texto switch
    {
        "cheque" => TipoEvento.Cheque,
        "snapshot" => TipoEvento.Snapshot,
        "heartbeat" => TipoEvento.Heartbeat,
        _ => throw new InvalidDataException($"Tipo de evento desconocido en la cola: '{texto}'."),
    };
}
