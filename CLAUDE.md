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
  es el orquestador del Modo autónomo, `scripts/nocturno-v2.ps1`, que lo lanza con el hook
  `pre-push` como guardia. La sesión que abre ese script **es interactiva y lleva ese
  flag**: eso es el orquestador haciendo su trabajo, no una sesión tuya saltándose la regla.

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

Se activa SOLO cuando Ricardo lanza una sesión con la instrucción literal "MODO AUTÓNOMO".
En ese modo el bucle cambia así, y NADA MÁS cambia:

- No hay paradas humanas: no esperes autorización del plan ni del resultado. El revisor
  SIGUE siendo obligatorio en ambos puntos (plan y entregable).
- Toma la PRIMERA tarea de la sección "Cola nocturna" de `backlog.md` que no esté `[x]` ni
  aparezca como SALTADA en `docs/nocturno-log.md`. Haz UNA sola tarea por sesión y termina.
  **No toques el bloque "Diurnas"**: esas tareas necesitan a Ricardo o acceso externo y no
  se pueden cerrar de noche por definición.
- **Una tarea = una sesión, y la sesión TERMINA al cerrarla.** No encadenes la siguiente
  aunque quede tiempo y aunque sea obvia cuál sigue: `scripts/nocturno-v2.ps1` lanza un
  proceso nuevo por tarea, y ese proceso nuevo es lo que hace que la tarea 12 arranque con
  tanto contexto útil como la 1. Encadenar dentro de la misma sesión arrastra el historial
  entero y degrada todo lo que venga después.
- **El log es el ÚNICO canal entre sesiones.** La siguiente sesión **no recuerda nada** de
  ésta: no ha visto tu razonamiento, tus dudas ni lo que descubriste a medio camino. Escribe
  en `docs/nocturno-log.md` lo que necesitaría saber alguien que llega en frío: decisiones
  que tomaste, lo que quedó abierto, las trampas que encontraste y lo que ibas a hacer
  distinto. Si algo importa y no está escrito, se perdió.
- **Y el log se escribe DENTRO DE LA RAMA, antes del push y del PR.** No después del merge.
  Su commit va en la rama de la tarea y viaja en el PR como un archivo más del entregable.
  *Por qué:* el vigilante mata la ventana en cuanto la tarea cierra, y escribir la nota
  después del merge es escribirla en el minuto en que te están apagando. En un repo hermano
  que corre este mismo protocolo, **nueve sesiones seguidas cerraron sin dejar nota** por
  exactamente eso. Tras el merge, a main sólo va el commit del `[x]` en `backlog.md`.
- Si la Cola nocturna ya no tiene tareas pendientes, **no inventes ninguna** ni te adelantes
  a las Diurnas ni a la Fase 2: crea el archivo vacío `COLA_VACIA.txt` en la raíz del repo y
  termina. El loop lo lee y para.
- Rama `feat/<id>` desde main actualizado. Construye. Checks locales. Revisor. Si el revisor
  BLOQUEA, corrige y vuelve a pasar; si bloquea dos veces **en el mismo gate**, la tarea se
  SALTA (ver abajo).
- **Los dos bloqueos son POR GATE, no acumulados entre gates.** Hay dos gates: el del plan y
  el del entregable, cada uno con su contador propio que arranca en cero.
  - Dos bloqueos en el gate del **plan** → SALTA (nunca llegaste a construir).
  - Dos bloqueos en el gate del **entregable** → SALTA.
  - Un bloqueo en el plan **más** un bloqueo en el entregable → **NO se salta**: son gates
    distintos y ninguno llegó a dos. Sigue trabajando.
  - Aprobar el plan **no perdona** nada del entregable, y un bloqueo del entregable no
    reabre el contador del plan.
- Con revisor aprobado: **escribe y commitea la entrada del log en la rama**, push,
  `gh pr create`, `gh pr checks --watch`; con CI verde:
  `gh pr merge --squash --delete-branch` (sin `--auto`). Si el CI falla: máximo 2 intentos
  de arreglo; si sigue rojo, SALTA.
- **Cierre.** Merge confirmado (`gh pr view --json state` dice MERGED):
  `git checkout main && git pull`, marca `[x]` en `backlog.md`, commit directo a main con
  push. La nota del log ya entró con el PR: no la repitas aquí. Como **último paso**, crea el
  archivo vacío `TAREA_CERRADA.txt` en la raíz del repo y termina la sesión. Ése es el aviso
  de que ya no te queda nada por escribir y la ventana se puede cerrar.
