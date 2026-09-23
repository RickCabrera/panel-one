# Instalación — monitor SoftRestaurant, desde cero

Este kit **no se instala sobre un repo existente**: crea uno. Al terminar tienes el repo en
GitHub, el CI corriendo en verde, la guardia de `main` puesta y el orquestador nocturno
probado.

Tiempo: unos 20 minutos, casi todo esperando a GitHub.

---

## 0 · Requisitos

Verifica los cinco antes de empezar. Si falta uno, el paso donde hace falta va a fallar de
una forma poco obvia.

| Requisito | Cómo se comprueba | Por qué |
|---|---|---|
| **`gh` autenticado** | `gh auth status` → dice `Logged in to github.com` | Crea el repo, abre y mergea los PRs. El orquestador lo usa en cada tarea. |
| **`claude` en PATH** | `claude --version` responde | `scripts/nocturno-v2.ps1` lo lanza por tarea. Si no está, el loop gira en vacío. |
| **PowerShell 5.1** | `$PSVersionTable.PSVersion` → `5.1.x` | Es el que lee el `.ps1` del orquestador. Viene con Windows. |
| **Node 22** | `node --version` → `v22.x` | `/api` (NestJS) y `/web` (React+Vite), y el hook de Claude Code. |
| **.NET 8 SDK** | `dotnet --version` → `8.x` | `/agent` (Worker Service de Windows). |

Opcional pero recomendado: **Docker Desktop**, para levantar el Postgres de `/infra` en
local desde F1-001.

> **Todos los comandos de esta guía se pegan en PowerShell 5.1, uno por línea.** Si al
> primer `npm` o `npx` sale `npm.ps1 ... la ejecución de scripts está deshabilitada`, es
> la política de ejecución de Windows. Corre una vez en esa consola:
>
> ```powershell
> Set-ExecutionPolicy -Scope Process Bypass -Force
> ```
>
> Sólo vale para esa ventana. La alternativa, sin tocar la política, es escribir `npm.cmd`
> y `npx.cmd` en lugar de `npm` y `npx`. Y en PowerShell 5.1 **no uses `&&`** para encadenar
> comandos: no lo acepta.

> El propio `scripts/nocturno-v2.ps1` revisa `claude` y `gh auth` antes de arrancar y se
> detiene con un mensaje claro si falta alguno. Esa comprobación existe porque sin ella una
> herramienta ausente se paga 14 veces: el loop lee "no hubo commits" como límite de tokens
> y duerme 30 minutos antes de volver a fallar igual.

---

## 1 · Preparar la carpeta del repo

Copia el contenido de este kit a la carpeta donde vivirá el proyecto. Después de copiar,
**borra `BACKLOG (22).md` y este archivo no**: el backlog original ya está convertido en
`backlog.md` y `README-KIT.md` sólo sirve fuera del repo.

Lo que debe quedar:

```
CLAUDE.md                                  protocolo de trabajo (el que Claude Code lee siempre)
backlog.md                                 cola nocturna + las 56 tareas
0-INSTALACION.md                           este archivo
.gitignore
.gitattributes
.claude/settings.json                      permisos (se versiona: es config de equipo)
.claude/agents/revisor.md
.claude/hooks/auto-approve-readonly.mjs
.github/workflows/ci.yml
scripts/nocturno-v2.ps1                    orquestador del modo autónomo
scripts/git-hooks/pre-push                 copia versionada de la guardia de main
docs/nocturno-log.md                       canal entre sesiones (vacío, sólo cabecera)
docs/esquema-sr.md                         memoria sobre SoftRestaurant (esqueleto)
```

No crees todavía `/agent`, `/api`, `/web` ni `/infra`: **eso es la tarea F1-001**, y es la
primera de la cola. El repo nace con el protocolo, no con el código.

---

## 2 · Crear el repo en GitHub

```powershell
git init -b main
git add -A
git status          # REVISA: no debe aparecer ningún .env, ningún centinela, ningún BACKLOG (22).md
git commit -m "chore: protocolo de trabajo, CI y orquestador nocturno"
```

Después, con `gh`:

```powershell
gh repo create monitor-softrestaurant --private --source=. --remote=origin --push
```

