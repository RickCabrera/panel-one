<#
.SYNOPSIS
    Instala (o actualiza) el agente ArkonAgente como servicio de Windows.

.DESCRIPTION
    Guía paso a paso: docs/instalacion-agente.md (paso 4). Desde una consola de
    ADMINISTRADOR, en la carpeta donde están agente.exe y este script:

        powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1

    Qué hace, en orden:
      1. Revisa que la consola sea de administrador y que agente.exe esté al lado.
      2. Si el servicio ya existe (actualización), lo detiene.
      3. Copia agente.exe a "C:\Program Files\ArkonAgente".
      4. Protege "C:\ProgramData\ArkonAgente": sólo SYSTEM y Administradores (y, más
         abajo, la cuenta del servicio). Siempre, aunque la carpeta ya exista.
      5. Escribe config.json preguntando los datos (la API key y la contraseña no se ven
         en pantalla ni quedan en el historial). Si ya hay uno, lo conserva.
      6. Registra el servicio (arranque automático retrasado, se levanta solo si se cae).
      7. Lo arranca.
      8. Corre "agente test" y dice si quedó reportando.

    Nunca borra cola.db ni los logs: lo que el agente no había mandado se conserva.

    Códigos de salida: 0 instalado y las dos conexiones funcionan; 1 instalado, pero falla
    una conexión (el test dice cuál); 2 config.json inválido; 3 no se pudo instalar.

.PARAMETER ApiUrl
    Dirección del panel (https://...). Si no se pone, se pregunta.

.PARAMETER Servidor
    Servidor SQL de SoftRestaurant, p. ej. .\NATIONALSOFT. Si no se pone, se pregunta
    (y si en la PC hay un solo SQL Server, se propone).

.PARAMETER Base
    Base de SoftRestaurant, p. ej. softrestaurant10. Si no se pone, se pregunta.

.PARAMETER UsuarioSql
    Usuario SQL de solo lectura. Por defecto monitor_lector (el que crea
    crear-usuario-lector.ps1).

.PARAMETER Exe
    Ruta de agente.exe. Por defecto, el que está junto a este script.

.PARAMETER CuentaServicio
    Virtual (por defecto): el servicio corre como la cuenta virtual NT SERVICE\ArkonAgente,
    que sólo puede tocar su carpeta. LocalSystem: la cuenta de todo el sistema; úsala sólo
    si con la virtual el servicio no arranca.

.PARAMETER ReemplazarConfig
    Vuelve a preguntar los datos y reescribe config.json aunque ya exista (por ejemplo,
    tras generar una API key nueva o cambiar la contraseña del lector).
#>
[CmdletBinding()]
param(
    [string] $ApiUrl,
    [string] $Servidor,
    [string] $Base,
    [string] $UsuarioSql = 'monitor_lector',
    [string] $Exe,
    [ValidateSet('Virtual', 'LocalSystem')]
    [string] $CuentaServicio = 'Virtual',
    [switch] $ReemplazarConfig
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'funciones-instalador.ps1')

$carpetaPrograma = Join-Path $env:ProgramFiles $script:NombreServicio
$exeDestino = Join-Path $carpetaPrograma 'agente.exe'
$carpetaDatos = Join-Path $env:ProgramData $script:NombreServicio
$archivoConfig = Join-Path $carpetaDatos 'config.json'
if (-not $Exe) { $Exe = Join-Path $PSScriptRoot 'agente.exe' }

# sc.exe con la línea de comando LITERAL: así binPath conserva sus comillas internas.
# (Ojo: en PowerShell 5.1 "sc" a secas es Set-Content, no el administrador de servicios.)
function Invoke-ScExe {
    param([Parameter(Mandatory)] [string] $Argumentos)

    $salida = [System.IO.Path]::GetTempFileName()
    try {
        $proceso = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\sc.exe') `
            -ArgumentList $Argumentos -NoNewWindow -Wait -PassThru -RedirectStandardOutput $salida
        if ($proceso.ExitCode -ne 0) {
            $detalle = (Get-Content $salida -ErrorAction SilentlyContinue) -join ' '
            throw "sc.exe $($Argumentos.Split(' ')[0]) falló (código $($proceso.ExitCode)): $detalle"
        }
    }
    finally {
        Remove-Item $salida -ErrorAction SilentlyContinue
    }
}

function Invoke-Icacls {
    param([Parameter(Mandatory)] [string[]] $Argumentos)

    # En 5.1, con 'Stop', una línea de stderr de un exe con 2>&1 corta el script.
    $ErrorActionPreference = 'Continue'
    $salida = & (Join-Path $env:SystemRoot 'System32\icacls.exe') @Argumentos 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "icacls falló (código $LASTEXITCODE): $($salida -join ' ')"
    }
}

