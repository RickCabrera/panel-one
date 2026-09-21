# Log del modo autónomo

Este archivo es el **único canal entre sesiones nocturnas**. La sesión que viene detrás
no recuerda nada de la anterior: no vio su razonamiento, ni sus dudas, ni lo que
descubrió a medio camino. Sólo lee esto.

Escribe para alguien que llega en frío.

## Reglas de este archivo

1. **Una entrada por tarea**, al final del archivo (las nuevas abajo).
2. **La entrada se commitea DENTRO DE LA RAMA de la tarea**, antes del push y del PR, y
   viaja en el PR como un archivo más del entregable. No después del merge: el vigilante
   mata la ventana en cuanto la tarea cierra, y la nota escrita después es la nota que no
   se escribe. En un repo hermano que corre este mismo protocolo, nueve sesiones seguidas
   cerraron sin dejar nota por eso.
3. **Excepción, una sola:** la entrada de una tarea **SALTADA** va commiteada y pusheada
   **directo a main**. La rama se va a borrar; si la nota se queda en ella, la sesión
   siguiente no ve el salto y vuelve a tomar la misma tarea.
4. La palabra **SALTADA** en el encabezado es lo que lee la sesión siguiente para no
   volver a tomar esa tarea. Escríbela tal cual, en mayúsculas.
5. Lo que no sirve: "implementé F1-030, todo bien". Lo que sirve: por qué elegiste esa
   opción y no la otra, qué te tomó más tiempo del que valía, qué está a medias, qué
   supusiste sin poder confirmarlo, y qué harías distinto.
6. Los hallazgos sobre el esquema de SoftRestaurant **no van aquí**: van a
   `docs/esquema-sr.md`, que es donde alguien los va a buscar. Aquí sólo la referencia.

## Formato

```markdown
## AAAA-MM-DD HH:MM — F1-0XX · Título corto de la tarea
**Estado:** CERRADA (PR #N, mergeada) | SALTADA (razón en una línea)

**Qué quedó hecho.** Lo que de verdad funciona al terminar, no lo que se intentó.

**Decisiones que tomé y por qué.** Sobre todo las que otra sesión podría revertir sin
saber que ya se pensaron. Incluye las marcadas `# DECISION PROVISIONAL (nocturno):`
en el código, con su ruta y línea.

**Trampas que encontré.** Lo que costó tiempo y no era obvio: una columna del POS que
significaba otra cosa, un test que pasaba por el motivo equivocado, una herramienta que
falló en silencio. Es lo más valioso que puede tener esta nota.

**Qué quedó abierto.** A medias, pendiente, o que descubrí que hace falta y no era parte
de esta tarea. Si es una tarea nueva, dilo y di dónde debería ir en la cola.

**Qué haría distinto.** Para quien tome la siguiente.
```

---

<!-- Las entradas empiezan aquí. La primera sesión nocturna escribe debajo de esta línea. -->

## 2026-09-20 20:25 — F1-001 · Monorepo y tooling base
**Estado:** CERRADA PARCIAL (corte por máquina, no por tiempo) — falta verificar
`docker compose up`; el resto queda en **F1-001b**, que está en **Diurnas**.

> Sesión interactiva con Ricardo presente, no nocturna. Se retomó después de que un
> reinicio mató la sesión original con todo el andamiaje en staging en `feat/F1-001`.
> Por decisión explícita de Ricardo (andamiaje, él presente): sin pase de revisor y merge
> sin esperar al CI, en cuanto pasaron los checks locales. No es precedente para el bucle.

**Qué quedó hecho.** Carpetas `/agent`, `/api`, `/web`, `/infra` con su tooling:
`.editorconfig`, `.gitignore` por carpeta, ESLint + Prettier en `/api` y `/web`,
`Directory.Build.props` con nullable en `/agent`, README raíz, `infra/docker-compose.yml`
con Postgres 16 vacío. Los carriles `api`, `web` y `agent` de `.github/workflows/ci.yml`
quedaron encendidos sin sus pasos de test (cada uno anota la tarea que lo enciende:
F1-011, F1-041, F1-021).

Verificado en local, sobre el commit de la rama:
- `npm run dev` en `/api`: Nest arranca, `GET http://localhost:3000/` → 200
  `{"servicio":"monitor-api","estado":"arriba"}`.
