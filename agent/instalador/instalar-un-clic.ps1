<#
.SYNOPSIS
    Instalador de UN CLIC del agente Yo Controlo (ArkonAgente): sólo pide el código de enlace.

.DESCRIPTION
    Lo abre Instalar-YoControlo.cmd (doble clic; pide permiso de administrador solo). Guía:
    docs/instalacion-agente.md. Qué hace, en orden:

      1. Revisa la PC: administrador, archivos del paquete y sqlcmd. Toma la dirección del panel
         del paquete (instalador.json) o de -ApiUrl; sólo si no hay, la pregunta.
      2. Busca el SQL Server de SoftRestaurant y su base (softrestaurant*). Sólo pregunta si hay
         varios. Revisa, SÓLO LEYENDO, que se pueda crear el usuario de solo lectura; si tu usuario
         de Windows no puede, pide la contraseña de sa (sólo para eso; nunca se guarda).
      3. Pide el código de enlace del panel y lo cambia por la API key de la sucursal. Un código
         equivocado no cambia nada: se puede escribir otro. DESDE AQUÍ la key anterior de la
         sucursal ya no sirve: cualquier falla posterior pasa por el respaldo (abajo).
      4. Crea (o actualiza) monitor_lector con una contraseña ALEATORIA que nadie ve, con
         crear-usuario-lector.sql: SÓLO db_datareader.
      5. Escribe config.json e instala/actualiza los dos servicios con instalar.ps1 (que también
         corre "agente test"). Si el servicio no puede INICIAR SESIÓN con la cuenta virtual
         (errores 1069/1079), reintenta con LocalSystem.
      6. Dice el resultado (LISTO, o qué pasó y qué hacer) y lo deja escrito en
         C:\ProgramData\ArkonAgente\logs\instalacion-AAAAMMDD.log.

    Respaldo tras el canje: si algo falla después del paso 3 y en la PC ya había un agente, se le
    escribe la key NUEVA (con la contraseña nueva si el SQL ya la acepta; si no, con la de antes) y
    se reinicia, para que siga reportando. Si no se puede, el resultado dice claro que quedó
    desconectado y que hace falta un código nuevo.

    Reinstalar encima de una instalación existente funciona: conserva la cola (cola.db) y los
    logs, y reemplaza la API key y la contraseña del lector por unas nuevas.

    El modo manual (crear-usuario-lector.ps1 + instalar.ps1) sigue igual, para soporte.

    Códigos de salida: 0 listo; 1 instalado pero falla una conexión; 2 config.json inválido;
    3 no se pudo (el mensaje dice qué cambió y qué no).

    Cargarlo con dot-source (`. .\instalar-un-clic.ps1`) sólo define las funciones: así lo prueba
    InstaladorUnClicTests con un sqlcmd, un API y un instalar.ps1 falsos.

.PARAMETER Codigo
    El código de enlace (K7P4-42XQ). Si no se pone, se pregunta. Es de un solo uso y vence a los
    30 minutos: no es un secreto que dure, pero igual no lo dejes escrito en ningún lado.

.PARAMETER ApiUrl
    Dirección del panel, si el paquete no la trae (o para usar otra).

.PARAMETER Servidor
    Servidor SQL (p. ej. .\NATIONALSOFT), si no se quiere que lo detecte.

.PARAMETER Base
    Base de SoftRestaurant, si no se quiere que la detecte.

.PARAMETER UsuarioAdmin
    Login de SQL con el que se crea el lector (p. ej. sa), si ya sabes que tu usuario de Windows
    no alcanza. Se pide su contraseña sin mostrarla.

.PARAMETER CuentaServicio
    Virtual (por defecto; LocalSystem automático sólo si no puede iniciar sesión) o LocalSystem.
#>
[CmdletBinding()]
param(
    [string] $Codigo,
    [string] $ApiUrl,
    [string] $Servidor,
    [string] $Base,
    [string] $UsuarioAdmin,
    [ValidateSet('Virtual', 'LocalSystem')]
    [string] $CuentaServicio = 'Virtual'
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'funciones-instalador.ps1')

