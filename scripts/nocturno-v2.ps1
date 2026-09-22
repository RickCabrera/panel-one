# scripts/nocturno-v2.ps1 - loop con PANEL de Claude Code y avance automatico.
#
# EL PROBLEMA QUE RESUELVE
# ------------------------
# Habia que elegir entre dos cosas malas:
#   - modo -p: avanza solo, pero la salida es JSON crudo, ilegible;
#   - modo interactivo: panel bonito, pero la ventana se queda esperando input
#     y alguien tiene que escribir /exit entre tarea y tarea.
#
# LA SALIDA
# ---------
# Se abre el panel interactivo, Y ADEMAS un vigilante mira el repo cada minuto.
# La sesion avisa como termino dejando un CENTINELA en la raiz del repo:
#
#   TAREA_CERRADA.txt   cerro: PR mergeado y el [x] de backlog.md pusheado a main.
#   TAREA_SALTADA.txt   se salto (revisor que bloquea dos veces, CI que sigue
#                       rojo). La razon ya quedo escrita en el log, en main.
#   COLA_VACIA.txt      no queda tarea pendiente en la Cola nocturna.
#
# POR QUE UN CENTINELA Y NO SOLO EL COMMIT - la leccion que costo nueve notas
# --------------------------------------------------------------------------
# La version anterior mataba la ventana 45 s despues del PRIMER commit nuevo en
# origin/main, que es el squash del PR. Pero el protocolo escribia la entrada de
# docs/nocturno-log.md DESPUES de eso, asi que la ventana moria a media nota:
# NUEVE sesiones seguidas cerraron sin dejar rastro, y el log es el UNICO canal
# entre sesiones. (Medido en un repo hermano que corre este mismo protocolo; aqui
# se porta la leccion, no su historia.)
#
# Ahora la nota viaja DENTRO del PR y el centinela lo crea la sesion cuando ya
# no le queda nada que escribir. El respaldo por commit sigue aqui para cuando
# la sesion muere sin poder crearlo, pero exige el COMMIT DEL [x] y no un commit
# cualquiera. Ver Test-CommitDelCierre, abajo: la distincion no es cosmetica.
#
# Y UNA TAREA SALTADA YA NO ES UN BUCLE
# -------------------------------------
# Antes, saltar no dejaba commit, el loop lo leia como limite de tokens y
# reintentaba la MISMA tarea hasta doce veces: seis horas de nada. Ahora
# TAREA_SALTADA.txt avanza el contador, pero solo despues de comprobar que la
# razon esta en main: si se quedo en la rama que la sesion borro, la siguiente
# sesion no la ve y vuelve a tomar la misma tarea. Si falta, el loop se detiene
# en vez de seguir a ciegas.
#
# ASCII puro y con BOM. PowerShell 5.1 lee un .ps1 sin BOM como ANSI y un guion
# largo rompe el parser en la ultima linea del archivo.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\nocturno-v2.ps1 -MaxTareas 6

param(
  [int]$MaxTareas          = 14,
  [int]$EsperaLimiteMin    = 30,   # espera al toparse con el limite de tokens
  [int]$MaxEsperas         = 12,
  [int]$MinutosSinAvanzar  = 90,   # si una tarea no cierra en este tiempo, se corta
  [int]$SegundosDeGracia   = 180   # margen del RESPALDO por commit, no del centinela
)

$ErrorActionPreference = 'Continue'

