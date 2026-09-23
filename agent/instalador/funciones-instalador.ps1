# =============================================================================
# ArkonAgente · Funciones compartidas de instalar.ps1 y crear-usuario-lector.ps1.
#
# Sólo define funciones: cargarlo (dot-source) no pregunta nada ni toca la máquina.
# Las funciones puras (validar, armar la cadena, el config.json y los argumentos de
# sc.exe) las prueban los tests del agente (InstaladorPs1Tests) con powershell.exe en
# Windows y con pwsh en el CI de Linux, así que ellas no usan nada propio de Windows.
#
# PowerShell 5.1: este archivo va en UTF-8 CON BOM. Sin BOM, 5.1 lo lee como ANSI y
# los acentos de los mensajes salen rotos (un test lo vigila).
# =============================================================================

$script:NombreServicio = 'ArkonAgente'
$script:NombreVisible = 'ArkonAgente (monitor SoftRestaurant)'
$script:DescripcionServicio = 'Lee SoftRestaurant en solo lectura y reporta al monitor.'
$script:UsuarioLectorPorDefecto = 'monitor_lector'

# F2-143: el watchdog de la auto-actualización. Es el MISMO agente.exe, copiado en una subcarpeta
# (así el exe del agente nunca está bloqueado por él) y arrancado con el argumento "actualizador".
$script:NombreActualizador = 'ArkonAgenteActualizador'
$script:NombreVisibleActualizador = 'ArkonAgente - actualizador'
$script:DescripcionActualizador = 'Instala las versiones nuevas del agente ArkonAgente que publica el monitor.'
$script:CarpetaActualizador = 'actualizador'

# --- Validaciones (devuelven $null si está bien, o el mensaje de qué corregir) -------

function Test-ApiUrl {
    param([string] $Url)

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return 'Falta la dirección del panel.'
    }

    $uri = $null
    if (-not [Uri]::TryCreate($Url.Trim(), [UriKind]::Absolute, [ref] $uri) -or
        ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http')) {
        return 'La dirección del panel debe ser completa, por ejemplo https://monitor.ejemplo.com'
    }

    # Igual que el agente (CargadorConfiguracion): la API key viaja en cada petición, así
    # que http:// sólo se acepta contra la propia máquina (desarrollo).
    if ($uri.Scheme -eq 'http' -and -not $uri.IsLoopback) {
        return 'La dirección del panel debe empezar con https:// (http:// sólo para localhost).'
    }

    if ($uri.Query -or $uri.Fragment) {
        return 'La dirección del panel va sin "?" ni "#": sólo la dirección base.'
    }

    return $null
}

# Reglas de la contraseña NUEVA del lector (la que crea crear-usuario-lector.ps1). Son
# estrictas a propósito: la contraseña viaja dentro del T-SQL (entre comillas simples),
# dentro de la cadena de conexión (separada por ';') y por la consola. Con sólo letras,
# números y estos símbolos no hay nada que escapar en ningún lado.
$script:SimbolosPassword = '-_.!@#*+=?'

function Test-PasswordNueva {
    param([string] $Password)

    if ([string]::IsNullOrEmpty($Password)) {
        return 'La contraseña está vacía.'
    }
    if ($Password.Length -lt 12 -or $Password.Length -gt 64) {
        return 'La contraseña debe tener entre 12 y 64 caracteres.'
    }
    if ($Password -cnotmatch '^[A-Za-z0-9\-_.!@#*+=?]+$') {
        return "La contraseña sólo puede llevar letras sin acento, números y estos símbolos: $script:SimbolosPassword (sin espacios, sin comillas, sin ñ)."
    }
    if ($Password -cnotmatch '[A-Za-z]' -or $Password -cnotmatch '[0-9]') {
        return 'La contraseña debe llevar al menos una letra y un número.'
    }
    return $null
}

# La contraseña que se escribe en config.json. Más permisiva que la nueva (el usuario pudo
# haberse creado a mano), pero sin lo que rompería la cadena de conexión.
function Test-PasswordCadena {
    param([string] $Password)

    if ([string]::IsNullOrEmpty($Password)) {
        return 'La contraseña está vacía.'
    }
    if ($Password -match '[;''"]' -or $Password -match '[\x00-\x1F]') {
        return 'La contraseña no puede llevar punto y coma, comillas ni caracteres de control.'
    }
    if ($Password.Trim() -ne $Password) {
        return 'La contraseña no puede empezar ni terminar con espacios.'
    }
    return $null
}

# Servidor, base y usuario: van tal cual en la cadena de conexión.
function Test-ValorCadena {
    param([string] $Valor, [string] $Campo)

    if ([string]::IsNullOrWhiteSpace($Valor)) {
        return "Falta $Campo."
    }
    if ($Valor -match '[;''"=]' -or $Valor -match '[\x00-\x1F]') {
        return "$Campo no puede llevar punto y coma, comillas ni el signo =."
    }
    if ($Valor.Length -gt 128) {
        return "$Campo es demasiado largo."
    }
    return $null
}