- `npm run dev` en `/web`: Vite arranca, `GET http://localhost:5173/` → 200.
- `dotnet build --configuration Release` en `/agent`: 0 advertencias, 0 errores.
- `/api`: lint limpio, typecheck limpio, jest 1/1. `/web`: lint limpio, build (tsc + vite)
  limpio, vitest 1/1. `prettier --check .` limpio.
- `docker compose config -q` en `/infra`: válido.

**Por qué el corte.** Esta máquina no tiene la virtualización habilitada en la BIOS, así
que Docker Desktop no puede arrancar el engine: `docker compose config` valida, pero
`docker compose up` no se puede correr. Lo único del "Listo cuando" que no se verificó es
"`docker compose up` en `/infra` levanta postgres vacío".

**Trampas que encontré.** `npm ci` avisa de postinstall bloqueados por `allow-scripts`
(`unrs-resolver`); no afecta lint/build/test hoy, pero si algo de ESLint empieza a fallar
raro en otra máquina, empieza por ahí.

**Qué quedó abierto.** **F1-001b** (Diurnas): correr `docker compose up -d` en `/infra` en
una máquina con virtualización y confirmar que Postgres queda healthy y vacío. Es diurna
porque depende del hardware de la máquina, no de código. **Ojo:** F1-010 (`prisma migrate
dev`) necesita un Postgres corriendo; si la máquina sigue sin virtualización, esa tarea
también se va a topar con esto (alternativa: Postgres nativo de Windows en el 5432 con las
credenciales de `infra/.env.example`).

**Qué haría distinto.** Commitear el andamiaje en cuanto compila, aunque falten checks:
un reinicio con todo en staging es trabajo que sólo sobrevivió de milagro.

## 2026-09-20 20:55 — F1-010 · Esquema Prisma núcleo
**Estado:** CERRADA (PR de `feat/F1-010`, squash a main)

**Qué quedó hecho.** `api/prisma/schema.prisma` con `Empresa`, `Sucursal`, `Usuario`
(enum `rol_usuario`) y `AgenteEstado`; migración `20260921023706_esquema_nucleo`; seed
`api/prisma/seed.ts` (`npx prisma db seed`: 1 admin global `admin@monitor.local`, empresa
"Restaurante Demo", sucursales Centro y Norte); `api/prisma/esquema.spec.ts` con 10 tests
contra Postgres real. Verificado en local: `migrate dev` aplica y una segunda corrida dice
"Already in sync"; `db seed` dos veces sin cambios; lint, typecheck, `npm test` 11/11
(0 skips), `prisma validate`, `nest build` (sigue saliendo `dist/main.js`).

**Decisiones que tomé y por qué.**
- **Prisma 6.19.3, fijo, no 7 ni 8.** npm etiqueta `latest` a `8.0.0-rc.15` (un rc). Prisma 7
  exige driver adapter, `prisma.config.ts` y el generador nuevo con salida propia; Prisma 6
  es CommonJS, encaja con Nest 11 y carga `api/.env` solo. Subir de major es una tarea
  aparte, no algo "de pasada".
- **`@node-rs/argon2` (argon2id, m=19456 t=2 p=1, OWASP)**, no `argon2`: trae binarios napi
  sin postinstall. F1-011 debe verificar con la misma librería; las opciones están
  exportadas como `ARGON2_OPCIONES` en `api/prisma/seed.ts`.
- **`AgenteEstado` lleva `empresa_id`** aunque el backlog no lo lista (el revisor bloqueó el
  primer plan por eso: "índice por empresa_id en todo"). Marcado `DECISION PROVISIONAL
  (nocturno)` en `api/prisma/schema.prisma` (modelo AgenteEstado). Para que no pueda
  divergir, la FK es **compuesta** `(sucursal_id, empresa_id) → sucursales(id, empresa_id)`
  (`agente_estado_sucursal_empresa_fkey`), con `@@unique([id, empresaId])` en Sucursal.
  **Patrón a repetir en F1-030** para `Cheque`, que también lleva ambas columnas.
