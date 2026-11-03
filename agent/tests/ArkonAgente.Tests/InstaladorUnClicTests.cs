using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using ArkonAgente.Configuracion;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Tests;

/// <summary>
/// El instalador de un clic: las funciones nuevas de <c>funciones-instalador.ps1</c> (código de
/// enlace, contraseña aleatoria, sqlcmd, canje contra un API falso), el <c>.cmd</c> y el
/// empaquetador. Corren PowerShell de verdad, como <see cref="InstaladorPs1Tests"/>: sin
/// PowerShell FALLAN, no se saltan.
/// </summary>
/// <remarks>
/// Lo que NO se prueba aquí (necesita un Windows con SQL Server y consola de administrador): la
/// elevación del <c>.cmd</c>, la detección de instancias por servicio, crear el login de verdad,
/// registrar los servicios. Eso se prueba en la PC de Ricardo (ver el PR).
/// </remarks>
public class InstaladorUnClicTests
{
    private static List<string> Ps(string cuerpo) => InstaladorPs1Tests.CorrerPowerShell(cuerpo);

    private const string ConsultaBases =
        "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name;";

    // --- El bug de sqlcmd: argumentos exactos, nunca uno vacío ---------------------------------

    [Fact]
    public void Los_argumentos_de_sqlcmd_son_un_arreglo_exacto_y_un_vacio_truena()
    {
        var salida = Ps("""
            $a = Get-ArgumentosSqlcmd -Servidor '.\NATIONALSOFT' -UsuarioAdmin '' -Extra @('-b', '-Q', 'SELECT 1')
            "N|$($a.Count)|$($a.GetType().Name)"
            $a | ForEach-Object { "A|[$_]" }
            $b = Get-ArgumentosSqlcmd -Servidor '.\NATIONALSOFT' -UsuarioAdmin 'sa' -Extra @('-b')
            $b | ForEach-Object { "B|[$_]" }
            $c = Get-ArgumentosSqlcmd -Servidor '.'
            "C|$($c.Count)|$($c -join ' ')"
            try { Get-ArgumentosSqlcmd -Servidor '.' -Extra @('-b', '', '-W') | Out-Null; 'SIN ERROR' } catch { "ERROR|$($_.Exception.Message)" }
            try { Get-ArgumentosSqlcmd -Servidor '.' -Extra @('-b', ' ') | Out-Null; 'SIN ERROR' } catch { "ERROR|$($_.Exception.Message)" }
            """);

        Assert.Equal(
            [
                "N|6|String[]",
                "A|[-S]", @"A|[.\NATIONALSOFT]", "A|[-E]", "A|[-b]", "A|[-Q]", "A|[SELECT 1]",
                "B|[-S]", @"B|[.\NATIONALSOFT]", "B|[-U]", "B|[sa]", "B|[-b]",
                "C|3|-S . -E",
                "ERROR|Argumento vacío para sqlcmd después de '-b'.",
                "ERROR|Argumento vacío para sqlcmd después de '-b'.",
            ],
            salida);
    }

    [Fact]
    public void Con_autenticacion_de_Windows_sqlcmd_recibe_exactamente_sus_argumentos_sin_uno_en_blanco()
    {
        // El bug: crear-usuario-lector.ps1 sin -UsuarioAdmin le pasaba a sqlcmd un argumento en
        // blanco ("Sqlcmd: ' ': Unknown Option"). Aquí corre un sqlcmd FALSO que anota lo que
        // recibe, a través de la misma función que usa el script.
        using var carpeta = new CarpetaTemporal();
        var registro = Path.Combine(carpeta.Ruta, "args.txt");
        var falso = CrearSqlcmdFalso(carpeta.Ruta);

        var salida = Ps($$"""
            $env:YC_ARGS_FILE = '{{registro}}'
            $env:YC_SALIDA = '0'
            $bases = Get-BasesSql -Sqlcmd '{{falso}}' -Servidor '.\NATIONALSOFT' -UsuarioAdmin ''
            "N|$($bases.Count)"
            $bases | ForEach-Object { "B|$_" }
            """);

        Assert.Equal(["N|2", "B|softrestaurant10", "B|OtraBase"], salida);
        if (OperatingSystem.IsWindows())
        {
            Assert.Equal($"-S .\\NATIONALSOFT -E -b -l 10 -t 10 -h -1 -W -Q \"{ConsultaBases}\"", File.ReadAllText(registro).Trim());
        }
        else
        {
            Assert.Equal(
                ["-S", @".\NATIONALSOFT", "-E", "-b", "-l", "10", "-t", "10", "-h", "-1", "-W", "-Q", ConsultaBases],
                File.ReadAllLines(registro));
        }
    }