# El nombre de la base va DENTRO del T-SQL (`USE [$(BASE_SR)]`), no sólo en la cadena: un
# `]` permitiría cerrar el corchete y meter otra sentencia. Lista cerrada de caracteres.
function Test-NombreBase {
    param([string] $Valor)

    if ([string]::IsNullOrWhiteSpace($Valor)) {
        return 'Falta la base.'
    }
    if ($Valor -cnotmatch '^[A-Za-z0-9_\-]{1,128}$') {
        return 'El nombre de la base sólo puede llevar letras sin acento, números, "_" y "-" (por ejemplo softrestaurant10).'
    }
    return $null
}

function Test-ApiKey {
    param([string] $ApiKey)

    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        return 'La API key está vacía.'
    }
    if ($ApiKey -match '\s' -or $ApiKey -match '["\\]') {
        return 'La API key no lleva espacios, comillas ni barras invertidas. Cópiala otra vez del panel.'
    }
    return $null
}

# --- Armado de archivos y argumentos (puras) -----------------------------------------

function New-CadenaConexion {
    param(
        [Parameter(Mandatory)] [string] $Servidor,
        [Parameter(Mandatory)] [string] $Base,
        [Parameter(Mandatory)] [string] $Usuario,
        [Parameter(Mandatory)] [string] $Password
    )

    # Autenticación SQL a propósito, nunca Integrated Security (ver agent/README.md).
    # TrustServerCertificate: el SQL Express del POS trae certificado autofirmado
    # (docs/esquema-sr.md §11).
    return "Server=$Servidor;Database=$Base;User ID=$Usuario;Password=$Password;TrustServerCertificate=True"
}

# Texto JSON de una cadena. A mano y no con ConvertTo-Json: 5.1 y 7 escapan distinto, y
# aquí importa que las barras invertidas (.\NATIONALSOFT) salgan dobles siempre.
function ConvertTo-TextoJson {
    param([AllowEmptyString()] [string] $Texto)

    $sb = New-Object System.Text.StringBuilder
    [void] $sb.Append('"')
    foreach ($c in $Texto.ToCharArray()) {
        $n = [int] $c
        if ($c -eq [char] '"') { [void] $sb.Append('\"') }
        elseif ($c -eq [char] '\') { [void] $sb.Append('\\') }
        elseif ($n -lt 0x20) { [void] $sb.Append(('\u{0:x4}' -f $n)) }
        else { [void] $sb.Append($c) }
    }
    [void] $sb.Append('"')
    return $sb.ToString()
}

function New-ContenidoConfig {
    param(
        [Parameter(Mandatory)] [string] $ApiUrl,
        [Parameter(Mandatory)] [string] $ApiKey,
        [Parameter(Mandatory)] [string] $Cadena
    )

    # intervaloSegundos 30: el panel marca "desconectado" a los 90 s fijos (F1-061).
    $lineas = @(
        '{',
        ('  "apiUrl": ' + (ConvertTo-TextoJson $ApiUrl.Trim()) + ','),
        ('  "apiKey": ' + (ConvertTo-TextoJson $ApiKey.Trim()) + ','),
        ('  "connectionString": ' + (ConvertTo-TextoJson $Cadena) + ','),
        '  "intervaloSegundos": 30',
        '}',
        ''
    )
    return ($lineas -join "`r`n")
}

# UTF-8 SIN BOM. En 5.1, Set-Content -Encoding UTF8 le pone BOM.
function Write-ArchivoSinBom {
    param(
        [Parameter(Mandatory)] [string] $Ruta,
        [Parameter(Mandatory)] [string] $Contenido
    )

    $codificacion = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Ruta, $Contenido, $codificacion)
}

# Argumentos de sc.exe como UNA línea de comando literal (se pasa así a Start-Process).
# binPath lleva comillas internas: la ruta tiene espacios ("C:\Program Files\...") y sin
# ellas queda el hueco de "unquoted service path". En sc.exe el espacio después de "="
# es obligatorio.
function Get-ArgumentosScServicio {
    param(
        [Parameter(Mandatory)] [ValidateSet('create', 'config')] [string] $Accion,
        [Parameter(Mandatory)] [string] $RutaExe,
        [Parameter(Mandatory)] [ValidateSet('Virtual', 'LocalSystem')] [string] $Cuenta
    )

    if ($RutaExe.Contains('"')) {
        throw 'La ruta del exe no puede llevar comillas.'
    }

    if ($Cuenta -eq 'Virtual') {
        $obj = '"NT SERVICE\' + $script:NombreServicio + '"'
    }
    else {
        $obj = 'LocalSystem'
    }

    $partes = @(
        $Accion,
        $script:NombreServicio,
        ('binPath= "\"' + $RutaExe + '\""'),
        'start= delayed-auto',
        ('DisplayName= "' + $script:NombreVisible + '"'),
        ('obj= ' + $obj)
    )
    return ($partes -join ' ')
}

