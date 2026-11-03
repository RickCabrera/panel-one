using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Tests;

/// <summary>
/// <c>Invoke-UnClic</c> de punta a punta con piezas falsas: <c>instalar-un-clic.ps1</c> se carga con
/// dot-source (sólo define funciones) y se sustituyen sqlcmd (<c>Invoke-ProgramaSqlcmd</c>), el
/// reinicio del servicio e <c>instalar.ps1</c>; el canje va contra un API falso por HTTP de verdad.
/// Cada pieza anota en <c>orden.txt</c> cuándo la llamaron.
/// </summary>
/// <remarks>
/// Fija tres garantías: (1) todo lo de SQL que sólo lee va ANTES del canje; (2) cualquier falla
/// DESPUÉS del canje deja al agente que ya estaba con la llave nueva (o dice que hace falta otro
/// código); (3) el reintento con LocalSystem es SÓLO tras una falla de inicio de sesión (4).
/// </remarks>
public class InstaladorOrquestacionTests
{
    private const string KeyNueva = "msr_key-nueva-sintetica";
    private const string CadenaVieja = @"Server=.\NATIONALSOFT;Database=softrestaurant10;User ID=monitor_lector;Password=Vieja-12345abc;TrustServerCertificate=True";

    private sealed record Corrida(string Resultado, List<string> Orden, string Salida, string RutaConfig, string Registro);

    private static Corrida CorrerUnClic(
        string permisos = "1|0",
        int lector = 0,
        int login = 1,
        string instalar = "0",
        bool configPrevia = false)
    {
        using var carpeta = new CarpetaTemporal();
        var orden = Path.Combine(carpeta.Ruta, "orden.txt");
        File.WriteAllText(orden, "");
        var exe = carpeta.Escribir("agente.exe", "exe-falso");
        var datos = Path.Combine(carpeta.Ruta, "ProgramData", "ArkonAgente");
        Directory.CreateDirectory(datos);
        var config = Path.Combine(datos, "config.json");
        if (configPrevia)
        {
            File.WriteAllText(config, JsonSerializer.Serialize(new
            {
                apiUrl = "https://vieja.ejemplo.test",
                apiKey = "msr_key-vieja",
                connectionString = CadenaVieja,
                horaSincronizacionCatalogos = "05:30",
            }));
        }

        var instalarFalso = carpeta.Escribir("instalar-falso.ps1", """
            param([string] $Exe, [string] $ContenidoConfig, [switch] $DesdeUnClic, [string] $CuentaServicio)
            Add-Content -LiteralPath $env:YC_ORDEN -Value "INSTALAR|$CuentaServicio|$([bool] $DesdeUnClic)"
            $codigos = $env:YC_INSTALAR.Split(',')
            $n = @(Get-Content -LiteralPath $env:YC_ORDEN | Where-Object { $_ -like 'INSTALAR|*' }).Count
            exit ([int] $codigos[[Math]::Min($n, $codigos.Length) - 1])
            """);

        using var api = new ApiEnlaceFalsa(_ =>
        {
            File.AppendAllText(orden, "CANJE\n");
            return (200, "{\"sucursal\":\"Centro\",\"apiKey\":\"" + KeyNueva + "\",\"apiUrl\":null}");
        });

        var salida = InstaladorPs1Tests.CorrerPowerShell($$"""
            $env:YC_ORDEN = '{{orden}}'
            $env:YC_PERMISOS = '{{permisos}}'
            $env:YC_LECTOR = '{{lector}}'
            $env:YC_LOGIN = '{{login}}'
            $env:YC_INSTALAR = '{{instalar}}'
            . '{{Instalador.Ruta("instalar-un-clic.ps1")}}' -Codigo 'k7p4-42xq' -ApiUrl '{{api.Url}}' -Servidor '.\NATIONALSOFT'
            $exePaquete = '{{exe}}'
            $scriptInstalar = '{{instalarFalso}}'
            $archivoConfig = '{{config}}'
            function Test-EsAdministrador { $true }
            function Find-Sqlcmd { 'sqlcmd-falso' }
            function Restart-ServicioAgente { Add-Content -LiteralPath $env:YC_ORDEN -Value 'REINICIO' }
            function Invoke-ProgramaSqlcmd {
                param([string] $Sqlcmd, [string[]] $Argumentos)
                $todo = $Argumentos -join ' '
                $r = { param($c, $s) [pscustomobject]@{ Codigo = $c; Salida = @($s) } }
                if ($todo -like '*sys.databases*') { Add-Content -LiteralPath $env:YC_ORDEN -Value 'BASES'; return (& $r 0 @('softrestaurant10', 'OtraBase')) }
                if ($todo -like '*HAS_PERMS_BY_NAME*') { Add-Content -LiteralPath $env:YC_ORDEN -Value 'PERMISOS'; return (& $r 0 @($env:YC_PERMISOS)) }
                if ($todo -like '*-U monitor_lector*') { Add-Content -LiteralPath $env:YC_ORDEN -Value 'LOGIN'; return (& $r ([int] $env:YC_LOGIN) @()) }
                if ($todo -like '* -i *') { Add-Content -LiteralPath $env:YC_ORDEN -Value 'LECTOR'; return (& $r ([int] $env:YC_LECTOR) @('Msg 15151: algo falló a la mitad')) }
                Add-Content -LiteralPath $env:YC_ORDEN -Value "OTRO|$todo"
                return (& $r 9 @())
            }
            $resultado = Invoke-UnClic
            "RESULTADO|$($resultado -join ',')"
            $global:LASTEXITCODE = 0
            """);

        var lineas = File.ReadAllLines(orden).Where(l => l.Length > 0).ToList();
        var logs = Path.Combine(datos, "logs");
        var registro = Directory.Exists(logs)
            ? string.Join("\n", Directory.GetFiles(logs, "instalacion-*.log").Select(f => File.ReadAllText(f)))
            : "";
        var resultado = salida.Single(l => l.StartsWith("RESULTADO|", StringComparison.Ordinal))["RESULTADO|".Length..];
        // El texto de la config se copia antes de que se borre la carpeta temporal.
        var copiaConfig = Path.Combine(Path.GetTempPath(), "arkon-agente-tests", Guid.NewGuid().ToString("N") + ".json");
        Directory.CreateDirectory(Path.GetDirectoryName(copiaConfig)!);
        if (File.Exists(config)) File.Copy(config, copiaConfig);
        return new Corrida(resultado, lineas, string.Join("\n", salida), copiaConfig, registro);
    }

