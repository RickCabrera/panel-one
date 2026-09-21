using ArkonAgente.Configuracion;

namespace ArkonAgente.Tests;

public class CargadorConfiguracionTests
{
    [Fact]
    public void Config_valida_se_carga_con_intervalo_por_defecto_de_30()
    {
        using var carpeta = new CarpetaTemporal();
        var ruta = carpeta.Escribir("config.json", Datos.Json());

        var r = CargadorConfiguracion.Cargar(ruta);

        Assert.True(r.Ok, string.Join("; ", r.Errores));
        Assert.Equal(new Uri("https://monitor.ejemplo.test"), r.Configuracion!.ApiUrl);
        Assert.Equal(Datos.ApiKey, r.Configuracion.ApiKey);
        Assert.Equal(Datos.Cadena, r.Configuracion.ConnectionString);
        Assert.Equal(30, r.Configuracion.IntervaloSegundos);
        Assert.Empty(r.Avisos);
    }

    [Fact]
    public void Intervalo_explicito_se_respeta()
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(intervalo: "45"), "config.json");
        Assert.Equal(45, r.Configuracion!.IntervaloSegundos);
    }

    [Fact]
    public void Tolera_comentarios_y_coma_final_porque_lo_edita_un_humano()
    {
        var json = "{\n // la del panel\n \"apiUrl\": \"https://m.test\",\n \"apiKey\": \"k\",\n" +
                   " \"connectionString\": \"Server=x;Database=y;User ID=u;Password=p\",\n}";
        Assert.True(CargadorConfiguracion.Interpretar(json, "config.json").Ok);
    }

    [Fact]
    public void Archivo_inexistente_dice_la_ruta_esperada()
    {
        using var carpeta = new CarpetaTemporal();
        var ruta = Path.Combine(carpeta.Ruta, "config.json");

        var r = CargadorConfiguracion.Cargar(ruta);

        Assert.False(r.Ok);
        var error = Assert.Single(r.Errores);
        Assert.Contains(ruta, error);
        Assert.Contains("plantilla", error);
    }

    [Fact]
    public void Json_roto_dice_la_linea_sin_citar_el_contenido()
    {
        var json = "{\n  \"apiKey\": \"" + Datos.ApiKey + "\"\n  \"apiUrl\": \"https://m.test\"\n}";

        var r = CargadorConfiguracion.Interpretar(json, "config.json");

        var error = Assert.Single(r.Errores);
        Assert.Contains("línea 3", error);
        Assert.DoesNotContain(Datos.ApiKey, error);
    }

    [Fact]
    public void La_raiz_debe_ser_un_objeto()
    {
        var r = CargadorConfiguracion.Interpretar("[1, 2]", "config.json");

        Assert.Contains("objeto JSON", Assert.Single(r.Errores));
    }

    [Theory]
    [InlineData("apiUrl")]
    [InlineData("apiKey")]
    [InlineData("connectionString")]
    public void Falta_un_campo_obligatorio(string campo)
    {
        var json = Datos.Json().Replace($"\"{campo}\"", "\"otro_" + campo + "\"");

        var r = CargadorConfiguracion.Interpretar(json, "config.json");

        Assert.False(r.Ok);
        Assert.Contains($"Falta el campo '{campo}'.", r.Errores);
        Assert.Contains(r.Avisos, a => a.Contains("otro_" + campo));
    }

    [Fact]
    public void Campos_vacios_o_de_otro_tipo_se_rechazan()
    {
        var vacio = CargadorConfiguracion.Interpretar(Datos.Json(apiKey: "   "), "c");
        Assert.Contains("El campo 'apiKey' está vacío.", vacio.Errores);

        var numero = CargadorConfiguracion.Interpretar(
            "{\"apiUrl\": 5, \"apiKey\": \"k\", \"connectionString\": \"Server=x;Database=y\"}", "c");
        Assert.Contains("El campo 'apiUrl' debe ser texto entre comillas.", numero.Errores);
    }

    [Fact]
    public void Reporta_todos_los_errores_juntos()
    {
        var r = CargadorConfiguracion.Interpretar("{\"intervaloSegundos\": 1}", "c");

        Assert.Equal(4, r.Errores.Count);
    }

    [Theory]
    [InlineData("http://monitor.ejemplo.test")]
    [InlineData("http://192.168.1.10:3000")]
    [InlineData("ftp://monitor.ejemplo.test")]
    [InlineData("monitor.ejemplo.test")]
    [InlineData("https://monitor.ejemplo.test/?x=1")]
    public void ApiUrl_invalida_o_http_fuera_de_localhost(string url)
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(apiUrl: url), "c");

        Assert.False(r.Ok);
        Assert.Contains(r.Errores, e => e.StartsWith("'apiUrl'", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("https://monitor.ejemplo.test")]
    [InlineData("https://monitor.ejemplo.test/api/")]
    [InlineData("http://localhost:3000")]
    [InlineData("http://127.0.0.1:3000")]
    [InlineData("http://[::1]:3000")]
    public void ApiUrl_aceptada(string url)
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(apiUrl: url), "c");

        Assert.True(r.Ok, string.Join("; ", r.Errores));
    }

    [Theory]
    [InlineData("4")]
    [InlineData("3601")]
    [InlineData("0")]
    [InlineData("-30")]
    public void Intervalo_fuera_de_rango(string valor)
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(intervalo: valor), "c");

        Assert.False(r.Ok);
        Assert.Contains(r.Errores, e => e.Contains("debe estar entre 5 y 3600"));
    }

    [Theory]
    [InlineData("\"30\"")]
    [InlineData("30.5")]
    public void Intervalo_que_no_es_entero(string valor)
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(intervalo: valor), "c");

        Assert.False(r.Ok);
        Assert.Contains(r.Errores, e => e.Contains("número entero"));
    }

    [Fact]
    public void Cadena_de_conexion_que_no_parsea_no_repite_el_password()
    {
        var cadena = "Server=x;Database=y;Password=" + Datos.Password + ";Clave Rara Sin Igual";

        var r = CargadorConfiguracion.Interpretar(Datos.Json(cadena: cadena), "c");

        Assert.False(r.Ok);
        Assert.Contains(r.Errores, e => e.Contains("no tiene el formato"));
        Assert.All(r.Errores, e => Assert.DoesNotContain(Datos.Password, e));
    }

    [Fact]
    public void Cadena_de_conexion_con_palabra_desconocida_no_repite_el_password()
    {
        var cadena = "Server=x;Database=y;Password=" + Datos.Password + ";Contrasenia=" + Datos.Password;

        var r = CargadorConfiguracion.Interpretar(Datos.Json(cadena: cadena), "c");

        Assert.False(r.Ok);
        Assert.All(r.Errores, e => Assert.DoesNotContain(Datos.Password, e));
    }

    [Fact]
    public void Cadena_sin_servidor_o_sin_base()
    {
        var sinBase = CargadorConfiguracion.Interpretar(Datos.Json(cadena: "Server=x;User ID=u;Password=p"), "c");
        Assert.Contains(sinBase.Errores, e => e.Contains("falta Database="));

        var sinServidor = CargadorConfiguracion.Interpretar(Datos.Json(cadena: "Database=y;User ID=u;Password=p"), "c");
        Assert.Contains(sinServidor.Errores, e => e.Contains("falta Server="));
    }

    [Fact]
    public void Ningun_error_ni_aviso_contiene_secretos()
    {
        // Los caminos de error, con los secretos presentes en el archivo.
        var casos = new[]
        {
            Datos.Json(apiUrl: "http://lejos.test"),
            Datos.Json(intervalo: "1"),
            Datos.Json(cadena: "Password=" + Datos.Password),
            Datos.Json(cadena: "Server=x;Password=" + Datos.Password + ";=roto"),
            "{ \"apiKey\": \"" + Datos.ApiKey + "\" \"x\": 1 }",
            "[\"" + Datos.ApiKey + "\"]",
            "{ \"apiKey\": \"" + Datos.ApiKey + "\", \"extra\": \"" + Datos.Password + "\" }",
        };

        foreach (var json in casos)
        {
            var r = CargadorConfiguracion.Interpretar(json, "c");
            Assert.NotEmpty(r.Errores);
            foreach (var m in r.Errores.Concat(r.Avisos))
            {
                Assert.DoesNotContain(Datos.ApiKey, m);
                Assert.DoesNotContain(Datos.Password, m);
            }
        }
    }

    [Fact]
    public void La_plantilla_versionada_es_una_config_valida()
    {
        // infra/config.example.json: si la plantilla no pasa el cargador, el técnico que
        // la copia arranca con un error que no es suyo.
        var carpeta = new DirectoryInfo(AppContext.BaseDirectory);
        while (carpeta is not null && !File.Exists(Path.Combine(carpeta.FullName, "infra", "config.example.json")))
        {
            carpeta = carpeta.Parent;
        }

        Assert.NotNull(carpeta);
        var r = CargadorConfiguracion.Cargar(Path.Combine(carpeta.FullName, "infra", "config.example.json"));

        Assert.True(r.Ok, string.Join("; ", r.Errores));
        Assert.Empty(r.Avisos);
        Assert.Equal(30, r.Configuracion!.IntervaloSegundos);
        Assert.Equal(Uri.UriSchemeHttps, r.Configuracion.ApiUrl.Scheme);
        Assert.False(new Sql.ConexionSoftRestaurant(r.Configuracion.ConnectionString).UsaAutenticacionWindows);
    }

    [Fact]
    public void ToString_de_la_config_no_trae_secretos()
    {
        var texto = Datos.Config().ToString();

        Assert.DoesNotContain(Datos.ApiKey, texto);
        Assert.DoesNotContain(Datos.Password, texto);
    }
}
