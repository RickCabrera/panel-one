using System.Globalization;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Actualizacion;

/// <summary>Qué hacer con un binario del canal, según lo que ya pasó con él.</summary>
/// <param name="PuedeIntentar">Se puede bajar e instalar ahora.</param>
/// <param name="Aplicada">El watchdog ya lo instaló alguna vez: no se vuelve a intentar.</param>
/// <param name="VersionDistintaReportada">Ya se le dijo al api que ese binario no reporta su versión.</param>
/// <param name="EsperarHasta">Con fallas previas, cuándo se permite el siguiente intento.</param>
internal sealed record DecisionIntento(bool PuedeIntentar, bool Aplicada, bool VersionDistintaReportada, DateTimeOffset? EsperarHasta);

/// <summary>
/// El estado de reintentos de la auto-actualización (F2-143), por binario (versión + SHA-256), en
/// <c>actualizacion\estado.db</c>: un SQLite propio del agente, como la cola (la regla del
/// proyecto: el estado propio del agente vive en su SQLite local, nunca en SoftRestaurant).
/// </summary>
/// <remarks>
/// <para>
/// Backoff por binario: tras <c>n</c> fallas, el siguiente intento espera
/// <c>min(1 h · 2^(n−1), 24 h)</c>. Un binario distinto (otra versión u otro SHA) empieza de cero.
/// Así un binario roto publicado no hace que cada PC del restaurante baje 70 MB cada 30 s.
/// </para>
/// <para>
/// Un binario que el watchdog YA aplicó no se vuelve a intentar nunca, aunque el agente siga
/// reportando otra versión (el exe publicado trae otra <c>AssemblyInformationalVersion</c>). Sin
/// esto el agente lo bajaría, el watchdog lo instalaría y el agente seguiría "distinto": un
/// Stop/Start en cada ciclo para siempre (observación del revisor al plan).
/// </para>
/// </remarks>
internal sealed class EstadoActualizacion
{
    public static readonly TimeSpan EsperaInicial = TimeSpan.FromHours(1);
    public static readonly TimeSpan EsperaMaxima = TimeSpan.FromHours(24);

    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS intentos (
            version                     TEXT    NOT NULL,
            sha256                      TEXT    NOT NULL,
            fallas                      INTEGER NOT NULL DEFAULT 0,
            ultima_falla_at             TEXT    NULL,
            aplicada_at                 TEXT    NULL,
            version_distinta_reportada  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (version, sha256)
        );
        PRAGMA user_version = 1;
        """;

    private readonly string _cadena;

    private EstadoActualizacion(string ruta)
    {
        _cadena = new SqliteConnectionStringBuilder
        {
            DataSource = ruta,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = 10,
        }.ToString();
    }

    public static EstadoActualizacion Abrir(string ruta)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var estado = new EstadoActualizacion(ruta);
        using var conexion = estado.Conectar();
        Ejecutar(conexion, Esquema);
        return estado;
    }

    /// <summary>Espera tras <paramref name="fallas"/> fallas seguidas del mismo binario.</summary>
    public static TimeSpan Espera(int fallas)
    {
        if (fallas <= 0)
        {
            return TimeSpan.Zero;
        }

        var horas = Math.Pow(2, Math.Min(fallas - 1, 10));
        var espera = TimeSpan.FromHours(horas);
        return espera > EsperaMaxima ? EsperaMaxima : espera;
    }

    public DecisionIntento Decidir(string version, string sha256, DateTimeOffset ahora)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText =
            "SELECT fallas, ultima_falla_at, aplicada_at, version_distinta_reportada FROM intentos " +
            "WHERE version = $v AND sha256 = $s";
        comando.Parameters.AddWithValue("$v", version);
        comando.Parameters.AddWithValue("$s", sha256);
        using var lector = comando.ExecuteReader();
        if (!lector.Read())
        {
            return new DecisionIntento(true, false, false, null);
        }

        var fallas = lector.GetInt32(0);
        var ultimaFalla = lector.IsDBNull(1) ? (DateTimeOffset?)null : Fecha(lector.GetString(1));
        var aplicada = !lector.IsDBNull(2);
        var distintaReportada = lector.GetInt32(3) != 0;
        if (aplicada)
        {
            return new DecisionIntento(false, true, distintaReportada, null);
        }

        if (ultimaFalla is not { } t || fallas == 0)
        {
            return new DecisionIntento(true, false, distintaReportada, null);
        }

        var hasta = t + Espera(fallas);
        return new DecisionIntento(ahora >= hasta, false, distintaReportada, hasta);
    }

    public void RegistrarFalla(string version, string sha256, DateTimeOffset ahora) =>
        Upsert(version, sha256,
            "INSERT INTO intentos (version, sha256, fallas, ultima_falla_at) VALUES ($v, $s, 1, $t) " +
            "ON CONFLICT (version, sha256) DO UPDATE SET fallas = fallas + 1, ultima_falla_at = $t",
            ahora);

    public void RegistrarAplicada(string version, string sha256, DateTimeOffset ahora) =>
        Upsert(version, sha256,
            "INSERT INTO intentos (version, sha256, aplicada_at) VALUES ($v, $s, $t) " +
            "ON CONFLICT (version, sha256) DO UPDATE SET aplicada_at = COALESCE(aplicada_at, $t)",
            ahora);

    public void MarcarVersionDistintaReportada(string version, string sha256) =>
        Upsert(version, sha256,
            "INSERT INTO intentos (version, sha256, version_distinta_reportada) VALUES ($v, $s, 1) " +
            "ON CONFLICT (version, sha256) DO UPDATE SET version_distinta_reportada = 1",
            null);

    private void Upsert(string version, string sha256, string sql, DateTimeOffset? ahora)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = sql;
        comando.Parameters.AddWithValue("$v", version);
        comando.Parameters.AddWithValue("$s", sha256);
        if (ahora is { } t)
        {
            comando.Parameters.AddWithValue("$t", Texto(t));
        }

        comando.ExecuteNonQuery();
    }

    private SqliteConnection Conectar()
    {
        var conexion = new SqliteConnection(_cadena);
        conexion.Open();
        return conexion;
    }

    private static void Ejecutar(SqliteConnection conexion, string sql)
    {
        using var comando = conexion.CreateCommand();
        comando.CommandText = sql;
        comando.ExecuteNonQuery();
    }

    private static string Texto(DateTimeOffset t) =>
        t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);

    private static DateTimeOffset Fecha(string texto) =>
        DateTimeOffset.ParseExact(texto, "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