# CONSOLA EN UTF-8 (F2-203). La consola de PowerShell 5.1 arranca en la pagina
# de codigos OEM (850/437) y pinta los acentos que le llegan de git y de claude
# como "revocaci?n" roto en dos simbolos. El repo esta bien; es la consola.
# OutputEncoding de [Console] es lo que se PINTA; $OutputEncoding es lo que este
# script le manda por tuberia a un ejecutable nativo. Va despues del param():
# antes de el, PowerShell no acepta ninguna instruccion.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# PREFLIGHT. Sin esto, una herramienta que falta se paga MaxTareas veces.
# Start-Process contra un ejecutable que no esta en PATH tira excepcion, el
# vigilante no encuentra proceso vivo, no hay commits, el loop lo lee como
# limite de tokens y duerme 30 min. Doce veces: seis horas de nada por un PATH.
# En un repo recien creado -que es donde este script se estrena- es justo el
# escenario mas probable.
#
# Se revisan TODAS y se reporta la lista completa: si faltan node y dotnet, que
# el primer intento los muestre los dos y no obligue a dos vueltas.
$faltantes = @()
$requeridos = @(
  @{ Cmd = 'claude'; Razon = 'es la sesion que hace la tarea. Instala Claude Code o abre una consola nueva.' },
  @{ Cmd = 'gh';     Razon = 'el protocolo abre y mergea PRs con gh.' },
  @{ Cmd = 'git';    Razon = 'el loop hace checkout, pull y rev-list en cada vuelta.' },
  @{ Cmd = 'node';   Razon = 'los checks de /api y /web corren con node.' },
  @{ Cmd = 'npm';    Razon = 'lint, typecheck, test y build de /api y /web se lanzan con npm.' },
  @{ Cmd = 'dotnet'; Razon = 'los checks de /agent son dotnet build y dotnet test.' }
)

foreach ($r in $requeridos) {
  if (-not (Get-Command $r.Cmd -ErrorAction SilentlyContinue)) {
    $faltantes += $r
  }
}

if ($faltantes.Count -gt 0) {
  Write-Host 'PREFLIGHT: falta lo siguiente en el PATH y el loop no arranca.' -ForegroundColor Red
  foreach ($f in $faltantes) {
    Write-Host ("  - " + $f.Cmd + ": " + $f.Razon) -ForegroundColor Red
  }
  exit 1
}

# gh instalado no es gh autenticado, y el protocolo no llega al PR sin sesion.
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'PREFLIGHT: gh no esta autenticado. Corre "gh auth login" y vuelve.' -ForegroundColor Red
  exit 1
}
Write-Host 'Preflight ok: claude, gh, git, node, npm y dotnet en PATH, gh autenticado.' -ForegroundColor Green

$log = Join-Path $raiz "docs\nocturno-$(Get-Date -Format 'yyyyMMdd-HHmm').txt"

$centinelaCerrada = Join-Path $raiz 'TAREA_CERRADA.txt'
$centinelaSaltada = Join-Path $raiz 'TAREA_SALTADA.txt'
$centinelaVacia   = Join-Path $raiz 'COLA_VACIA.txt'
$centinelas = @($centinelaCerrada, $centinelaSaltada, $centinelaVacia)

# EL COMMIT DEL [x] TIENE UNA FIRMA QUE NINGUN OTRO COMMIT DEL PROTOCOLO TIENE:
# toca backlog.md Y NADA MAS (CLAUDE.md, Reglas de cierre: "y solo ese, sin
# tocar otro archivo").
#
# Hace falta esa precision, y no basta con preguntar si el rango toca
# backlog.md: EL SQUASH DEL PR TAMBIEN LO TOCA en la mayoria de las tareas -en el
# repo hermano donde se midio, nueve de las ultimas tareas lo hacian-. Con la
# pregunta floja, el respaldo volveria a leer el squash como cierre, que es
# exactamente el error que este arreglo cierra.
function Test-CommitDelCierre([string]$rango) {
  foreach ($c in (git rev-list $rango 2>$null)) {
    $f = git diff-tree --no-commit-id --name-only -r $c 2>$null
    if ((@($f).Count -eq 1) -and ($f -contains 'backlog.md')) { return $true }
  }
  return $false
}

