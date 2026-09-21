using System.Diagnostics;
using System.Text;
using ArkonAgente.Configuracion;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Tests;

/// <summary>Los archivos de <c>agent/instalador</c>, leídos del repo (los mismos que se empaquetan).</summary>
internal static class Instalador
{
    public static string Carpeta { get; } = Encontrar();

    public static string Ruta(string archivo) => Path.Combine(Carpeta, archivo);

    public static string LeerTexto(string archivo) => File.ReadAllText(Ruta(archivo), Encoding.UTF8);

    private static string Encontrar()
    {
        var carpeta = new DirectoryInfo(AppContext.BaseDirectory);
        while (carpeta is not null && !Directory.Exists(Path.Combine(carpeta.FullName, "agent", "instalador")))
        {
            carpeta = carpeta.Parent;
        }

        Assert.True(carpeta is not null, "No se encontró agent/instalador subiendo desde " + AppContext.BaseDirectory);
        return Path.Combine(carpeta!.FullName, "agent", "instalador");
    }
}

/// <summary>
/// Pruebas de los scripts de PowerShell del instalador (F1-026). Corren el script de
/// verdad: <c>powershell.exe</c> (5.1, el de las PCs de los restaurantes) en Windows y
/// <c>pwsh</c> en el CI de Linux. Si no hay ninguno, el test FALLA: no se salta.
/// </summary>
/// <remarks>
/// Sólo se prueban las funciones puras de <c>funciones-instalador.ps1</c> y el parseo de
/// los tres scripts. Registrar el servicio, los permisos de la carpeta y la cuenta virtual
/// necesitan una consola de administrador: nunca se han corrido (F1-020b).
/// </remarks>
public class InstaladorPs1Tests
{
    private static readonly string[] Scripts = ["instalar.ps1", "crear-usuario-lector.ps1", "funciones-instalador.ps1"];

    [Fact]
    public void Los_scripts_del_instalador_parsean_y_no_usan_alias_peligrosos()
    {
        var lista = string.Join(",", Scripts.Select(s => $"'{Instalador.Ruta(s)}'"));
        var salida = CorrerPowerShell($$"""
            foreach ($f in @({{lista}})) {
                $tokens = $null; $errores = $null
                $ast = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errores)
                foreach ($e in $errores) { "ERROR|$f|$($e.Extent.StartLineNumber)|$($e.Message)" }
                $comandos = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
                foreach ($c in $comandos) {
                    $nombre = $c.GetCommandName()
                    # 'sc' en 5.1 es Set-Content, no el administrador de servicios.
                    if ($nombre -in @('sc', 'iex', 'Invoke-Expression')) { "PROHIBIDO|$f|$($c.Extent.StartLineNumber)|$nombre" }
                }
                "OK|$f"
            }
            """);

        Assert.DoesNotContain(salida, l => l.StartsWith("ERROR|", StringComparison.Ordinal) || l.StartsWith("PROHIBIDO|", StringComparison.Ordinal));
        Assert.Equal(Scripts.Length, salida.Count(l => l.StartsWith("OK|", StringComparison.Ordinal)));
    }

    [Fact]
    public void La_guardia_de_alias_detecta_sc_a_secas()
    {
        var salida = CorrerPowerShell("""
            $ast = [System.Management.Automation.Language.Parser]::ParseInput('sc stop ArkonAgente', [ref]$null, [ref]$null)
            $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { "CMD|$($_.GetCommandName())" }
            """);

        Assert.Contains("CMD|sc", salida);
    }

    [Theory]
    [InlineData("instalar.ps1")]
    [InlineData("crear-usuario-lector.ps1")]
    [InlineData("funciones-instalador.ps1")]
    [InlineData("crear-usuario-lector.sql")]
    public void Los_archivos_del_instalador_van_en_UTF8_con_BOM(string archivo)
    {
        // PowerShell 5.1 lee un .ps1 sin BOM como ANSI, y sqlcmd igual con el .sql: los
        // acentos de los mensajes saldrían rotos en la PC del restaurante.
        var bytes = File.ReadAllBytes(Instalador.Ruta(archivo));

        Assert.True(bytes.Length > 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF, $"{archivo} no empieza con BOM");
    }

