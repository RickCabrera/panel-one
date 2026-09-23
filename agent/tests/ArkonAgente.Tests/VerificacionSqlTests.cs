using System.Diagnostics;
using ArkonAgente.Diagnostico;
using ArkonAgente.Sql;

namespace ArkonAgente.Tests;

public class VerificacionSqlTests
{
    private static readonly ConexionSoftRestaurant Conexion = new(Datos.Cadena);

    private static FilaDiagnostico SoloLectura() => new(
        "15.0.2000.5", "Express Edition (64-bit)", "softrestaurant", "lector",
        EsSysadmin: false, EsDbOwner: false, EsDbDatawriter: false, EsDbDdladmin: false,
        PuedeInsert: false, PuedeUpdate: false, PuedeDelete: false, PuedeAlter: false, PuedeCreateTable: false,
        DboPuedeInsert: false, DboPuedeUpdate: false, DboPuedeDelete: false, DboPuedeAlter: false);

    [Fact]
    public void Usuario_de_solo_lectura_es_OK()
    {
        var r = VerificacionSql.Evaluar(SoloLectura(), Conexion, []);

        Assert.True(r.Ok, r.Detalle);
        Assert.Contains("Sin permisos de escritura a nivel servidor, base ni esquema dbo", r.Detalle);
        Assert.Contains("servidor=127.0.0.1\\SQLEXPRESS", r.Detalle);
        Assert.DoesNotContain(Datos.Password, r.Detalle);
    }

    private static FilaDiagnostico ConPermiso(string permiso) => permiso switch
    {
        "sysadmin" => SoloLectura() with { EsSysadmin = true },
        "db_owner" => SoloLectura() with { EsDbOwner = true },
        "db_datawriter" => SoloLectura() with { EsDbDatawriter = true },
        "db_ddladmin" => SoloLectura() with { EsDbDdladmin = true },
        "INSERT" => SoloLectura() with { PuedeInsert = true },
        "UPDATE" => SoloLectura() with { PuedeUpdate = true },
        "DELETE" => SoloLectura() with { PuedeDelete = true },
        "ALTER" => SoloLectura() with { PuedeAlter = true },
        "CREATE TABLE" => SoloLectura() with { PuedeCreateTable = true },
        "INSERT en el esquema dbo" => SoloLectura() with { DboPuedeInsert = true },
        "UPDATE en el esquema dbo" => SoloLectura() with { DboPuedeUpdate = true },
        "DELETE en el esquema dbo" => SoloLectura() with { DboPuedeDelete = true },
        "ALTER en el esquema dbo" => SoloLectura() with { DboPuedeAlter = true },
        _ => throw new ArgumentOutOfRangeException(nameof(permiso)),
    };

    [Theory]
    [InlineData("sysadmin")]
    [InlineData("db_owner")]
    [InlineData("db_datawriter")]
    [InlineData("db_ddladmin")]
    [InlineData("INSERT")]
    [InlineData("UPDATE")]
    [InlineData("DELETE")]
    [InlineData("ALTER")]
    [InlineData("CREATE TABLE")]
    [InlineData("INSERT en el esquema dbo")]
    [InlineData("UPDATE en el esquema dbo")]
    [InlineData("DELETE en el esquema dbo")]
    [InlineData("ALTER en el esquema dbo")]
    public void Usuario_que_puede_escribir_es_FALLA_aunque_conecte(string permiso)
    {
        var r = VerificacionSql.Evaluar(ConPermiso(permiso), Conexion, []);

        Assert.False(r.Ok);
        Assert.Contains("permisos de escritura", r.Detalle);
        Assert.Contains(permiso, r.Detalle);
        Assert.Contains("SOLO LECTURA", r.Sugerencia);
    }

    [Fact]
    public void Un_GRANT_de_escritura_sobre_una_tabla_que_lee_el_agente_es_FALLA()
    {
        var r = VerificacionSql.Evaluar(
            SoloLectura() with { ObjEscrituraTotal = 3, ObjEscrituraEjemplo = "dbo.productos: UPDATE" }, Conexion, []);

        Assert.False(r.Ok);
        Assert.Contains("permiso por tabla (dbo.productos: UPDATE y 2 permiso(s) más)", r.Detalle);
        Assert.Contains("SOLO LECTURA", r.Sugerencia);
    }

    [Fact]
    public void Sin_GRANT_por_tabla_el_OK_dice_que_tambien_se_revisaron_las_tablas()
    {
        var r = VerificacionSql.Evaluar(SoloLectura(), Conexion, []);

        Assert.Contains("ni sobre las tablas de SoftRestaurant que lee el agente", r.Detalle);
    }