# EL PROMPT VA EN UNA SOLA LINEA, A PROPOSITO.
# Start-Process -ArgumentList no respeta los saltos de linea: parte el texto y
# solo entrega el primer pedazo. Con un here-string multilinea llegaba
# literalmente la palabra "MODO" y Claude contestaba que el mensaje venia
# cortado. Una linea, y entrecomillada al pasarla, es lo unico que cruza entero.
# Sin comillas dobles adentro, por la misma razon.
$prompt = 'MODO AUTONOMO. Lee CLAUDE.md (seccion Modo autonomo), backlog.md y docs/nocturno-log.md. Ejecuta la SIGUIENTE tarea de la Cola nocturna siguiendo el protocolo al pie de la letra. UNA sola tarea: termina la sesion al cerrarla o al saltarla, sin encadenar la siguiente. Todo hallazgo sobre el esquema de SoftRestaurant se documenta en docs/esquema-sr.md en el mismo entregable, aunque la tarea no sea de mapeo. La entrada de docs/nocturno-log.md se escribe y se commitea DENTRO de la rama de la tarea, antes del push y del PR, y viaja en el PR: es el UNICO canal entre sesiones y la siguiente arranca sin memoria de esta. Si CIERRAS la tarea: despues de pushear a main el commit del [x] en backlog.md, crea un archivo vacio TAREA_CERRADA.txt en la raiz del repo y termina. Si SALTAS la tarea: commitea y pushea la entrada SALTADA del log DIRECTO a main, crea un archivo vacio TAREA_SALTADA.txt en la raiz del repo y termina. Si la Cola nocturna ya no tiene tareas pendientes, no inventes ninguna ni te adelantes a las Diurnas: crea un archivo vacio COLA_VACIA.txt en la raiz del repo y termina.'

$esperas = 0
$tarea = 1