Cambia el nombre si quieres otro. `--private` porque el repo va a tener, más adelante,
cadenas de conexión de ejemplo y detalles de instalaciones de clientes.

> **El orden importa: el repo se crea ANTES de instalar el hook.** El `pre-push` rechaza
> cualquier push a `main` que toque algo que no sea `backlog.md` o `docs/nocturno-log.md`, y
> este primer commit los toca todos. Si instalas el hook antes, el push inicial rebota. No es
> un bug del hook: es exactamente su trabajo.

---

## 3 · Instalar la guardia de `main` (el hook `pre-push`)

`.git/hooks/` **no se versiona**, así que el hook no viaja con el repo: en cada clon hay que
instalarlo o no hay guardia. La copia buena está en `scripts/git-hooks/pre-push`.

```sh
cp scripts/git-hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

En PowerShell, si no tienes `cp`:

```powershell
Copy-Item scripts\git-hooks\pre-push .git\hooks\pre-push -Force
```

**Qué hace:** al empujar a `main`, rechaza el push si el rango toca cualquier archivo que no
sea `backlog.md` o `docs/nocturno-log.md`. Todo lo demás pasa por PR. Es la guardia real del
modo autónomo.

**Sobre los finales de línea:** `.gitattributes` fija esa copia con **LF**
(`scripts/git-hooks/pre-push text eol=lf`). No es cosmético: git convierte a CRLF por
defecto en Windows, y un `#!/bin/sh` con un `\r` pegado instala un hook que se ve bien y
**no corre**. El job `guardia` del CI comprueba que siga con LF en cada PR.

### Comprobarlo sin empujar nada

El hook lee las refs de stdin, así que se le pueden dar a mano:

```sh
SHA=$(git rev-parse HEAD)
CEROS=0000000000000000000000000000000000000000

# 1. Rama de ceros con el commit inicial (que toca de todo)  -> exit 1
echo "refs/heads/main $SHA refs/heads/main $CEROS" | sh .git/hooks/pre-push; echo "esperado 1, dio $?"

# 2. SHA remoto inventado (rango que no resuelve)            -> exit 1
echo "refs/heads/main $SHA refs/heads/main 0123456789abcdef0123456789abcdef01234567" | sh .git/hooks/pre-push; echo "esperado 1, dio $?"

# 3. Push a una rama que no es main                          -> exit 0
echo "refs/heads/feat/x $SHA refs/heads/feat/x $CEROS" | sh .git/hooks/pre-push; echo "esperado 0, dio $?"
```

Los casos 1 y 2 son **fail-closed**, y no siempre lo fueron: en la versión original de este
hook, un rango que no resolvía hacía que el `for` no iterara sobre nada y **el push pasaba**
— la guardia caía sola justo en el escenario más delicado. Lo mismo con la rama de ceros:
`git diff --name-only <sha>` compara contra el *árbol de trabajo*, no contra el árbol vacío,
así que con el árbol limpio la lista salía vacía y pasaba cualquier contenido. Por eso esa
rama usa `git diff-tree --root`.

**Límite conocido, anotado a propósito:** en la rama de ceros el hook mira sólo el commit de
la punta. Y `git diff A..B` es el diff **neto**. Están sin cerrar por decisión, no por
descuido; el detalle está en los comentarios del propio hook.

**Lo que ninguna versión puede:** `git push --no-verify` lo brinca entero. Contra eso no hay
mecanismo, sólo protocolo — está prohibido en `CLAUDE.md`, *Modo autónomo*, junto con
`--force`.

---

## 4 · Habilitar Actions y ver el CI en verde

Actions suele venir activado en repos nuevos. Compruébalo:

```powershell
gh workflow list
gh run list --limit 5
```

Si no aparece nada: GitHub → el repo → pestaña **Actions** → *I understand my workflows,
enable them*.

El CI debe salir **verde a la primera**, con un solo job: `Guardia del repo`. Los tres
carriles (`api`, `web`, `agent`) nacen **comentados** en `.github/workflows/ci.yml`, porque
en este momento esas carpetas todavía no existen y un job que corre `npm ci` sobre una
carpeta ausente falla. Un CI que nace rojo enseña a ignorar el CI, y eso es lo único que lo
mata de verdad.

Cada carril se descomenta en la tarea que lo habilita, y eso es **parte del entregable de
esa tarea**:

