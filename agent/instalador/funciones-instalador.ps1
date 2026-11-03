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
        [Parameter(Mandatory)] [string] $Cadena,
        # Opcional: la hora de la sincronización diaria de catálogos ("HH:mm"). El instalador de un
        # clic la conserva al reinstalar si el config anterior la traía. Inválida = no se escribe.
        [AllowEmptyString()] [AllowNull()] [string] $HoraCatalogos
    )

    # intervaloSegundos 30: el panel marca "desconectado" a los 90 s fijos (F1-061).
    $lineas = @(
        '{',
        ('  "apiUrl": ' + (ConvertTo-TextoJson $ApiUrl.Trim()) + ','),
        ('  "apiKey": ' + (ConvertTo-TextoJson $ApiKey.Trim()) + ','),
        ('  "connectionString": ' + (ConvertTo-TextoJson $Cadena) + ',')
    )
    if ($HoraCatalogos -and $HoraCatalogos -match '^([01][0-9]|2[0-3]):[0-5][0-9]$') {
        $lineas += '  "intervaloSegundos": 30,'
        $lineas += ('  "horaSincronizacionCatalogos": ' + (ConvertTo-TextoJson $HoraCatalogos))
    }
    else {
        $lineas += '  "intervaloSegundos": 30'
    }
    $lineas += @('}', '')
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

# --- Instalador de un clic: código de enlace, contraseña y paquete (puras) -------------

# El código de enlace que da el panel (Administración > Sucursales > Conectar sucursal): 6 de
# A-Z y 2-9 sin O, 0, I, 1, mostrado como K7P-42X. La misma regla que la API (codigo-enlace.ts).
$script:RegexCodigoEnlace = '^[A-HJ-NP-Z2-9]{6}$'

# Lo que alguien teclea: sin espacios ni guiones, en mayúsculas.
function ConvertTo-CodigoEnlace {
    param([AllowEmptyString()] [AllowNull()] [string] $Texto)

    if ([string]::IsNullOrEmpty($Texto)) { return '' }
    return ($Texto -replace '[\s-]', '').ToUpperInvariant()
}

function Test-CodigoEnlace {
    param([AllowEmptyString()] [AllowNull()] [string] $Texto)

    $codigo = ConvertTo-CodigoEnlace $Texto
    if ($codigo -cnotmatch $script:RegexCodigoEnlace) {
        return 'El código tiene 6 letras y números, como K7P-42X (no lleva O, 0, I ni 1). Revísalo en el panel.'
    }
    return $null
}

# Contraseña ALEATORIA del lector para el instalador de un clic: nadie la ve ni la escribe. Cumple
# Test-PasswordNueva (sólo letras sin acento, números y los símbolos que no hay que escapar) y la
# política de complejidad de Windows (CHECK_POLICY = ON): al menos una minúscula, una mayúscula, un
# número y un símbolo. Generador criptográfico, sin sesgo de módulo.
function New-PasswordLector {
    param([ValidateRange(16, 64)] [int] $Largo = 32)

    $grupos = @('abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!@#*+=?')
    $todos = -join $grupos
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $byte = New-Object byte[] 1
        $chars = New-Object System.Collections.Generic.List[char]
        $indice = {
            param([int] $n)
            $tope = 256 - (256 % $n)
            do { $rng.GetBytes($byte) } while ([int] $byte[0] -ge $tope)
            [int] $byte[0] % $n
        }
        foreach ($g in $grupos) { $chars.Add($g[(& $indice $g.Length)]) }
        while ($chars.Count -lt $Largo) { $chars.Add($todos[(& $indice $todos.Length)]) }
        # Fisher-Yates: que los obligatorios no queden siempre al principio.
        for ($i = $chars.Count - 1; $i -gt 0; $i--) {
            $j = & $indice ($i + 1)
            $tmp = $chars[$i]
            $chars[$i] = $chars[$j]
            $chars[$j] = $tmp
        }
        return (-join $chars)
    }
    finally {
        $rng.Dispose()
    }
}

# Las bases que parecen de SoftRestaurant (softrestaurant10, SoftRestaurant11...).
function Select-BaseSoftRestaurant {
    param([AllowEmptyCollection()] [AllowNull()] [string[]] $Bases)

    if ($null -eq $Bases) { return , @() }
    return , @($Bases | Where-Object { $_ -like 'softrestaurant*' })
}

