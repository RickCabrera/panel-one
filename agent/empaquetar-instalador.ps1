<#
.SYNOPSIS
    Arma Instalar-YoControlo.zip: el paquete del instalador de un clic.

.DESCRIPTION
    Uso (desde /agent, en Windows o en Linux con pwsh):

        pwsh -File .\empaquetar-instalador.ps1 -ApiUrl https://monitor.ejemplo.com

    Sin -Exe corre `dotnet publish` (win-x64, un solo agente.exe self-contained). El .zip queda:

        Instalar-YoControlo.cmd     <- lo único que hay que abrir (doble clic)
        LEEME.txt                   <- los 3 pasos
        archivos\
            agente.exe
            instalar-un-clic.ps1, instalar.ps1, funciones-instalador.ps1,
            crear-usuario-lector.ps1, crear-usuario-lector.sql
            instalador.json         <- { "apiUrl": ... } (sólo con -ApiUrl)

    -ApiUrl va EMBEBIDA para que el instalador no la pregunte: es la dirección BASE de la API tal
    como la ve la PC del restaurante (la misma que iría en config.json). No es un secreto. Sin
    -ApiUrl el paquete sirve igual, pero el instalador la pregunta. Nada más va en el paquete:
    ni config.json, ni API keys, ni contraseñas.

.PARAMETER ApiUrl
    Dirección base de la API (https://...). Recomendada.

.PARAMETER Exe
    agente.exe ya publicado. Sin él, se publica con dotnet.

.PARAMETER Salida
    Ruta del .zip. Por defecto agent\Instalar-YoControlo.zip (ignorado por git).
#>
[CmdletBinding()]
param(
    [string] $ApiUrl,
    [string] $Exe,
    [string] $Salida
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$carpetaInstalador = Join-Path $PSScriptRoot 'instalador'
. (Join-Path $carpetaInstalador 'funciones-instalador.ps1')

# Lo que va en archivos\ además de agente.exe e instalador.json. Lista CERRADA: nada que esté
# por casualidad en la carpeta (un config.json de prueba, por ejemplo) entra al paquete.
$archivosPaquete = @(
    'instalar-un-clic.ps1',
    'instalar.ps1',
    'funciones-instalador.ps1',
    'crear-usuario-lector.ps1',
    'crear-usuario-lector.sql'
)

if ($ApiUrl) {
    $problema = Test-ApiUrl $ApiUrl
    if ($problema) { throw "-ApiUrl: $problema" }
    $ApiUrl = $ApiUrl.Trim().TrimEnd('/')
}
else {
    Write-Warning 'Sin -ApiUrl: el instalador va a preguntar la dirección del panel.'
}

if (-not $Salida) { $Salida = Join-Path $PSScriptRoot 'Instalar-YoControlo.zip' }
$Salida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Salida)

if (-not $Exe) {
    $publicado = Join-Path $PSScriptRoot 'publish'
    & dotnet publish (Join-Path $PSScriptRoot 'src/ArkonAgente') -c Release -r win-x64 -o $publicado
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish falló.' }
    $Exe = Join-Path $publicado 'agente.exe'
}
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "No existe agente.exe en: $Exe" }

$temporal = Join-Path ([System.IO.Path]::GetTempPath()) ('yocontrolo-paquete-' + [guid]::NewGuid().ToString('N'))
$archivos = Join-Path $temporal 'archivos'
New-Item -ItemType Directory -Path $archivos -Force | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $carpetaInstalador 'Instalar-YoControlo.cmd') -Destination $temporal
    Copy-Item -LiteralPath (Join-Path $carpetaInstalador 'LEEME.txt') -Destination $temporal
    Copy-Item -LiteralPath $Exe -Destination (Join-Path $archivos 'agente.exe')
    foreach ($f in $archivosPaquete) {
        Copy-Item -LiteralPath (Join-Path $carpetaInstalador $f) -Destination $archivos
    }
    if ($ApiUrl) {
        Write-ArchivoSinBom -Ruta (Join-Path $archivos 'instalador.json') `
            -Contenido ('{ "apiUrl": ' + (ConvertTo-TextoJson $ApiUrl) + " }`r`n")
    }

    if (Test-Path -LiteralPath $Salida) { Remove-Item -LiteralPath $Salida -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($temporal, $Salida)
}
finally {
    Remove-Item -LiteralPath $temporal -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Paquete listo: $Salida"
