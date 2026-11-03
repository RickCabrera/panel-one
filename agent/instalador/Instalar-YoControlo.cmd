@echo off
rem ===========================================================================
rem  Yo Controlo - instalador de un clic del agente (ArkonAgente).
rem  Doble clic aqui. Pide permiso de administrador y luego SOLO el codigo de
rem  enlace que aparece en el panel (Administracion > Sucursales > Conectar).
rem
rem  Este archivo va en ASCII, sin BOM y con CRLF: cmd.exe lee mal cualquier
rem  otra cosa. Los acentos van en instalar-un-clic.ps1, no aqui.
rem ===========================================================================
setlocal
title Yo Controlo - instalador del agente
set "YC_SCRIPT=%~dp0archivos\instalar-un-clic.ps1"

if exist "%YC_SCRIPT%" goto :hay_archivos
echo.
echo  No encuentro la carpeta "archivos" junto a este archivo.
echo  Primero extrae el .zip: clic derecho sobre el .zip, "Extraer todo".
echo  Luego abre la carpeta extraida y da doble clic en Instalar-YoControlo.
echo.
pause
exit /b 3

:hay_archivos
rem fltmc solo funciona con permisos de administrador.
fltmc >nul 2>&1
if not errorlevel 1 goto :elevado

echo  Pidiendo permiso de administrador...
echo  Si Windows pregunta si permites que haga cambios, contesta "Si".
set "YC_CMD=%~f0"
set "YC_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = @{ FilePath = $env:YC_CMD; Verb = 'RunAs' }; if ($env:YC_ARGS) { $p.ArgumentList = $env:YC_ARGS }; try { Start-Process @p -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto :sin_permiso
exit /b 0

:sin_permiso
echo.
echo  No se dio el permiso de administrador: no se cambio nada.
echo  Vuelve a dar doble clic en Instalar-YoControlo y contesta "Si".
echo.
pause
exit /b 3

:elevado
powershell -NoProfile -ExecutionPolicy Bypass -File "%YC_SCRIPT%" %*
set "YC_CODIGO=%ERRORLEVEL%"
echo.
pause
exit /b %YC_CODIGO%