    [Fact]
    public void Crear_el_lector_pasa_contrasena_y_base_por_entorno_y_las_borra_al_terminar()
    {
        using var carpeta = new CarpetaTemporal();
        var registro = Path.Combine(carpeta.Ruta, "args.txt");
        var falso = CrearSqlcmdFalso(carpeta.Ruta);
        var sql = Instalador.Ruta("crear-usuario-lector.sql");

        var salida = Ps($$"""
            $env:YC_ARGS_FILE = '{{registro}}'
            $env:YC_SALIDA = '0'
            $r = Invoke-CrearLectorSql -Sqlcmd '{{falso}}' -ArchivoSql '{{sql}}' -Servidor '.\NATIONALSOFT' -Base 'softrestaurant10' -Password 'Prueba-12345abc' -UsuarioAdmin 'sa'
            "R|$($r.Codigo)"
            "E|$([bool] $env:PASSWORD_LECTOR)|$([bool] $env:BASE_SR)"
            # Lo que vio el sqlcmd falso, antes de que la llamada de abajo lo sobrescriba.
            Copy-Item -LiteralPath '{{registro}}' -Destination '{{registro}}.lector'
            Copy-Item -LiteralPath '{{registro}}.env' -Destination '{{registro}}.lector.env'
            $env:YC_SALIDA = '1'
            try { Get-BasesSql -Sqlcmd '{{falso}}' -Servidor '.' -UsuarioAdmin '' | Out-Null; 'SIN ERROR' } catch { "F|$($_.Exception.Message)" }
            # El sqlcmd falso salió con 1 a propósito; el script de prueba no debe heredar ese código.
            $global:LASTEXITCODE = 0
            """);

        Assert.Equal("R|0", salida[0]);
        Assert.Equal("E|False|False", salida[1]);
        Assert.StartsWith("F|No se pudo entrar al SQL Server '.'", salida[2]);
        Assert.Equal("softrestaurant10|Prueba-12345abc", File.ReadAllText(registro + ".lector.env").Trim());
        if (!OperatingSystem.IsWindows())
        {
            // La contraseña de sa nunca va en la línea de comando (sqlcmd la toma de SQLCMDPASSWORD),
            // ni la del lector.
            Assert.Equal(["-S", @".\NATIONALSOFT", "-U", "sa", "-b", "-l", "10", "-t", "30", "-i", sql], File.ReadAllLines(registro + ".lector"));
        }
    }

    [Fact]
    public void Los_scripts_no_ponen_contrasenas_en_la_linea_de_comando_de_sqlcmd()
    {
        foreach (var archivo in new[] { "instalar-un-clic.ps1", "funciones-instalador.ps1", "crear-usuario-lector.ps1" })
        {
            var texto = Instalador.LeerTexto(archivo);
            Assert.DoesNotMatch(@"'-P'", texto);
            Assert.DoesNotContain("@acceso", texto.Split('\n').Where(l => !l.TrimStart().StartsWith('#')).Aggregate("", (a, l) => a + l));
            Assert.DoesNotMatch(@"-v\s+PASSWORD", texto);
        }

        Assert.Contains(@"Remove-Item Env:\SQLCMDPASSWORD", Instalador.LeerTexto("instalar-un-clic.ps1"));
    }

    // --- Contraseña aleatoria y código de enlace ------------------------------------------------