# Argumentos de sc.exe del watchdog (F2-143). binPath lleva el exe entre comillas internas Y el
# argumento "actualizador" afuera de ellas. Corre como LocalSystem: tiene que detener y arrancar el
# servicio del agente y escribir en Program Files, cosas que la cuenta virtual no puede.
# DECISION PROVISIONAL (nocturno): LocalSystem, sin verificar con elevación (F1-020b).
function Get-ArgumentosScActualizador {
    param(
        [Parameter(Mandatory)] [ValidateSet('create', 'config')] [string] $Accion,
        [Parameter(Mandatory)] [string] $RutaExe
    )

    if ($RutaExe.Contains('"')) {
        throw 'La ruta del exe no puede llevar comillas.'
    }

    $partes = @(
        $Accion,
        $script:NombreActualizador,
        ('binPath= "\"' + $RutaExe + '\" actualizador"'),
        'start= delayed-auto',
        ('DisplayName= "' + $script:NombreVisibleActualizador + '"'),
        'obj= LocalSystem'
    )
    return ($partes -join ' ')
}

# `.\INSTANCIA` a partir del nombre del servicio de SQL Server.
function ConvertTo-ServidorLocal {
    param([Parameter(Mandatory)] [string] $NombreServicioSql)

    if ($NombreServicioSql -eq 'MSSQLSERVER') {
        return '.'
    }
    if ($NombreServicioSql -like 'MSSQL$*') {
        return '.\' + $NombreServicioSql.Substring(6)
    }
    return $null
}

# --- Interacción y sistema (no puras: no las corren los tests) ------------------------

function Write-Paso {
    param([string] $Texto)
    Write-Host ''
    Write-Host $Texto -ForegroundColor Cyan
}

function Write-Bien {
    param([string] $Texto)
    Write-Host "  $Texto" -ForegroundColor Green
}

function Write-Problema {
    param([string] $Texto)
    Write-Host "  $Texto" -ForegroundColor Yellow
}

function Test-EsAdministrador {
    $identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identidad)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-ComoAbrirAdministrador {
    Write-Problema 'Hay que correrlo desde una consola de ADMINISTRADOR:'
    Write-Problema '  menú Inicio > escribe "PowerShell" > clic derecho > "Ejecutar como administrador".'
    Write-Problema 'Luego vuelve a esta carpeta y corre el mismo comando.'
}

# Pregunta hasta que la validación pase (o la persona deje vacío = cancelar).
function Read-Valor {
    param(
        [Parameter(Mandatory)] [string] $Pregunta,
        [string] $Sugerido,
        [Parameter(Mandatory)] [scriptblock] $Validar
    )

    while ($true) {
        $texto = $Pregunta
        if ($Sugerido) { $texto = "$Pregunta [$Sugerido]" }
        $valor = Read-Host $texto
        if ([string]::IsNullOrWhiteSpace($valor) -and $Sugerido) { $valor = $Sugerido }
        if ([string]::IsNullOrWhiteSpace($valor)) { throw 'Cancelado: no se escribió nada.' }
        $valor = $valor.Trim()
        $problema = & $Validar $valor
        if (-not $problema) { return $valor }
        Write-Problema $problema
    }
}

# Pide un secreto sin mostrarlo ni dejarlo en el historial de la consola.
function Read-Secreto {
    param(
        [Parameter(Mandatory)] [string] $Pregunta,
        [Parameter(Mandatory)] [scriptblock] $Validar,
        [switch] $Confirmar
    )

    while ($true) {
        $valor = ConvertFrom-Seguro (Read-Host $Pregunta -AsSecureString)
        if ([string]::IsNullOrEmpty($valor)) { throw 'Cancelado: no se escribió nada.' }
        $problema = & $Validar $valor
        if ($problema) { Write-Problema $problema; continue }
        if ($Confirmar) {
            $otra = ConvertFrom-Seguro (Read-Host 'Escríbela otra vez' -AsSecureString)
            if ($otra -cne $valor) { Write-Problema 'No coinciden. Otra vez.'; continue }
        }
        return $valor
    }
}

function ConvertFrom-Seguro {
    param([Security.SecureString] $Seguro)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Seguro)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# Si en la PC hay exactamente un SQL Server, lo propone (p. ej. `.\NATIONALSOFT`).
function Get-ServidorSugerido {
    $servicios = @(Get-Service -Name 'MSSQLSERVER', 'MSSQL$*' -ErrorAction SilentlyContinue)
    if ($servicios.Count -eq 1) {
        return ConvertTo-ServidorLocal $servicios[0].Name
    }
    return $null
}
