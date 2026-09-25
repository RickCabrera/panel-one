# MONITOR SOFTRESTAURANT — Protocolo de trabajo

Este archivo define **CÓMO** se trabaja en este monorepo. El **QUÉ** (arquitectura,
endpoints, reglas de código de cada carril) vive en los CLAUDE.md de cada app cuando
existan — léelos según la app que toque la tarea. El esquema real de SoftRestaurant vive
en `docs/esquema-sr.md` y es de lectura obligada antes de tocar el agente.

**Desarrollador único: Ricardo.** No hay carriles separados de personas; el mismo bucle
sirve para el agente, el api y el web. El orden de trabajo lo manda la **Cola nocturna**
de `backlog.md`.

## El bucle (innegociable)

1. Ricardo pide una tarea del `backlog.md` (o te dice cuál sigue).
2. **Plan primero.** Lee el backlog, el CLAUDE.md de la app afectada, `docs/esquema-sr.md`
   y el código relevante. Escribe un plan concreto (archivos a tocar, tests a agregar,
   criterio de "Listo cuando" de la tarea). **Pásalo por el subagente `revisor`** antes
   de mostrarlo.
3. Muestra el plan (ya revisado, con las observaciones del revisor resueltas o señaladas
   como decisión abierta) y **espera autorización explícita de Ricardo**.
4. Construye en una **rama nueva desde main actualizado**
   (`git checkout main && git pull && git checkout -b feat/<id-tarea>`).
5. Al terminar: corre los checks locales del carril (ver abajo), **pasa el resultado por
   el `revisor`**, corrige lo que marque, y muestra a Ricardo un resumen honesto de lo
   implementado + salida de tests. **Espera autorización.**
6. Con el OK: push a la rama y `gh pr create`. Ricardo espera el CI en verde y hace el
   merge él mismo.
7. Cuando Ricardo confirme el merge: marca `[x]` la tarea en `backlog.md`, **commitea el
   backlog en ese mismo movimiento**, y ofrece la siguiente tarea. Vuelve a esperar.

> Si el ejecutor no invoca al revisor por su cuenta, Ricardo lo dispara con `@revisor`.

## Checks locales antes de cantar victoria

Corre **los del carril que tocaste**. Si la tarea cruza carriles, corre los de todos.

- **`/api`** (NestJS + Prisma): `npm run lint` sin errores nuevos · `npm run typecheck`
  limpio · `npm test` verde, cero skips · si la tarea toca el esquema,
  `npx prisma migrate dev` limpio y `npx prisma validate` sin quejas.
- **`/web`** (React + Vite): `npm run build` limpio (tsc sin errores) · `npm run lint`
  sin errores nuevos · `npm test` verde cuando existan tests.
- **`/agent`** (.NET 8): `dotnet build --configuration Release` sin warnings nuevos ·
  `dotnet test` verde cuando existan tests.
- **`/infra`**: `docker compose config` valida el compose antes de tocarlo.

Un carril que todavía no existe no se inventa: si la tarea no lo toca, no lo corras.

## Reglas de cierre (gate)

- `[x]` = **mergeado a main por Ricardo y confirmado**. No "CI verde", no "ya pusheé".
- Nunca aflojes un test, un tipo o una validación para forzar el verde.
- Rama nueva siempre desde main actualizado. Nunca rama-sobre-rama ni reusar ramas viejas.
- Una tarea por corrida. Nada "de pasada".
- Si la tarea expone o cambia un endpoint, el **contrato OpenAPI se actualiza en el mismo
  entregable** (es la fuente única del contrato; el frontend construye contra eso).
- Si la tarea descubre algo del esquema de SoftRestaurant, **`docs/esquema-sr.md` se
  actualiza en el mismo entregable**, aunque la tarea no sea de mapeo.
- Cuando una tarea habilita un carril del CI, **descomentar ese carril en
  `.github/workflows/ci.yml` es parte del entregable**, no un "ya luego".
- El commit que marca `[x]` en `backlog.md` (y solo ese, sin tocar otro archivo) va
  directo a main con push; no requiere rama ni PR.

## Diagnóstico antes de modificar

Si la tarea es arreglar algo existente: primero diagnostica (lee, reproduce, explica la
causa) y espera OK antes de editar. No reescribas a ciegas.

Si el diagnóstico apunta a SoftRestaurant, **mira primero `docs/esquema-sr.md`**: lo que
parece un bug nuestro suele ser una columna que en esta versión del POS significa otra
cosa.