| Se descomenta | En la tarea | Qué habilita |
|---|---|---|
| carriles `api`, `web`, `agent` (sin tests) | **F1-001** | lint, typecheck, build de los tres |
| servicio `postgres` + `migrate` + `npm test` de `api` | **F1-011** | primeros e2e con base real |
| `npm test` de `web` | **F1-041** | primera vista con lógica que probar |
| `dotnet test` de `agent` | **F1-021** | selección de reader por versión de SR |

El job `guardia` corre desde el minuto cero y no es de adorno: falla si alguien commitea un
centinela, un `.env`, un `.pem`/`.key`/`.cer`/`.pfx`, un `config.json` con la cadena de
conexión del cliente, o si el hook pierde sus finales LF.

---

## 5 · Proteger `main` en GitHub

Dos guardias son mejor que una. El hook `pre-push` es local y `--no-verify` lo brinca;
la protección de rama vive del lado del servidor y no.

GitHub → el repo → **Settings → Branches → Add branch protection rule**:

- Branch name pattern: `main`
- ☑ **Require a pull request before merging**
- ☑ **Require status checks to pass before merging** → selecciona `Guardia del repo` (y los
  demás jobs conforme los vayas descomentando)
- ☑ **Do not allow bypassing the above settings** — o déjalo sin marcar, ver abajo

> ### El conflicto con el modo autónomo, y cómo se resuelve
>
> El protocolo empuja **un commit directo a `main`**: el que marca `[x]` en `backlog.md`
> tras el merge (y el de una tarea SALTADA en `docs/nocturno-log.md`). Si activas *Require a
> pull request* **sin** excepción para tu usuario, esos dos pushes rebotan y el orquestador
> se traba en cada cierre.
>
> Elige una:
>
> - **Recomendado:** activa la protección pero **deja el bypass a administradores** (no
>   marques *Do not allow bypassing*). Tú puedes empujar el `[x]`; nadie más puede empujar
>   nada. El `pre-push` sigue siendo quien decide *qué* archivo puede ir directo.
> - **Alternativa:** protección total, y entonces el `[x]` del backlog también va por PR.
>   Cuesta un PR de una línea por tarea y hay que cambiar la sección *Cierre* de `CLAUDE.md`.
>
> **Y si el repo es privado en plan gratuito**, la API de branch protection responde **403
> pidiendo Pro**: no vas a poder proteger `main` en absoluto. En ese caso el `pre-push` **es
> la única guardia que tienes**, y por eso está escrito fail-closed y por eso `--no-verify`
> está prohibido en el protocolo.

---

## 6 · Prueba de humo

Tres comprobaciones, en este orden. Si las tres pasan, el kit está montado.

### 6.1 · El hook de Claude Code auto-aprueba lo seguro y no lo demás

```powershell
echo '{"tool_input":{"command":"git status"}}' | node .claude/hooks/auto-approve-readonly.mjs
# esperado: un JSON con "permissionDecision":"allow"

echo '{"tool_input":{"command":"rm -rf node_modules"}}' | node .claude/hooks/auto-approve-readonly.mjs
# esperado: SIN salida (cae al flujo normal, pregunta)
```

Es fail-safe: ante la duda no aprueba. Si el hook truena o Node no está, simplemente deja de
auto-aprobar — no bloquea al agente.

### 6.2 · El orquestador arranca, encuentra la cola y se detiene solo

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\nocturno-v2.ps1 -MaxTareas 1
```

Qué debe pasar, en orden:

1. Imprime `Preflight ok: claude en PATH, gh autenticado.`
2. Borra los centinelas que hubiera y abre **una ventana con el panel de Claude Code**.
3. La sesión lee `CLAUDE.md` y `backlog.md`, toma **F1-001** (la primera no-`[x]` de la Cola
   nocturna) y se pone a trabajar.

Si quieres cortar la corrida de prueba antes de que cierre la tarea, cierra la ventana: el
loop lo detecta y termina. Con `-MaxTareas 1` no encadena nada más.

**Comprobar la otra mitad —que el loop para cuando no hay nada que hacer— sin gastar una
tarea:** crea el centinela a mano en otra consola mientras el loop corre.

```powershell
New-Item -ItemType File COLA_VACIA.txt
```

Dentro del minuto siguiente el loop debe imprimir `Cola nocturna vacia. Fin del loop.` y
terminar. Borra el archivo después (el loop lo borra solo en la siguiente vuelta, pero mejor
no dejarlo puesto: una sesión que arranca con un centinela ya puesto muere en el primer
minuto sin haber hecho nada).

### 6.3 · El primer ciclo completo de verdad

Deja correr una tarea entera y comprueba que el ciclo cierra donde debe:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\nocturno-v2.ps1 -MaxTareas 1
```