function Write-UltimoLog {
    $ultimo = Get-ChildItem (Join-Path $carpetaDatos 'logs') -Filter 'agente-*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime | Select-Object -Last 1
    if ($ultimo) {
        Write-Problema "Últimas líneas de $($ultimo.FullName):"
        Get-Content $ultimo.FullName -Tail 15 | ForEach-Object { Write-Host "    $_" }
    }
    else {
        Write-Problema "El agente no alcanzó a escribir log en $carpetaDatos\logs."
    }
}

function Invoke-Instalacion {
    Write-Host 'Instalación del agente ArkonAgente (monitor SoftRestaurant)' -ForegroundColor White

    # ---------------------------------------------------------------- 1
    Write-Paso '[1/8] Revisando requisitos'
    if (-not (Test-EsAdministrador)) {
        Write-ComoAbrirAdministrador
        return 3
    }
    if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) {
        Write-Problema "No encontré agente.exe en: $Exe"
        Write-Problema 'Corre este script desde la carpeta del paquete del agente (donde está agente.exe).'
        return 3
    }
    $Exe = (Resolve-Path -LiteralPath $Exe).Path
    Write-Bien "agente.exe: $Exe"

    # ---------------------------------------------------------------- 2
    Write-Paso '[2/8] Deteniendo el servicio anterior (si existe)'
    $servicio = Get-Service -Name $script:NombreServicio -ErrorAction SilentlyContinue
    if ($servicio) {
        if ($servicio.Status -ne 'Stopped') {
            Stop-Service -Name $script:NombreServicio -Force
            $servicio.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        }
        Write-Bien 'El servicio ya existía: se detuvo para actualizarlo. Su config.json y su cola se conservan.'
    }
    else {
        Write-Bien 'Instalación nueva.'
    }

    # ---------------------------------------------------------------- 3
    Write-Paso "[3/8] Copiando agente.exe a $carpetaPrograma"
    New-Item -ItemType Directory -Path $carpetaPrograma -Force | Out-Null
    if ($Exe -ieq $exeDestino) {
        Write-Bien 'El exe ya está en su lugar.'
    }
    else {
        # El proceso puede tardar un momento en soltar el archivo tras detenerse.
        $copiado = $false
        for ($intento = 1; -not $copiado; $intento++) {
            try {
                Copy-Item -LiteralPath $Exe -Destination $exeDestino -Force
                $copiado = $true
            }
            catch {
                if ($intento -ge 10) { throw }
                Start-Sleep -Seconds 1
            }
        }
        Write-Bien 'Copiado.'
    }

    # ---------------------------------------------------------------- 4
    Write-Paso "[4/8] Protegiendo $carpetaDatos (trae la API key y la contraseña de SQL)"
    New-Item -ItemType Directory -Path $carpetaDatos -Force | Out-Null
    # Por SID (en un Windows en español "Administrators" no existe) y en dos pasos:
    # primero se dan los permisos y DESPUÉS se corta la herencia, para que la carpeta
    # nunca se quede sin dueño. Se aplica siempre: una instalación a mano pudo dejarla
    # con los permisos heredados de ProgramData (que deja leer a todos los usuarios).
    Invoke-Icacls @($carpetaDatos, '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Invoke-Icacls @($carpetaDatos, '/inheritance:r')
    # /grant:r sólo reemplaza a SYSTEM y Administradores: si una instalación a mano dejó a
    # alguien más (p. ej. Usuarios), sigue ahí. No se quita a ciegas: se avisa.
    $otros = @((Get-Acl -LiteralPath $carpetaDatos).Access | Where-Object {
            $sid = try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { '' }
            $sid -ne 'S-1-5-18' -and $sid -ne 'S-1-5-32-544' -and $sid -notlike 'S-1-5-80-*'
        })
    foreach ($ace in $otros) {
        Write-Problema "AVISO: $($ace.IdentityReference) también tiene permiso sobre la carpeta ($($ace.FileSystemRights)). Si no debe, quítalo:"
        Write-Problema "  icacls `"$carpetaDatos`" /remove `"$($ace.IdentityReference)`""
    }
    Write-Bien 'Sólo SYSTEM y Administradores (la cuenta del servicio se agrega en el paso 6).'

    # ---------------------------------------------------------------- 5
    Write-Paso '[5/8] Configuración (config.json)'
    if ((Test-Path -LiteralPath $archivoConfig) -and -not $ReemplazarConfig) {
        Write-Bien "Ya existe $archivoConfig y se conserva tal cual."
        Write-Bien 'Para cambiar los datos: vuelve a correr con -ReemplazarConfig.'
    }
    else {
        Write-Host '  Datos que vas a necesitar: la dirección del panel, la API key de la sucursal y'
        Write-Host '  la contraseña del usuario de solo lectura (paso 3 de la guía).'
        $url = if ($ApiUrl) { $ApiUrl } else { $null }
        if (-not $url -or (Test-ApiUrl $url)) {
            if ($url) { Write-Problema (Test-ApiUrl $url) }
            $url = Read-Valor -Pregunta '  Dirección del panel (https://...)' -Validar { param($v) Test-ApiUrl $v }
        }
        $key = Read-Secreto -Pregunta '  API key de la sucursal (pégala; no se ve al escribir)' -Validar { param($v) Test-ApiKey $v }

        $sugerido = if ($Servidor) { $Servidor } else { Get-ServidorSugerido }
        $srv = Read-Valor -Pregunta '  Servidor SQL de SoftRestaurant' -Sugerido $sugerido -Validar { param($v) Test-ValorCadena $v 'el servidor' }
        $bd = Read-Valor -Pregunta '  Base de SoftRestaurant' -Sugerido $Base -Validar { param($v) Test-NombreBase $v }
        $usr = Read-Valor -Pregunta '  Usuario SQL de solo lectura' -Sugerido $UsuarioSql -Validar { param($v) Test-ValorCadena $v 'el usuario' }
        $passwordSql = Read-Secreto -Pregunta "  Contraseña de $usr (no se ve al escribir)" -Validar { param($v) Test-PasswordCadena $v }

        $cadena = New-CadenaConexion -Servidor $srv -Base $bd -Usuario $usr -Password $passwordSql
        Write-ArchivoSinBom -Ruta $archivoConfig -Contenido (New-ContenidoConfig -ApiUrl $url -ApiKey $key -Cadena $cadena)
        $key = $null; $passwordSql = $null; $cadena = $null
        Write-Bien "Escrito $archivoConfig"
    }

    # ---------------------------------------------------------------- 6
    Write-Paso "[6/8] Registrando el servicio $($script:NombreServicio) (cuenta: $CuentaServicio)"
    $accion = if (Get-Service -Name $script:NombreServicio -ErrorAction SilentlyContinue) { 'config' } else { 'create' }
    Invoke-ScExe (Get-ArgumentosScServicio -Accion $accion -RutaExe $exeDestino -Cuenta $CuentaServicio)
    Invoke-ScExe "description $($script:NombreServicio) `"$($script:DescripcionServicio)`""
    # Si el proceso se cae, se levanta al minuto (tres veces; el contador se reinicia cada
    # 24 h). failureflag 1: también si se detiene con error (código 1, ver agent/README.md).
    Invoke-ScExe "failure $($script:NombreServicio) reset= 86400 actions= restart/60000/restart/60000/restart/60000"
    Invoke-ScExe "failureflag $($script:NombreServicio) 1"
    # SID propio del servicio en su token: es a quien se le da permiso sobre la carpeta.
    Invoke-ScExe "sidtype $($script:NombreServicio) unrestricted"

    # DECISION PROVISIONAL (nocturno): cuenta virtual NT SERVICE\ArkonAgente por defecto (menor
    # privilegio: sólo su carpeta y salir por HTTPS; al SQL entra con usuario SQL, no con la
    # cuenta de Windows). Nunca se ha corrido como servicio: lo verifica F1-020b. Si falla,
    # -CuentaServicio LocalSystem. El SID del servicio también recibe el permiso con
    # LocalSystem: no estorba y deja la carpeta igual en los dos casos.
    $cuentaServicio = New-Object System.Security.Principal.NTAccount('NT SERVICE', $script:NombreServicio)
    $sidServicio = $cuentaServicio.Translate([System.Security.Principal.SecurityIdentifier]).Value
    # Modificar (no control total): leer config.json, escribir logs y cola.db.
    Invoke-Icacls @($carpetaDatos, '/grant', "*$($sidServicio):(OI)(CI)M")
    Write-Bien "Servicio registrado. La cuenta del servicio ($sidServicio) puede modificar $carpetaDatos."

    # ---------------------------------------------------------------- 7
    Write-Paso '[7/8] Arrancando el servicio'
    try {
        Start-Service -Name $script:NombreServicio
        (Get-Service -Name $script:NombreServicio).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        Write-Bien 'El servicio está corriendo.'
    }
    catch {
        Write-Problema "El servicio no arrancó: $($_.Exception.Message)"
        Write-UltimoLog
        if ($CuentaServicio -eq 'Virtual') {
            Write-Problema 'Prueba con la otra cuenta:  .\instalar.ps1 -CuentaServicio LocalSystem'
        }
        return 3
    }

    # ---------------------------------------------------------------- 8
    Write-Paso '[8/8] Probando las conexiones (agente test)'
    & $exeDestino test | Out-Host
    $codigo = $LASTEXITCODE

    # Que el servicio siga vivo después de un momento (con la cuenta virtual, un problema de
    # permisos sobre la carpeta lo tumbaría aquí, no en el test, que corre como tú).
    Start-Sleep -Seconds 5
    $estado = (Get-Service -Name $script:NombreServicio).Status
    if ($estado -ne 'Running') {
        Write-Problema "El servicio se detuvo después de arrancar (estado: $estado)."
        Write-UltimoLog
        if ($CuentaServicio -eq 'Virtual') {
            Write-Problema 'Prueba con la otra cuenta:  .\instalar.ps1 -CuentaServicio LocalSystem'
        }
        return 3
    }

    Write-Host ''
    switch ($codigo) {
        0 {
            Write-Host 'LISTO: el agente quedó instalado y reportando.' -ForegroundColor Green
            Write-Host 'Confírmalo en el panel: Administración > Agentes (la sucursal debe decir "Conectado" en menos de un minuto).'
        }
        2 {
            Write-Host 'El servicio quedó instalado, pero config.json tiene errores (arriba dice cuáles).' -ForegroundColor Yellow
            Write-Host 'Corrígelo volviendo a correr:  .\instalar.ps1 -ReemplazarConfig'
            Write-Host 'El servicio vuelve a leer config.json cada minuto: no hace falta reiniciarlo.'
        }
        default {
            Write-Host 'El servicio quedó instalado, pero FALLA una conexión (arriba dice cuál y qué hacer).' -ForegroundColor Yellow
            Write-Host 'Si es un dato mal escrito:  .\instalar.ps1 -ReemplazarConfig'
            Write-Host 'Guía de problemas: docs/instalacion-agente.md, "Si algo sale mal".'
            $codigo = 1
        }
    }
    return $codigo
}

try {
    $codigoSalida = Invoke-Instalacion
}
catch {
    Write-Host ''
    Write-Host "No se pudo instalar: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Nada de lo que ya estaba (config.json, cola.db, logs) se borró.'
    $codigoSalida = 3
}
exit $codigoSalida