    [Fact]
    public void La_contrasena_aleatoria_del_lector_cumple_las_reglas_y_no_se_repite()
    {
        var salida = Ps("""
            1..25 | ForEach-Object { $p = New-PasswordLector; "P|$p|$([bool] (Test-PasswordNueva $p))" }
            "CORTA|$((New-PasswordLector -Largo 16).Length)"
            try { New-PasswordLector -Largo 10 | Out-Null; 'SIN ERROR' } catch { 'ERROR' }
            """);

        var filas = salida.Where(l => l.StartsWith("P|", StringComparison.Ordinal)).Select(l => l.Split('|')).ToList();
        Assert.Equal(25, filas.Count);
        var passwords = filas.Select(f => f[1]).ToList();
        Assert.Equal(25, passwords.Distinct(StringComparer.Ordinal).Count());
        foreach (var f in filas)
        {
            var p = f[1];
            Assert.Equal(32, p.Length);
            Assert.Equal("False", f[2]); // Test-PasswordNueva no encontró problema
            Assert.Matches("^[A-Za-z0-9_.!@#*+=?-]+$", p);
            Assert.Matches("[a-z]", p);
            Assert.Matches("[A-Z]", p);
            Assert.Matches("[0-9]", p);
            Assert.Matches("[_.!@#*+=?-]", p);
        }

        Assert.Equal(["CORTA|16", "ERROR"], salida.Where(l => !l.StartsWith("P|", StringComparison.Ordinal)).ToList());
    }

    [Theory]
    [InlineData("K7P4-42XQ", "K7P442XQ", true)]
    [InlineData(" k7p4 42xq ", "K7P442XQ", true)]
    [InlineData("k7p442xq", "K7P442XQ", true)]
    [InlineData("K7P-42X", "K7P42X", false)]
    [InlineData("K7P4-42XQQ", "K7P442XQQ", false)]
    [InlineData("O7P4-42XQ", "O7P442XQ", false)]
    [InlineData("K7P4-I2XQ", "K7P4I2XQ", false)]
    [InlineData("K1P4-42XQ", "K1P442XQ", false)]
    [InlineData("K7P4_42XQ", "K7P4_42XQ", false)]
    public void El_codigo_de_enlace_se_normaliza_y_valida_igual_que_en_la_API(string tecleado, string normalizado, bool valido)
    {
        var salida = Ps($$"""
            "N|$(ConvertTo-CodigoEnlace '{{tecleado}}')"
            "V|$(-not (Test-CodigoEnlace '{{tecleado}}'))"
            """);

        Assert.Equal([$"N|{normalizado}", $"V|{valido}"], salida);
    }

    [Fact]
    public void Se_proponen_solo_las_bases_de_SoftRestaurant()
    {
        var salida = Ps("""
            $a = Select-BaseSoftRestaurant @('master2', 'softrestaurant10', 'SoftRestaurant11', 'otra')
            "A|$($a.Count)|$($a -join ',')"
            $b = Select-BaseSoftRestaurant @('otra')
            "B|$($b.Count)"
            $c = Select-BaseSoftRestaurant @()
            "C|$($c.Count)"
            """);

        Assert.Equal(["A|2|softrestaurant10,SoftRestaurant11", "B|0", "C|0"], salida);
    }

    // --- Lo que trae el paquete y el config que se escribe ---------------------------------------

    [Fact]
    public void La_direccion_del_panel_sale_del_paquete_y_se_valida()
    {
        using var buena = new CarpetaTemporal();
        buena.Escribir("instalador.json", "{ \"apiUrl\": \"https://monitor.ejemplo.test/api/\" }");
        using var mala = new CarpetaTemporal();
        mala.Escribir("instalador.json", "{ \"apiUrl\": \"http://monitor.ejemplo.test\" }");
        using var vacia = new CarpetaTemporal();

        var salida = Ps($$"""
            "B|$(Read-ConfigPaquete -Carpeta '{{buena.Ruta}}')"
            "V|$($null -eq (Read-ConfigPaquete -Carpeta '{{vacia.Ruta}}'))"
            try { Read-ConfigPaquete -Carpeta '{{mala.Ruta}}' | Out-Null; 'SIN ERROR' } catch { "M|$($_.Exception.Message)" }
            """);

        Assert.Equal("B|https://monitor.ejemplo.test/api", salida[0]);
        Assert.Equal("V|True", salida[1]);
        Assert.StartsWith("M|instalador.json trae una dirección del panel inválida", salida[2]);
    }