- **Salto.** Al SALTAR una tarea —revisor que bloquea dos veces en un gate, o CI que sigue
  rojo tras dos intentos—: `gh pr close` si llegaste a abrirlo, escribe la razón en
  `docs/nocturno-log.md` marcándola **SALTADA**, y **commitea y pushea esa entrada DIRECTO a
  main** (el `pre-push` lo permite). No la dejes en la rama: la vas a borrar, y entonces la
  siguiente sesión no ve el salto y vuelve a tomar la misma tarea. Después borra la rama,
  crea el archivo vacío `TAREA_SALTADA.txt` en la raíz y termina **sin marcar nada** en el
  backlog.
- **Corte por tiempo: la tarea que no cabe se PARTE, no se abandona ni se salta.** Si a
  media construcción ves que la tarea completa no entra en el tiempo de la sesión, no la
  dejes a medias en una rama que nadie va a retomar ni la marques SALTADA: córtala. Un
  corte son cuatro movimientos, y los cuatro:
  1. **Mergea la parte que funciona y no rompe nada.** Misma rama, mismo PR, mismos checks
     locales, mismo revisor, mismo CI verde. Lo que entra tiene que quedar coherente por sí
     solo: nada a medio cablear, ningún test borrado ni en skip, ninguna validación
     aflojada. Si el pedazo que tienes no cumple eso, no hay corte que valga y la tarea
     sigue el camino normal (cerrar o SALTAR).
  2. **Marca `[x]` en `backlog.md` y en esa misma línea escribe `**PARCIAL:** falta ...`**
     con lo que quedó fuera, concreto. El `[x]` es lo que hace que las tareas que dependían
     de ésta avancen con lo que ya existe; el `PARCIAL` es lo que evita que alguien lea ese
     `[x]` como "completa".
  3. **Agrega al final del `backlog.md` una tarea nueva `<ID>b`** —`F1-032b` si cortaste
     `F1-032`— con el resto y con **su propio "Listo cuando"**, y **métela en la Cola
     nocturna justo después de la tarea actual**: su fila en la tabla y su lugar en el
     orden. Ahí es donde va, no al final de la cola: el resto de una tarea cortada suele
     ser justo lo que las siguientes esperan.
  4. **Escribe en `docs/nocturno-log.md` por qué se cortó y DÓNDE se cortó**: qué quedó
     dentro, qué quedó fuera, y por dónde retomar. La sesión que tome la `<ID>b` llega en
     frío y ese log es lo único que tiene.
  El `[x]`, el `PARCIAL`, la tarea nueva y su fila en la cola son **todos `backlog.md`**:
  el commit de cierre sigue tocando ese archivo y ninguno más, así que el respaldo por
  commit del orquestador lo sigue reconociendo como cierre. El resto del cierre no cambia:
  la nota del log viaja en el PR de la parte que sí entró, y el centinela final es
  `TAREA_CERRADA.txt`.
- Decisiones que dependen del mundo (una instalación real de SoftRestaurant que todavía no
  se ha visto, una versión del POS que no está mapeada): busca primero en
  `docs/esquema-sr.md`. Si no está cubierta ahí, toma la opción MÁS CONSERVADORA, déjala
  señalada con un comentario `# DECISION PROVISIONAL (nocturno):` en el código, anótala en
  `docs/esquema-sr.md` como supuesto no validado y en el log, y continúa. Nunca te detengas
  a preguntar.
- **Límite de uso.** Si la sesión muere porque se agotó el límite de tokens, no es un fallo
  de la tarea y no se anota como SALTADA: `scripts/nocturno-v2.ps1` espera y **reintenta la
  misma tarea** en una sesión nueva. Deja el árbol en un estado del que se pueda continuar
  —rama pusheada o cambios commiteados— y no marques nada. Es el único camino que NO deja
  centinela: sin ninguno de los tres archivos, el loop asume límite de uso y reintenta.
- **Los tres centinelas, juntos.** Son archivos vacíos en la raíz del repo, están
  gitignorados, y el loop los borra al empezar cada vuelta. Crea **uno solo** y siempre como
  último acto de la sesión: `TAREA_CERRADA.txt` (cerraste), `TAREA_SALTADA.txt` (saltaste),
  `COLA_VACIA.txt` (no había nada que tomar).
- Prohibido en modo autónomo, sin excepción: deploy (SSH al VPS, `docker compose up` en
  producción, GitHub Actions de deploy), tocar producción, secretos o llaves,
  **`git push --force` y `git push --no-verify`** —los dos juntos, porque `--no-verify`
  brinca el `pre-push`, que es la única guardia real de main, y `--force` reescribe lo que
  ya pasó por ella—, `filter-repo`, borrar ramas que no sean tuyas ya mergeadas, escribir
  en la base de SoftRestaurant, cambiar este CLAUDE.md o `.claude/settings.json`, y aflojar
  tests o CI para lograr el verde.