$archivoSql = Join-Path $PSScriptRoot 'crear-usuario-lector.sql'
$exePaquete = Join-Path $PSScriptRoot 'agente.exe'
$scriptInstalar = Join-Path $PSScriptRoot 'instalar.ps1'
# En Windows es C:\ProgramData. GetFolderPath sólo cubre el dot-source de los tests en Linux, donde
# $env:ProgramData no existe (ahí el test sustituye $archivoConfig).
$programData = if ($env:ProgramData) { $env:ProgramData } else { [Environment]::GetFolderPath('CommonApplicationData') }
$archivoConfig = Join-Path (Join-Path $programData $script:NombreServicio) 'config.json'
$inicio = Get-Date

# El recuadro final. Sin emojis: la consola de PowerShell 5.1 (conhost, fuente Consolas) los
# muestra como cuadritos; √ y × sí vienen en la fuente.
function Write-Resultado {
    param([bool] $Bien, [string] $Titulo, [string[]] $Lineas = @())

    $color = if ($Bien) { 'Green' } else { 'Red' }
    $marca = if ($Bien) { [string] [char] 0x221A } else { [string] [char] 0x00D7 }
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor $color
    Write-Host "  $marca  $Titulo" -ForegroundColor $color
    Write-Host ''
    foreach ($l in $Lineas) { Write-Host "     $l" }
    Write-Host ('=' * 70) -ForegroundColor $color
    $estado = if ($Bien) { 'LISTO' } else { 'FALLA' }
    Write-RegistroInstalacion (@("$estado | $Titulo") + $Lineas)
}

# Deja el resultado en C:\ProgramData\ArkonAgente\logs\instalacion-AAAAMMDD.log, junto al log del
# agente (que lo escribe Serilog y no se comparte). Sin secretos: ni la key, ni contraseñas, ni el
# código. Sólo si la carpeta del agente ya existe (la protege instalar.ps1); si no, sólo consola.
function Write-RegistroInstalacion {
    param([string[]] $Lineas)

    try {
        $carpetaDatos = Split-Path -Parent $archivoConfig
        if (-not (Test-Path -LiteralPath $carpetaDatos -PathType Container)) { return }
        $logs = Join-Path $carpetaDatos 'logs'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $ruta = Join-Path $logs ('instalacion-' + (Get-Date).ToString('yyyyMMdd') + '.log')
        $sello = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + 'Z'
        $texto = (@($Lineas) | ForEach-Object { "$sello [instalar-un-clic] $_" }) -join "`r`n"
        [System.IO.File]::AppendAllText($ruta, $texto + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    }
    catch {
        Write-Verbose "No se pudo escribir el registro de instalación: $($_.Exception.Message)"
    }
}

# Elegir de una lista numerada (sólo cuando hay más de un candidato).
function Read-Opcion {
    param([Parameter(Mandatory)] [string] $Pregunta, [Parameter(Mandatory)] [string[]] $Opciones)

    for ($i = 0; $i -lt $Opciones.Count; $i++) {
        Write-Host ('    {0}) {1}' -f ($i + 1), $Opciones[$i])
    }
    while ($true) {
        $texto = "$(Read-Host "  $Pregunta (escribe el número)")".Trim()
        if (-not $texto) { throw 'Cancelado: no se eligió nada.' }
        $n = 0
        if ([int]::TryParse($texto, [ref] $n) -and $n -ge 1 -and $n -le $Opciones.Count) {
            return $Opciones[$n - 1]
        }
        Write-Problema "Escribe un número del 1 al $($Opciones.Count)."
    }
}

# Los SQL Server que corren en esta PC, como .\INSTANCIA.
# ⚠️ SUPUESTO (docs/esquema-sr.md §11): el SQL de SoftRestaurant es un servicio MSSQLSERVER o MSSQL$*.
function Get-ServidoresSqlLocales {
    $servicios = @(Get-Service -Name 'MSSQLSERVER', 'MSSQL$*' -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -eq 'Running' })
    return , @($servicios | ForEach-Object { ConvertTo-ServidorLocal $_.Name } | Where-Object { $_ })
}