    [Fact]
    public void El_config_de_un_clic_conserva_la_hora_de_catalogos_y_el_agente_lo_acepta()
    {
        using var carpeta = new CarpetaTemporal();
        var anterior = carpeta.Escribir(
            "anterior.json",
            "{ \"apiUrl\": \"https://viejo.ejemplo.test\", \"apiKey\": \"msr_vieja\", \"connectionString\": \"Server=.;Database=x;User ID=y;Password=z\", \"horaSincronizacionCatalogos\": \"05:30\" }");
        var conHora = Path.Combine(carpeta.Ruta, "config.json");
        var sinHora = Path.Combine(carpeta.Ruta, "config2.json");
        var noExiste = Path.Combine(carpeta.Ruta, "no-existe.json");

        var salida = Ps($$"""
            $existente = Read-ConfigExistente -Ruta '{{anterior}}'
            $cadena = New-CadenaConexion -Servidor '.\NATIONALSOFT' -Base 'softrestaurant10' -Usuario 'monitor_lector' -Password (New-PasswordLector)
            Write-ArchivoSinBom -Ruta '{{conHora}}' -Contenido (New-ContenidoConfig -ApiUrl 'https://monitor.ejemplo.test' -ApiKey 'msr_nueva-123' -Cadena $cadena -HoraCatalogos (Get-CampoTexto $existente 'horaSincronizacionCatalogos'))
            Write-ArchivoSinBom -Ruta '{{sinHora}}' -Contenido (New-ContenidoConfig -ApiUrl 'https://monitor.ejemplo.test' -ApiKey 'msr_nueva-123' -Cadena $cadena -HoraCatalogos (Get-CampoTexto $null 'horaSincronizacionCatalogos'))
            "VIEJA|$(Get-CampoTexto $existente 'connectionString')"
            "NULO|$($null -eq (Read-ConfigExistente -Ruta '{{noExiste}}'))"
            """);

        Assert.Equal(["VIEJA|Server=.;Database=x;User ID=y;Password=z", "NULO|True"], salida);

        var con = CargadorConfiguracion.Cargar(conHora);
        Assert.True(con.Ok, string.Join(" / ", con.Errores));
        Assert.Equal(new TimeOnly(5, 30), con.Configuracion!.HoraCatalogos);
        Assert.Equal("msr_nueva-123", con.Configuracion.ApiKey);
        var cadena = new SqlConnectionStringBuilder(con.Configuracion.ConnectionString);
        Assert.Equal("monitor_lector", cadena.UserID);
        Assert.Equal(32, cadena.Password.Length);

        var sin = CargadorConfiguracion.Cargar(sinHora);
        Assert.True(sin.Ok, string.Join(" / ", sin.Errores));
        Assert.Null(sin.Configuracion!.HoraSincronizacionCatalogos);
    }

    // --- Canje del código contra un API falso -------------------------------------------------

    [Fact]
    public void El_canje_manda_el_codigo_normalizado_y_toma_la_key_y_la_URL_que_dice_el_panel()
    {
        using var api = new ApiEnlaceFalsa(_ => (200,
            "{\"sucursalId\":\"f1011000-0000-4000-8000-0000000000a1\",\"sucursal\":\"Centro\",\"apiKey\":\"msr_key-sintetica_123\",\"apiUrl\":\"https://publica.ejemplo.test/api\"}"));

        var salida = Ps($$"""
            $r = Invoke-CanjeCodigoEnlace -ApiUrl '{{api.Url}}/' -Codigo ' k7p4-42xq '
            "OK|$($r.Ok)|$($r.ApiKey)|$($r.ApiUrl)|$($r.Sucursal)|$($r.Estado)"
            """);

        Assert.Equal(["OK|True|msr_key-sintetica_123|https://publica.ejemplo.test/api|Centro|200"], salida);
        var peticion = Assert.Single(api.Copia());
        Assert.Equal("POST", peticion.Metodo);
        Assert.Equal("/agente/enlace", peticion.Ruta);
        Assert.StartsWith("application/json", peticion.ContentType);
        Assert.Equal("K7P442XQ", JsonDocument.Parse(peticion.Cuerpo).RootElement.GetProperty("codigo").GetString());
    }