while ($tarea -le $MaxTareas) {
  Write-Host ''
  Write-Host "=== Tarea $tarea de $MaxTareas - $(Get-Date -Format 'HH:mm') ===" -ForegroundColor Cyan
  Add-Content $log "=== Tarea $tarea de $MaxTareas - $(Get-Date -Format 'HH:mm') ==="

  git checkout main 2>$null
  git pull  2>$null
  $antes = (git rev-parse HEAD).Trim()

  # Los centinelas de la vuelta anterior, fuera. Si uno sobrevive, la tarea
  # nueva muere en el primer minuto sin haber hecho nada.
  foreach ($c in $centinelas) { if (Test-Path $c) { Remove-Item $c -Force } }

  # El panel de siempre, en su ventana. -PassThru para poder matarlo despues.
  # Las comillas son obligatorias: sin ellas, Start-Process corta el prompt en
  # el primer espacio y a Claude le llega una sola palabra.
  $proc = Start-Process -FilePath 'claude' `
                        -ArgumentList @('--dangerously-skip-permissions', ('"' + $prompt + '"')) `
                        -PassThru

  $limite  = (Get-Date).AddMinutes($MinutosSinAvanzar)
  $cerro   = $false
  $saltada = $false
  $vacia   = $false

  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 60

    if (Test-Path $centinelaVacia)   { $vacia   = $true; break }
    if (Test-Path $centinelaSaltada) { $saltada = $true; break }
    if (Test-Path $centinelaCerrada) {
      Write-Host 'TAREA_CERRADA. La sesion ya escribio todo; cierro la ventana.' -ForegroundColor Green
      Start-Sleep -Seconds 10
      $cerro = $true
      break
    }

    # RESPALDO. Solo para la sesion que muere sin poder dejar centinela. Exige
    # el commit del [x]; el squash del PR NO cuenta aunque toque backlog.md.
    git fetch --quiet 2>$null
    $remoto = (git rev-parse origin/main 2>$null)
    if ($remoto) { $remoto = $remoto.Trim() }

    if ($remoto -and $remoto -ne $antes -and (Test-CommitDelCierre "$antes..$remoto")) {
      Write-Host "El [x] esta en main y no hubo centinela. Cierro la ventana en ${SegundosDeGracia}s." -ForegroundColor Yellow
      Add-Content $log '  Cierre detectado por el commit del [x], sin centinela.'
      Start-Sleep -Seconds $SegundosDeGracia
      $cerro = $true
      break
    }

    if ((Get-Date) -gt $limite) {
      Write-Host "$MinutosSinAvanzar min sin cerrar. Corto la tarea y sigo." -ForegroundColor Yellow
      Add-Content $log "Tarea $tarea cortada por tiempo: no cerro en $MinutosSinAvanzar min."
      break
    }
  }

  # UN ULTIMO REPASO DE LOS CENTINELAS. El while de arriba solo los mira mientras
  # el proceso vive: si la ventana se cierra sola dentro del minuto siguiente a
  # que la sesion dejo el suyo, se sale por $proc.HasExited y nadie los vuelve a
  # leer. Una COLA_VACIA asi se leeria como limite de tokens y el loop dormiria
  # 30 min doce veces, que es la misma nada que este arreglo vino a matar.
  if (-not ($vacia -or $saltada -or $cerro)) {
    if (Test-Path $centinelaVacia)   { $vacia   = $true }
    if (Test-Path $centinelaSaltada) { $saltada = $true }
    if (Test-Path $centinelaCerrada) { $cerro   = $true }
  }

  if (-not $proc.HasExited) { taskkill /PID $proc.Id /T /F 2>$null | Out-Null }

  git checkout main 2>$null
  git pull --quiet 2>$null
  $nuevos = git log --oneline "$antes..HEAD"

  # SALTADA: avanza el contador, pero solo si la razon llego a main.
  if ($saltada) {
    $enMain = git diff --name-only "$antes..HEAD" 2>$null
    if ($enMain -contains 'docs/nocturno-log.md') {
      Write-Host "Tarea $tarea SALTADA. La razon esta en el log; sigo con la siguiente." -ForegroundColor Yellow
      Add-Content $log "Tarea $tarea SALTADA (razon en docs/nocturno-log.md)."
      if ($nuevos) { $nuevos | ForEach-Object { Add-Content $log "  $_" } }
      $esperas = 0
      $tarea++
      Start-Sleep -Seconds 10
      continue
    }
    Write-Host 'TAREA_SALTADA sin su entrada en el log dentro de main. Me detengo.' -ForegroundColor Red
    Add-Content $log 'TAREA_SALTADA sin commit de docs/nocturno-log.md en main. Loop detenido: sin esa nota, la siguiente sesion volveria a tomar la misma tarea.'
    break
  }

  # COLA VACIA: se decide ANTES de contar commits. No hay ninguno que contar, y
  # con el orden viejo eso caia en la rama del limite de tokens y dormia 30 min.
  if ($vacia) {
    Write-Host 'Cola nocturna vacia. Fin del loop.' -ForegroundColor Cyan
    Add-Content $log 'Cola nocturna vacia. Fin del loop.'
    break
  }

  # Que cambio de verdad. No es lo que diga el texto: son los commits.
  Write-Host '--- Que cambio de verdad en el repo ---' -ForegroundColor Green
  if ($nuevos -or $cerro) {
    if ($nuevos) { $nuevos | ForEach-Object { Write-Host "  $_"; Add-Content $log "  $_" } }
    else {
      # Centinela de cierre pero cero commits: casi siempre un git pull que fallo.
      # Se le cree al centinela, que lo escribio la sesion, y no se reintenta una
      # tarea que ya cerro.
      Write-Host '  TAREA_CERRADA sin commits visibles (pull fallido?). Avanzo igual.' -ForegroundColor Yellow
      Add-Content $log '  TAREA_CERRADA sin commits visibles. Se avanza por el centinela.'
    }
    $esperas = 0
    $tarea++
  } else {
    Write-Host '  NINGUN commit nuevo. La tarea NO cerro.' -ForegroundColor Red
    Add-Content $log '  NINGUN commit nuevo. La tarea NO cerro.'
    # Sin commit y sin centinela, lo mas probable es el limite de tokens: se
    # espera y se REINTENTA LA MISMA TAREA, sin avanzar el contador.
    $esperas++
    if ($esperas -gt $MaxEsperas) {
      Write-Host "Van $MaxEsperas intentos sin avanzar. Me detengo." -ForegroundColor Red
      break
    }
    $reanuda = (Get-Date).AddMinutes($EsperaLimiteMin).ToString('HH:mm')
    Write-Host "Reintento la misma tarea a las $reanuda (intento $esperas de $MaxEsperas)." -ForegroundColor Yellow
    Start-Sleep -Seconds ($EsperaLimiteMin * 60)
  }

  Start-Sleep -Seconds 10
}

Write-Host "=== Loop terminado $(Get-Date -Format 'HH:mm') ===" -ForegroundColor Cyan
Write-Host "Log: $log"