# Pide la contraseña del login administrador del SQL (sa) y la deja SÓLO en SQLCMDPASSWORD de
# este proceso (sqlcmd la toma de ahí). Se borra al terminar el paso del lector, y en el finally.
function Read-AccesoAdmin {
    param([string] $Usuario = 'sa')

    Write-Host "  Para crear el usuario de solo lectura hace falta la contraseña de '$Usuario' del SQL Server"
    Write-Host '  (suele tenerla el soporte de SoftRestaurant). Sólo se usa para eso, ahora; NO se guarda.'
    $env:SQLCMDPASSWORD = Read-Secreto -Pregunta "  Contraseña de '$Usuario' (no se ve al escribir)" -Validar { param($v) $null }
    return $Usuario
}

# Restart-Service, aparte para que el test lo pueda sustituir.
function Restart-ServicioAgente {
    Restart-Service -Name $script:NombreServicio -Force -ErrorAction Stop
}

# El respaldo tras el canje: la key anterior de la sucursal YA no sirve. Si en la PC hay un agente
# (config.json), se le escribe la key nueva, con la cadena NUEVA si el SQL ya acepta la contraseña
# nueva, o con la suya de antes si no, y se reinicia. Devuelve las líneas para el resultado.
function Invoke-RespaldoTrasCanje {
    param([Parameter(Mandatory)] $Canje, [AllowEmptyString()] [AllowNull()] [string] $CadenaNueva)

    $existente = Read-ConfigExistente -Ruta $archivoConfig
    if ($null -eq $existente) {
        return , @(
            'El código ya se usó y en esta PC no quedó ningún agente con la llave nueva.',
            'Genera un código NUEVO en el panel y vuelve a correr Instalar-YoControlo.')
    }
    $cadena = if ($CadenaNueva) { $CadenaNueva } else { Get-CampoTexto $existente 'connectionString' }
    if (-not $cadena) {
        return , @(
            'El agente que ya estaba quedó DESCONECTADO: su llave ya no sirve y su configuración no se pudo leer.',
            'Genera un código NUEVO en el panel y vuelve a correr Instalar-YoControlo.')
    }
    try {
        Write-ArchivoSinBom -Ruta $archivoConfig -Contenido (New-ContenidoConfig -ApiUrl $Canje.ApiUrl `
                -ApiKey $Canje.ApiKey -Cadena $cadena -HoraCatalogos (Get-CampoTexto $existente 'horaSincronizacionCatalogos'))
    }
    catch {
        return , @(
            'El agente que ya estaba quedó DESCONECTADO: su llave ya no sirve y no se pudo guardar la nueva.',
            'Genera un código NUEVO en el panel y vuelve a correr Instalar-YoControlo.')
    }
    $datos = if ($CadenaNueva) { 'la contraseña nueva del lector' } else { 'sus datos de SQL de antes' }
    try {
        Restart-ServicioAgente
        return , @("El agente que ya estaba se quedó con la llave nueva y $datos, y se reinició: sigue reportando.")
    }
    catch {
        return , @(
            "Se guardó la llave nueva (con $datos) en el agente que ya estaba, pero su servicio no se pudo reiniciar.",
            'Mientras no se reinicie (o se reinicie la PC) puede quedar DESCONECTADO.')
    }
}

function Invoke-UnClic {
    Write-Host 'Instalador de un clic del agente Yo Controlo (monitor de SoftRestaurant)' -ForegroundColor White
    Write-Host 'Sólo te va a pedir el código de enlace que aparece en el panel.'

    # ---------------------------------------------------------------- 1
    Write-Paso '[1/6] Revisando esta PC'
    if (-not (Test-EsAdministrador)) {
        Write-ComoAbrirAdministrador
        return 3
    }
    foreach ($f in @($exePaquete, $archivoSql, $scriptInstalar)) {
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) {
            Write-Resultado $false 'Falta un archivo del paquete' @(
                "No encontré $f. No se cambió nada.",
                'Vuelve a extraer el .zip completo (clic derecho > Extraer todo) y corre otra vez Instalar-YoControlo.')
            return 3
        }
    }
    # Un .zip bajado de internet deja sus archivos "bloqueados" (Mark of the Web).
    try {
        Get-ChildItem -LiteralPath $PSScriptRoot -File | Unblock-File -ErrorAction SilentlyContinue
    }
    catch {
        Write-Verbose 'Unblock-File no está disponible.'
    }
    $sqlcmd = Find-Sqlcmd
    if (-not $sqlcmd) {
        Write-Resultado $false 'No encontré sqlcmd.exe en esta PC' @(
            'Viene con el SQL Server de SoftRestaurant. ¿Es ésta la PC donde está el SQL Server? No se cambió nada.',
            'Si sí, llama a soporte: hay que instalar las herramientas de línea de comandos de SQL Server.')
        return 3
    }
    Write-Bien "sqlcmd: $sqlcmd"

    $url = $null
    if ($ApiUrl) {
        $problema = Test-ApiUrl $ApiUrl
        if ($problema) { Write-Problema $problema } else { $url = $ApiUrl.Trim().TrimEnd('/') }
    }
    if (-not $url) { $url = Read-ConfigPaquete -Carpeta $PSScriptRoot }
    if (-not $url) {
        Write-Problema 'Este paquete no trae la dirección del panel.'
        $url = (Read-Valor -Pregunta '  Dirección del panel (https://...)' -Validar { param($v) Test-ApiUrl $v }).TrimEnd('/')
    }
    Write-Bien "Panel: $url"

    # ---------------------------------------------------------------- 2
    # Todo lo de este paso sólo LEE: va ANTES del canje para que un SQL que no sirve no gaste el código.
    Write-Paso '[2/6] Buscando el SQL Server de SoftRestaurant'
    $usuarioAdmin = if ($UsuarioAdmin) { $UsuarioAdmin.Trim() } else { $null }
    if ($usuarioAdmin) { $usuarioAdmin = Read-AccesoAdmin -Usuario $usuarioAdmin }

    $srv = $Servidor
    if (-not $srv) {
        $servidores = Get-ServidoresSqlLocales
        if ($servidores.Count -eq 0) {
            Write-Resultado $false 'No encontré un SQL Server funcionando en esta PC' @(
                'El agente se instala en la PC donde está el SQL Server de SoftRestaurant (casi siempre la caja principal).',
                'No se cambió nada. Si SoftRestaurant sí está en esta PC, llama a soporte.')
            return 3
        }
        elseif ($servidores.Count -eq 1) {
            $srv = $servidores[0]
        }
        else {
            # Varios: el único que tenga una base softrestaurant*, si lo hay.
            $conSr = @()
            foreach ($s in $servidores) {
                try {
                    if ((Select-BaseSoftRestaurant (Get-BasesSql -Sqlcmd $sqlcmd -Servidor $s -UsuarioAdmin $usuarioAdmin)).Count -gt 0) {
                        $conSr += $s
                    }
                }
                catch {
                    Write-Verbose "No se pudo listar las bases de $s."
                }
            }
            if ($conSr.Count -eq 1) {
                $srv = $conSr[0]
            }
            else {
                Write-Host '  En esta PC hay varios SQL Server:'
                $srv = Read-Opcion -Pregunta '¿Cuál es el de SoftRestaurant?' -Opciones $servidores
            }
        }
    }
    $problema = Test-ValorCadena $srv 'el servidor'
    if ($problema) { throw $problema }
    Write-Bien "Servidor: $srv"

    $bases = $null
    try {
        $bases = Get-BasesSql -Sqlcmd $sqlcmd -Servidor $srv -UsuarioAdmin $usuarioAdmin
    }
    catch {
        if ($usuarioAdmin) { throw }
        Write-Problema 'Tu usuario de Windows no pudo entrar a ese SQL Server.'
        $usuarioAdmin = Read-AccesoAdmin
        $bases = Get-BasesSql -Sqlcmd $sqlcmd -Servidor $srv -UsuarioAdmin $usuarioAdmin
    }

    $bd = $Base
    if (-not $bd) {
        # ⚠️ SUPUESTO (docs/esquema-sr.md §11): la base de SR se llama softrestaurant*.
        $deSr = Select-BaseSoftRestaurant $bases
        if ($deSr.Count -eq 1) {
            $bd = $deSr[0]
        }
        elseif ($deSr.Count -gt 1) {
            Write-Host '  Hay varias bases de SoftRestaurant:'
            $bd = Read-Opcion -Pregunta '¿Cuál es la de esta sucursal?' -Opciones $deSr
        }
        elseif ($bases.Count -gt 0) {
            Write-Problema 'No encontré una base que se llame softrestaurant... Éstas son las que hay:'
            $bd = Read-Opcion -Pregunta '¿Cuál es la de SoftRestaurant?' -Opciones $bases
        }
        else {
            Write-Resultado $false "El SQL Server '$srv' no tiene bases" @(
                '¿Es el SQL Server de SoftRestaurant? No se cambió nada. Llama a soporte.')
            return 3
        }
    }
    $problema = Test-NombreBase $bd
    if ($problema) { throw $problema }
    Write-Bien "Base: $bd"

    $permisos = Get-PermisosLector -Sqlcmd $sqlcmd -Servidor $srv -Base $bd -UsuarioAdmin $usuarioAdmin
    if ($permisos.SoloWindows) {
        Write-Resultado $false 'Este SQL Server sólo acepta usuarios de Windows' @(
            'No se cambió nada (ni el código de enlace se usó).',
            'Cambiarlo obliga a reiniciar el SQL Server de SoftRestaurant: la caja deja de cobrar mientras tanto.',
            'NO lo hagas tú: llama a soporte.')
        return 3
    }
    if (-not $permisos.PuedeCrear -and -not $usuarioAdmin) {
        Write-Problema 'Tu usuario de Windows entra al SQL Server, pero no puede crear usuarios.'
        $usuarioAdmin = Read-AccesoAdmin
        $permisos = Get-PermisosLector -Sqlcmd $sqlcmd -Servidor $srv -Base $bd -UsuarioAdmin $usuarioAdmin
    }
    if (-not $permisos.PuedeCrear) {
        $quien = if ($usuarioAdmin) { $usuarioAdmin } else { 'tu usuario de Windows' }
        Write-Resultado $false "El usuario '$quien' no puede crear usuarios en ese SQL Server" @(
            'No se cambió nada (ni el código de enlace se usó).',
            'Hace falta un administrador del SQL Server (por ejemplo sa). Llama a soporte.')
        return 3
    }
    Write-Bien 'Se puede crear el usuario de solo lectura.'

    # ---------------------------------------------------------------- 3
    Write-Paso '[3/6] Código de enlace'
    Write-Host '  Está en el panel: Administración > Sucursales > Conectar sucursal (por ejemplo K7P4-42XQ).'
    $canje = $null
    $texto = $Codigo
    $fallidos = 0
    while ($null -eq $canje) {
        if (-not $texto -or (Test-CodigoEnlace $texto)) {
            if ($texto) { Write-Problema (Test-CodigoEnlace $texto) }
            $texto = Read-Valor -Pregunta '  Código de enlace' -Validar { param($v) Test-CodigoEnlace $v }
        }
        Write-Host '  Revisando el código con el panel...'
        $r = Invoke-CanjeCodigoEnlace -ApiUrl $url -Codigo $texto
        if ($r.Ok) {
            $canje = $r
            break
        }
        $fallidos++
        Write-Problema $r.Mensaje
        if (($r.Estado -ne 404 -and $r.Estado -ne 400) -or $fallidos -ge 3) {
            Write-Resultado $false 'No se pudo usar el código de enlace' @($r.Mensaje, 'No se cambió nada en esta PC.')
            return 3
        }
        Write-Host '  Escribe otro (si hace falta, genera uno nuevo en el panel).'
        $texto = $null
    }
    $sucursal = if ($canje.Sucursal) { $canje.Sucursal } else { '(sin nombre)' }
    Write-Bien "Código aceptado: sucursal '$sucursal'. La llave anterior de esta sucursal ya no sirve."

    # ---------------------------------------------------------------- 4 y 5
    # DESDE AQUÍ el código ya se usó. Toda falla, también una excepción, termina en el respaldo.
    $cadenaNueva = $null
    $cuenta = $CuentaServicio
    $codigo = 3
    $titulo = 'No se pudo terminar la instalación'
    $detalle = @()
    $password = $null
    try {
        Write-Paso '[4/6] Usuario de solo lectura (monitor_lector)'
        $password = New-PasswordLector
        $r = Invoke-CrearLectorSql -Sqlcmd $sqlcmd -ArchivoSql $archivoSql -Servidor $srv -Base $bd `
            -Password $password -UsuarioAdmin $usuarioAdmin
        # La de sa ya no hace falta.
        Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
        if ($r.Codigo -ne 0) {
            $r.Salida | ForEach-Object { Write-Host "    $_" }
            # ¿Quedó a medias (la contraseña ya cambió pero falló lo de después)? Si el login ya
            # acepta la nueva, la de antes no vale: el respaldo usa la nueva.
            if (Test-LoginLector -Sqlcmd $sqlcmd -Servidor $srv -Password $password) {
                $cadenaNueva = New-CadenaConexion -Servidor $srv -Base $bd -Usuario $script:UsuarioLectorPorDefecto -Password $password
            }
            $titulo = 'No se pudo crear el usuario de solo lectura'
            $detalle = @('El SQL Server no lo creó (arriba dice por qué). Si el mensaje empieza con ALTO, no se cambió nada en el SQL Server: llama a soporte.')
        }
        else {
            $r.Salida | Where-Object { $_ -match 'AVISO' } | ForEach-Object { Write-Problema $_ }
            Write-Bien 'monitor_lector sólo puede leer la base de SoftRestaurant. Su contraseña es aleatoria: sólo la guarda el agente.'
            $cadenaNueva = New-CadenaConexion -Servidor $srv -Base $bd -Usuario $script:UsuarioLectorPorDefecto -Password $password

            Write-Paso '[5/6] Instalando el agente (servicios de Windows)'
            $existente = Read-ConfigExistente -Ruta $archivoConfig
            $contenido = New-ContenidoConfig -ApiUrl $canje.ApiUrl -ApiKey $canje.ApiKey -Cadena $cadenaNueva `
                -HoraCatalogos (Get-CampoTexto $existente 'horaSincronizacionCatalogos')
            try {
                & $scriptInstalar -Exe $exePaquete -ContenidoConfig $contenido -DesdeUnClic -CuentaServicio $cuenta | Out-Host
                $codigo = $LASTEXITCODE
                # DECISION PROVISIONAL (nocturno): la cuenta virtual NT SERVICE\ArkonAgente nunca se ha
                # probado como servicio (F1-020b). instalar.ps1 -DesdeUnClic sale con 4 SÓLO si el
                # servicio no pudo INICIAR SESIÓN (1069/1079); sólo entonces se reintenta con LocalSystem.
                # Cualquier otra caída no se "arregla" con más privilegios.
                if ($codigo -eq 4 -and $cuenta -eq 'Virtual') {
                    Write-Problema 'El servicio no pudo iniciar sesión con la cuenta virtual. Pruebo con LocalSystem...'
                    Write-RegistroInstalacion @('AVISO | La cuenta virtual no pudo iniciar sesión (1069/1079): se reintenta con LocalSystem.')
                    $cuenta = 'LocalSystem'
                    & $scriptInstalar -Exe $exePaquete -ContenidoConfig $contenido -DesdeUnClic -CuentaServicio $cuenta | Out-Host
                    $codigo = $LASTEXITCODE
                }
            }
            finally {
                $contenido = $null
            }
            if ($codigo -eq 4) {
                $titulo = 'El servicio de Windows del agente no pudo iniciar sesión'
                $detalle = @('Arriba están las últimas líneas de su log.')
            }
            elseif ($codigo -ge 3) {
                $titulo = 'No se pudo instalar el agente'
                $detalle = @('Arriba dice en qué paso falló.')
            }
        }
    }
    catch {
        $codigo = 3
        $titulo = 'No se pudo terminar la instalación'
        $detalle = @($_.Exception.Message)
    }
    finally {
        $password = $null
        Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
    }

    # ---------------------------------------------------------------- 6
    $minutos = [Math]::Max(1, [Math]::Round(((Get-Date) - $inicio).TotalMinutes))
    $nota = if ($cuenta -eq 'LocalSystem' -and $CuentaServicio -eq 'Virtual') {
        'Nota para soporte: el servicio quedó con la cuenta LocalSystem (la virtual no pudo iniciar sesión).'
    }
    else { $null }
    if ($codigo -eq 0) {
        $lineas = @(
            "Sucursal: $sucursal   (tardó unos $minutos min)",
            'En el panel, Administración > Agentes, tiene que decir "Conectado" en menos de un minuto.',
            'Ya puedes cerrar esta ventana. El agente arranca solo con Windows.')
        if ($nota) { $lineas += $nota }
        Write-Resultado $true 'LISTO: la sucursal quedó conectada' $lineas
        return 0
    }
    if ($codigo -eq 1) {
        $lineas = @(
            'Arriba, la línea [FALLA] dice cuál, y "Qué hacer:" qué revisar.',
            'El agente ya tiene la llave nueva y vuelve a intentar solo cada minuto: en cuanto se corrige, empieza a reportar.',
            'Si no sabes qué hacer, llama a soporte con una foto de esta ventana.')
        if ($nota) { $lineas += $nota }
        Write-Resultado $false 'El agente quedó instalado, pero falla una conexión' $lineas
        return 1
    }
    if ($codigo -eq 2) {
        Write-Resultado $false 'El agente quedó instalado, pero su configuración tiene errores' @(
            'Arriba dice cuáles. Esto no debería pasar con el instalador de un clic: llama a soporte.')
        return 2
    }

    # 3 o 4: el código ya se usó y la instalación no terminó.
    $lineas = @($detalle) + @(Invoke-RespaldoTrasCanje -Canje $canje -CadenaNueva $cadenaNueva)
    $lineas += 'Si no sabes qué hacer, llama a soporte con una foto de esta ventana.'
    Write-Resultado $false $titulo $lineas
    return 3
}

# Con dot-source sólo se definen las funciones (lo usan los tests).
if ($MyInvocation.InvocationName -eq '.') { return }

try {
    $codigoSalida = Invoke-UnClic
}
catch {
    # Aquí sólo llega una falla de ANTES del canje: las de después las atrapa Invoke-UnClic.
    Write-Resultado $false 'No se pudo terminar la instalación' @(
        $_.Exception.Message,
        'No se cambió nada (el código de enlace no se usó).',
        'Vuelve a correr Instalar-YoControlo; si sigue, llama a soporte con una foto de esta ventana.')
    $codigoSalida = 3
}
finally {
    Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PASSWORD_LECTOR -ErrorAction SilentlyContinue
}
exit $codigoSalida