# La URL del panel que trae el paquete (archivos\instalador.json, la escribe
# empaquetar-instalador.ps1). $null si no hay archivo; lanza si el archivo está mal.
function Read-ConfigPaquete {
    param([Parameter(Mandatory)] [string] $Carpeta)

    $ruta = Join-Path $Carpeta 'instalador.json'
    if (-not (Test-Path -LiteralPath $ruta -PathType Leaf)) { return $null }
    $obj = [System.IO.File]::ReadAllText($ruta) | ConvertFrom-Json
    $url = Get-CampoTexto $obj 'apiUrl'
    $problema = Test-ApiUrl $url
    if ($problema) { throw "instalador.json trae una dirección del panel inválida: $problema" }
    return $url.Trim().TrimEnd('/')
}

# Lee un config.json existente (el que escribió un instalador anterior). $null si no existe o no
# se entiende. El instalador de un clic lo usa para conservar lo que no pregunta.
function Read-ConfigExistente {
    param([Parameter(Mandatory)] [string] $Ruta)

    if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { return $null }
    try {
        return ([System.IO.File]::ReadAllText($Ruta) | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

# Un campo de texto de un objeto (de JSON) o $null, sin tronar con StrictMode si no existe.
function Get-CampoTexto {
    param($Objeto, [Parameter(Mandatory)] [string] $Nombre)

    if ($null -eq $Objeto) { return $null }
    $prop = $Objeto.PSObject.Properties[$Nombre]
    if ($null -eq $prop -or $null -eq $prop.Value) { return $null }
    return [string] $prop.Value
}

# --- sqlcmd -----------------------------------------------------------------------------

# Los argumentos COMPLETOS de sqlcmd como arreglo, uno por elemento. Nada de splatting de un valor
# suelto ni de elementos vacíos: con autenticación de Windows, crear-usuario-lector.ps1 armaba el
# acceso aparte (`@acceso`) y sqlcmd recibía un argumento en blanco ("Unknown Option"). Un
# argumento vacío aquí es un error de programación y truena ANTES de llamar a sqlcmd.
function Get-ArgumentosSqlcmd {
    param(
        [Parameter(Mandatory)] [string] $Servidor,
        [AllowEmptyString()] [AllowNull()] [string] $UsuarioAdmin,
        [AllowEmptyCollection()] [string[]] $Extra = @()
    )

    $lista = New-Object System.Collections.Generic.List[string]
    $lista.Add('-S')
    $lista.Add($Servidor.Trim())
    if ([string]::IsNullOrWhiteSpace($UsuarioAdmin)) {
        $lista.Add('-E')
    }
    else {
        # La contraseña NO va aquí: sqlcmd la toma de SQLCMDPASSWORD (no queda en la línea de comando).
        $lista.Add('-U')
        $lista.Add($UsuarioAdmin.Trim())
    }
    foreach ($a in $Extra) {
        if ([string]::IsNullOrWhiteSpace($a)) {
            throw "Argumento vacío para sqlcmd después de '$($lista[$lista.Count - 1])'."
        }
        $lista.Add($a)
    }
    return , $lista.ToArray()
}

# Corre sqlcmd con un arreglo de argumentos (cada elemento, un argumento) y devuelve el código y
# la salida (stdout + stderr).
function Invoke-ProgramaSqlcmd {
    param(
        [Parameter(Mandatory)] [string] $Sqlcmd,
        [Parameter(Mandatory)] [string[]] $Argumentos
    )

    # En 5.1, con 'Stop', una línea de stderr de un exe con 2>&1 corta el script.
    $ErrorActionPreference = 'Continue'
    $salida = & $Sqlcmd $Argumentos 2>&1
    $codigo = $LASTEXITCODE
    return [pscustomobject]@{
        Codigo = $codigo
        Salida = @($salida | ForEach-Object { "$_" })
    }
}

# Sólo LEE la lista de bases (sys.databases), para no tener que adivinar el nombre.
function Get-BasesSql {
    param(
        [Parameter(Mandatory)] [string] $Sqlcmd,
        [Parameter(Mandatory)] [string] $Servidor,
        [AllowEmptyString()] [AllowNull()] [string] $UsuarioAdmin
    )

    $consulta = 'SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name;'
    $argumentos = Get-ArgumentosSqlcmd -Servidor $Servidor -UsuarioAdmin $UsuarioAdmin `
        -Extra @('-b', '-l', '10', '-t', '10', '-h', '-1', '-W', '-Q', $consulta)
    $r = Invoke-ProgramaSqlcmd -Sqlcmd $Sqlcmd -Argumentos $argumentos
    if ($r.Codigo -ne 0) {
        throw ("No se pudo entrar al SQL Server '$Servidor': " + (($r.Salida -join ' ').Trim()))
    }
    return , @($r.Salida | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# Sólo LEE (funciones de sistema, ninguna tabla de SoftRestaurant): ¿quien entra puede crear el
# login y el usuario en esa base? ¿el servidor sólo acepta usuarios de Windows? Así el instalador
# de un clic sabe ANTES de gastar el código si va a poder crear el lector (o si tiene que pedir sa).
function Get-PermisosLector {
    param(
        [Parameter(Mandatory)] [string] $Sqlcmd,
        [Parameter(Mandatory)] [string] $Servidor,
        [Parameter(Mandatory)] [string] $Base,
        [AllowEmptyString()] [AllowNull()] [string] $UsuarioAdmin
    )

    $problema = Test-NombreBase $Base
    if ($problema) { throw $problema }
    # $Base ya pasó la lista cerrada de Test-NombreBase: no puede cerrar la comilla.
    $consulta = "SET NOCOUNT ON; SELECT CAST(ISNULL(HAS_PERMS_BY_NAME(NULL, NULL, 'ALTER ANY LOGIN'), 0) AS int) * CAST(ISNULL(HAS_PERMS_BY_NAME(N'$Base', 'DATABASE', 'ALTER ANY USER'), 0) AS int), CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int);"
    $argumentos = Get-ArgumentosSqlcmd -Servidor $Servidor -UsuarioAdmin $UsuarioAdmin `
        -Extra @('-b', '-l', '10', '-t', '10', '-h', '-1', '-W', '-s', '|', '-Q', $consulta)
    $r = Invoke-ProgramaSqlcmd -Sqlcmd $Sqlcmd -Argumentos $argumentos
    if ($r.Codigo -ne 0) {
        throw ("No se pudo consultar los permisos en '$Servidor': " + (($r.Salida -join ' ').Trim()))
    }
    $fila = @($r.Salida | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+\|\d+$' }) | Select-Object -First 1
    if (-not $fila) {
        throw ('Respuesta inesperada de sqlcmd al consultar permisos: ' + (($r.Salida -join ' ').Trim()))
    }
    $partes = $fila.Split('|')
    return [pscustomobject]@{
        PuedeCrear  = ($partes[0] -eq '1')
        SoloWindows = ($partes[1] -eq '1')
    }
}

# Corre crear-usuario-lector.sql. La contraseña nueva y la base van por variable de entorno (no
# quedan en la línea de comando); la de sa, si se usa, ya viene en SQLCMDPASSWORD.
function Invoke-CrearLectorSql {
    param(
        [Parameter(Mandatory)] [string] $Sqlcmd,
        [Parameter(Mandatory)] [string] $ArchivoSql,
        [Parameter(Mandatory)] [string] $Servidor,
        [Parameter(Mandatory)] [string] $Base,
        [Parameter(Mandatory)] [string] $Password,
        [AllowEmptyString()] [AllowNull()] [string] $UsuarioAdmin
    )

    $env:BASE_SR = $Base
    $env:PASSWORD_LECTOR = $Password
    try {
        # -t 30: CREATE USER y sp_addrolemember toman bloqueos de metadatos en la base del POS; si
        # algo los hace esperar, mejor fallar que quedarse colgado.
        $argumentos = Get-ArgumentosSqlcmd -Servidor $Servidor -UsuarioAdmin $UsuarioAdmin `
            -Extra @('-b', '-l', '10', '-t', '30', '-i', $ArchivoSql)
        return (Invoke-ProgramaSqlcmd -Sqlcmd $Sqlcmd -Argumentos $argumentos)
    }
    finally {
        Remove-Item Env:\PASSWORD_LECTOR -ErrorAction SilentlyContinue
        Remove-Item Env:\BASE_SR -ErrorAction SilentlyContinue
    }
}

# sqlcmd viene con SQL Server (también con el Express de SoftRestaurant) pero no siempre
# está en el PATH.
function Find-Sqlcmd {
    $comando = Get-Command 'sqlcmd.exe' -ErrorAction SilentlyContinue
    if ($comando) { return $comando.Source }

    $raices = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
    foreach ($raiz in $raices) {
        $candidatos = @(
            Get-ChildItem -Path (Join-Path $raiz 'Microsoft SQL Server') -Filter 'sqlcmd.exe' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\Tools\\Binn\\' } |
                Sort-Object FullName -Descending
        )
        if ($candidatos.Count -gt 0) { return $candidatos[0].FullName }
    }
    return $null
}

# --- API del panel: canje del código de enlace ---------------------------------------------

# Cambia el código por la API key de la sucursal (POST {ApiUrl}/agente/enlace). Nunca lanza:
# devuelve @{ Ok; ApiKey; ApiUrl; Sucursal; Estado; Mensaje }. Con Ok = $false, Mensaje dice qué
# pasó y qué hacer. La key nunca se escribe en pantalla.
function Invoke-CanjeCodigoEnlace {
    param(
        [Parameter(Mandatory)] [string] $ApiUrl,
        [Parameter(Mandatory)] [string] $Codigo,
        [int] $TimeoutSegundos = 30
    )

    # PowerShell 5.1 en un Windows viejo ofrece TLS 1.0 por defecto y el panel exige 1.2.
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
    catch {
        Write-Verbose 'No se pudo activar TLS 1.2 (PowerShell 7 ya lo trae).'
    }

    $base = $ApiUrl.Trim().TrimEnd('/')
    $url = $base + '/agente/enlace'
    $cuerpo = '{"codigo":' + (ConvertTo-TextoJson (ConvertTo-CodigoEnlace $Codigo)) + '}'

    try {
        $r = Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($cuerpo)) -TimeoutSec $TimeoutSegundos -UseBasicParsing
    }
    catch {
        $estado = $null
        $respuesta = $_.Exception.PSObject.Properties['Response']
        if ($respuesta -and $respuesta.Value) {
            try { $estado = [int] $respuesta.Value.StatusCode } catch { $estado = $null }
        }
        $mensaje = if ($null -eq $estado) {
            "No pude llegar al panel en $base. Revisa que esta PC tenga internet. Detalle: $($_.Exception.Message)"
        }
        elseif ($estado -eq 404) {
            'El código no sirve: está mal escrito, ya se usó o ya venció (dura 30 minutos). Genera uno nuevo en el panel: Administración > Sucursales > Conectar sucursal.'
        }
        elseif ($estado -eq 400) {
            'El panel dice que el código no tiene el formato correcto. Cópialo otra vez del panel (6 letras y números, como K7P-42X).'
        }
        elseif ($estado -eq 429) {
            'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar; si sigue, llama a soporte.'
        }
        else {
            "El panel respondió un error ($estado). Intenta en unos minutos; si sigue, llama a soporte."
        }
        return [pscustomobject]@{ Ok = $false; ApiKey = $null; ApiUrl = $null; Sucursal = $null; Estado = $estado; Mensaje = $mensaje }
    }

    $apiKey = Get-CampoTexto $r 'apiKey'
    if (-not $apiKey -or (Test-ApiKey $apiKey)) {
        return [pscustomobject]@{ Ok = $false; ApiKey = $null; ApiUrl = $null; Sucursal = $null; Estado = 200; Mensaje = 'El panel respondió algo que no entiendo (sin API key). Llama a soporte.' }
    }
    # La URL que dice el panel (API_URL_PUBLICA) manda; si no la dice o es inválida, la del paquete.
    $urlRespuesta = Get-CampoTexto $r 'apiUrl'
    $urlFinal = if ($urlRespuesta -and -not (Test-ApiUrl $urlRespuesta)) { $urlRespuesta.Trim().TrimEnd('/') } else { $base }
    return [pscustomobject]@{
        Ok       = $true
        ApiKey   = $apiKey
        ApiUrl   = $urlFinal
        Sucursal = (Get-CampoTexto $r 'sucursal')
        Estado   = 200
        Mensaje  = $null
    }
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
