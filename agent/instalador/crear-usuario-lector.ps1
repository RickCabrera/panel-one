<#
.SYNOPSIS
    Crea en el SQL Server de SoftRestaurant el usuario de SOLO LECTURA del agente.

.DESCRIPTION
    Guía paso a paso: docs/instalacion-agente.md (paso 3). Desde una consola de
    ADMINISTRADOR, en la carpeta del paquete del agente:

        powershell -NoProfile -ExecutionPolicy Bypass -File .\crear-usuario-lector.ps1

    Pregunta el servidor, la base y la contraseña nueva (dos veces, sin mostrarla ni
    dejarla en el historial de la consola) y corre crear-usuario-lector.sql con sqlcmd.
    Ese .sql SÓLO otorga el rol db_datareader: el usuario puede leer y nada más.

    Entra al SQL Server con tu usuario de Windows (sqlcmd -E). Si tu usuario de Windows no
    es administrador de ese SQL Server, usa -UsuarioAdmin sa: el script te pide la
    contraseña de sa (sin mostrarla). Esa cuenta sirve SÓLO para crear el lector; NUNCA va
    en config.json.

    Códigos de salida: 0 usuario listo; 1 el SQL Server lo rechazó (el mensaje dice por
    qué); 3 falta algo para intentarlo (consola, sqlcmd, archivo).

.PARAMETER Servidor
    Servidor SQL, p. ej. .\NATIONALSOFT. Si en la PC hay un solo SQL Server, se propone.

.PARAMETER Base
    Base de SoftRestaurant, p. ej. softrestaurant10. Si no se pone, se muestran las bases
    del servidor para elegir.

.PARAMETER UsuarioAdmin
    Login de SQL con el que se crea el lector, si no alcanza tu usuario de Windows (p. ej.
    sa). Se pide su contraseña sin mostrarla.
#>
[CmdletBinding()]
param(
    [string] $Servidor,
    [string] $Base,
    [string] $UsuarioAdmin
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'funciones-instalador.ps1')

$archivoSql = Join-Path $PSScriptRoot 'crear-usuario-lector.sql'

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

function Get-ArgumentosAcceso {
    if ($UsuarioAdmin) { return @('-U', $UsuarioAdmin) }
    return @('-E')
}

