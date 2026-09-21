using System.Diagnostics;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;

namespace ArkonAgente.Tests;

public class VersionSrTests
{
    [Theory]
    [InlineData("10.021800", 10)] // el valor visto en SR 10.0.323 (docs/esquema-sr.md §1)
    [InlineData("10", 10)]
    [InlineData("11.000100", 11)]
    [InlineData(" 10.5 ", 10)]
    [InlineData("9.99", 9)]
    [InlineData("12.0", 12)]
    public void Interpreta_la_parte_entera_como_version_mayor(string texto, int mayor)
    {
        var v = VersionSr.Interpretar(texto);

        Assert.NotNull(v);
        Assert.Equal(mayor, v.Mayor);
        Assert.Equal(texto.Trim(), v.Texto); // el texto se conserva tal cual, sin redondear
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("0")] // parametros.versiondb vale '0' en SR 10: no es una versión
    [InlineData("0.5")]
    [InlineData("-10")]
    [InlineData("10,5")]
    [InlineData("v10")]
    [InlineData("10.0.323")]
    [InlineData("1e3")]
    [InlineData("99999999999")]
    public void Lo_que_no_se_entiende_no_se_adivina(string? texto)
    {
        Assert.Null(VersionSr.Interpretar(texto));
    }
}

public class SelectorReaderTests
{
    private static readonly string[] Nucleo = ["cheques", "cheqdet", "chequespagos", "tempcheques", "tempcheqdet"];

    private static HuellaSr Huella(string?[] versiones, IEnumerable<string>? tablas = null, bool tieneVersionDb = true)
    {
        var filas = (tablas ?? Nucleo).Select(t => (t, false)).ToList();
        if (tieneVersionDb)
        {
            filas.Add(("parametros2", true));
        }

        return HuellaSr.Desde("softrestaurant10", filas, versiones);
    }

    [Fact]
    public void SR_10_como_la_instalacion_vista_elige_SrV11Reader_sin_aviso()
    {
        var r = SelectorReader.Elegir(Huella(["10.021800"]));

        Assert.Equal(EstadoDeteccion.Soportada, r.Estado);
        var reader = Assert.IsType<SrV11Reader>(r.Reader);
        Assert.Equal("SrV11Reader", reader.Nombre);
        Assert.Equal(10, reader.Version.Mayor);
        Assert.Equal("10.021800", r.VersionSr);
        Assert.Null(r.Error);
        Assert.Null(r.Aviso);
    }

    [Fact]
    public void SR_11_se_lee_pero_avisa_que_no_esta_validada()
    {
        var r = SelectorReader.Elegir(Huella(["11.000100"]));

        Assert.Equal(EstadoDeteccion.Soportada, r.Estado);
        Assert.IsType<SrV11Reader>(r.Reader);
        Assert.Equal("11.000100", r.VersionSr);
        Assert.Contains("no se ha validado", r.Aviso);
        Assert.Contains("esquema-sr.md", r.Aviso);
    }

    [Theory]
    [InlineData("9.500000")]
    [InlineData("12.000000")]
    public void Version_fuera_de_10_y_11_no_se_soporta_pero_se_reporta(string version)
    {
        var r = SelectorReader.Elegir(Huella([version]));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Null(r.Reader);
        Assert.Equal(version, r.VersionSr); // el heartbeat dice qué versión encontró
        Assert.Contains($"versión {version} no soportada", r.Error);
        Assert.Contains("10 y 11", r.Error);
        Assert.Contains("softrestaurant10", r.Error);
    }

    [Fact]
    public void Base_sin_parametros2_ni_tablas_de_cuentas_da_las_tres_causas()
    {
        var r = SelectorReader.Elegir(Huella([], tablas: [], tieneVersionDb: false));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Null(r.VersionSr);
        Assert.Contains("ni las tablas de cuentas", r.Error);
        Assert.Contains("'Database'", r.Error);
        Assert.Contains("db_datareader", r.Error);
        Assert.Contains("versión de SoftRestaurant que el agente no conoce", r.Error);
    }

    [Fact]
    public void Con_tablas_de_cuentas_pero_sin_versiondb_no_se_soporta()
    {
        var r = SelectorReader.Elegir(Huella([], tieneVersionDb: false));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Contains("No se encontró dbo.parametros2.versiondb en la base", r.Error);
        Assert.DoesNotContain("ni las tablas de cuentas", r.Error);
    }

    [Fact]
    public void Parametros2_sin_la_columna_versiondb_cuenta_como_sin_version()
    {
        var huella = HuellaSr.Desde("sr", Nucleo.Select(t => (t, false)).Append(("parametros2", false)), []);

        Assert.False(huella.TieneVersionDb);
        Assert.Equal(EstadoDeteccion.NoSoportada, SelectorReader.Elegir(huella).Estado);
    }

    [Fact]
    public void Otra_tabla_con_versiondb_no_cuenta()
    {
        // configuracion y parametros también tienen versiondb en SR 10, y no son la versión.
        var huella = HuellaSr.Desde("sr", [("configuracion", true), ("parametros", true)], []);

        Assert.False(huella.TieneVersionDb);
    }

    [Fact]
    public void Los_nombres_se_comparan_exactos()
    {
        var huella = HuellaSr.Desde("sr", [("Parametros2", true)], ["10.0"]);

        Assert.False(huella.TieneVersionDb);
        Assert.DoesNotContain("parametros2", huella.TablasPresentes);
    }