- **CHECK `usuarios_rol_empresa_chk`** (`(rol = 'admin_global') = (empresa_id IS NULL)`)
  escrito a mano al final de la migración: Prisma no modela CHECK. Si alguien regenera la
  migración inicial, se pierde; está avisado en la cabecera del schema.
- Tablas y columnas en snake_case (`@@map`/`@map`), campos camelCase en TS. IDs UUID.
  Timestamps `timestamptz(3)`. Seed con UUID fijos (`SEED_IDS`) para poder hacer upsert.
- La contraseña del admin sólo se hashea al CREAR (argon2 lleva sal: re-hashear cambiaría la
  fila en cada corrida). `updated_at` sí se refresca en cada seed (`@updatedAt`); el test de
  idempotencia lo excluye a propósito. El seed se niega con `NODE_ENV=production` y avisa en
  consola si usa la contraseña por defecto.
- `api_key_hash` quedó `String? @unique`. **Nota para F1-012:** tiene que ser hash
  determinista (SHA-256 de una key de alta entropía) para buscar por igualdad; argon2 no sirve.

**Trampas que encontré.**
- **Docker no arranca en esta máquina, pero HAY un PostgreSQL 16 nativo** (servicio
  `postgresql-x64-16`, `C:\Program Files\PostgreSQL\16\bin\psql.exe`) en el 5432 con el rol
  `monitor`/`monitor` y `CREATEDB` (hace falta para la shadow db de `migrate dev`). `psql` no
  está en el PATH. `api/.env` local ya existe (gitignorado) apuntando a la base `monitor`.
- **Prisma 6 en Postgres NO da el nombre de la FK en `P2003`** (`meta.constraint: null`). Para
  asegurar que falló la constraint correcta, los tests repiten la operación en SQL crudo
  (`$executeRaw`), donde el error es `P2010` con el mensaje de Postgres (SQLSTATE + nombre).
  Un CHECK llega como `PrismaClientUnknownRequestError` (sin código P), con `23514` y el nombre
  en el mensaje. Ver los helpers al inicio de `esquema.spec.ts`.
- `npm install` avisa de `allow-scripts` bloqueando los postinstall de `prisma`,
  `@prisma/engines` y `@prisma/client`. Aun así `prisma generate`/`migrate dev` funcionan
  (el CLI trae lo que necesita); no hubo que aprobar nada.
- **CRLF en migraciones:** Prisma guarda un checksum del `migration.sql`; un checkout de Windows
  con CRLF no coincide con una base migrada desde Linux y `migrate dev` pediría resetear.
  Agregué `api/prisma/migrations/** text eol=lf` a `.gitattributes`.
- Un heredoc de bash se comió los `\` de los regex de `jest.config.js` y ESLint lo cachó
  (`no-useless-escape`). Para archivos con backslashes, usa Edit y no heredoc.
- `npx prettier --check .` en la raíz falla con ~26 archivos **también en main** (finales CRLF
  del checkout en Windows vs `endOfLine` de prettier). No es de esta tarea y no lo toqué; los
  archivos nuevos pasan prettier. Candidato para F1-092 o para `.gitattributes`.

**Qué quedó abierto.**
- **Los tests de esta tarea NO corren en CI todavía:** el servicio postgres,
  `migrate deploy` y `npm test` del carril `api` son de F1-011 por backlog. En CI sólo se
  añadieron `prisma validate` (con URL de relleno) y `prisma generate` antes de typecheck.
  Cuando F1-011 los encienda, estos tests corren solos (siembran en su `beforeAll`).
- Los tests escriben en la base de `DATABASE_URL` (en local, la de desarrollo): el seed y un
  `AgenteEstado` temporal que se borra en `finally`. Si F1-011 agrega tests destructivos,
  conviene una base `monitor_test` también en local.
- No hay `PrismaService`/módulo de Nest todavía: F1-011 lo necesita y lo debe crear.
- **Email y mayúsculas (para F1-011):** `usuarios.email` es único sólo por igualdad exacta;
  `Admin@x` y `admin@x` serían dos usuarios. El seed guarda en minúsculas, pero F1-011 debe
  normalizar en un solo punto antes de escribir/buscar, o agregar un único sobre `lower(email)`.

**Qué haría distinto.** Confirmar qué expone Prisma en los errores (meta, clase, código)
antes de escribir los asserts: me habría ahorrado una vuelta.