    private static (string ApiKey, SqlConnectionStringBuilder Cadena) LeerConfig(string ruta)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(ruta));
        return (json.RootElement.GetProperty("apiKey").GetString()!,
            new SqlConnectionStringBuilder(json.RootElement.GetProperty("connectionString").GetString()));
    }

    [Fact]
    public void Todo_bien_revisa_el_SQL_antes_de_gastar_el_codigo_y_termina_en_LISTO()
    {
        var c = CorrerUnClic();

        Assert.Equal("0", c.Resultado);
        Assert.Equal(["BASES", "PERMISOS", "CANJE", "LECTOR", "INSTALAR|Virtual|True"], c.Orden);
        Assert.Contains("LISTO: la sucursal quedó conectada", c.Salida);
        Assert.Contains("LISTO | LISTO: la sucursal quedó conectada", c.Registro);
        Assert.DoesNotContain(KeyNueva, c.Registro);
    }

    [Fact]
    public void Un_SQL_que_solo_acepta_Windows_se_detecta_antes_del_canje_y_no_cambia_nada()
    {
        var c = CorrerUnClic(permisos: "1|1", configPrevia: true);

        Assert.Equal("3", c.Resultado);
        Assert.Equal(["BASES", "PERMISOS"], c.Orden); // nunca llegó al API
        Assert.Contains("ni el código de enlace se usó", c.Salida);
        Assert.Equal("msr_key-vieja", LeerConfig(c.RutaConfig).ApiKey);
    }

    [Fact]
    public void Si_el_lector_falla_tras_el_canje_el_agente_que_estaba_se_queda_con_la_llave_nueva_y_su_cadena_de_antes()
    {
        var c = CorrerUnClic(lector: 1, login: 1, configPrevia: true);

        Assert.Equal("3", c.Resultado);
        Assert.Equal(["BASES", "PERMISOS", "CANJE", "LECTOR", "LOGIN", "REINICIO"], c.Orden);
        var (key, cadena) = LeerConfig(c.RutaConfig);
        Assert.Equal(KeyNueva, key);
        Assert.Equal("Vieja-12345abc", cadena.Password);
        Assert.Contains("sus datos de SQL de antes", c.Salida);
        Assert.Contains("FALLA | No se pudo crear el usuario de solo lectura", c.Registro);
    }

    [Fact]
    public void Si_el_lector_quedo_a_medias_y_el_SQL_ya_acepta_la_contrasena_nueva_el_respaldo_usa_la_nueva()
    {
        var c = CorrerUnClic(lector: 1, login: 0, configPrevia: true);

        Assert.Equal("3", c.Resultado);
        var (key, cadena) = LeerConfig(c.RutaConfig);
        Assert.Equal(KeyNueva, key);
        Assert.Equal("monitor_lector", cadena.UserID);
        Assert.NotEqual("Vieja-12345abc", cadena.Password);
        Assert.Equal(32, cadena.Password.Length);
        Assert.Contains("la contraseña nueva del lector", c.Salida);
    }

    [Fact]
    public void Si_falla_instalar_tras_el_canje_tambien_hay_respaldo_y_no_se_reintenta_con_LocalSystem()
    {
        var c = CorrerUnClic(instalar: "3", configPrevia: true);

        Assert.Equal("3", c.Resultado);
        Assert.Equal(["BASES", "PERMISOS", "CANJE", "LECTOR", "INSTALAR|Virtual|True", "REINICIO"], c.Orden);
        var (key, cadena) = LeerConfig(c.RutaConfig);
        Assert.Equal(KeyNueva, key);
        Assert.Equal(32, cadena.Password.Length); // el lector sí se creó: la cadena nueva
        Assert.DoesNotContain("No se cambió nada", c.Salida.Split("No se pudo instalar el agente").Last());
    }

    [Fact]
    public void En_una_PC_sin_agente_una_falla_tras_el_canje_dice_que_hace_falta_un_codigo_nuevo()
    {
        var c = CorrerUnClic(lector: 1, login: 1, configPrevia: false);

        Assert.Equal("3", c.Resultado);
        Assert.DoesNotContain("REINICIO", c.Orden);
        Assert.False(File.Exists(c.RutaConfig));
        Assert.Contains("Genera un código NUEVO", c.Salida);
    }

    [Fact]
    public void Solo_una_falla_de_inicio_de_sesion_reintenta_con_LocalSystem()
    {
        var c = CorrerUnClic(instalar: "4,0");

        Assert.Equal("0", c.Resultado);
        Assert.Equal(["BASES", "PERMISOS", "CANJE", "LECTOR", "INSTALAR|Virtual|True", "INSTALAR|LocalSystem|True"], c.Orden);
        Assert.Contains("quedó con la cuenta LocalSystem", c.Salida);
        Assert.Contains("se reintenta con LocalSystem", c.Registro);
    }

    [Fact]
    public void La_falla_de_inicio_de_sesion_se_reconoce_por_los_errores_1069_y_1079()
    {
        var salida = InstaladorPs1Tests.CorrerPowerShell("""
            $envuelta = { param($n) New-Object System.InvalidOperationException('No se pudo iniciar', (New-Object System.ComponentModel.Win32Exception($n))) }
            "1069|$(Test-FallaInicioSesionServicio (& $envuelta 1069))"
            "1079|$(Test-FallaInicioSesionServicio (& $envuelta 1079))"
            "1053|$(Test-FallaInicioSesionServicio (& $envuelta 1053))"
            "SUELTA|$(Test-FallaInicioSesionServicio (New-Object System.ComponentModel.Win32Exception(1069)))"
            "OTRA|$(Test-FallaInicioSesionServicio (New-Object System.InvalidOperationException('x')))"
            "NULA|$(Test-FallaInicioSesionServicio $null)"
            """);

        Assert.Equal(["1069|True", "1079|True", "1053|False", "SUELTA|True", "OTRA|False", "NULA|False"], salida);
    }
}