    [Fact]
    public void Parametros2_vacia_no_se_soporta()
    {
        var r = SelectorReader.Elegir(Huella([]));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Contains("está vacía", r.Error);
    }

    [Fact]
    public void Varias_filas_con_la_misma_version_no_son_ambiguas()
    {
        var r = SelectorReader.Elegir(Huella(["10.021800", "10.021800"]));

        Assert.Equal(EstadoDeteccion.Soportada, r.Estado);
        Assert.Equal("10.021800", r.VersionSr);
    }

    [Fact]
    public void Varias_filas_con_versiones_distintas_no_se_eligen_al_azar()
    {
        var r = SelectorReader.Elegir(Huella(["10.021800", "11.000000"]));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Null(r.Reader);
        Assert.Contains("versiones distintas", r.Error);
    }

    [Theory]
    [InlineData(null, "NULL")]
    [InlineData("0", "'0'")]
    [InlineData("abc", "'abc'")]
    public void Version_ilegible_no_se_soporta_y_dice_que_valor_vio(string? valor, string mostrado)
    {
        var r = SelectorReader.Elegir(Huella([valor]));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Null(r.VersionSr);
        Assert.Contains($"versiondb vale {mostrado}", r.Error);
    }

    [Fact]
    public void Version_soportada_sin_tablas_nucleo_lista_las_que_faltan()
    {
        var r = SelectorReader.Elegir(Huella(["10.021800"], tablas: ["cheques", "cheqdet"]));

        Assert.Equal(EstadoDeteccion.NoSoportada, r.Estado);
        Assert.Equal("10.021800", r.VersionSr);
        Assert.Contains("dbo.chequespagos, dbo.tempcheques, dbo.tempcheqdet", r.Error);
        Assert.DoesNotContain("dbo.cheques,", r.Error);
    }

    [Fact]
    public void Un_valor_enorme_de_la_base_no_revienta_el_mensaje()
    {
        var r = SelectorReader.Elegir(Huella([new string('x', 5000)]));

        Assert.True(r.Error!.Length <= ResultadoDeteccion.LargoMaximoError);
        Assert.Contains("'" + new string('x', 40) + "…'", r.Error);
    }

    [Fact]
    public void El_resultado_se_acota_a_lo_que_acepta_el_heartbeat()
    {
        var r = ResultadoDeteccion.NoSoportada(new string('e', 3000), new string('v', 80));

        Assert.Equal(ResultadoDeteccion.LargoMaximoError, r.Error!.Length);
        Assert.Equal(ResultadoDeteccion.LargoMaximoVersion, r.VersionSr!.Length);
        Assert.EndsWith("…", r.Error);
    }
}

public class DetectorVersionSrTests
{
    [Fact]
    public async Task Servidor_inalcanzable_es_SinConexion_sin_secretos_y_sin_excepcion()
    {
        var conexion = new ConexionSoftRestaurant(
            "Data Source=tcp:127.0.0.1,1;Database=softrestaurant;User ID=lector;Password=" + Datos.Password +
            ";Connect Timeout=2;Encrypt=False");
        var reloj = Stopwatch.StartNew();

        var r = await new DetectorVersionSr(conexion).DetectarAsync(CancellationToken.None);

        reloj.Stop();
        Assert.Equal(EstadoDeteccion.SinConexion, r.Estado);
        Assert.Null(r.Reader);
        Assert.Null(r.VersionSr);
        Assert.StartsWith("No se pudo detectar la versión de SoftRestaurant.", r.Error);
        Assert.Contains("No se pudo llegar al servidor SQL", r.Error);
        Assert.DoesNotContain(Datos.Password, r.Error);
        Assert.True(reloj.Elapsed < TimeSpan.FromSeconds(10), $"tardó {reloj.Elapsed}");
    }

    [Fact]
    public async Task La_cancelacion_del_servicio_si_se_propaga()
    {
        var conexion = new ConexionSoftRestaurant(
            "Data Source=tcp:127.0.0.1,1;Database=sr;User ID=lector;Password=x;Connect Timeout=5;Encrypt=False");
        using var cancelado = new CancellationTokenSource();
        cancelado.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new DetectorVersionSr(conexion).DetectarAsync(cancelado.Token));
    }
}

public class CrearComandoTests
{
    [Theory]
    [InlineData("diagnostico")]
    [InlineData("sr_estructura")]
    [InlineData("sr_version")]
    public void Toda_consulta_sale_con_el_texto_embebido_y_el_timeout_corto(string consulta)
    {
        using var conexion = new ConexionSoftRestaurant(Datos.Cadena).CrearConexion();

        using var comando = ConexionSoftRestaurant.CrearComando(conexion, consulta);

        Assert.Equal(ConsultasEmbebidas.Leer(consulta), comando.CommandText);
        Assert.Equal(ConexionSoftRestaurant.TimeoutComandoSegundos, comando.CommandTimeout);
        Assert.Equal(System.Data.CommandType.Text, comando.CommandType);
    }

    [Fact]
    public void La_base_sale_de_la_cadena()
    {
        Assert.Equal("softrestaurant", new ConexionSoftRestaurant(Datos.Cadena).BaseDatos);
    }
}