## Nunca

- Nunca avances de tarea sin autorización explícita de Ricardo.
- Nunca marques `[x]` sin merge confirmado.
- Nunca uses `--dangerously-skip-permissions` en sesiones interactivas. La única excepción
  es el orquestador local del Modo autónomo, que lo lanza con el hook `pre-push` como
  guardia. La sesión que abre ese orquestador **es interactiva y lleva ese flag**: eso es el
  orquestador haciendo su trabajo, no una sesión tuya saltándose la regla.

### Las reglas de dominio, que no se negocian nunca

- **Nunca escribas en la base de SoftRestaurant.** Ni `INSERT`, ni `UPDATE`, ni `DELETE`,
  ni `CREATE`, ni una tabla auxiliar "sólo para el cursor". El usuario SQL es de **solo
  lectura** y así se queda. El estado propio del agente vive en su SQLite local. El POS es
  el sistema del que vive el restaurante y no es nuestro: si nuestro código lo rompe, el
  negocio no puede cobrar.
- **Nunca lances una query pesada sin `WITH (NOLOCK)` y sin timeout corto.** Un bloqueo
  nuestro sobre las tablas de operación es una caja detenida.
- **Nunca consultes datos sin pasar por el helper de scope.** `empresa_id`/`sucursal_id`
  se aplican con el helper obligatorio en **TODO** query, no "recordando ponerlo".
- **Nunca devuelvas 403 por datos de otra empresa: es 404.** Un 403 confirma que el
  recurso existe, y eso ya es filtrar información entre clientes.
- **Nunca guardes dinero en `float`.** `NUMERIC(12,2)` en Postgres, decimal en el código.
- **Nunca guardes fechas en hora local.** UTC en base, `America/Mexico_City` en
  presentación, y los cortes de "hoy" en la **zona de la sucursal**, no la del servidor.
- **Nunca rompas la idempotencia de la ingesta.** Upsert por `(sucursal_id, folio_sr)` con
  constraint único en base. Reenviar el mismo lote tres veces deja exactamente los mismos
  datos.
- **Nunca commitees secretos ni datos reales de un cliente.** Cadenas de conexión al SQL
  Server del restaurante, API keys de sucursal, credenciales del PAC, el `.key` del CSD o
  su contraseña: ninguno entra al repo. Tests con fixtures sintéticas.
- **Nunca dejes un hallazgo sobre SoftRestaurant fuera de `docs/esquema-sr.md`.** Ese
  conocimiento no está en ningún otro lado.
- Fuera de alcance salvo tarea explícita: timbrado real con el PAC, deploy a producción,
  tocar el VPS o sus llaves, y cualquier tarea de Fase 2 antes de que F1-091 cierre.

## Modo rápido

Se activa SOLO cuando Ricardo lo pide con la instrucción literal "MODO RÁPIDO". Es una
excepción a la cadencia del bucle, **no a sus garantías**. Se combina con Modo autónomo o
se usa solo. Lo que cambia:

- **Un plan para toda la corrida**, no uno por tarea, con **una** pasada de revisor sobre
  ese plan y **una** al cierre de la corrida. La sección del backlog dice cuántas y dónde.
- **Sin paradas de autorización entre tareas.** Sigue siendo una rama y un PR por tarea.
- **Excepción que nunca se levanta:** si la tarea toca la lectura de SoftRestaurant, el
  scope multiempresa, el cálculo de agregados o la idempotencia de la ingesta, esa parte
  pasa por **revisor aparte**, sin importar el modo.
- **Tests.** La sección del backlog puede aplazar la suite completa al cierre de la corrida
  y acotar qué se escribe durante ella. Lo que **no** puede hacer, ni en modo rápido ni en
  ninguno: borrar un test, marcarlo skip, o aflojar un tipo o una validación. Un test que
  rompe porque el comportamiento cambió **se adapta al comportamiento nuevo**; uno que rompe
  porque algo se rompió, se arregla.
- La sección del backlog es la que define el régimen concreto de su corrida. Si no lo
  define, aplica el bucle normal.

## Modo autónomo (nocturno)

Existe un modo autónomo local que se activa SOLO cuando Ricardo lanza una sesión con la
instrucción literal "MODO AUTÓNOMO". Sus reglas y su orquestador viven fuera del repo, en
archivos locales de la máquina de Ricardo; la sesión que lo lanza recibe en su prompt cuál
leer. Sin esa instrucción literal, aplica el bucle normal de este archivo.