    [Fact]
    public void La_fila_del_diagnostico_lee_los_permisos_por_tabla()
    {
        var tabla = new System.Data.DataTable();
        foreach (var c in new[] { "version_producto", "edicion", "base_datos", "login_sql", "obj_escritura_ejemplo" })
        {
            tabla.Columns.Add(c, typeof(string));
        }

        foreach (var c in new[]
                 {
                     "es_sysadmin", "es_db_owner", "es_db_datawriter", "es_db_ddladmin", "puede_insert", "puede_update",
                     "puede_delete", "puede_alter", "puede_create_table", "dbo_puede_insert", "dbo_puede_update",
                     "dbo_puede_delete", "dbo_puede_alter", "obj_escritura_total",
                 })
        {
            tabla.Columns.Add(c, typeof(int));
        }

        var fila = tabla.NewRow();
        fila["version_producto"] = "12.0"; fila["edicion"] = "Express"; fila["base_datos"] = "sr"; fila["login_sql"] = "lector";
        foreach (System.Data.DataColumn c in tabla.Columns)
        {
            if (c.DataType == typeof(int)) fila[c] = 0;
        }

        fila["obj_escritura_total"] = 1;
        fila["obj_escritura_ejemplo"] = "dbo.clientes: DELETE";
        tabla.Rows.Add(fila);
        using var lector = tabla.CreateDataReader();
        lector.Read();

        var leida = FilaDiagnostico.Leer(lector);

        Assert.Equal(["permiso por tabla (dbo.clientes: DELETE)"], leida.PermisosDeEscritura());
    }

    [Fact]
    public void Certificado_no_confiable_en_Windows_en_espanol_sugiere_TrustServerCertificate()
    {
        // Número y texto reales de SqlClient 5.2.3 contra SQL Server 2014 Express (SR 10)
        // sin TrustServerCertificate, en un Windows en español (F1-021).
        const string mensaje =
            "La conexión con el servidor se ha establecido correctamente, pero se ha producido un error durante el " +
            "proceso de inicio de sesión. (provider: Proveedor de SSL, error: 0 - La cadena de certificación fue " +
            "emitida por una entidad en la que no se confía.)";

        var (detalle, sugerencia) = VerificacionSql.ClasificarError(-2146893019, mensaje, Conexion);

        Assert.Contains("certificado TLS no es de confianza", detalle);
        Assert.Contains("TrustServerCertificate=True", sugerencia);
    }

    [Theory]
    [InlineData(-2146893019, "texto que no se entiende")] // sólo el número
    [InlineData(0, "The certificate chain was issued by an authority that is not trusted.")]
    [InlineData(0, "La cadena de certificación fue emitida por una entidad en la que no se confía.")]
    public void El_certificado_se_reconoce_por_numero_o_por_texto(int numero, string mensaje)
    {
        Assert.Contains("TrustServerCertificate", VerificacionSql.ClasificarError(numero, mensaje, Conexion).Sugerencia);
    }

    [Theory]
    [InlineData(229, "permiso de lectura", "db_datareader")]
    [InlineData(18456, "usuario o la contraseña", "User ID")]
    [InlineData(4060, "no pudo abrir la base", "'Database'")]
    [InlineData(10054, "No se pudo llegar al servidor SQL", "TCP/IP")]
    public void Cada_numero_de_error_tiene_su_mensaje(int numero, string enDetalle, string enSugerencia)
    {
        var (detalle, sugerencia) = VerificacionSql.ClasificarError(numero, "error", Conexion);

        Assert.Contains(enDetalle, detalle);
        Assert.Contains(enSugerencia, sugerencia);
        Assert.DoesNotContain(Datos.Password, detalle);
    }

    [Fact]
    public async Task Servidor_inalcanzable_falla_rapido_y_dice_que_no_llego()
    {
        // tcp: explícito para que SqlClient no intente Named Pipes en Windows.
        var conexion = new ConexionSoftRestaurant(
            "Data Source=tcp:127.0.0.1,1;Database=softrestaurant;User ID=lector;Password=" + Datos.Password +
            ";Connect Timeout=2;Encrypt=False");
        var reloj = Stopwatch.StartNew();

        var r = await new VerificacionSql(conexion).VerificarAsync(CancellationToken.None);

        reloj.Stop();
        Assert.False(r.Ok);
        Assert.Contains("No se pudo llegar al servidor SQL", r.Detalle);
        Assert.DoesNotContain(Datos.Password, r.Detalle);
        Assert.DoesNotContain(Datos.Password, r.Sugerencia ?? "");
        Assert.True(reloj.Elapsed < TimeSpan.FromSeconds(10), $"tardó {reloj.Elapsed}");
    }

    [Fact]
    public async Task Autenticacion_de_windows_deja_aviso()
    {
        var conexion = new ConexionSoftRestaurant(
            "Data Source=tcp:127.0.0.1,1;Database=y;Integrated Security=True;Connect Timeout=1;Encrypt=False");

        var r = await new VerificacionSql(conexion).VerificarAsync(CancellationToken.None);

        Assert.Contains(VerificacionSql.AvisoAutenticacionWindows, r.AvisosOVacio);
    }
}