    [Fact]
    public void Sin_URL_publica_en_la_respuesta_se_queda_la_del_paquete()
    {
        using var api = new ApiEnlaceFalsa(_ => (200, "{\"sucursal\":\"Centro\",\"apiKey\":\"msr_otra\",\"apiUrl\":null}"));

        var salida = Ps($$"""
            $r = Invoke-CanjeCodigoEnlace -ApiUrl '{{api.Url}}' -Codigo 'K7P4-42XQ'
            "OK|$($r.Ok)|$($r.ApiUrl)"
            """);

        Assert.Equal([$"OK|True|{api.Url}"], salida);
    }

    [Theory]
    [InlineData(404, "{\"statusCode\":404}", "ya se usó")]
    [InlineData(400, "{\"statusCode\":400}", "formato")]
    [InlineData(429, "{\"statusCode\":429}", "Demasiados intentos")]
    [InlineData(500, "{\"statusCode\":500}", "(500)")]
    [InlineData(200, "{\"sucursal\":\"Centro\"}", "no entiendo")]
    public void Un_canje_que_falla_dice_que_paso_y_nunca_truena(int estado, string cuerpo, string mensaje)
    {
        using var api = new ApiEnlaceFalsa(_ => (estado, cuerpo));

        var salida = Ps($$"""
            $r = Invoke-CanjeCodigoEnlace -ApiUrl '{{api.Url}}' -Codigo 'K7P4-42XQ'
            "R|$($r.Ok)|$($r.Estado)|$($null -eq $r.ApiKey)"
            "M|$($r.Mensaje)"
            """);

        Assert.Equal($"R|False|{estado}|True", salida[0]);
        Assert.Contains(mensaje, salida[1]);
    }

    [Fact]
    public void Sin_red_el_canje_dice_que_no_llego_al_panel()
    {
        var url = $"http://127.0.0.1:{ApiEnlaceFalsa.PuertoLibre()}";

        var salida = Ps($$"""
            $r = Invoke-CanjeCodigoEnlace -ApiUrl '{{url}}' -Codigo 'K7P4-42XQ' -TimeoutSegundos 5
            "R|$($r.Ok)|$($null -eq $r.Estado)"
            "M|$($r.Mensaje)"
            """);

        Assert.Equal("R|False|True", salida[0]);
        Assert.StartsWith($"M|No pude llegar al panel en {url}", salida[1]);
    }

    // --- El .cmd y el paquete -----------------------------------------------------------------

    [Fact]
    public void El_cmd_es_ASCII_sin_BOM_con_CRLF_y_se_eleva_antes_de_correr_el_instalador()
    {
        var bytes = File.ReadAllBytes(Instalador.Ruta("Instalar-YoControlo.cmd"));
        Assert.DoesNotContain(bytes, b => b >= 0x80); // ni BOM ni acentos: cmd.exe los lee mal
        var texto = Encoding.ASCII.GetString(bytes);
        Assert.DoesNotContain("\n", texto.Replace("\r\n", "", StringComparison.Ordinal));
        Assert.StartsWith("@echo off\r\n", texto);
        Assert.Contains("fltmc", texto);
        Assert.Contains("Verb = 'RunAs'", texto);
        Assert.Contains(@"%~dp0archivos\instalar-un-clic.ps1", texto);
        Assert.Contains("powershell -NoProfile -ExecutionPolicy Bypass -File \"%YC_SCRIPT%\" %*", texto);
        Assert.Contains("pause", texto);
    }

