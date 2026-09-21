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