    [Fact]
    public void Cargar_las_funciones_no_hace_nada_mas()
    {
        var salida = CorrerPowerShell("'FIN'");

        Assert.Equal(["FIN"], salida);
    }

    [Fact]
    public void El_config_que_escribe_el_instalador_lo_acepta_el_agente_tal_cual()
    {
        using var carpeta = new CarpetaTemporal();
        var ruta = Path.Combine(carpeta.Ruta, "config.json");
        // Barra invertida en la instancia, '=' y símbolos en la contraseña: lo que puede
        // romper el JSON o la cadena de conexión.
        const string password = "Abc-123_x.!@#*+=?";
        const string apiKey = "msr_AbC-_123xyz";

        CorrerPowerShell($$"""
            $cadena = New-CadenaConexion -Servidor '.\NATIONALSOFT' -Base 'softrestaurant10' -Usuario 'monitor_lector' -Password '{{password}}'
            Write-ArchivoSinBom -Ruta '{{ruta}}' -Contenido (New-ContenidoConfig -ApiUrl ' https://monitor.ejemplo.test ' -ApiKey '{{apiKey}}' -Cadena $cadena)
            """);

        var bytes = File.ReadAllBytes(ruta);
        Assert.False(bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF, "config.json salió con BOM");

        var resultado = CargadorConfiguracion.Cargar(ruta);
        Assert.True(resultado.Ok, string.Join(" / ", resultado.Errores));
        Assert.Empty(resultado.Avisos);
        var config = resultado.Configuracion!;
        Assert.Equal(new Uri("https://monitor.ejemplo.test"), config.ApiUrl);
        Assert.Equal(apiKey, config.ApiKey);
        Assert.Equal(30, config.IntervaloSegundos);

        var cadena = new SqlConnectionStringBuilder(config.ConnectionString);
        Assert.Equal(@".\NATIONALSOFT", cadena.DataSource);
        Assert.Equal("softrestaurant10", cadena.InitialCatalog);
        Assert.Equal("monitor_lector", cadena.UserID);
        Assert.Equal(password, cadena.Password);
        Assert.False(cadena.IntegratedSecurity);
        Assert.True(cadena.TrustServerCertificate);
    }

    [Theory]
    [InlineData("Abcdefgh1234", true)]
    [InlineData("Abc-123_x.!@#*+=?", true)]
    [InlineData("abcdefghijk1", true)]
    [InlineData("Corta1", false)]
    [InlineData("SoloLetrasSinNumero", false)]
    [InlineData("123456789012", false)]
    [InlineData("Con'Comilla123", false)]
    [InlineData("Con\"Comilla123", false)]
    [InlineData("Con;PuntoComa123", false)]
    [InlineData("Con Espacio 123", false)]
    [InlineData("Con$(Variable)123", false)]
    [InlineData("ContraseñaConEñe1", false)]
    [InlineData("Con`Backtick123", false)]
    public void La_contrasena_nueva_del_lector_solo_acepta_lo_que_no_hay_que_escapar(string password, bool valida)
    {
        Assert.Equal(valida, EsValida("Test-PasswordNueva", password));
    }

    [Theory]
    [InlineData("cualquier$cosa(con)símbolos", true)]
    [InlineData("con;punto", false)]
    [InlineData("con'comilla", false)]
    [InlineData(" espacio", false)]
    public void La_contrasena_de_la_cadena_rechaza_lo_que_rompe_la_cadena(string password, bool valida)
    {
        Assert.Equal(valida, EsValida("Test-PasswordCadena", password));
    }

    [Theory]
    [InlineData("https://monitor.ejemplo.com", true)]
    [InlineData("https://monitor.ejemplo.com/api", true)]
    [InlineData("http://localhost:3000", true)]
    [InlineData("http://127.0.0.1:3000", true)]
    [InlineData("http://monitor.ejemplo.com", false)]
    [InlineData("monitor.ejemplo.com", false)]
    [InlineData("https://monitor.ejemplo.com/?x=1", false)]
    [InlineData("ftp://monitor.ejemplo.com", false)]
    public void La_direccion_del_panel_sigue_la_misma_regla_que_el_agente(string url, bool valida)
    {
        Assert.Equal(valida, EsValida("Test-ApiUrl", url));
    }