    [Fact]
    public void El_empaquetador_arma_el_zip_con_el_cmd_en_la_raiz_y_la_URL_embebida()
    {
        using var carpeta = new CarpetaTemporal();
        var exe = carpeta.Escribir("agente.exe", "exe-falso-de-prueba");
        var zip = Path.Combine(carpeta.Ruta, "Instalar-YoControlo.zip");

        var (codigo, salida) = CorrerScript(Instalador.RutaEmpaquetador,
            "-ApiUrl", "https://monitor.ejemplo.test/api/", "-Exe", exe, "-Salida", zip);

        Assert.True(codigo == 0, salida);
        using var archivo = ZipFile.OpenRead(zip);
        var entradas = archivo.Entries.Select(e => e.FullName.Replace('\\', '/')).OrderBy(n => n, StringComparer.Ordinal).ToList();
        Assert.Equal(
            [
                "Instalar-YoControlo.cmd",
                "LEEME.txt",
                "archivos/agente.exe",
                "archivos/crear-usuario-lector.ps1",
                "archivos/crear-usuario-lector.sql",
                "archivos/funciones-instalador.ps1",
                "archivos/instalador.json",
                "archivos/instalar-un-clic.ps1",
                "archivos/instalar.ps1",
            ],
            entradas);

        using var json = JsonDocument.Parse(Leer(archivo, "archivos/instalador.json"));
        Assert.Equal("https://monitor.ejemplo.test/api", json.RootElement.GetProperty("apiUrl").GetString());
        Assert.Single(json.RootElement.EnumerateObject()); // sólo la URL: ningún secreto
        Assert.Equal(File.ReadAllBytes(Instalador.Ruta("Instalar-YoControlo.cmd")), LeerBytes(archivo, "Instalar-YoControlo.cmd"));
        Assert.Equal("exe-falso-de-prueba", Encoding.UTF8.GetString(LeerBytes(archivo, "archivos/agente.exe")));
    }

    [Fact]
    public void El_empaquetador_rechaza_una_URL_insegura_y_sin_URL_no_embebe_nada()
    {
        using var carpeta = new CarpetaTemporal();
        var exe = carpeta.Escribir("agente.exe", "exe-falso-de-prueba");
        var malo = Path.Combine(carpeta.Ruta, "malo.zip");
        var sinUrl = Path.Combine(carpeta.Ruta, "sin-url.zip");

        var (codigoMalo, _) = CorrerScript(Instalador.RutaEmpaquetador,
            "-ApiUrl", "http://monitor.ejemplo.test", "-Exe", exe, "-Salida", malo);
        var (codigoSinUrl, salida) = CorrerScript(Instalador.RutaEmpaquetador, "-Exe", exe, "-Salida", sinUrl);

        Assert.NotEqual(0, codigoMalo);
        Assert.False(File.Exists(malo));
        Assert.True(codigoSinUrl == 0, salida);
        using var archivo = ZipFile.OpenRead(sinUrl);
        Assert.DoesNotContain(archivo.Entries, e => e.FullName.EndsWith("instalador.json", StringComparison.Ordinal));
    }

    // --- Apoyo ------------------------------------------------------------------------------

    private static string Leer(ZipArchive archivo, string nombre) => Encoding.UTF8.GetString(LeerBytes(archivo, nombre));

    private static byte[] LeerBytes(ZipArchive archivo, string nombre)
    {
        var entrada = archivo.Entries.Single(e => e.FullName.Replace('\\', '/') == nombre);
        using var flujo = entrada.Open();
        using var memoria = new MemoryStream();
        flujo.CopyTo(memoria);
        return memoria.ToArray();
    }

