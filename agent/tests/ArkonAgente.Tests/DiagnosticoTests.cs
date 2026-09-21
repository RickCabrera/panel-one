using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;

namespace ArkonAgente.Tests;

public class DiagnosticoTests
{
    private static readonly ResultadoConfiguracion ConfigOk = new(Datos.Config(), [], []);

    private static Task<ReporteDiagnostico> Correr(ResultadoConfiguracion config, params IVerificacion[] verificaciones) =>
        Diagnosticador.EjecutarAsync("C:\\cfg\\config.json", config, _ => verificaciones, CancellationToken.None);

    [Fact]
    public async Task Las_dos_bien_es_codigo_0()
    {
        var reporte = await Correr(ConfigOk, new VerificacionFija("SQL", true), new VerificacionFija("API", true));

        Assert.Equal(0, reporte.CodigoSalida);
        Assert.Equal("Resultado: OK. Las dos conexiones funcionan.", reporte.Conclusion());
    }

    [Fact]
    public async Task Falla_la_primera_y_aun_asi_se_prueba_la_segunda()
    {
        var sql = new VerificacionFija("SQL Server (SoftRestaurant)", false);
        var api = new VerificacionFija("API del monitor", true);

        var reporte = await Correr(ConfigOk, sql, api);

        Assert.Equal(1, api.Llamadas);
        Assert.Equal(1, reporte.CodigoSalida);
        Assert.Equal("Resultado: FALLA la conexión a SQL Server (SoftRestaurant). La otra funciona.", reporte.Conclusion());
        var texto = reporte.ComoTexto();
        Assert.Contains("[FALLA] SQL Server (SoftRestaurant): no funciona", texto);
        Assert.Contains("Qué hacer: arréglalo", texto);
        Assert.Contains("[OK]    API del monitor: funciona", texto);
    }

    [Fact]
    public async Task Falla_solo_el_api()
    {
        var reporte = await Correr(ConfigOk, new VerificacionFija("SQL", true), new VerificacionFija("API", false));

        Assert.Equal(1, reporte.CodigoSalida);
        Assert.Equal("Resultado: FALLA la conexión a API. La otra funciona.", reporte.Conclusion());
    }

    [Fact]
    public async Task Fallan_las_dos_y_las_nombra()
    {
        var reporte = await Correr(ConfigOk, new VerificacionFija("SQL", false), new VerificacionFija("API", false));

        Assert.Equal(1, reporte.CodigoSalida);
        Assert.Equal("Resultado: FALLAN las dos conexiones: SQL y API.", reporte.Conclusion());
    }

    [Fact]
    public async Task Config_invalida_es_codigo_2_y_no_prueba_nada()
    {
        var sql = new VerificacionFija("SQL", true);
        var invalida = new ResultadoConfiguracion(null, ["Falta el campo 'apiKey'."], []);

        var reporte = await Correr(invalida, sql);

        Assert.Equal(0, sql.Llamadas);
        Assert.Equal(2, reporte.CodigoSalida);
        var texto = reporte.ComoTexto();
        Assert.Contains("[FALLA] Configuración: C:\\cfg\\config.json", texto);
        Assert.Contains("- Falta el campo 'apiKey'.", texto);
        Assert.Contains("no se probó ninguna conexión", texto);
    }

    [Fact]
    public async Task Una_verificacion_que_truena_no_impide_la_otra_ni_filtra_su_mensaje()
    {
        var api = new VerificacionFija("API", true);

        var reporte = await Correr(ConfigOk, new VerificacionQueTruena("SQL"), api);

        Assert.Equal(1, api.Llamadas);
        Assert.Equal(1, reporte.CodigoSalida);
        Assert.Contains("InvalidCastException", reporte.ComoTexto());
        Assert.DoesNotContain(Datos.Password, reporte.ComoTexto());
    }

    [Fact]
    public async Task Los_avisos_se_imprimen()
    {
        var conAvisos = new ResultadoConfiguracion(Datos.Config(), [], ["Campo desconocido 'x'"]);
        var sql = new AvisoFijo();

        var texto = (await Correr(conAvisos, sql)).ComoTexto();

        Assert.Contains("Aviso: Campo desconocido 'x'", texto);
        Assert.Contains("Aviso: usa usuario SQL", texto);
    }

    [Fact]
    public void Las_verificaciones_reales_son_sql_y_api_en_ese_orden()
    {
        var v = Diagnosticador.VerificacionesPara(Datos.Config());

        Assert.Collection(v,
            x => Assert.IsType<VerificacionSql>(x),
            x => Assert.IsType<VerificacionApi>(x));
    }

    private sealed class AvisoFijo : IVerificacion
    {
        public string Nombre => "SQL";

        public Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion) =>
            Task.FromResult(ResultadoVerificacion.Bien(Nombre, "ok", ["usa usuario SQL"]));
    }
}

public class LineaDeComandosTests
{
    [Fact]
    public async Task Test_usa_config_json_de_la_carpeta_y_devuelve_el_codigo_del_reporte()
    {
        using var carpeta = new CarpetaTemporal();
        string? leida = null;
        var salida = new StringWriter();

        var codigo = await LineaDeComandos.EjecutarAsync(
            ["test"], carpeta.Rutas, salida,
            ruta => { leida = ruta; return new ResultadoConfiguracion(Datos.Config(), [], []); },
            _ => [new VerificacionFija("SQL", false), new VerificacionFija("API", true)],
            CancellationToken.None);

        Assert.Equal(Path.Combine(carpeta.Ruta, "config.json"), leida);
        Assert.Equal(1, codigo);
        Assert.Contains("FALLA la conexión a SQL", salida.ToString());
    }

    [Fact]
    public async Task Test_con_config_explicita()
    {
        using var carpeta = new CarpetaTemporal();
        var otra = carpeta.Escribir("otra.json", Datos.Json());
        string? leida = null;

        var codigo = await LineaDeComandos.EjecutarAsync(
            ["test", "--config", otra], new RutasAgente("C:\\no\\existe"), new StringWriter(),
            ruta => { leida = ruta; return new ResultadoConfiguracion(Datos.Config(), [], []); },
            _ => [new VerificacionFija("SQL", true), new VerificacionFija("API", true)],
            CancellationToken.None);

        Assert.Equal(otra, leida);
        Assert.Equal(0, codigo);
    }

    [Fact]
    public async Task Test_real_sin_config_es_codigo_2()
    {
        using var carpeta = new CarpetaTemporal();
        var salida = new StringWriter();

        var codigo = await LineaDeComandos.EjecutarAsync(["test"], carpeta.Rutas, salida);

        Assert.Equal(2, codigo);
        Assert.Contains("No existe el archivo de configuración", salida.ToString());
    }

    [Theory]
    [InlineData("otro")]
    [InlineData("test", "--config")]
    [InlineData("test", "--nada", "x")]
    public async Task Comando_desconocido_muestra_uso_y_codigo_64(params string[] args)
    {
        var salida = new StringWriter();

        var codigo = await LineaDeComandos.EjecutarAsync(args, new RutasAgente("x"), salida);

        Assert.Equal(64, codigo);
        Assert.Contains("Uso:", salida.ToString());
    }

    [Fact]
    public async Task Ayuda()
    {
        var salida = new StringWriter();

        Assert.Equal(0, await LineaDeComandos.EjecutarAsync(["--help"], new RutasAgente("x"), salida));
        Assert.Contains("agente.exe test", salida.ToString());
    }
}
