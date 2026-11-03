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

# Find-Sqlcmd, Get-BasesSql e Invoke-CrearLectorSql viven en funciones-instalador.ps1 (las usa
# también el instalador de un clic). Arman los argumentos de sqlcmd como UN arreglo completo:
# antes, con autenticación de Windows, el acceso iba aparte (`@acceso`) y sqlcmd recibía un
# argumento en blanco ("Sqlcmd: ' ': Unknown Option").

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
        $bases = Get-BasesSql -Sqlcmd $sqlcmd -Servidor $srv -UsuarioAdmin $UsuarioAdmin
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
    # La contraseña y la base van por variable de entorno y no con -v: así no quedan en la línea
    # de comando (ni en el historial). Sólo viven en este proceso y en el sqlcmd hijo.
    try {
        $resultado = Invoke-CrearLectorSql -Sqlcmd $sqlcmd -ArchivoSql $archivoSql -Servidor $srv `
            -Base $bd -Password $password -UsuarioAdmin $UsuarioAdmin
        $resultado.Salida | ForEach-Object { Write-Host "  $_" }
        $codigo = $resultado.Codigo
    }
    finally {
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