    /// <summary>Un sqlcmd falso: anota cada argumento (y BASE_SR|PASSWORD_LECTOR) y lista dos bases.</summary>
    private static string CrearSqlcmdFalso(string carpeta)
    {
        if (OperatingSystem.IsWindows())
        {
            var cmd = Path.Combine(carpeta, "sqlcmd-falso.cmd");
            File.WriteAllText(cmd,
                "@echo off\r\n" +
                ">\"%YC_ARGS_FILE%\" echo(%*\r\n" +
                ">\"%YC_ARGS_FILE%.env\" echo(%BASE_SR%^|%PASSWORD_LECTOR%\r\n" +
                "echo softrestaurant10\r\n" +
                "echo OtraBase\r\n" +
                "exit /b %YC_SALIDA%\r\n");
            return cmd;
        }

        var sh = Path.Combine(carpeta, "sqlcmd-falso");
        File.WriteAllText(sh,
            "#!/bin/sh\n" +
            ": > \"$YC_ARGS_FILE\"\n" +
            "for a in \"$@\"; do printf '%s\\n' \"$a\" >> \"$YC_ARGS_FILE\"; done\n" +
            "printf '%s|%s\\n' \"$BASE_SR\" \"$PASSWORD_LECTOR\" > \"$YC_ARGS_FILE.env\"\n" +
            "printf 'softrestaurant10\\nOtraBase\\n'\n" +
            "exit \"${YC_SALIDA:-0}\"\n");
        File.SetUnixFileMode(sh, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return sh;
    }

    /// <summary>Corre un .ps1 con -File y sus argumentos; devuelve el código de salida y todo lo que imprimió.</summary>
    private static (int Codigo, string Salida) CorrerScript(string script, params string[] argumentos)
    {
        var inicio = new ProcessStartInfo(InstaladorPs1Tests.Shell())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script }.Concat(argumentos))
        {
            inicio.ArgumentList.Add(a);
        }

        using var proceso = Process.Start(inicio)!;
        var salida = proceso.StandardOutput.ReadToEndAsync();
        var errores = proceso.StandardError.ReadToEndAsync();
        Assert.True(proceso.WaitForExit(TimeSpan.FromSeconds(120)), "PowerShell no terminó en 120 s");
        return (proceso.ExitCode, salida.Result + errores.Result);
    }
}

internal sealed record PeticionEnlace(string Metodo, string Ruta, string ContentType, string Cuerpo);

/// <summary>
/// <c>POST /agente/enlace</c> de mentiras, en un puerto local de verdad: el instalador lo llama
/// con <c>Invoke-RestMethod</c>, así que hace falta HTTP real (no un HttpMessageHandler).
/// </summary>
internal sealed class ApiEnlaceFalsa : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly Func<string, (int Estado, string Cuerpo)> _responder;
    private readonly List<PeticionEnlace> _peticiones = [];
    private readonly Task _bucle;

    public ApiEnlaceFalsa(Func<string, (int Estado, string Cuerpo)> responder)
    {
        _responder = responder;
        var host = OperatingSystem.IsWindows() ? "localhost" : "127.0.0.1";
        Url = $"http://{host}:{PuertoLibre()}";
        _listener.Prefixes.Add(Url + "/");
        _listener.Start();
        _bucle = Task.Run(AtenderAsync);
    }

    public string Url { get; }

    public List<PeticionEnlace> Copia()
    {
        lock (_peticiones)
        {
            return _peticiones.ToList();
        }
    }

    public static int PuertoLibre()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var puerto = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return puerto;
    }

    private async Task AtenderAsync()
    {
        while (_listener.IsListening)
        {
            HttpListenerContext contexto;
            try
            {
                contexto = await _listener.GetContextAsync();
            }
            catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException or InvalidOperationException)
            {
                return;
            }

            string cuerpo;
            using (var lector = new StreamReader(contexto.Request.InputStream, Encoding.UTF8))
            {
                cuerpo = await lector.ReadToEndAsync();
            }

            lock (_peticiones)
            {
                _peticiones.Add(new PeticionEnlace(
                    contexto.Request.HttpMethod, contexto.Request.Url!.AbsolutePath, contexto.Request.ContentType ?? "", cuerpo));
            }

            var (estado, respuesta) = _responder(cuerpo);
            var bytes = Encoding.UTF8.GetBytes(respuesta);
            contexto.Response.StatusCode = estado;
            contexto.Response.ContentType = "application/json; charset=utf-8";
            contexto.Response.ContentLength64 = bytes.Length;
            await contexto.Response.OutputStream.WriteAsync(bytes);
            contexto.Response.Close();
        }
    }

    public void Dispose()
    {
        _listener.Stop();
        _listener.Close();
        try
        {
            _bucle.Wait(TimeSpan.FromSeconds(5));
        }
        catch (AggregateException)
        {
            // El bucle ya terminó con el listener cerrado.
        }
    }
}