# Sólo LEE la lista de bases (sys.databases), para no tener que adivinar el nombre.
function Get-BasesDelServidor {
    param([string] $Sqlcmd, [string] $Srv)

    # En 5.1, con 'Stop', una línea de stderr de un exe con 2>&1 corta el script.
    $ErrorActionPreference = 'Continue'

    $consulta = 'SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name;'
    $acceso = Get-ArgumentosAcceso
    $salida = & $Sqlcmd -S $Srv @acceso -b -l 10 -t 10 -h -1 -W -Q $consulta 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("No se pudo entrar al SQL Server '$Srv': " + (($salida | Out-String).Trim()))
    }
    return @($salida | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

function Invoke-CrearLector {
    Write-Host 'Usuario de SOLO LECTURA para el agente ArkonAgente' -ForegroundColor White

    Write-Paso '[1/4] Revisando requisitos'
    if (-not (Test-EsAdministrador)) {
        Write-ComoAbrirAdministrador
        return 3
    }
    if (-not (Test-Path -LiteralPath $archivoSql -PathType Leaf)) {
        Write-Problema "Falta $archivoSql. Corre este script desde la carpeta del paquete del agente."
        return 3
    }
    $sqlcmd = Find-Sqlcmd
    if (-not $sqlcmd) {
        Write-Problema 'No encontré sqlcmd.exe en esta PC.'
        Write-Problema 'Alternativa: abre crear-usuario-lector.sql en SQL Server Management Studio, conectado'
        Write-Problema 'como administrador del SQL, activa "Modo SQLCMD" (menú Consulta) y agrega al inicio:'
        Write-Problema '    :setvar BASE_SR "nombre_de_la_base"'
        Write-Problema '    :setvar PASSWORD_LECTOR "la_contraseña"'
        Write-Problema 'Luego ejecútalo, y CIERRA esa pestaña sin guardar (la contraseña queda escrita ahí).'
        return 3
    }
    Write-Bien "sqlcmd: $sqlcmd"

    Write-Paso '[2/4] Servidor y base de SoftRestaurant'
    $sugerido = if ($Servidor) { $Servidor } else { Get-ServidorSugerido }
    $srv = Read-Valor -Pregunta '  Servidor SQL' -Sugerido $sugerido -Validar { param($v) Test-ValorCadena $v 'el servidor' }
    if ($UsuarioAdmin) {
        # sqlcmd la toma de SQLCMDPASSWORD si no va -P: así no queda en la línea de comando.
        $env:SQLCMDPASSWORD = Read-Secreto -Pregunta "  Contraseña de '$UsuarioAdmin' (no se ve al escribir)" -Validar { param($v) $null }
    }

    $bd = $Base
    if (-not $bd) {
        $bases = Get-BasesDelServidor -Sqlcmd $sqlcmd -Srv $srv
        if ($bases.Count -eq 0) {
            Write-Problema "El servidor '$srv' no tiene bases de usuario. ¿Es el SQL Server de SoftRestaurant?"
            return 3
        }
        Write-Host '  Bases en ese servidor:'
        $bases | ForEach-Object { Write-Host "    - $_" }
        $deSr = @($bases | Where-Object { $_ -like 'softrestaurant*' })
        $sugeridaBase = if ($deSr.Count -eq 1) { $deSr[0] } else { $null }
        $bd = Read-Valor -Pregunta '  Base de SoftRestaurant' -Sugerido $sugeridaBase -Validar {
            param($v)
            if ($bases -notcontains $v) { return "No existe la base '$v' en ese servidor." }
            Test-NombreBase $v
        }
    }
    elseif (Test-NombreBase $bd) {
        Write-Problema (Test-NombreBase $bd)
        return 3
    }

    Write-Paso '[3/4] Contraseña NUEVA para monitor_lector'
    Write-Host "  Reglas: 12 a 64 caracteres; letras sin acento, números y estos símbolos: $script:SimbolosPassword"
    Write-Host '  Anótala: la vas a necesitar en el paso 4 (instalar.ps1).'
    $password = Read-Secreto -Pregunta '  Contraseña nueva (no se ve al escribir)' -Validar { param($v) Test-PasswordNueva $v } -Confirmar

    Write-Paso "[4/4] Creando monitor_lector en $srv / $bd (sólo lectura)"
    # Por variable de entorno y no con -v: así la contraseña no queda en la línea de
    # comando (ni en el historial). Sólo vive en este proceso y en el sqlcmd hijo.
    $env:BASE_SR = $bd
    $env:PASSWORD_LECTOR = $password
    try {
        $acceso = Get-ArgumentosAcceso
        # -t 30: CREATE USER y sp_addrolemember toman bloqueos de metadatos en la base del
        # POS; si algo los hace esperar, mejor fallar que quedarse colgado.
        & $sqlcmd -S $srv @acceso -b -l 10 -t 30 -i $archivoSql | Out-Host
        $codigo = $LASTEXITCODE
    }
    finally {
        Remove-Item Env:\PASSWORD_LECTOR -ErrorAction SilentlyContinue
        Remove-Item Env:\BASE_SR -ErrorAction SilentlyContinue
        Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
        $password = $null
    }

    Write-Host ''
    if ($codigo -eq 0) {
        Write-Host 'LISTO: monitor_lector sólo puede leer la base de SoftRestaurant.' -ForegroundColor Green
        Write-Host 'Sigue con el paso 4 de la guía: .\instalar.ps1'
        return 0
    }

    Write-Host 'El SQL Server no creó el usuario (el mensaje de arriba dice por qué).' -ForegroundColor Yellow
    Write-Host 'Si dice "Login failed" o "permission denied": tu usuario de Windows no es administrador de ese SQL.'
    Write-Host '  Prueba con:  .\crear-usuario-lector.ps1 -UsuarioAdmin sa'
    Write-Host 'Si el mensaje empieza con "ALTO": no se cambió nada; sigue lo que dice.'
    return 1
}

try {
    $codigoSalida = Invoke-CrearLector
}
catch {
    Write-Host ''
    Write-Host "No se pudo: $($_.Exception.Message)" -ForegroundColor Red
    $codigoSalida = 3
}
finally {
    Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PASSWORD_LECTOR -ErrorAction SilentlyContinue
}
exit $codigoSalida