Al terminar, el repo debe tener:

- una rama `feat/F1-001` **borrada** (mergeada con `--delete-branch`),
- un PR cerrado como MERGED, cuyo diff incluye **la entrada de `docs/nocturno-log.md`**
  (esto es lo importante: la nota viaja *dentro* del PR, no después del merge),
- en `main`, un commit suelto que toca **sólo `backlog.md`** marcando `[x] F1-001`,
- `TAREA_CERRADA.txt` en la raíz, sin commitear.

```powershell
git log --oneline -5
gh pr list --state merged --limit 1
git show --stat HEAD        # debe tocar backlog.md y nada más
```

Si el commit del `[x]` toca algún archivo además de `backlog.md`, el respaldo por commit del
orquestador deja de reconocer el cierre. Esa distinción no es cosmética: el squash del PR
*también* toca `backlog.md`, y por eso `Test-CommitDelCierre` exige que sea el único archivo
del commit.

---

## 7 · Y de aquí en adelante

**Trabajo con Ricardo presente** — el bucle normal de `CLAUDE.md`: plan → revisor →
autorización → rama → checks → revisor → autorización → PR → merge → `[x]`.

**Trabajo nocturno** — lanzar el orquestador con las tareas que quepan en la noche:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\nocturno-v2.ps1 -MaxTareas 6
```

**Lo primero que hay que hacer aparte de la cola:** conseguir acceso a una instalación real
de SoftRestaurant. **F1-090 sigue siendo el cuello de botella** y es diurna: mientras no
cierre, F1-022 y F1-023 (el lector de cheques y el de mesas) no se pueden escribir de verdad, y
todo lo que el proyecto "sabe" del POS son supuestos marcados como tales en
`docs/esquema-sr.md`.

**Estado al cierre de la Ronda 2 (F2-250, 23/09/2026).** Las colas de la Ronda 1 y de la Ronda 2
están cerradas; lo que existe y con qué salvedades está en
[`docs/paridad.md`](docs/paridad.md). Lo que queda es de dos tipos: las **Diurnas** de
`backlog.md` (necesitan a Ricardo, un servidor, credenciales o un restaurante real) y la
**RONDA 3** al final del backlog, que **no está autorizada**: mientras Ricardo no la mueva a una
cola vigente, el orquestador encuentra la cola vacía, deja `COLA_VACIA.txt` y se detiene.

---

## 8 · Clon nuevo: del `git clone` al panel con datos

Esto es para cualquier máquina que clona el repo **ya creado** (la de un desarrollador
nuevo, una máquina de pruebas, la tuya después de formatear), no para montar el kit. La
secuencia completa, con cada comando en su línea y sin `&&`, vive en **un solo lugar**:
[`README.md` → *Levantar todo en local*](README.md#levantar-todo-en-local). En resumen:

```powershell
git clone <url-del-repo> panel-one
cd panel-one
npm ci
cd api
npm run setup:env
npx prisma migrate deploy
npm run seed
npm run dev
```

Con el Postgres de `/infra` arriba (paso 1 del README), eso deja la API en
`http://localhost:3000` con la empresa demo, sus dos sucursales, 90 días de ventas, mesas
abiertas, catálogos, inventario y facturación de ejemplo (el detalle de cada seed está en el
README). `npm ci` **ya genera el cliente de Prisma** (no hace falta `prisma generate` a
mano) y `npm run setup:env` crea `api/.env` sin pisar uno que ya exista.

Después de clonar, **instala el hook** como en el paso 3 de esta guía: la guardia de `main`
no viaja con el clon.

La corrida real de esta secuencia en un clon limpio, con su salida, está en
[`docs/verificacion-arranque.md`](docs/verificacion-arranque.md).
