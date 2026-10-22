using System.Globalization;
using Microsoft.Data.Sqlite;

namespace ArkonAgente.Cola;

/// <summary>Lo último que se encoló de un cheque: su apertura en SR y la huella de lo que se mandó.</summary>
internal sealed record ChequeVisto(string AbiertoLocal, string Huella);

/// <summary>
/// El estado del lector de cheques (F1-022) en <c>cola.db</c>: el cursor sobre <c>cheques.folio</c>
/// y, por cada <c>folioSr</c>, la huella de lo último encolado. Los eventos mismos van a
/// <see cref="ColaLocal"/>; esto sólo decide si un cheque CAMBIÓ y hay que volver a encolarlo.
/// </summary>
/// <remarks>
/// Es estado PROPIO del agente: vive aquí, nunca en la base de SoftRestaurant (regla de oro). Tablas:
/// <c>cheques_vistos</c> y la marca del cursor en <c>agente_marcas</c> (la comparten catálogos y
/// existencias; todos la crean con <c>IF NOT EXISTS</c>).
/// </remarks>
internal sealed class ColaCheques
{
    internal const string MarcaUltimoFolio = "cheques.ultimo_folio";

    /// <summary>
    /// DECISION PROVISIONAL (nocturno): la huella de un cheque se olvida a los 90 días de no verlo.
    /// Sin esto la tabla crece sin tope; con esto, un numcheque reusado después de 90 días ya no se
    /// detecta aquí (esquema-sr §2, la decisión abierta sobre el reinicio de folios).
    /// </summary>
    public static readonly TimeSpan Retencion = TimeSpan.FromDays(90);

    private const string Esquema = """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cheques_vistos (
            folio_sr      TEXT PRIMARY KEY,
            abierto_local TEXT NOT NULL,
            huella        TEXT NOT NULL,
            visto_at      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agente_marcas (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
        """;

    private readonly string _cadena;
    private readonly TimeProvider _reloj;

    private ColaCheques(string ruta, TimeProvider reloj)
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

    public static ColaCheques Abrir(string ruta, TimeProvider reloj)
    {
        var carpeta = Path.GetDirectoryName(Path.GetFullPath(ruta));
        if (!string.IsNullOrEmpty(carpeta))
        {
            Directory.CreateDirectory(carpeta);
        }

        var cola = new ColaCheques(ruta, reloj);
        using var conexion = cola.Conectar();
        Ejecutar(conexion, null, Esquema);
        return cola;
    }

    /// <summary>El mayor <c>cheques.folio</c> ya leído; -1 si nunca se ha leído.</summary>
    public long UltimoFolio()
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = "SELECT valor FROM agente_marcas WHERE clave = $k;";
        comando.Parameters.AddWithValue("$k", MarcaUltimoFolio);
        return comando.ExecuteScalar() is string texto ? long.Parse(texto, CultureInfo.InvariantCulture) : -1;
    }

    public void GuardarUltimoFolio(long folio)
    {
        using var conexion = Conectar();
        Ejecutar(
            conexion, null,
            "INSERT INTO agente_marcas (clave, valor) VALUES ($k, $v) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor;",
            ("$k", MarcaUltimoFolio), ("$v", folio.ToString(CultureInfo.InvariantCulture)));
    }

    public ChequeVisto? Visto(string folioSr)
    {
        using var conexion = Conectar();
        using var comando = conexion.CreateCommand();
        comando.CommandText = "SELECT abierto_local, huella FROM cheques_vistos WHERE folio_sr = $f;";
        comando.Parameters.AddWithValue("$f", folioSr);
        using var lector = comando.ExecuteReader();
        return lector.Read() ? new ChequeVisto(lector.GetString(0), lector.GetString(1)) : null;
    }

    /// <summary>Anota lo que se acaba de encolar. Se llama DESPUÉS de <see cref="ColaLocal.Encolar"/>.</summary>
    public void GuardarVisto(string folioSr, ChequeVisto visto)
    {
        using var conexion = Conectar();
        Ejecutar(
            conexion, null,
            """
            INSERT INTO cheques_vistos (folio_sr, abierto_local, huella, visto_at) VALUES ($f, $a, $h, $n)
            ON CONFLICT (folio_sr) DO UPDATE SET abierto_local = excluded.abierto_local, huella = excluded.huella,
                visto_at = excluded.visto_at;
            """,
            ("$f", folioSr), ("$a", visto.AbiertoLocal), ("$h", visto.Huella), ("$n", Ahora()));
    }

    /// <summary>Renueva <c>visto_at</c> de lo que sigue apareciendo sin cambios, para que la retención no lo olvide.</summary>
    public void Tocar(IEnumerable<string> foliosSr)
    {
        using var conexion = Conectar();
        using var tx = conexion.BeginTransaction();
        var ahora = Ahora();
        foreach (var folio in foliosSr)
        {
            Ejecutar(conexion, tx, "UPDATE cheques_vistos SET visto_at = $n WHERE folio_sr = $f;", ("$n", ahora), ("$f", folio));
        }

        tx.Commit();
    }

    public int Purgar()
    {
        using var conexion = Conectar();
        return Ejecutar(
            conexion, null, "DELETE FROM cheques_vistos WHERE visto_at < $l;",
            ("$l", ColaLocal.Formatear(_reloj.GetUtcNow() - Retencion)));
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
}