    [Theory]
    [InlineData(@".\NATIONALSOFT", true)]
    [InlineData("softrestaurant10", true)]
    [InlineData("base;Password=x", false)]
    [InlineData("base'x", false)]
    public void Servidor_base_y_usuario_no_pueden_romper_la_cadena(string valor, bool valido)
    {
        Assert.Equal(valido, EsValida("Test-ValorCadena", valor));
    }

    [Fact]
    public void Los_argumentos_de_sc_llevan_la_ruta_entre_comillas_y_la_cuenta_correcta()
    {
        var salida = CorrerPowerShell("""
            Get-ArgumentosScServicio -Accion create -RutaExe 'C:\Program Files\ArkonAgente\agente.exe' -Cuenta Virtual
            Get-ArgumentosScServicio -Accion config -RutaExe 'C:\Program Files\ArkonAgente\agente.exe' -Cuenta LocalSystem
            """);

        Assert.Equal(
            [
                """create ArkonAgente binPath= "\"C:\Program Files\ArkonAgente\agente.exe\"" start= delayed-auto DisplayName= "ArkonAgente (monitor SoftRestaurant)" obj= "NT SERVICE\ArkonAgente" """.TrimEnd(),
                """config ArkonAgente binPath= "\"C:\Program Files\ArkonAgente\agente.exe\"" start= delayed-auto DisplayName= "ArkonAgente (monitor SoftRestaurant)" obj= LocalSystem""",
            ],
            salida);
    }

    [Theory]
    [InlineData("MSSQL$NATIONALSOFT", @".\NATIONALSOFT")]
    [InlineData("MSSQLSERVER", ".")]
    [InlineData("MSSQLFDLauncher", "")]
    public void La_instancia_se_propone_a_partir_del_servicio_de_SQL(string servicio, string esperado)
    {
        var salida = CorrerPowerShell($"\"R|$(ConvertTo-ServidorLocal '{servicio}')\"");

        Assert.Equal(["R|" + esperado], salida);
    }

    // --- Correr PowerShell --------------------------------------------------------------

    private static bool EsValida(string funcion, string valor)
    {
        var literal = valor.Replace("'", "''", StringComparison.Ordinal);
        var salida = CorrerPowerShell($"if ({funcion} '{literal}') {{ 'MAL' }} else {{ 'BIEN' }}");
        return Assert.Single(salida) == "BIEN";
    }

    /// <summary>
    /// Corre <paramref name="cuerpo"/> después de cargar funciones-instalador.ps1 y devuelve
    /// las líneas de salida. Falla si PowerShell termina con error o escribe en stderr.
    /// </summary>
    private static List<string> CorrerPowerShell(string cuerpo)
    {
        using var carpeta = new CarpetaTemporal();
        var script = Path.Combine(carpeta.Ruta, "prueba.ps1");
        var contenido = $"""
            Set-StrictMode -Version 2
            $ErrorActionPreference = 'Stop'
            . '{Instalador.Ruta("funciones-instalador.ps1")}'
            {cuerpo}
            """;
        // Con BOM: así 5.1 lee bien los acentos del propio script de prueba.
        File.WriteAllText(script, contenido, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

        var inicio = new ProcessStartInfo(Shell())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                     $"[Console]::OutputEncoding = [Text.Encoding]::UTF8; & '{script}'; exit $LASTEXITCODE" })
        {
            inicio.ArgumentList.Add(arg);
        }

        using var proceso = Process.Start(inicio)!;
        var salida = proceso.StandardOutput.ReadToEndAsync();
        var errores = proceso.StandardError.ReadToEndAsync();
        Assert.True(proceso.WaitForExit(TimeSpan.FromSeconds(60)), "PowerShell no terminó en 60 s");

        Assert.True(proceso.ExitCode == 0 && errores.Result.Trim().Length == 0,
            $"PowerShell terminó con {proceso.ExitCode}. stderr: {errores.Result} stdout: {salida.Result}");
        return salida.Result.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
    }

    private static string Shell()
    {
        if (OperatingSystem.IsWindows())
        {
            return "powershell.exe";
        }

        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (dir.Length > 0 && File.Exists(Path.Combine(dir, "pwsh")))
            {
                return "pwsh";
            }
        }

        Assert.Fail("No hay pwsh en el PATH: los tests del instalador necesitan PowerShell (no se saltan).");
        return "";
    }
}
