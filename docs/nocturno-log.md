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

## 2026-09-20 21:03 — F1-011 · Auth de usuarios (JWT)
**Estado:** CERRADA (PR de `feat/F1-011`, squash a main)

**Qué quedó hecho.** `POST /auth/login` (rate limit 5/min por IP → 429), `POST /auth/refresh`,
`GET /auth/me`. Access JWT de 15 min en el body y refresh JWT de 7 días en la cookie
`monitor_refresh` (httpOnly, SameSite=Strict, Path=/auth, Secure con `NODE_ENV=production`).
Hay dos guards globales, `JwtAuthGuard` y luego `RolesGuard`, más los decoradores
`@Public()` y `@Roles()`. El helper obligatorio de scope es `ScopedPrismaService.para(scope)`
y el contrato quedó en `api/openapi.json`. En CI, el carril api ya levanta Postgres, corre
`migrate deploy` y `npm test`.
Verificado en local: lint, typecheck, `prisma validate` y `nest build` limpios (sigue
saliendo `dist/main.js`); `npm test` 70/70 con 0 skips. Arranqué la app real
(`node dist/main.js`): sin secretos truena con mensaje claro; con secretos, `GET /` da 200,
`/auth/me` sin token 401 y login malo 401.

**Decisiones que tomé y por qué.**
- **El scope se aplica en el guard, no en un middleware** (el backlog dice "middleware"). En
  Nest el middleware corre antes que los guards y no ve el JWT validado ni `@Public()`.
  `JwtAuthGuard` verifica el token y en ese mismo paso pone `req.usuario` y
  `req.empresaScope`. El decorador `@EmpresaScopeActual()` lo lee y truena si la ruta es
  pública.
- **Cómo queda obligatorio el helper de scope** (lo que pidió el revisor):
  1. `ScopedPrismaService.para(scope)` devuelve sólo los delegados de los modelos, y sólo con
     `findFirst/findFirstOrThrow/findMany/count/aggregate/groupBy`. Una extensión de Prisma
     mete `AND {empresaId}` en el WHERE (para `Empresa` usa `id`). No hay create, update,
     delete, findUnique, `$queryRaw` ni `$transaction`. El cliente crudo vive en un campo
     `#privado`.
  2. `LLAVE_EMPRESA` en `src/scope/scope.helper.ts` tiene un
     `satisfies Record<Prisma.ModelName, ...>`: **F1-030 tiene que registrar `Cheque`,
     `ChequePartida`, etc. ahí, o el typecheck falla.** Ojo: `ChequePartida` y `ChequePago`
     no traen `empresa_id` en el backlog. O se les agrega la columna (con FK compuesta, igual
     que AgenteEstado) o se decide otra cosa, pero hay que decidirlo en F1-030.
  3. `eslint.config.mjs` usa `no-restricted-imports` para prohibir `PrismaService` y
     `PrismaClient` en `src/**`. La allowlist es `src/prisma/**`,
     `src/scope/scoped-prisma.service.ts`, `src/auth/auth.service.ts` (el login busca por
     email sin scope) y los `*.spec.ts`. `src/lint/restriccion-prisma.spec.ts` comprueba que
     la regla sí muerde: corre el ESLint real por `--stdin` en un proceso aparte, porque la
     config `.mjs` no carga dentro de jest.
- **Las escrituras con scope NO existen todavía.** F1-060 (CRUD) y la ingesta las van a
  necesitar. Hay que agregarlas en `ScopedPrismaService` con su filtro (que `data.empresaId`
  no pueda apuntar a otra empresa) y con tests, no importando Prisma directo. La ingesta
  (F1-031) va por API key y no por usuario: probablemente necesite un scope "de sucursal".
  Es decisión de F1-012/F1-031.
- **El 404 se prueba con un controlador que sólo existe en el test**
  (`PruebaScopeController` en `src/auth/auth.e2e.spec.ts`). Hoy no hay ningún endpoint de
  datos por empresa (`/empresas` y `/sucursales` son de F1-033/F1-060). Recorre la tubería
  real: login → guard → scope → `findFirst` con scope → `encontradoOr404`. Visor de A pide
  una sucursal o la empresa de B → 404, con cuerpo idéntico al de un UUID inexistente.
  **F1-033 debe agregar e2e de scoping por cada endpoint real.**
- Login: el email se normaliza (`trim().toLowerCase()`) con un `@Transform` en el DTO, antes
  de `@IsEmail` (con espacios, IsEmail da 400), y otra vez en el servicio. Email inexistente,
  contraseña mala, usuario inactivo o empresa inactiva → **401 con el mismo cuerpo**. Cuando
  el email no existe se verifica igual contra un hash argon2 de relleno, así el tiempo de
  respuesta no delata qué emails existen.
- Refresh y `/me` **releen al usuario de la base** (activo y empresa activa). El scope de
  cada request, en cambio, sale de los claims del access token.
- `ARGON2_OPCIONES` se mudó a `src/auth/argon2.ts`; el seed lo importa y lo re-exporta.
  Si `src/` importara de `prisma/`, `nest build` cambiaría la raíz de salida y
  `dist/main.js` dejaría de existir.
- El contrato OpenAPI se genera con `npm run openapi` en /api (`NestFactory.create` en modo
  `preview`: no pide base ni secretos). `src/openapi/openapi.spec.ts` falla si
  `api/openapi.json` no es exactamente lo que genera el código. El archivo está en
  `.prettierignore` y fijo en LF en `.gitattributes`. `GET /` (andamio) queda fuera del
  contrato (`@ApiExcludeController`) y es `@Public()`. **`/docs` todavía NO se sirve**: es de
  F1-033, que lo pide protegido.
- Dependencias nuevas: `@nestjs/jwt@11`, `@nestjs/throttler@6`, `@nestjs/swagger@11` (el 12
  pide Nest 12), `class-validator`, `class-transformer`, `cookie-parser`, `supertest`.

**Trampas que encontré.**
- **El rate limit de login le pega a los propios tests.** Todos los requests salen de la
  misma IP y cuentan también los 400 y los 401. Cada `describe` del e2e levanta su propia
  app, porque el storage del throttler es por instancia, y ninguno pasa de 5 logins. Donde
  sólo hace falta un token, se firma con `TokensService`. **No subas el límite ni apagues el
  throttler en tests.** Si agregas casos de login, abre otro bloque.
- `npm test` ahora es `jest --runInBand`. `prisma/esquema.spec.ts` fotografía tablas enteras
  y, en paralelo, los fixtures de auth se colaban en la foto.
- Los fixtures son propios (`api/test/fixtures-auth.ts`, UUIDs `f1011000-…` y emails
  `@f1-011.test`) y **no dependen del seed**: en CI la base llega vacía. Se limpian antes y
  después.
- En supertest, `await (await algo).expect()` no tipa: el `await` del `Test` ya devuelve el
  `Response`.
- `require.resolve('eslint/bin/eslint.js')` falla porque no está en los `exports` del
  paquete. Hay que resolver `eslint/package.json` y armar la ruta desde ahí.
- En Git Bash, un script de python con `open()` sin `encoding` escribe cp1252 y rompe los
  acentos. Usa Edit/Write, o `encoding='utf-8'` explícito. Un heredoc largo con backticks
  y comillas también se rompió en el parser de bash, dos veces, y en ese caso no se escribe
  nada.
- **Tu `api/.env` local no trae `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`**: no lo toqué (es
  un archivo de secretos). `npm run dev` no arranca hasta que se agreguen; los valores de
  relleno y el comando para generarlos están en `api/.env.example` y en el README. Los tests
  no los necesitan: `api/test/entorno.ts` pone unos sintéticos si faltan.

**Qué quedó abierto** (no son tareas nuevas en el backlog, en autónomo no se agregan):
- **No hay revocación de refresh tokens ni logout.** No hay tabla de sesiones: rotar no
  invalida el refresh anterior, y uno robado vale 7 días. Tampoco se revoca el access: un
  usuario desactivado o cambiado de empresa conserva su scope viejo hasta 15 min (`/me` y
  refresh sí lo cortan). Candidato para F1-092.
- **`trust proxy`**: detrás del proxy del VPS, `req.ip` será la IP del proxy y el límite de
  5/min se compartirá entre todos. Hay que configurarlo al hacer el deploy.
- **CORS** para la SPA: F1-040 decide si usa el proxy de Vite (cookie del mismo origen) o
  CORS con credentials. La cookie es SameSite=Strict con Path=/auth.
- El storage del throttler es en memoria y vale por proceso: con varias réplicas no alcanza.
- El revisor aprobó el entregable con estas observaciones, que quedaron anotadas y **sin
  tocar el código**. Así lo que entra es exactamente lo que se revisó:
  1. **La regla de lint se puede brincar.** No cubre `require('@prisma/client')`, las
     subrutas (`@prisma/client/default`, `.prisma/client`) ni `import x = require(...)`.
     Atrapa el olvido, no a quien quiera saltársela. Hay que agregar esos patrones, con
     casos en `restriccion-prisma.spec.ts`, la próxima vez que se toque la regla (F1-033
     o F1-092).
  2. **`findFirstOrThrow` da 500.** Está entre las lecturas permitidas de
     `ScopedPrismaService`, y si no encuentra nada lanza el error de Prisma, que llega como
     500 y no como 404. No filtra nada, pero rompe la convención: **F1-033 debe quitarla**
     de `OPERACIONES_PERMITIDAS` o traducirla a `NotFoundException`.
  3. **Un usuario desactivado sigue entrando a las rutas de datos** hasta que vence su
     access token (15 min), no sólo a `/me`. Va junto con la revocación, en F1-092.
  4. **Los `include`/`select` de relaciones no pasan por el filtro de empresa.** Hoy da
     igual, porque todas las relaciones cuelgan de la misma empresa. **Hay que revisarlo en
     F1-030** si `ChequePartida` o `ChequePago` quedan sin `empresa_id` propio.

**Qué haría distinto.** Escribir los archivos con Write desde el principio, en vez de
heredocs y python desde bash: perdí dos vueltas con encoding y parseo.

## 2026-09-20 21:20 — F1-012 · Auth de agentes (API key)
**Estado:** CERRADA (PR de `feat/F1-012`, squash a main)

**Qué quedó hecho.**
- `POST /sucursales/:id/api-key` genera la key de la sucursal, o la rota si ya tenía una.
  Sólo lo pueden llamar `admin_global` y `admin_empresa`. Responde 201 con
  `{ sucursalId, apiKey }` y `Cache-Control: no-store`, y es la única vez que la key sale del
  servidor. En `sucursales.api_key_hash` queda su SHA-256 en hex. Un visor recibe 403 (depende
  de la ruta). Una sucursal de otra empresa da 404, con el mismo cuerpo que un UUID inexistente.
- `AgentAuthGuard` lee `X-Api-Key`, calcula el hash y busca la sucursal. Da 401, siempre con
  el mismo cuerpo, si falta la key, no existe, la sucursal está inactiva o **la empresa está
  inactiva** (esto último lo agregué por conservador).
- `GET /agente/yo` devuelve `{ sucursalId, nombre, zonaHoraria }` de la sucursal de la key.
- Rate limit de 120/min por sucursal, sumando todas las rutas de agente.
- Contrato: `api/openapi.json`, con el security scheme `agente` (apiKey en el header
  `X-Api-Key`).
- Verificado en local: lint, typecheck, `prisma validate` y build limpios; `npm test` 101/101
  con 0 skips. También arranqué la app real y los 401 salen bien.

**Decisiones que tomé y por qué.**
- **Formato de la key:** `msr_` + 32 bytes aleatorios en base64url. El hash es SHA-256 sin sal,
  como pedía la nota de F1-010 en `schema.prisma`: la búsqueda es por igualdad sobre el índice
  único, y una key de 256 bits no se adivina por diccionario. No hubo migración.
- **Generar y rotar son la misma operación:** una sola sentencia sobrescribe el hash, y el
  guard busca en la base en cada request, sin caché. Por eso la key vieja da 401 en el request
  siguiente. Si llegan dos rotaciones a la vez, gana la última; está documentado en el
  OpenAPI para F1-060.
- **`ScopedPrismaService` ya tiene su primera escritura: `updateMany`.** Aplica el mismo AND de
  empresa en el WHERE, más `validarEscritura`:
  - rechaza un `where` vacío o ausente (para admin_global el filtro es `{}` y actualizaría la
    tabla entera);
  - rechaza un `data` que toque `COLUMNAS_INTOCABLES` (`id, empresaId, sucursalId, empresa,
    sucursal`) o la `LLAVE_EMPRESA` del modelo.
  Es una lista de **prohibidas**. Si F1-030 trae otra columna de pertenencia que no esté ahí,
  se agrega con su test. create, upsert, delete y findUnique siguen sin existir.
- **Rutas de agente:** se marcan SÓLO con `@AutenticacionAgente()` (`src/agentes/decoradores.ts`),
  que trae `AgentAuthGuard` y `ThrottlerGuard` pegados, en ese orden. La metadata
  `ES_RUTA_AGENTE` no se exporta, para que nadie pueda marcar una ruta sin ponerle el guard.
  `JwtAuthGuard` deja pasar esas rutas sin Bearer (vía `esRutaAgente()`), y un Bearer de usuario
  NO las abre. `@AgenteActual()` truena si se usa fuera de una ruta de agente.
- **El throttler `agente`** está en `src/agentes/throttle-agente.ts` y se registra en el
  `ThrottlerModule.forRoot` de AuthModule, junto a `login`:
  - Cuenta por `req.agente.sucursalId` y usa su propio `generateKey`, así que el contador es
    por sucursal y no por ruta.
  - En v6 **todos los throttlers con nombre aplican a toda ruta con ThrottlerGuard**, por eso
    login lleva `@SkipThrottle({ agente: true })` y las rutas de agente `SkipThrottle({ login:
    true })`. Si agregas un tercer throttler, sáltalo en las rutas que no son suyas.
  - Rotar la key no reinicia el contador, porque es de la sucursal.
- **La lectura por hash va sin scope.** `AgentesAuthService` usa `PrismaService` crudo y entró a
  la allowlist de `eslint.config.mjs`, con la misma justificación que el login: todavía no se
  sabe el tenant. Sólo tiene ese método. `restriccion-prisma.spec.ts` prueba que la regla sigue
  mordiendo en el resto de `src/agentes`.
- **`GET /agente/yo` es parte deliberada de la tarea**, con el visto bueno del revisor. Sin una
  ruta real, el guard no tenía quién lo usara y el "Listo cuando" se habría probado contra un
  controlador de test. Además, F1-025 y F1-026 lo pueden usar para verificar la key al
  instalar. Lee por el helper de scope con `scopeDeAgente()`
  (`src/scope/empresa-scope.ts`).
- Se permite generar key a una sucursal inactiva (es inofensivo, porque el guard la rechaza).

**Trampas que encontré.**
- **El heredoc de bash volvió a romperse** con un bloque grande que traía backticks y comillas, y
  no escribió NADA. Aprende de F1-011 y de mí: los archivos se escriben con Write.
- En supertest, si armas varios requests de golpe (`[yo(a), yo(a, ''), ...]`) y los esperas
  después, sale `ECONNREFUSED`: cada request abre su puerto efímero. Hay que armarlos dentro del
  loop, justo antes de mandarlos.
- Un helper `async` que devuelve `request(...).post(...)` pierde `.expect()` en el tipo, porque
  el `await` lo resuelve a `Response`. Por eso existe `rotarEsperando()` en el e2e.
- `npx prettier --write` sobre carpetas enteras cambia el fin de línea en el working copy de
  archivos que no tocaste. Git no los ve como cambios (autocrlf), pero salen muchos warnings.

**Qué quedó abierto** (el revisor aprobó con estas observaciones; ninguna es tarea nueva):
- **F1-031, riesgo explícito:** `scopeDeAgente()` acota a la EMPRESA, no a la sucursal. En la
  ingesta, un agente de A1 no debe poder leer ni escribir datos de A2: el filtro por
  `sucursalId` se decide y se prueba allá. El `sucursalId` siempre sale de `@AgenteActual()`,
  nunca del payload.
- **`updateMany`, `where` con puros `undefined`:** `validarEscritura` sólo cuenta llaves. Un
  `where: { id: undefined }` pasa el chequeo, Prisma ignora los `undefined` y actualizaría todas
  las filas del scope (con scope global, la tabla entera). Hoy no se puede llegar ahí, porque
  `ParseUUIDPipe` garantiza el id y el índice único de `api_key_hash` haría fallar una escritura
  masiva. **La próxima tarea que use `updateMany` (F1-060) debe rechazar los where cuyos valores
  sean todos `undefined`, con su test.**
- **F1-092:** los requests con una key inválida no pasan por ningún throttle, porque no hay
  sucursal que contar. Cada uno cuesta una búsqueda por índice en la base. No hay fuerza bruta
  viable con 256 bits, pero sí carga gratis. Falta un límite por IP para los fallos.
- **Deploy:** el storage de los throttlers está en memoria y vale por proceso (con varias
  réplicas no alcanza), y falta configurar `trust proxy`, igual que en login.
- El test de rate limit no prueba que la ventana se reinicie al pasar el minuto. Es
  comportamiento de la librería y no se probó.
- La UI para generar la key es de F1-060 (/web): debe mostrarla una sola vez y avisar que
  rotar corta al agente en ese momento.

**Qué haría distinto.** Escribir todo con Write desde el primer archivo. Me costó una vuelta
volver a caer en la trampa del heredoc que F1-011 ya había dejado anotada.

## 2026-09-20 21:32 — F1-030 · Esquema de ventas en Postgres
**Estado:** CERRADA (PR de `feat/F1-030`, squash a main)

**Qué quedó hecho.**
- Modelos `Cheque`, `ChequePartida`, `ChequePago` y `MesaSnapshot`, más el enum `forma_pago`,
  en `api/prisma/schema.prisma`. Migración `20260921032708_esquema_ventas`, generada por
  Prisma, sin SQL a mano.
- Índice único `cheques_sucursal_id_folio_sr_key` e índice `cheques_empresa_id_cerrado_at_idx`.
  Todo importe es `NUMERIC(12,2)` y todo timestamp `timestamptz(3)`.
- Los 4 modelos quedaron registrados en `LLAVE_EMPRESA`. `chequeId`/`cheque` entraron a
  `COLUMNAS_INTOCABLES`.
- Tests: `api/prisma/ventas.spec.ts` (37, contra Postgres real) y un bloque nuevo en
  `scoped-prisma.service.spec.ts` que prueba el scope sobre las tablas de ventas.
- Verificado en local: lint, typecheck, `prisma validate` y build limpios; `migrate status`
  al día; `npm test` 146/146 con 0 skips. El revisor aprobó el plan y el entregable, los dos
  con observaciones no bloqueantes, que están todas aquí abajo.

**Decisiones que tomé y por qué.**
- **Cada tabla hija lleva su propio `empresa_id`** (también partidas y pagos) con **FK
  compuesta** `(padre_id, empresa_id) → padre(id, empresa_id)`, el mismo patrón que
  `agente_estado`. Así se cierra el punto 4 del log de F1-011: un `include` no puede salirse
  de la empresa, porque la base no deja que una hija diverja de su padre. `cheques` tiene
  `@@unique([id, empresaId])` como destino. Partidas y pagos **no** llevan `sucursal_id`.
- `DECISION PROVISIONAL (nocturno)` en `api/prisma/schema.prisma`, todas anotadas en
  `docs/esquema-sr.md` §2 y §3:
  - `folio` y `folio_sr` son texto;
  - `cerrado_at` admite nulo;
  - `comensales` es `Int?` sin default (lo pidió el revisor: un 0 inventado ensucia los
    promedios);
  - `cantidad` es `NUMERIC(12,3)`;
  - no hay CHECK de signo en los importes (podrían venir devoluciones negativas).
- `cheque_partidas.orden` es único por cheque: guarda la posición de la partida en el ticket,
  porque las UUID no ordenan. F1-031 lo llena con el índice de cada partida en el array.
- **Snapshots con histórico, NO una sola fila por sucursal.** El backlog de F1-031 dice
  "upsert del último por sucursal", pero F1-030 pide también "histórico 24 h para depurar".
  Por eso `mesa_snapshots` tiene varias filas por sucursal y un único
  `(sucursal_id, capturado_at)`: reenviar el mismo snapshot no lo duplica, y "el último" es
  el de mayor `capturado_at`. **F1-031: no lo conviertas en una sola fila** por leer el
  backlog al pie de la letra. El upsert va por `(sucursal_id, capturado_at)`, más la purga.
- `ChequePago.forma` es NOT NULL. F1-031 tiene que derivarlo de `forma_raw` al ingerir: si no
  hay catálogo todavía, que ponga `otro`, que es lo conservador, y deje el crudo.

**Trampas que encontré.**
- **El Postgres local responde en español.** Los mensajes de error salen traducidos
  ("desbordamiento de campo numeric", "viola la llave foránea «…»"), así que un
  `toContain('numeric field overflow')` pasa en CI y falla en local. Hay que comparar sólo el
  SQLSTATE y el nombre de la constraint, que no se traducen.
- `test/fixtures-auth.ts#limpiarFixtures` borra las sucursales de A/B/C. Con FK Restrict,
  cualquier test que cuelgue ventas de esas sucursales rompe la limpieza. Ahora borra antes
  partidas, pagos, cheques y snapshots de esas empresas. Si agregas otra tabla colgada de una
  sucursal, agrégala ahí también.
- `npx prettier --check` marca en `test/` y en `src/scope/empresa-scope.ts` archivos que no
  toqué. Es el CRLF de siempre; con `--end-of-line auto` pasan.

**Qué quedó abierto** (nada es tarea nueva):
- **La idempotencia NO está probada aquí.** Sólo existe la constraint. La prueba de reenviar
  el lote 3 veces, con el upsert reemplazando partidas y pagos en vez de acumularlos, es de
  **F1-031** y es obligatoria. Este `[x]` no quiere decir "idempotencia resuelta".
- **F1-031 necesita escrituras con scope** (create, upsert, deleteMany para reemplazar
  partidas y pagos), y `ScopedPrismaService` todavía no las tiene. Siguen vigentes dos cosas:
  - `scopeDeAgente()` acota a la EMPRESA, no a la sucursal. El filtro por sucursal en partidas
    y pagos tiene que pasar por el cheque.
  - Un `where` con puros `undefined` en `updateMany` actualizaría todo el scope (ver la
    entrada de F1-012).
- **F1-031, total del cheque:** se guarda tal como lo reporta SR y **nunca se recalcula
  sumando partidas**. `NUMERIC(12,2)` redondea en silencio (0.125 → 0.13, hay un test que lo
  fija), así que la suma de partidas redondeadas puede no dar el total.
- **La purga de snapshots de más de 24 h no existe**: es de F1-031. Hasta entonces la tabla
  crece sin límite.
- **F1-032, cortesías:** el modelo no tiene cómo distinguirlas (sólo `descuentos`), y
  tampoco hay cancelaciones de partidas sueltas. Las dos están como DECISIÓN ABIERTA para
  Ricardo en `docs/esquema-sr.md` §2. Ahí mismo está el riesgo más serio: si SR reinicia
  folios, el upsert pisa un cheque viejo en silencio.
- **F1-032, índice por sucursal:** para "ventas de hoy de una sucursal" sólo sirve
  `(empresa_id, cerrado_at)` más un filtro. Si hace falta, que F1-032 agregue
  `(sucursal_id, cerrado_at)` en su propia migración.
- **F1-060:** las FK compuestas llevan `ON UPDATE CASCADE` (lo que Prisma pone por defecto).
  Cambiar la empresa de una sucursal con historial movería sus ventas a otro cliente. El CRUD
  de sucursales debería prohibir ese cambio.

**Qué haría distinto.** Nada relevante. Escribir los tests de errores comparando SQLSTATE
desde el principio me habría ahorrado una vuelta.

## 2026-09-20 22:24 — F1-031 · Endpoint de ingesta idempotente
**Estado:** CERRADA (PR de `feat/F1-031`, squash a main)

**Qué quedó hecho.**
- `POST /ingesta/eventos` con `@AutenticacionAgente()` (X-Api-Key, 120/min por sucursal).
  Recibe `{ eventos: [...] }` con 1 a 100 eventos `{ id, tipo: cheque|snapshot|heartbeat,
  datos }` y responde **200** con `{ procesados: [ids], rechazados: [{ id, indice, motivo,
  reintentable }] }`. El contrato está en `api/openapi.json` (esquemas `Evento*Dto`,
  `RechazoDto`).
- `ScopedPrismaService.deSucursal(agente)` → `EscrituraSucursal.enTransaccion(fn)`
  (`api/src/scope/escritura-sucursal.ts`). Es la única forma de escribir de la ingesta y la
  única transacción del helper. Cada operación pone `sucursalId`/`empresaId` desde la key.
  Los filtros vacíos o `undefined` truenan, y los datos no pueden traer columnas de
  `COLUMNAS_INTOCABLES`, que se mudó a `scope.helper.ts`.
- Tests: `normalizar.spec.ts`, `escritura-sucursal.spec.ts`, `ingesta.service.spec.ts` e
  `ingesta.e2e.spec.ts`, todos contra Postgres real salvo el primero. En total, `npm test`
  da 232/232 con 0 skips. Lint, typecheck, `prisma validate` y build limpios. El revisor
  aprobó el plan y el entregable, los dos con observaciones, que están aquí abajo.

**Decisiones que tomé y por qué.**
- **El ValidationPipe global valida sólo el SOBRE**, y cada evento se valida a mano en el
  servicio (`plainToInstance` + `validate`, con `forbidNonWhitelisted`). Si el pipe validara
  los eventos anidados, uno malo tumbaría el lote entero con un 400. Un sobre malo (vacío,
  más de 100 eventos, no-arreglo, un campo de más) sí es 400.
- **Una transacción por evento, en orden.** Si un evento falla, sólo se revierte el suyo.
- **`reintentable`:** `false` para eventos inválidos y errores deterministas (desbordamiento,
  FK, un bug nuestro); `true` sólo para la lista cerrada de `esTransitorio()`
  (`ingesta.service.ts`: P1001/P1002/P1008/P1017/P2002/P2024/P2028/P2034, más los errores de
  inicialización y panic de Prisma). **F1-024 construye contra esto:** un rechazo con
  `false` no se reenvía en bucle.
- **Idempotencia literal:** en la misma tx se lee el cheque guardado y, si su forma canónica
  (`ingesta/canonico.ts`) es igual a la del entrante, **no se escribe nada**. Así no cambian
  ni los ids de partidas y pagos ni `updated_at`, y la ventana de relectura de 2 h de F1-022
  no genera escrituras. La forma canónica usa fechas en ms, importes a 2 decimales,
  cantidades a 3, llaves de jsonb ordenadas y pagos ordenados. Si hubo cambios, hace un
  `upsert` por la unique `(sucursal_id, folio_sr)` y luego borra y recrea partidas y pagos.
  **La lectura previa es sólo un atajo, la llave la pone la constraint.** Hay un test que
  confirma que Prisma emite el `INSERT ... ON CONFLICT` nativo, que no depende de la forma
  del where. Si alguien le agrega una escritura anidada al upsert, Prisma cae en select+insert
  y ese test truena.
- **El dinero viaja en texto** (regex `DINERO`: 10 enteros, hasta 4 decimales) y se redondea
  en código con `Prisma.Decimal` `ROUND_HALF_UP`, que es mitad lejos de cero, igual que
  NUMERIC. Lo que ya no cabe tras redondear se rechaza con `reintentable:false`, así el
  agente no lo reenvía para siempre. **El total del cheque nunca se recalcula.**
- **Fechas:** se exige zona (`Z` u offset); una sin zona se rechaza.
- `DECISION PROVISIONAL (nocturno)` en `api/src/ingesta/normalizar.ts#derivarFormaPago`:
  la forma de pago es siempre `otro` y el crudo va en `forma_raw`. F1-032 trae el catálogo.
- **Snapshots:** upsert por `(sucursal_id, capturado_at)` (un reenvío no mueve
  `recibido_at`). La purga, en la misma tx, borra los de esa sucursal con más de 24 h
  **salvo el último**, aunque sea viejo. Se sigue sin convertir en una sola fila, como
  decidió F1-030.
- **Heartbeat:** upsert de `AgenteEstado`. Si llega uno con `ultimaLecturaAt` anterior a la
  guardada, **se descarta completo**, incluidos `versionAgente` y `ultimoError`; es una
  decisión consciente y está en el OpenAPI. Uno con `ultimaLecturaAt: null` no borra la
  última lectura conocida. Si nada cambió, no se escribe.
- **Body JSON de hasta 5 MB** (`configurar-app.ts`, `LIMITE_BODY_JSON`). El default de
  Express, 100 KB, no alcanza para 100 cheques. Gzip se infla solo, y el tope se mide ya
  inflado: una bomba gzip da 413, y hay test.
- `configurarApp` ahora recibe `NestExpressApplication`, porque `useBodyParser` es de ahí.
  Por eso los e2e de auth y agentes crean la app con `createNestApplication<NestExpressApplication>()`.
- `escritura-sucursal.ts` **no** está en la allowlist de eslint: sólo importa tipos. Hay un
  test que prueba que la regla muerde ahí y en `src/ingesta`.

**Trampas que encontré.**
- **Supertest/superagent re-serializa un `Buffer` como JSON** si el Content-Type es JSON.
  Un body gzip llega como `{"type":"Buffer","data":[...]}` y body-parser responde 400
  ("incorrect header check"), aunque el server está bien. El e2e de gzip usa `node:http`
  crudo (`postCrudo`). `.serialize((b) => b)` también sirve, pero no tipa.
- Para requests en paralelo con supertest (el ECONNREFUSED de F1-012), el e2e hace
  `app.listen(0)` y usa `app.getUrl()`, en vez de `getHttpServer()`.
- `limpiarFixtures` no borraba `agente_estado`. Con FK Restrict, el primer heartbeat de un
  test rompía la limpieza de sucursales. Ya lo borra.
- `openapi.spec.ts` lista **todos** los paths a mano: cada endpoint nuevo lo rompe a
  propósito, y hay que agregarlo ahí.
- **Prettier reescribe los archivos en LF** y git avisa "LF will be replaced by CRLF". No
  es un problema (autocrlf).

**Qué quedó abierto** (nada es tarea nueva):
- **F1-024, orden entre lotes:** si dos lotes en vuelo traen versiones distintas del mismo
  cheque, gana el último commit, no la versión más reciente de SR, y el API no tiene cómo
  ordenarlos. **El agente debe mandar los lotes en serie, nunca dos a la vez por sucursal.**
  También debe partir el lote si recibe 413, y no reenviar los `reintentable:false`.
- **F1-025:** el heartbeat sólo acepta los 4 campos que hoy tiene `AgenteEstado`. Latencia
  de query y tamaño de cola necesitan migración y ampliar `DatosHeartbeatDto`. Ojo: con
  `forbidNonWhitelisted`, un agente que mande campos nuevos contra un api viejo recibe sus
  heartbeats rechazados; hay que desplegar primero el api.
- **Folios reiniciados (esquema-sr.md §2 y §13):** el upsert por `(sucursal_id, folio_sr)`
  pisa en silencio un cheque viejo si SR reinicia folios. **Es lo primero que hay que validar
  en F1-090.**
- **F1-092:** el tope de 5 MB aplica a todas las rutas, `/auth/login` incluida. Si se
  vuelve superficie de abuso, hay que acotarlo por ruta.
- **F1-032:** la forma de pago está en `otro` para todo; el desglose por forma necesita el
  catálogo sobre `forma_raw`. El índice `(sucursal_id, cerrado_at)` sigue pendiente, como
  anotó F1-030.
- La forma de cada mesa del snapshot no se valida: la fijan F1-023/F1-050.

**Qué haría distinto.** Probar el transporte (gzip, tamaño) con un cliente HTTP crudo desde
el principio. Me costó una vuelta descubrir que el 400 era del cliente de test y no del
server.

## 2026-09-20 22:57 — F1-032 · Servicio de agregados de ventas
**Estado:** CERRADA (PR de `feat/F1-032`, squash a main)

**Qué quedó hecho.**
- `AgregadosVentasService` (`api/src/ventas/`) con `resumen`, `porHora`, `formasPago`,
  `topProductos` y `comparativoSucursales`, todos con filtro `{ empresaId, sucursalId?, desde,
  hasta }` (días LOCALES de cada sucursal, inclusivos). **No hay endpoints:** son de F1-033, y
  el `VentasModule` sólo exporta el servicio. `openapi.json` no cambió.
- **SQL crudo con scope:** `ScopedPrismaService.ventas(scope, filtro)` → `ConsultaVentas`
  (`api/src/scope/consulta-ventas.ts`). El helper arma TODO el `WITH`: `sucursales_alcance`,
  `ventas`, `cancelados`, `partidas_ventas`, `pagos_ventas` y `catalogo_formas`, ya filtradas por el
  tenant del usuario, por la empresa y sucursal pedidas y por el rango
  (`AT TIME ZONE s.zona_horaria` por sucursal). El caller sólo escribe el cuerpo, y
  `guardiaCuerpo()` lo rechaza si nombra una tabla real (la lista sale de `Prisma.dmmf`, así que
  un modelo nuevo queda prohibido solo), comillas, esquemas, `;` o comentarios, o si pone después
  de FROM/JOIN algo que no sea una CTE. Cada consulta corre con `statement_timeout` de 5 s
  (`set_config(..., true)` en una transacción batch).
- Migración `agregados_ventas`: tabla `formas_pago_catalogo` e índice
  `cheques(sucursal_id, cerrado_at)`.
- Seed `api/prisma/seed-ventas.ts` (`npm run seed:ventas`, después de `npx prisma db seed`):
  500 cheques sintéticos, 250 por sucursal, en 30 días que terminan HOY. `generarVentas()` es puro
  y determinista, con ids UUID derivados de la sucursal. `sembrarVentas()` borra sólo lo `SEED-%`
  de esas sucursales y lo recrea: es idempotente, ids incluidos.
- Tests (contra Postgres): `consulta-ventas.spec.ts`, `seed-ventas.spec.ts` y
  `agregados-ventas.service.spec.ts`. `npm test` da 342/342, 0 skips. Lint, typecheck,
  `prisma validate`, migrate y build limpios. El revisor aprobó el plan y el entregable, los dos
  con observaciones, que están resueltas o anotadas aquí.

**Decisiones que tomé y por qué.**
- **La forma de pago se deriva AL LEER** con `LEFT JOIN catalogo_formas` (match exacto de
  `forma_raw`); lo no mapeado es `otro` y se lista aparte en `sinCatalogo`. La columna
  `cheque_pagos.forma` (siempre `otro` desde la ingesta) **no la usa ningún agregado**. Así,
  corregir el catálogo reclasifica el histórico sin reingerir. No toqué la ingesta: habría sido
  "de pasada".
- `DECISION PROVISIONAL (nocturno)`:
  - catálogo por EMPRESA y sin normalizar el texto (`api/prisma/schema.prisma`, modelo
    `FormaPagoCatalogo`);
  - `resumen.cortesias` siempre `null` (`agregados-ventas.service.ts`, interfaz `Resumen`).
  Las dos están en `docs/esquema-sr.md` §2 y §4.
- **Venta = Σ `cheques.total` tal cual, sin propina.** Los cancelados nunca cuentan; los que no
  traen `cerrado_at` se ubican por `abierto_at`, sólo para contarlos. El día y la hora son los del
  CIERRE en la zona de la sucursal. Todo esto es SUPUESTO en esquema-sr.md §2: **el cuadre peso a
  peso contra los reportes nativos de SR no está validado; depende de F1-090.**
- **El filtro se valida primero (400) y después se resuelven la empresa y la sucursal con
  `para(scope)` (404).** Así un id que no es UUID no llega a Postgres, donde saldría 500. Además
  las CTEs vuelven a filtrar por tenant: aunque faltara la verificación, se devuelve vacío, no
  datos ajenos (hay test).
- Ninguna división en SQL. Los promedios se hacen en código con `Decimal` ROUND_HALF_UP, y el
  dinero sale como string con 2 decimales y las cantidades con 3.
- El empate del top y el orden del comparativo usan `COLLATE ucs_basic` (orden por code point),
  no `"C"`: la guardia prohíbe las comillas.
- Top productos agrupa por NOMBRE (el contrato no trae id de producto) y su `importe` va antes
  del descuento del cheque: **no cuadra con la venta y no se debe comparar**.

**Trampas que encontré.**
- **`npx jest` sin `--runInBand` corre los archivos en paralelo** y los specs se pisan los
  fixtures (`crearFixtures`/`limpiarFixtures` de las mismas empresas). Salen 5 o 26 rojos que
  parecen bugs. Siempre `npm test` o `npx jest --runInBand ...`.
- El test de < 300 ms dio un rojo intermitente (553 ms) con una sola muestra justo después del
  seed: estadísticas viejas y ruido de Windows. Ahora corre `ANALYZE` en el `beforeAll` y compara
  la mediana de 5 corridas. **El umbral sigue en 300 ms.** Ojo: sólo se midió en esta máquina y
  con 500 cheques.
- Los tests `scope.helper.spec.ts` (`LLAVE_EMPRESA`) y `scoped-prisma.service.spec.ts` (lista de
  delegados) rompen **a propósito** con cada modelo nuevo: hay que agregarlo ahí.
- Los archivos `.ts` nuevos no están en git hasta el commit: `git checkout -- archivo` no los
  restaura. Si haces un mutation test, respalda antes.
- Tijuana sí tiene horario de verano (reglas de EE. UU.) y el resto de México no. Es la zona que
  sirve para probar que el corte se hace por sucursal.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **F1-060:** validar `zona_horaria` como zona IANA en el CRUD de sucursales. Hoy una zona
  inválida en la base hace fallar `AT TIME ZONE` en Postgres y el agregado sale 500. Y el CRUD del
  catálogo de formas de pago (`formas_pago_catalogo`) tampoco existe todavía.
- **F1-033, antes de fijar el OpenAPI:** sin cuentas, `ticketPromedio` es `"0.00"`, pero sin
  comensales `promedioPorComensal` es `null`. Es inconsistente: decide una convención. Además los
  DTOs tienen que validar `por` y `limite` del top (el servicio lanza `Error` plano, que saldría
  500), y hay que armar el cache de 15 s.
- La CTE `cancelados` filtra por `COALESCE(cerrado_at, abierto_at)` sin prefiltro sargable. Con
  volumen real conviene un prefiltro o un índice.
- La guardia protege contra descuidos, no contra alguien que quiera saltarla (está dicho en el
  comentario de `guardiaCuerpo`). El cuerpo lo escribe siempre nuestro código.
- El seed demo termina HOY, así que incluye cheques "de hoy" con hora futura. Correrlo otro día
  mueve las fechas.

**Qué haría distinto.** Correr desde el principio los specs de base de datos con `--runInBand`,
y medir rendimiento con varias muestras desde el primer día. Las dos cosas costaron una vuelta.

## 2026-09-20 23:26 — F1-033 · Endpoints de lectura para el frontend
**Estado:** CERRADA (PR de `feat/F1-033`, squash a main)

**Qué quedó hecho.**
- Endpoints nuevos, todos con Bearer y para cualquier rol:
  - `GET /ventas/resumen`, `/ventas/por-hora`, `/ventas/formas-pago` y `/ventas/top-productos`.
    Reciben `empresaId` (obligatorio), `sucursalId?`, `desde` y `hasta` (días locales), y el top
    además `por` y `limite`. Pasan por `CacheAgregados` (15 s).
  - `GET /ventas/tickets`: paginado (`pagina` ≤ 10000, `porPagina` ≤ 100, default 50), con
    `folio?` por prefijo y el detalle inline (partidas en orden del POS y pagos con la forma
    derivada del catálogo).
  - `GET /mesas/abiertas`: el último snapshot de cada sucursal, con su edad.
  - `GET /empresas` y `GET /sucursales?empresaId?`.
- `/docs` (Swagger UI y `/docs/openapi.json`) protegido con HTTP Basic (`DOCS_USUARIO` /
  `DOCS_PASSWORD`). Sin las dos variables **no se monta**. Con una sola, o con una contraseña de
  menos de 16 caracteres, la API no arranca.
- `api/openapi.json` regenerado. Hay e2e de scoping por rol en cada endpoint
  (`src/ventas/lectura.e2e.spec.ts`, 104 casos), y además unitarios del cache, e2e de `/docs` y
  el test de la CTE `tickets`. `npm test` da 464/464, 0 skips. Lint, typecheck,
  `prisma validate` y build limpios. Sin migración. El revisor aprobó el plan y el entregable,
  los dos con observaciones, que están aquí.

**Decisiones que tomé y por qué.**
- **Un promedio sin divisor es `null`.** F1-032 lo dejó abierto. `ticketPromedio` (resumen y
  comparativo) era `"0.00"` sin cuentas y ahora es `null`, igual que `promedioPorComensal`. Un
  "0.00" diría que el ticket promedio fue de cero pesos. El test de F1-032 se adaptó a la
  convención; no se aflojó.
- **`verificarAlcance()` (`api/src/scope/alcance.ts`)** es la verificación única que responde
  404 a una empresa fuera del scope o a una sucursal que no es de esa empresa. La usan los
  agregados, los tickets, las mesas y `/sucursales?empresaId`. Ni `admin_global` puede mezclar
  la empresa A con una sucursal de B. `AgregadosVentasService.consulta()` pasó a ser pública
  para que `TicketsService` la reuse.
- **Qué cuenta como ticket:** la CTE nueva `tickets` = `ventas` ∪ `cancelados`.
  - `cancelados` ahora expone `empresa_id`, `folio` y `momento = COALESCE(cerrado_at, abierto_at)`,
    y ganó un prefiltro grueso sargable partido en dos ramas.
  - Los cancelados se listan con su flag y **no suman**. F1-042 no debe sumarlos en el pie ni en
    el CSV.
  - Está en esquema-sr.md §2.
- **La búsqueda por folio** usa `starts_with(folio, $1)`, con el valor como parámetro: literal, sin
  comodines que escapar. Busca **dentro del rango de fechas**, no en todo el histórico.
- **Cache:** la llave lleva el scope del token (`global` o `empresa:<id>`) más el endpoint y
  todos los parámetros. Se consulta en el controller, después del ValidationPipe, y sólo guarda
  lo exitoso. Los valores se congelan. El tope es de 1000 entradas. Tickets y mesas no se
  cachean.
- **`Reloj` (`api/src/comun/reloj.ts`, módulo global)** es inyectable. Los e2e lo reemplazan con
  `overrideProvider(Reloj)`, que es el mismo provider que usan el cache y las mesas.
- **Mesas:** `edadSegundos` sale de `capturadoAt`, que usa el reloj del agente, y se recorta a
  ≥ 0. `edadRecepcionSegundos` sale de `recibidoAt`, que usa el reloj del servidor, y **es la que
  F1-050 debería usar para "desconectada"**. `mesas` va tal cual; su forma sigue siendo
  SUPUESTO (§5).
- **Basic en `/docs` y no JWT:** el navegador no manda Bearer al abrir la UI, y los guards de
  Nest no corren en las rutas de Swagger. El JSON vive en `/docs/openapi.json`, dentro del
  prefijo protegido, y no existen `/docs-json` ni `/docs-yaml`.
- `/sucursales?empresaId=` de otra empresa da 404, no `[]`, para ser consistente con el resto.

**Trampas que encontré.**
- **NO corras `npx prettier --write src`.** Reescribe en LF todos los archivos del árbol y git
  marca 50 archivos como modificados. Su diff de contenido está vacío: es la caché de stat, y
  `git update-index --really-refresh` lo limpia. Formatea sólo los archivos que tocaste.
- **En los e2e, `get(ruta)` es una función `async`:** devuelve una Promise, no el Test de
  supertest, así que `.expect(401)` no existe. Usa `expect((await get(...)).status)`.
- `openapi.spec.ts` lista los paths a mano y rompe con cada endpoint nuevo, a propósito.
- Un heredoc largo con backticks y `${}` rompió el Bash tool (`unexpected EOF`). Para archivos
  TS grandes usa Write.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **F1-043 va a llegar sin API.** Necesita un endpoint de comparativo entre sucursales (el
  servicio ya existe: `comparativoSucursales`) y otro de **ventas por día** (no existe). No
  estaban en la lista de F1-033. F1-043 es sólo `/web`: quien la tome tiene que decidir si los
  agrega en esa tarea o si se abre una `F1-033b`. Lo anoto, no lo creo.
- **Tickets no es una foto consistente:** el conteo, la página y el detalle son lecturas
  separadas. Si la ingesta reescribe un cheque entre ellas, `total` puede no coincidir con la
  unión de las páginas, y si un cheque desaparece entre la página y el detalle, sale 500 (a
  propósito, en vez de un hueco silencioso). F1-042 no debe tratar el total como exacto al peso.
- **Rendimiento:** medí tickets con 10k cheques en A: 65–110 ms por request (página 1, 100, 199 y
  búsqueda por folio, en esta máquina). No se midió con más volumen ni en el VPS.
- El detalle de tickets (`findMany`) y las lecturas de mesas corren con Prisma, **sin
  `statement_timeout`**. Es nuestra base, no la de SR, pero conviene revisarlo en F1-092.
- La llave del cache no normaliza mayúsculas de los UUID: dos entradas para el mismo filtro. No
  filtra datos entre tenants; sólo ocupa espacio.
- `/mesas/abiertas` hace una consulta por sucursal (N+1). Con pocas sucursales está bien.
- En `lectura.e2e.spec.ts`, "tickets no se cachea" reusa el cheque que crea el test de cache.
  Depende del orden y es frágil si alguien filtra tests.
- Sigue pendiente de F1-060 validar `zona_horaria` como IANA (una inválida hace 500 en
  agregados y tickets).

**Qué haría distinto.** Hacer la prueba de mutación (quitar un filtro de scope y ver que los
tests truenan) desde el primer verde, no al final. 104 verdes al primer intento no prueban que
los tests muerdan.

## 2026-09-20 23:59 — F1-040 · Base de la SPA
**Estado:** CERRADA (PR de `feat/F1-040`, squash a main)

**Qué quedó hecho.**
- `/web` ya es la SPA de verdad: React Router 7 (modo librería), TanStack Query 5 y Tailwind 4
  (`@tailwindcss/vite`).
  - Rutas: `/`, `/mesas`, `/tickets`, `/reportes`, `/admin` (sólo `admin_global`/`admin_empresa`),
    `/login` y `*`. Las vistas son cascarones con título y alcance activo; su contenido es de
    F1-041/042/043/050/060.
  - Layout con sidebar (fijo en ≥ md, off-canvas en móvil con hamburguesa, overlay, Escape y
    cierre al navegar) y topbar con los selectores de empresa y sucursal, el usuario y "Salir".
- **Alcance en la URL** (`?empresa=&sucursal=`), todo en `web/src/filtros/alcance.ts`:
  - Los enlaces del sidebar conservan sólo esos dos parámetros.
  - Sin empresa, o con una que no está en tu lista → la primera de la lista (con `replace`). Una
    sucursal de otra empresa se quita. Cambiar de empresa borra la sucursal.
  - **Sólo se normaliza con la lista cargada con éxito.** Si `/empresas` falla, la URL no se toca.
  - Las inactivas se muestran con "(inactiva)". Si hay una sola empresa, sale como texto.
- **Auth**:
  - `web/src/auth/sesion.ts`: access token SÓLO en memoria. Refresh single-flight compartido por
    los tres caminos (401, timer proactivo a `expiresIn - 60 s` y arranque) y contador de
    generación para que un refresh tardío no reviva una sesión cerrada.
  - `web/src/api/cliente.ts` (`pedir`): Bearer, refresh + un reintento ante 401.
  - `RutaProtegida` manda a `/login?siguiente=<ruta+query codificada>`, y `destinoSeguro` evita
    el open redirect.
- `VITE_COLOR_ACENTO` (hex validado) → `--color-acento` → clases `*-acento`.
- Tests: `npm test` en `/web` da 69/69, 0 skips (vitest + jsdom). La API se simula sobre `fetch`
  con `src/test/apiFalsa.ts`, que registra cada llamada. Build, lint y prettier limpios.
- **CI: encendí el paso `npm test` del carril `web`.** El backlog se lo asigna a F1-041 ("Y
  además"), así que **F1-041 ya no tiene que hacerlo**: no lo busques comentado. El README y la
  cabecera del `ci.yml` están al día.
- El revisor aprobó el plan en el 2º intento (el 1º lo bloqueó por B1, abajo) y el entregable al
  1º, con observaciones. Atendí dos: el proxy exige `/api/` con barra, y hay un comentario en
  `test-setup.ts`. La tercera está en "Qué quedó abierto".

**Decisiones que tomé y por qué.**
- **Mismo origen vía proxy, no CORS** (F1-011 lo dejó abierto).
  - La SPA llama siempre a `/api/...`. `web/vite.config.ts` lo proxya a `API_PROXY_TARGET`
    (default `http://localhost:3000`, sin `VITE_`: no entra al bundle), quita `/api` y reescribe
    el `Path` de la cookie de `/auth` a `/api/auth`. Lo verifiqué con curl contra la API real: el
    login da `Set-Cookie ... Path=/api/auth; HttpOnly; SameSite=Strict` y el refresh con esa cookie
    da 200.
  - **F1-002 (Caddy) TIENE que replicarlo:** `handle_path /api/*` hacia la API y reescribir
    `Path=/auth` → `Path=/api/auth` en el `Set-Cookie`. Sin eso el login funciona pero el refresh
    silencioso no, y cada recarga pide contraseña. Está en el README.
- **B1, el bloqueo del revisor en el plan: las rutas `/auth/*` NUNCA disparan refresh ante un 401.**
  Tras "Salir", la cookie del usuario anterior sigue viva. Si el 401 de un login con contraseña
  mala hiciera refresh, esa persona entraría COMO EL USUARIO ANTERIOR, y además gastaría dos
  intentos del límite de 5/min. Hay un unitario y una integración que lo cubren, y la mutación lo
  confirma. **No quites esa exclusión.**
- **Logout sólo en el cliente**, porque la API no tiene `POST /auth/logout` y agregarlo era cruzar
  de carril. "Salir" borra el token, cancela el timer, limpia el caché de Query y pone
  `monitor.sesionCerrada=1` en localStorage (`web/src/auth/marcaCierre.ts`). Con esa marca el
  arranque no hace refresh silencioso, y si el storage no se puede leer, tampoco.
- En la pantalla de rol, a quien no le toca la vista le sale "No encontrada", nunca "prohibido":
  es la misma regla del 404 de la API.
- `react-router` **7**, no el 8 (que es la latest): elegí la línea 7, que declara soporte para
  React 18. `@tailwindcss/vite` 4.3.3 declara peer `vite ^5.2 || … || ^8` y se instaló sin
  `--force`.
- Los tipos del contrato están escritos a mano en `web/src/api/tipos.ts`, campo por campo contra
  `api/openapi.json`. Si el OpenAPI cambia, cámbialos en el mismo entregable.

**Trampas que encontré.**
- **Escribir archivos desde Bash rompió cosas tres veces:**
  1. Un heredoc largo con `<<EOF` anidado dentro de un `for` cortó `main.tsx` a la mitad, y
     además se tragó el `index.css` y el resto del comando, sin error claro.
  2. `sed` de GNU interpreta `\x00` en el reemplazo y metió bytes de control reales en una regex.
  3. Los `node -e` con backticks y `\` dentro de comillas dobles no hacen match, y encima
     `ci.yml` y `README.md` tienen CRLF.
  **Usa Write/Edit para todo lo que tenga backticks, barras o regex.**
- **El `<output>` de HTML tiene rol implícito `status`.** Un helper de test que lo usaba se robaba
  el `findByRole('status')`.
- **Contraseñas en el navegador: no se puede.** Para medir a 390 px las vistas autenticadas monté
  un arnés temporal (`web/arnes-390.html`) que reemplaza `fetch` con datos sintéticos. Lo borré y
  no está en el commit.
- **La ventana de Chrome no baja de 819 px de viewport** (escalado de pantalla). Medí dentro de un
  iframe de 390 px del mismo origen.
- `api/.env` sigue sin los secretos JWT (ya lo dijo F1-011). Para levantar la API local se los
  pasé por variable de entorno, con valores sintéticos, sin tocar el archivo. La contraseña del
  admin del seed es la de desarrollo de `api/prisma/seed.ts`.

**Evidencia de 390 px (el criterio de "Listo cuando").**
- Login con la API real, y las vistas `/`, `/mesas`, `/tickets`, `/reportes` y `/admin` con el
  arnés. Usé nombres largos de empresa, sucursal y usuario a propósito.
- En todas, `scrollWidth == clientWidth == 390` y ningún elemento pasa del borde derecho.
- El menú móvil abre y cierra. Lo confirmé con captura: con el menú abierto el sidebar tapa el
  contenido y el overlay oscurece el resto.
- Las medidas de posición del sidebar durante la transición no fueron fiables (el renderer del
  iframe se congela). Valen las capturas, no esos números.

**Prueba de mutación** (hecha, código restaurado, suite otra vez 69/69):
- Sin la exclusión de `/auth/` → fallan 3.
- `destinoSeguro` aceptando `//` → fallan 3.
- Normalizar la URL aunque `/empresas` falle → fallan 3.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **RIESGO DE SEGURIDAD, para F1-092:** "Salir" no revoca nada. La cookie de refresh sigue válida
  hasta 7 días. En una PC compartida, quien borre el localStorage, o llame
  `fetch('/api/auth/refresh', {method:'POST'})` desde la consola, entra como el usuario anterior.
  Hace falta `POST /auth/logout`, que borre la cookie y, mejor, que revoque (tabla de sesiones o
  versión de token).
- Si el reintento después de un refresh exitoso vuelve a dar 401, `pedir()` lanza el error pero no
  termina la sesión, y cada request siguiente hace otro refresh. No es bucle, y el caso es raro
  (una API que emite tokens que ella misma rechaza). Para F1-092.
- **F1-041** usa `useAlcance()` (`empresaId`/`sucursalId` ya validados) y
  `pedir('/ventas/resumen', { query })`. Recuerda que los agregados reciben `empresaId`
  obligatorio y que el `staleTime` de 15 s ya está puesto por defecto en `crearQueryClient`.
- Ninguna vista usa todavía la zona horaria de la sucursal; el selector de periodo es de F1-041.

**Qué haría distinto.** Escribir todos los archivos con Write desde el principio. Las tres roturas
por escapado en Bash costaron más que todo el layout.

## 2026-09-21 00:25 — F1-041 · Dashboard "Panel de ventas"
**Estado:** CERRADA (PR de `feat/F1-041`, squash a main)

**Qué quedó hecho.**
- La vista Inicio (`/`) ya es el dashboard. Está en `web/src/paginas/Inicio.tsx` y `web/src/paginas/inicio/`:
  - Selector de periodo: Hoy / Esta semana / Este mes / Mes anterior / Rango.
  - Tarjeta **Venta total**, con una línea por hora hecha con Recharts. El tooltip muestra el importe exacto.
  - **Dona de formas de pago**, con monto y %.
  - Tarjetas **Venta en vivo**, **Ticket promedio + comensales** y **Descuentos y cortesías**.
  - "Actualizado hh:mm" y botón Refrescar.
  - Cada tarjeta tiene su skeleton, su estado vacío y su error. Si una tarjeta falla, las demás siguen.
- **El periodo vive en la URL**, igual que el alcance: `?periodo=semana|mes|mes-anterior|rango&desde=&hasta=`. Sin `periodo` vale "hoy". La lógica está en `web/src/filtros/periodo.ts`. Cambiar la sucursal o el periodo cambia la queryKey y vuelve a consultar sin recargar.
- **Dinero exacto en el front:** `web/src/dinero/dinero.ts` convierte el texto de la API a centavos en `bigint`, y de ahí salen la suma, el formato `$1,234.50` y el %.
  - `number` sólo se usa para la posición de los puntos en Recharts (`paraGrafica`).
  - **F1-042 y F1-043 deben usar este módulo** para sumar pies de tabla y CSV.
- Recharts 3.10 (peer React 18 ok) se carga **en diferido** (`lazy` en `Tarjetas.tsx`): el chunk principal quedó en 244 kB y Recharts va aparte (372 kB). Sin eso, el build avisaba de un chunk de más de 500 kB.
- Los tipos nuevos del contrato (`Resumen`, `VentaHora`, `FormasPago`, `MesasSucursal`…) están en `web/src/api/tipos.ts`, escritos campo por campo contra `api/openapi.json`. **No se tocó la API ni el OpenAPI.**
- Tests: `npm test` en /web da **123/123, 0 skips**. Son 54 nuevos: dinero, periodo, venta en vivo y la integración `Inicio.test.tsx` con rutas reales y `apiFalsa`. Build y lint limpios, y prettier limpio en los archivos que toqué.
- **CI:** el `npm test` del carril web ya lo había encendido F1-040. Lo comprobé y no toqué `ci.yml`.

**Verificación contra el seed (Listo cuando), hecha.**
- Levanté la API local sobre el Postgres local, con los secretos JWT sintéticos por variable de entorno, y corrí `seed:ventas` (500 cheques, 30 días hasta el 2026-09-21).
- Guardé con curl, a través del proxy de Vite, las respuestas de los 4 endpoints para el mes en curso (2026-09-01..21). Con esas respuestas alimenté el dashboard en un test temporal que ya borré.
- Lo que pintó coincide peso a peso con la API:
  - venta $258,199.88, 334 cuentas y 14 canceladas;
  - ticket $773.05;
  - 1390 comensales, $172.26 por comensal;
  - descuentos $4,069.57 en 33 cuentas;
  - formas: efectivo $128,614.43 (47.4 %), tarjeta $115,728.77 (42.6 %), transferencia $16,641.78 (6.1 %), otro $10,384.80 (3.8 %), con "VALES DESPENSA" sin catálogo.
- La serie por hora suma exactamente la venta total.
- **No la hice en el navegador:** para entrar habría que teclear la contraseña, y eso está prohibido (lo mismo le pasó a F1-040).
- **Tampoco medí 390 px en navegador** esta vez. El layout es de una columna en móvil, con `flex-wrap` y `min-w-0`, pero la medida real queda pendiente para F1-092 o para quien tenga una sesión abierta.

**Decisiones que tomé y por qué.**
- **"Hoy" se calcula en la zona de la sucursal** (`hoyEn` con `Intl`, nunca la del navegador ni UTC). Con "Todas":
  - si todas comparten zona, se usa ésa;
  - si no, **America/Mexico_City**. Es `DECISION PROVISIONAL (nocturno)` en `web/src/filtros/periodo.ts` (`zonaDelPanel`).
  - La API corta cada sucursal en su zona; el front sólo elige la fecha. Entre la medianoche de CDMX y la de Tijuana, "Hoy" ya es el día nuevo y Tijuana sale en cero.
  - **Decisión abierta para Ricardo:** confirmarla o cambiarla.
- Las consultas esperan a que `/sucursales` responda (éxito o error), porque de esa lista sale la zona. Sin eso se pedía un día y enseguida otro.
- **La semana empieza el lunes.** Mes anterior = el mes completo. El rango se valida igual que la API: días inclusivos, máximo 366. Un rango inválido no consulta y dice qué corregir.
- **Venta en vivo** es `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/inicio/ventaEnVivo.ts`:
  - Suma `mesa.total` de cada mesa del snapshot. Si una sola mesa no lo trae legible, muestra "Sin dato", no una suma parcial.
  - Muestra la edad del dato más viejo con `edadRecepcionSegundos` (reloj del servidor) y nombra las sucursales que nunca reportaron.
  - No decide "desconectada": eso es de F1-050.
  - Supuesto anotado en esquema-sr.md §5.
- **Auto-refresco:** los 3 agregados se refrescan cada 60 s sólo si el periodo incluye hoy (lo que pide el backlog). Venta en vivo se refresca cada 60 s **siempre**, porque no depende del periodo (observación del revisor).
- **"Actualizado hh:mm" = el dato más viejo en pantalla**, no el más nuevo: si una tarjeta no se pudo refrescar, la hora no promete lo contrario. Se muestra en la zona del panel.
- **El % de formas de pago es sobre lo pagado** (Σ formas), no sobre la venta: los pagos incluyen la propina. Con total 0 no hay %.
- `null` de la API (ticket promedio, promedio por comensal) se muestra como "—", nunca como $0.00. Cortesías siempre dice "Sin dato", porque la API siempre manda null.
- Cambiar de alcance o periodo muestra skeletons y **no** usa `placeholderData`: así nunca se ven números del alcance anterior bajo el nuevo.

**Trampas que encontré.**
- **`App.test.tsx` › "un ?siguiente= externo no saca de la SPA" era una carrera:**
  - Comprobaba la URL normalizada justo después de ver el heading, pero la normalización llega cuando responde `/empresas`.
  - Corrido solo fallaba **también con el Inicio viejo de main** (lo probé). Con la vista nueva empezó a fallar en la suite completa.
  - Lo arreglé esperando la normalización con `waitFor`. La aserción es la misma: se espera, no se afloja.
- **La primera prueba de mutación sobrevivió.** Cambié `sumar` por float con redondeo a centavos y los tests seguían verdes, porque 0.1 + 0.2 redondeado sí da 0.30. Agregué un test con importes más allá de 2^53 centavos que sí lo detecta.
- **jsdom no trae `ResizeObserver`** y `ResponsiveContainer` lo pide. Hay un stub en `test-setup.ts`. En jsdom la gráfica mide 0 y no dibuja; los tests revisan texto, y el tooltip se prueba aparte (`TooltipHora`).
- **Leer `api/.env` desde Bash está denegado** por permisos. Para levantar la API usé secretos sintéticos por variable de entorno. La contraseña del admin del seed es el default de desarrollo de `seed.ts`.
- **El `vite` en background bloquea borrar carpetas bajo `src/`** ("Device or resource busy"). Hay que matarlo primero.
- **`python` con reemplazos de texto en tests me rompió un archivo una vez.** Usa Write/Edit (lo mismo que dijo F1-040).

**Prueba de mutación** (hecha; el código quedó restaurado y la suite otra vez en 123/123):
- "hoy" en UTC → fallan 6.
- Suma en float → falla 1, después del test nuevo.
- Sin `sucursalId` en la queryKey → falla "cambiar de sucursal".
- Auto-refresco siempre encendido → falla "no incluye hoy".

**Qué quedó abierto** (nada es tarea nueva de la cola):
- La decisión de zona con "Todas" (arriba), para Ricardo.
- La forma de `mesa.total` y si incluye descuentos e impuestos: la fijan F1-023 y F1-050 (esquema-sr.md §5). Si al final el campo se llama distinto, el único cambio es `totalDe()` en `ventaEnVivo.ts`.
- La medida de 390 px en navegador real, pendiente.
- La gráfica de varios días suma todas las horas del rango (la etiqueta lo dice). Una serie por día es de F1-043, que según el log de F1-033 necesita un endpoint nuevo.
- `react-is` quedó en 17.0.2 (deduplicado con `pretty-format` de Testing Library). Recharts lo acepta como peer, pero si algún día se sube React a 19, hay que revisarlo.

- **Observaciones del revisor en el entregable (aprobado; no toqué el código para que entre lo revisado):**
  1. `aCentavos(x) ?? 0n` en `TarjetaFormasPago` (`Tarjetas.tsx`) y en `datosPorHora` (`puntosHora.ts`) convierte un importe inválido en $0.00 sin aviso, y en formas distorsiona el %. La API ya valida el formato, así que el riesgo es bajo, pero **F1-042/F1-043, al reusar `dinero.ts`, deberían mostrar error o "Sin dato"** en ese caso, y de paso corregir estos dos.
  2. Los % redondeados pueden no sumar 100.0 %. Es cosmético, no un error de importes.
  3. Que cuadre peso a peso contra los reportes nativos de SR no se puede probar sin una instalación real: queda para la validación en campo.

**Qué haría distinto.** Empezar las pruebas de mutación por el dinero. Un test de "0.1 + 0.2" parece que protege contra el float, y no protege contra el float con redondeo.

## 2026-09-21 00:45 — F1-042 · Vista Tickets
**Estado:** CERRADA (PR de `feat/F1-042`, squash a main)

**Qué quedó hecho.**
- `/tickets` ya es la vista de verdad: `web/src/paginas/Tickets.tsx` y `web/src/paginas/tickets/`.
  - Tabla paginada **en el servidor de 50 en 50** con `GET /ventas/tickets`. Columnas: folio, fecha/hora, sucursal (sólo con "Todas"), mesa, mesero, comensales, total y forma de pago.
  - Cada fila se expande con sus partidas (cantidad, producto, precio unitario y total), los modificadores (**también los de $0.00**), los pagos y el desglose subtotal/impuestos/descuentos/propina/total.
  - Filtros: el periodo es el mismo `SelectorPeriodo` de F1-041, la sucursal es la del topbar, y hay búsqueda por prefijo de folio (Enter o "Buscar", más "Limpiar").
  - **Export CSV** del filtro actual, generado en el navegador, con progreso ("Exportando x de N") y botón Cancelar.
- **Todo el filtro vive en la URL:** `?periodo&desde&hasta&folio&pagina`. Cambiar el periodo, el folio o la sucursal vuelve a la página 1. Un deep-link a `?pagina=3` abre la página 3.
- **Paginación fluida:**
  - Al cambiar de página se queda visible la anterior, atenuada, y la siguiente se pide de antemano.
  - Eso se hace SÓLO entre páginas del mismo filtro. Con otro periodo, sucursal o folio salen skeletons, nunca los tickets viejos (la misma regla de F1-041, con test).
- **CSV:**
  - BOM UTF-8, CRLF, comillas RFC 4180 y una fila por ticket, **sin fila de totales**. Los cancelados van con la columna `Cancelado = Sí` y no se suman en ningún lado.
  - Importes como `1234.50` (sin `$` ni miles) y fecha en ISO `YYYY-MM-DD` más hora `hh:mm`, **en la zona de la sucursal de cada ticket**.
  - Protección contra inyección de fórmulas (`= + - @ tab CR` → `'`) sólo en los textos de SR, no en los importes.
- `useHoy` pasó de `Inicio.tsx` a `web/src/filtros/useHoy.ts` sin cambios, para compartirlo. Los tests de Inicio siguen verdes sin tocarlos.
- Tipos nuevos (`Ticket`, `PartidaTicket`, `PagoTicket`, `Modificador`, `PaginaTickets`) en `web/src/api/tipos.ts`, escritos campo por campo contra `api/openapi.json`. **No se tocó la API, ni el OpenAPI, ni el CI.**
- Tests: `npm test` en /web da **170/170, 0 skips** (47 nuevos). Build, lint y prettier limpios en lo tocado.

**Verificación de "Listo cuando", hecha.**
- **10k cheques:**
  - Un script TEMPORAL (no se commitea) metió 10,000 cheques sintéticos (`folio_sr` con prefijo `CARGA-`) en la sucursal Centro del Postgres LOCAL. Más los 500 del seed, suman 10,500. Nunca se tocó SR.
  - Con la API real y Vite, **pasando por el proxy y con el código real de la SPA** (`pedir`, `exportarTickets`, `ticketsACsv`, desde un test temporal en entorno node), las páginas 1, 2, 3, 50, 100, 150, 200 y 210 de 50 tardaron **102–113 ms cada una**. La búsqueda por folio tardó 53 ms.
  - **El export de las 10,500 tardó ~14 s** (105 requests de 100) y dio 10,501 líneas.
  - Al terminar borré los `CARGA-`: la base quedó con el seed de siempre.
- **Excel (hay Excel instalado en esta máquina), abierto por COM:**
  - El CSV de 10k abre con 10,501 filas y 14 columnas.
  - Un CSV con casos difíciles también abre bien:
    - Ñ, é, ü e í llegan como Unicode correcto (el BOM funciona).
    - La fecha es fecha, la hora es hora y los importes son número (`-12.5`, `1234567.89`).
    - El mesero con coma, comillas y salto de línea queda en UNA celda.
    - `=1+1`, `+5` y `@SUM(A1)` quedan como texto con `'`.
- **No lo probé en el navegador:** para entrar habría que teclear la contraseña, y eso está prohibido (lo mismo que en F1-040 y F1-041). Tampoco medí 390 px en un navegador real.
  - Lo que sí está: la tabla va en un contenedor `overflow-x-auto` y en móvil se esconden mesero, comensales, forma de pago y sucursal (siguen en el detalle).
  - La medida queda pendiente, como la de F1-041.
- No se puede comparar contra los reportes nativos de SR sin una instalación real: queda para la validación en campo (F1-090/091).

**Decisiones que tomé y por qué.**
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/tickets/exportar.ts`: **si los tickets cambian durante el export, no se entrega archivo.**
  - Qué cuenta como cambio: que el `total` varíe entre páginas, o que los ids únicos no cuadren con él.
  - Por qué: el conteo y las páginas de la API no son una foto (log de F1-033), y un CSV al que le falta o le sobra un cheque sin avisar es peor que pedir que se repita.
  - La API ordena por `momento DESC, id DESC`, así que la paginación es estable. La deduplicación por id es sólo defensa.
- `DECISION PROVISIONAL (nocturno)`, también en `exportar.ts`: **tope de 50,000 tickets por export.** Todo se junta en memoria antes de armar el archivo. Por encima del tope se pide acotar el rango o elegir sucursal, y no se baja nada más.
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/tickets/formato.ts` (`formasDePago`): **la forma de pago se muestra con el texto crudo de SR** (`formaRaw`, sin repetir, unidos con " + "), no con el ENUM del catálogo.
  - Es lo que el gerente ve en el POS, y un texto sin catálogo saldría como "otro", que no dice nada.
  - **Para Ricardo:** si prefiere el ENUM, sólo cambia esa función.
- **Sucursal que no está en `/sucursales`:** en la tabla, la fecha/hora y el nombre dicen "Sin dato", y **el CSV se niega a generarse**. Nunca se cae a la zona del navegador ni a UTC. Hay test.
- **Página y alcance:** el selector del topbar (F1-040) no sabe de páginas, y no lo toqué.
  - `useAlcanceEstable` (en `Tickets.tsx`) detecta el cambio de empresa o sucursal **durante el render** (patrón de "ajustar estado cuando cambia una prop") y, mientras la URL no se corrige a la página 1, **no consulta**.
  - Así nunca sale un request con la página 3 del alcance anterior, ni un "esta página no existe" fugaz. Hay test que lo prueba.
  - Va en render porque el lint de React 19 (`react-hooks/set-state-in-effect`) no deja hacerlo con un `setState` dentro de un efecto.
  - Efecto secundario conocido: "atrás" desde B/página 1 hacia A/página 3 cae en A/página 1.
- Sin auto-refresco en Tickets: la lista se movería bajo el dedo. Queda el refetch al volver a la pestaña (default de F1-040).
- Cancelados: fila atenuada, etiqueta "Cancelado" y total tachado. No hay pie de tabla con sumas: el backlog no lo pide y así no hay dónde sumar un cancelado por error.
- Un importe inválido se muestra como "Importe inválido" en la tabla, nunca $0.00, y en el CSV detiene el export.

**Trampas que encontré.**
- **`@prisma/client` está en el `node_modules` de la RAÍZ** (workspaces), no en `api/node_modules`. Un script suelto tiene que hacer `require` de la raíz.
- **`vi.stubGlobal('URL', ...)` rompe el constructor `URL`** y tumba el router. Para capturar la descarga, reemplaza sólo `URL.createObjectURL` y `URL.revokeObjectURL`, y restáuralos en `afterEach` (así está en `Tickets.test.tsx`).
- **`toEqual` entre dos `Uint8Array` falla en jsdom** aunque tengan los mismos bytes (son de realms distintos). Compara `[...bytes]`.
- **El prefetch de la página siguiente sale DESPUÉS de la página actual**, así que "el último request" de la API falsa suele ser la página 2. Los tests que revisan qué se pidió filtran por parámetros, no toman el último.
- **La primera mutación del `placeholderData` sobrevivió:** ningún test miraba la ventana en que la respuesta nueva todavía no llega. Agregué uno con una respuesta retenida por una promesa.
- `vitest` se traga los `console.log` de un test que pasa. Para medir, escribe a un archivo.
- **Un heredoc largo con backticks volvió a romper el Bash tool** (ya lo dijeron F1-033 y F1-040). Este log se escribió con Write.
- `npx prettier --check src` reporta 45 archivos (CRLF, la trampa que ya contó F1-033). Formatea sólo lo que tocaste.

**Prueba de mutación** (hecha; el código quedó restaurado y la suite otra vez en 170/170):
- Sin BOM → fallan 4.
- Sin anti-inyección → falla 1.
- Hora en UTC → fallan 8.
- `placeholderData` sin comparar la llave → falla 1, después del test nuevo.
- Sin la guardia de alcance → falla 1.
- Sin revisar el `total` entre páginas → falla 1.
- Cancelado sin tachar → falla 1.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Exportar "Hoy" en hora pico va a fallar seguido:** 10k tickets tardan ~14 s, y un cheque nuevo en ese lapso aborta el export (a propósito). Para F1-092: fijar un corte (`hastaInstante` exacto en la API, o exportar desde el servidor en streaming).
- **Excel y los folios numéricos:** `000123` se abre como `123`, y un folio muy largo saldría en notación científica. La protección con `'` sólo cubre los que empiezan con `- + = @`. Si SR usa folios con ceros a la izquierda, habría que escribirlos como texto. Para F1-092 o F1-090.
- **Del revisor de F1-041, sigue sin tocar** (era "de pasada" aquí): `aCentavos(x) ?? 0n` en `inicio/Tarjetas.tsx` (`TarjetaFormasPago`) y en `inicio/puntosHora.ts` convierte un importe inválido en $0.00 sin aviso. Para F1-092.
- La decisión de la forma de pago (texto crudo o ENUM), para Ricardo.
- **Cancelados en la lista, decisión de producto para Ricardo:** el backlog dice "tabla de cheques cerrados", pero la vista también lista los cancelados de `/ventas/tickets` (así los devuelve el contrato de F1-033), marcados y sin sumar. Si no los quiere ver, hace falta un filtro en la API (`incluirCancelados`) o en la vista. Anotado para F1-092.
- **La anti-inyección del CSV sólo mira el primer carácter:** no cubre un texto que empieza con espacios y luego `=`, ni `|`. El riesgo es bajo, porque el texto viene del POS y no de terceros. Para F1-092, junto con lo de los folios.
- La medida de 390 px en un navegador real, pendiente.
- **Sin hallazgos nuevos sobre SoftRestaurant:** esta tarea sólo consume nuestra API. `docs/esquema-sr.md` no cambió.

**Qué haría distinto.** Escribir el test de "el filtro viejo nunca se ve" antes que el `placeholderData`. Es la clase de regla que un test normal (esperar a que aparezca lo nuevo) no puede detectar.

## 2026-09-21 01:07 — F1-043 · Reportes básicos
**Estado:** CERRADA (PR de `feat/F1-043`, squash a main)

**Qué quedó hecho.**
- **Cruza carriles (/api + /web), a propósito.** F1-043 figura como /web, pero la API no tenía
  "ventas por día" ni endpoint para el comparativo (el log de F1-033 lo dejó abierto). Los agregué
  aquí porque son la API mínima sin la que la tarea no se puede construir. No abrí una F1-033b.
  El revisor lo aceptó en el plan. Corrí los checks de los dos carriles.
- **API:**
  - `GET /ventas/por-dia` da una fila por cada día `desde..hasta` (inclusivo, con ceros).
  - `GET /ventas/comparativo-sucursales` es el `comparativoSucursales` de F1-032, que ahora tiene
    endpoint.
  - Los dos pasan por `CacheAgregados` (15 s) y por `consulta()`: 400 y luego 404, nunca 403.
  - La CTE `ventas` del helper de scope ganó `dia_local` (el día de cierre en la zona de la
    sucursal). `diasDelRango()` rellena los días con aritmética de medianoche UTC sobre fechas de
    calendario.
  - `api/openapi.json` está regenerado y `openapi.spec.ts` lista los paths nuevos. Sin migración.
- **Web:** `/reportes` (`web/src/paginas/Reportes.tsx` + `web/src/paginas/reportes/`):
  - **Ventas por día:** barras, tabla y fila Total.
  - **Comparativo entre sucursales:** sucursal, venta, tickets, ticket promedio y comensales, con
    fila Total. El promedio del total es venta/cuentas en `bigint`, con mitad lejos de cero como
    la API.
  - **Top productos:** tabla y barras horizontales, "Por importe/Por cantidad" y "Mostrar
    10/20/50".
  - **Export CSV** por reporte.
  - El periodo va en la URL y "hoy" es la zona del panel, igual que F1-041. Sin auto-refresco y
    sin `placeholderData`.
- **CSV común:** `web/src/csv/csv.ts` (BOM, CRLF, anti-inyección, importes exactos, `nombreCsv`,
  `descargar`). `tickets/csv.ts` lo reusa, y `tickets/exportar.ts` reexporta `descargar`.
  **`tickets/csv.test.ts` y `Tickets.test.tsx` no se tocaron y siguen verdes.** Eso prueba que la
  extracción no cambió la salida.
- **Checks:**
  - /api: lint y typecheck limpios, `npm test` **502/502, 0 skips**.
  - /web: build y lint limpios, `npm test` **196/196, 0 skips** (26 nuevos).
  - CI: sin carril nuevo que encender.
- **Revisor:**
  - Plan aprobado con 7 observaciones, atendidas.
  - Entregable aprobado con 3 observaciones: esta nota, la honestidad del cuadre y el 500 de
    `porDia`. Las tres están abajo.

**El "Listo cuando" (los totales cuadran con el dashboard): qué se probó y qué NO.**
- **Probado, en la API contra Postgres:**
  - Σ venta y Σ cuentas de por-día = las del comparativo = `resumen`.
  - Está en los 6 escenarios del spec del servicio (incluidos Tijuana con DST y el rango vacío) y
    en el e2e (3 filtros).
  - La serie por día también cuadra contra un cálculo a mano con `Intl`, cheque por cheque.
- **Probado, manual sobre HTTP:**
  - Levanté la API sobre el Postgres local con `seed:ventas` y secretos JWT sintéticos por
    variable de entorno. Entré con el admin del seed, cuyo email y contraseña leyó de `seed.ts` un
    script temporal.
  - Cuadra en tres casos:
    - mes 2026-09-01..21: $258,199.88 / 334 (lo mismo que registró F1-041);
    - 30 días: $388,235.39 / 482;
    - sólo "Sucursal Norte": $196,328.03 / 241.
  - Pasé esas respuestas reales a la vista con un test temporal (ya borrado). El total de
    Reportes fue igual al texto de la Venta total del Panel en los tres. El ticket promedio
    combinado del mes dio $773.05, igual que en F1-041.
- **Lo que prueba `Reportes.test.tsx`:** su fixture está hecho para cuadrar. Sólo prueba que la
  vista suma sin perder un centavo y que pinta lo mismo que el Panel; **no** prueba que la API
  cuadre.
- **NO validado:** el cuadre contra los **reportes nativos de SoftRestaurant**, porque no hemos
  visto una instalación real. El supuesto de que "el día es el del CIERRE, no una fecha de negocio
  ni un turno" (esquema-sr.md §2) sigue abierto hasta F1-090. Si SR corta distinto, cambian
  `resumen` y por-día juntos.
- No lo abrí en el navegador: entrar exige teclear la contraseña, y está prohibido (igual que en
  F1-040, 041 y 042). No medí 390 px en un navegador real.

**Decisiones que tomé y por qué.**
- **Por día con varias zonas:** cada cuenta cae en el día de SU sucursal, así que "1 de
  septiembre" junta el de CDMX con el de Tijuana. Es la misma regla de `resumen` y es lo que hace
  que la suma cuadre exacta. Está en la descripción del DTO/OpenAPI y en esquema-sr.md §2.
- **Guarda en `porDia`:** si Postgres devolviera un `dia_local` fuera de `desde..hasta`, lanza
  `Error('Venta por día fuera del rango pedido.')`, que el cliente ve como **500 genérico**. Es una
  invariante, no un error del cliente. Si algún día aparece, significa que el corte de día de
  `ventas` y el de la lista de días se separaron: se busca en `consulta-ventas.ts`, no en el
  request.
- **CSV sin fila de totales**, igual que Tickets: Excel suma, y no queda una fila que alguien sume
  dos veces. Un importe ilegible detiene el archivo y lo dice. Un ticket promedio `null` sale como
  celda vacía, nunca como 0.00.
- **Importe ilegible en pantalla:** la fila dice "Importe inválido", el total dice "Sin dato" y la
  barra no se dibuja. Nunca se muestra $0.00.
- **El orden y el límite del top viven en estado del componente, no en la URL:** se pierden al
  salir de la vista. Si Ricardo los quiere compartibles por link, es un cambio chico en
  `Reportes.tsx`.
- **Top sin fila Total:** el importe va antes del descuento de la cuenta y no cuadra con la venta
  (la vista lo dice).

**Trampas que encontré.**
- **Mi cálculo "a mano" de por-día tumbó por timeout** (5 s) un test que ya existía. Creaba dos
  `Intl.DateTimeFormat` por cheque y por día (~30k). Lo arreglé calculando el día de cada cheque
  una sola vez. Si agregas otra referencia a mano en ese spec, no hagas `Intl` dentro de un bucle
  por día.
- **`prettier --write` sobre una carpeta de /api** marcó como modificados archivos que no toqué
  (la trampa de CRLF que ya contó F1-033). Su diff de contenido estaba vacío. Los restauré con
  `git checkout --` antes del commit.
- **En los tests de la vista, la tarjeta no existe hasta que responde el refresh de sesión.** Un
  `getByRole('region')` justo después de `montar()` falla. Usa `findByRole`: en
  `Reportes.test.tsx` es `esperarTarjeta()`.
- **El guard de `guardiaCuerpo` no deja `extract(... FROM ...)` en el cuerpo.** Todo lo derivado de
  la fecha (`hora_local`, `dia_local`) va en la CTE del helper. `to_char(dia_local, 'YYYY-MM-DD')`
  sí pasa, porque las comillas simples están permitidas y las dobles no.
- **Los heredocs de Bash volvieron a fallar dos veces:** una con template literals de TS y otra
  con este log (`unexpected EOF`). Esta nota se escribió con Write, como ya pedían F1-040 y
  F1-042. Hazle caso.

**Prueba de mutación** (hecha; el código quedó restaurado y las suites otra vez en verde):
- API: `dia_local` en UTC → fallan 12.
- Web:
  - suma en float → falla 1;
  - total que se salta la fila ilegible (la toma como 0) → fallan 3;
  - sin `sucursalId` en la queryKey → falla 1;
  - truncar en vez de redondear el ticket promedio → fallan 4;
  - `placeholderData` con el dato previo → falla 1 (el de "nunca los datos del alcance
    anterior").

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Sigue sin tocarse, del revisor de F1-041** (aquí habría sido "de pasada"):
  `aCentavos(x) ?? 0n` en `inicio/Tarjetas.tsx` (`TarjetaFormasPago`) y en `inicio/puntosHora.ts`
  convierte un importe inválido en $0.00 sin aviso. Los reportes nuevos NO lo hacen. Queda para
  F1-092.
- El cuadre contra los reportes nativos de SR, para F1-090/091 (arriba).
- La medida de 390 px en un navegador real sigue pendiente, como en F1-041/042. Las tablas van en
  `overflow-x-auto`, y en móvil se esconde la columna Comensales del comparativo.
- Con 366 días, la tabla por día se desplaza dentro de `max-h-80` y las barras quedan muy
  delgadas. Funciona, pero para rangos de un año convendría agrupar por semana o mes. Es una
  mejora de producto para Ricardo, no un bug.
- `useReporte` (en `reportes/consultas.ts`) y `useVentas` (en `inicio/consultas.ts`) son casi el
  mismo hook. No los unifiqué para no tocar el dashboard de pasada. Candidato para F1-092.
- **Sin hallazgos nuevos sobre SoftRestaurant.** esquema-sr.md §2 sólo ganó la consecuencia, para
  los reportes, del supuesto del día de cierre que ya estaba.

**Qué haría distinto.** Medir desde el principio el tiempo del spec contra Postgres al agregar
una referencia a mano: el timeout de 5 s de Jest es el primer aviso de que la referencia es más
cara que la consulta.

## 2026-09-21 01:29 — F1-050 · Monitor de mesas en vivo
**Estado:** CERRADA (PR de `feat/F1-050`, squash a main)

**Qué quedó hecho.**
- **`/mesas` ya es la vista de verdad.** Está en `web/src/paginas/Mesas.tsx` y `web/src/paginas/mesas/`:
  - `mesa.ts`: lee la forma de cada mesa.
  - `reglas.ts`: todas las reglas de tiempo y los KPIs, puras.
  - `Monitor.tsx`: KPIs, avisos y grid.
  - `consultas.ts`: polling de 20 s y `useAhora`.
- **KPIs:**
  - Mesas abiertas + $ en curso.
  - Cuentas sin imprimir.
  - Atención >60 min (con nota aparte de las mesas sin hora de apertura).
  - Última lectura hh:mm con color de frescura.
- **Grid:** una tarjeta por mesa con nº, total, mesero, minutos, borde por semáforo (con el texto también para lector de pantalla), las primeras 3 partidas y "n partidas más". Orden natural por nº de mesa.
- **Polling:** cada 20 s, con punto/"Actualizando…" y botón Refrescar.
- **Filtro por sucursal:** es el selector del topbar (F1-040), no se duplicó.
- **Banner "sucursal desconectada"** en lugar de sus mesas. Una sucursal que nunca reportó tiene su propio aviso. Si no queda ninguna conectada, NO se pintan KPIs en cero: sólo el aviso.
- **API:**
  - `api/prisma/seed-mesas.ts` + `npm run seed:mesas`: snapshots SINTÉTICOS. Sucursal Centro en vivo con 8 mesas que cubren todo el semáforo; Sucursal Norte con su última lectura de hace 2 h.
  - La descripción de `mesas` en `SnapshotMesasDto` ahora dice la forma provisional; `openapi.json` se regeneró y sólo cambia ese texto.
  - Sin migración y sin cambio de endpoint.
- `totalDe` de `inicio/ventaEnVivo.ts` ahora se exporta (sin tocar su lógica): el monitor lee el total con la misma regla que "Venta en vivo".
- **Checks:**
  - /web: build y lint limpios, **237/237, 0 skips** (41 nuevos).
  - /api: lint y typecheck limpios, **511/511, 0 skips** (9 nuevos).
  - CI: sin carril nuevo que encender.
- **Revisor:**
  - Plan aprobado con 10 observaciones, todas atendidas.
  - Entregable aprobado con 6 observaciones; las que no se tocaron en código están abajo.

**El "Listo cuando": qué se probó y qué NO.**
- **NO probado:** "abrir una mesa en SR la muestra en ≤ 60 s". No hay SoftRestaurant ni agente (F1-020/F1-023 no existen). **La cadena real agente → API → vista no se ha ejercitado nunca.** Pendiente de F1-091.
  - Lo que sí se sabe: la vista pregunta cada 20 s. Con el supuesto de 30 s de ciclo del agente, el peor caso es ~50 s más lo que tarde el envío.
- **Probado, banner con dato viejo:**
  - En vitest, con snapshots de 2 h, de 91 s contra 90 s, y con el API caído. En ese último caso, la última respuesta envejece sola y a los 10 + 85 s sale el banner.
  - Con el seed real: `seed:mesas` en el Postgres local, la API compilada con secretos JWT SINTÉTICOS por variable de entorno, y un token firmado a mano para el admin del seed (no se tecleó ninguna contraseña).
  - `GET /mesas/abiertas` dio 200 en 76 ms; sin token, 401.
  - Esa respuesta real, pasada a la vista con un test temporal (ya borrado), dio 8 mesas, **$4,898.25** (cuadrado a mano), 5 sin imprimir, 2 en atención y el banner de Norte "hace 2 h".
- No se abrió en un navegador ni se midió 390 px (igual que F1-040..043). El grid es de 1 columna en móvil.

**Decisiones que tomé y por qué.**
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/mesas/mesa.ts`: **la forma de cada mesa del snapshot.**
  - `{ mesa, mesero, folio, abiertoAt, total, comensales, impreso, partidas[] }`, detallada en esquema-sr.md §5.
  - F1-023 tiene que mandarla así, o cambiarla aquí y en §5.
  - Todo campo ilegible sale "Sin dato": nunca $0.00 ni 0 min.
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/mesas/reglas.ts` (`INTERVALO_AGENTE_S = 30`): **desconectada = más de 90 s.**
  - La edad es `edadRecepcionSegundos` (reloj del servidor) más el tiempo que lleva la respuesta en el navegador, NO la del reloj del POS.
  - **F1-020/F1-025:** si el intervalo es configurable por sucursal, hay que mandarlo en el heartbeat y volver esta constante un dato por sucursal.
- **Minutos abierta** = `capturadoAt − abiertoAt` (el mismo reloj del POS, así que el desfase no importa) + la edad efectiva, **truncados** a minutos enteros antes del semáforo. 60 min con 59 s es 60, alerta. Un `abiertoAt` posterior a la captura sale como "Sin dato".
- **La vista re-renderiza cada 5 s** (`useAhora`): los minutos y la edad avanzan entre consultas, y si el API se cae el banner llega solo.
- **"$ en curso" y "sin imprimir" no dan cifras parciales:** si UNA mesa no trae el dato, dicen "Sin dato". "Atención" sí cuenta, pero avisa cuántas mesas no tienen hora.
- **Sin `placeholderData`:** al cambiar de sucursal salen skeletons (hay test).
  - La llave `['mesas','abiertas',empresa,sucursal]` es la misma de la tarjeta "Venta en vivo" de Inicio, así que comparten caché. Revisé que Inicio tampoco declara `placeholderData`.
- **El seed marca sus snapshots con `payload.origen = 'seed'`** y sólo borra ésos (filtra además por empresa y sucursal). `mesasDe` del API ignora esa clave.

**Trampas que encontré.**
- **La sucursal Centro del seed sólo se ve "en vivo" 90 s.** Para verla viva, corre `npm run seed:mesas` justo antes. Mi primera consulta HTTP salió con las dos desconectadas por eso.
- **El reloj de la vista puede ir hasta 5 s detrás de `dataUpdatedAt`** (el pulso es de 5 s). Por eso `edadEfectiva` recorta a ≥ 0 lo que pasó desde la respuesta. Si quitas el `Math.max`, la edad puede quedar menor que la del API.
- **`prettier --write` reformatea los tests en LF** y git avisa de CRLF; el contenido no cambia (lo mismo que ya dijo F1-033).
- **En un script temporal, `S=... node` pisó mi variable de ruta y el archivo fue a dar a otro lado.** Nombres distintos para el secreto y la ruta.
- **Para verificar sin teclear contraseñas:** `jsonwebtoken` firma un access token con el mismo `JWT_ACCESS_SECRET` sintético con que arrancaste `node dist/main.js`. El `sub` es el id del usuario en la base.

**Prueba de mutación** (hecha; todo quedó restaurado y las suites otra vez en verde). Qué se cambió y qué test la atrapó:
- Web:
  - umbral `>= 90`: fallan 4 (bordes 90/91 de `reglas.test` y el de 91 s de la vista);
  - semáforo 60 = rojo: fallan 2 (`semaforo` 60 y el de 60 min 59 s);
  - edad sin envejecer: fallan 4 (el de API caído en `reglas.test` y en la vista, más los de minutos);
  - pintar las mesas de las desconectadas: fallan 5;
  - `round` en vez de `floor`: fallan 2;
  - suma parcial con ilegible = 0: fallan 2;
  - polling a 60 s: fallan 2 (el de 20 s y el de API caído);
  - `placeholderData` con el dato previo: falla 1 ("cambiar de sucursal muestra skeletons").
- API:
  - borrar sin el filtro `origen`: falla 1 ("no toca snapshots que no sembró").

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Para F1-092, diferencia de cifras con el Panel:** "Venta en vivo" de Inicio suma TODAS las sucursales con snapshot, desconectadas incluidas; el Monitor las excluye. Con una desconectada no coinciden. No lo cambié aquí porque habría sido "de pasada". Está en §5.
- **Para F1-092, KPI "Última lectura":** con "Todas", muestra la lectura MÁS VIEJA, desconectadas incluidas. Con Norte caída sale siempre en rojo con la hora de Norte, aunque Centro esté al día y sus KPIs sí se vean. Es a propósito (que no parezca que todo está fresco), pero puede leerse como "todo está viejo". Una opción: mostrar la de las conectadas y dejar el rojo al banner.
- **`seed-mesas.spec.ts`:** los `it` de `sembrarMesas()` dependen del orden (el de "otro ahora" vuelve a sembrar al final). Funciona con `--runInBand`; si alguien los reordena, que cada uno siembre por su cuenta.
- **`seed-mesas.ts` usa `PrismaClient` directo** (script de dev, con filtro explícito de empresa). No copiar ese patrón a `src/`: ahí todo pasa por el helper de scope.
- **F1-051 (lo siguiente):** las tarjetas todavía no son botones. `mesa.ts` ya lee `folio` y `comensales`; las partidas sólo leen `producto` y `cantidad`. El modal tendrá que ampliar `leerPartida` (categoría, precio, modificadores). La `clave` de cada tarjeta es `sucursal:folio:índice`.
- ¿Una mesa con varias cuentas abiertas en SR? Hoy cada cuenta es una tarjeta (§5). Lo confirma F1-023.
- La medida de 390 px en un navegador real sigue pendiente, como en F1-040..043.
- **Hallazgos sobre SoftRestaurant: ninguno visto en SR real.** §5 y §13 de esquema-sr.md ganaron los supuestos de esta tarea, marcados como tales.

**Qué haría distinto.** Arrancar por `edadEfectiva`: la regla "la última respuesta también envejece" es la que hace honesto al banner, y es la que un test de "llega un snapshot viejo" no ve.

## 2026-09-21 01:55 — F1-051 · Detalle de consumo (modal)
**Estado:** CERRADA (PR en esta rama; el número lo da `gh pr create`)

**Qué quedó hecho.**
- **Clic en una tarjeta del Monitor abre el detalle** (`web/src/paginas/mesas/Detalle.tsx`).
  - Encabezado: mesa, sucursal (sólo con "Todas"), mesero, folio, comensales, tiempo abierta y total.
  - Partidas: cantidad, producto, categoría, precio c/u y total de la partida.
  - Modificadores anidados en listas dentro de su padre; los de $0.00 se ven como "$0.00".
  - "Total de la cuenta" al pie.
- **La tarjeta es un `<li>` con un botón "estirado"** (`absolute inset-0`, nombre "Ver consumo de Mesa N[ · Sucursal]"). Un `<button>` no puede contener la `<ul>` de partidas, por eso no envuelve el contenido. El `aria-label` del `<li>` no cambió, así que los tests de F1-050 siguen igual.
- **Lectura** (`mesa.ts`): la partida ahora lee `categoria`, `precioUnit`, `total` y `modificadores`.
  - Los modificadores son recursivos y se leen hasta 4 niveles (`PROFUNDIDAD_MAX_MODIFICADORES`); lo que queda más abajo sale como "Más modificadores no mostrados".
  - `importeDe` salió de `inicio/ventaEnVivo.ts#totalDe` sin cambiar su comportamiento: la misma regla para todos los importes.
- **Identidad de la cuenta entre polls** (`seleccion.ts`). El modal no guarda una copia de la mesa: la vuelve a buscar en cada respuesta, y así sigue en vivo.
  - Si una cuenta desaparece o su sucursal se desconecta, el modal dice "ya no aparece" y no se cierra solo.
  - Al cambiar de alcance, la selección se descarta.
- **Abrir o cerrar el modal no pide nada al API** y el grid es el mismo nodo del DOM (hay test).
  - El modal se cierra con Cerrar, Escape o un clic en el fondo.
  - El foco vuelve a la tarjeta que lo abrió. Si esa tarjeta ya no existe, va al contenedor de la vista (`tabIndex=-1`).
  - Tab queda atrapado dentro del modal, también después de un clic sobre texto (el panel es `tabIndex=-1`). `body` pierde el scroll y lo recupera con su valor previo.
- **/api:** sólo cambió la descripción de `mesas` en `mesas.dto.ts`, con `openapi.json` regenerado (cambia sólo ese texto). No hay endpoint, migración ni seed nuevos.
- **Checks:**
  - /web: build y lint limpios, **262/262, 0 skips** (25 tests nuevos).
  - /api: lint y typecheck limpios, **511/511**.
  - CI: no hay carril nuevo que encender.
- **Revisor:**
  - Plan aprobado con 11 observaciones, todas atendidas.
  - Entregable aprobado con 6 observaciones. La #4 (el foco se escapaba) se corrigió en código; las demás están abajo.

**El "Listo cuando": qué se probó y qué NO.**
- **"Modificadores anidados se muestran correctamente": sólo con datos SINTÉTICOS y una forma SUPUESTA.** Nadie ha visto cómo guarda SR un modificador de modificador. El test comprueba 3 niveles por su lugar en el árbol (cada `<li>` dentro del de su padre), no sólo por el texto.
- **El seed (`npm run seed:mesas`) NO genera anidados.** Sí trae categoría, precios y modificadores planos, uno de ellos de $0.00. Con el seed, el modal se ve pero sin anidación.
- **"Cerrar/abrir no dispara refetch":** el test abre y cierra por los 3 caminos sin avanzar el reloj (sólo `Date` es falso). Cuenta las llamadas a `/mesas/abiertas`, que siguen en 1, y compara el nodo del grid.
- **No se probó en un navegador real**, ni a 390 px (igual que F1-040..050).

**Decisiones que tomé y por qué.**
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/mesas/mesa.ts` (comentario de `leerMesa`): **modificadores anidados con la misma llave**, `modificadores: [{ nombre, precio, modificadores?: [...] }]`.
  - Si `modificadores` falta, no hay modificadores (misma regla que el contrato de ingesta).
  - Si está presente pero no es una lista, sale "Sin dato".
  - Un modificador que llega como texto se toma como su nombre, sin precio.
  - Todo esto está en esquema-sr.md §5.
- **Ni el total de la partida ni el de la cuenta se calculan.** Si falta el total de una partida, sale "Sin dato", nunca `cantidad × precioUnit`. Hay test.
- **Importes del snapshot a 2 decimales como máximo.** Un `"12.5000"` sale "Sin dato". Es requisito para F1-023: el snapshot no pasa por el redondeo del API como los cheques cerrados. Está en §5.
- **Identidad de la cuenta:**
  - En la misma respuesta, se identifica por `clave`.
  - En una respuesta nueva, por sucursal + folio. Un folio repetido es ambiguo y da "ya no aparece".
  - Sin folio, tienen que coincidir la posición, la mesa y `abiertoAt`.
  - **Consecuencia visible (obs. #6 del revisor):** una cuenta sin folio ni `abiertoAt` sale "ya no aparece" a los 20 s aunque siga abierta. Si F1-023 descubre que SR no da folio en las cuentas abiertas, el modal casi no sirve: hay que buscar otra llave estable.
- **Modal propio, no `<dialog>.showModal()`**, porque jsdom no lo implementa bien.
- **`TEXTO_SEMAFORO` y `nombreMesa` se movieron a `mesas/textos.ts`**, porque `react-refresh/only-export-components` no deja exportarlos desde `Monitor.tsx`.

**Trampas que encontré.**
- **`npx prettier --write src/paginas` reescribe ~40 archivos que NO tocaste.** El checkout de Windows los tiene en CRLF y prettier los pasa a LF. Git los marca como modificados sin diff de contenido, y `prettier --check` los marca aunque no sean tuyos. Pasa a prettier sólo tus archivos, o restaura los demás con `git checkout -- <archivo>`.
- **`git checkout -- <archivo>` para deshacer una mutación también borra tus cambios sin commitear.** Me pasó con `Detalle.tsx` y tuve que reaplicar el arreglo. Para las mutaciones, usa una copia (`cp` a /tmp y de vuelta).
- **Tab desde el panel enfocado cae en el botón Cerrar por orden del DOM, aunque no haya trampa.** La mutación que quitaba esa rama sobrevivía. Lo que sí escapa es Shift+Tab, y ése es el test que la atrapa.
- **`python` escribiendo a la consola de Windows revienta con caracteres como "§" o "×"** (cp1252). Usa `PYTHONIOENCODING=utf-8`.
- **Los heredocs largos en la herramienta Bash fallan** ("unexpected EOF while looking for matching `''"), incluso con el delimitador entre comillas. Para textos largos (tests, esta nota): escríbelos a un archivo en el scratchpad y agrégalos con `cat >>`.
- **Una corrida intermedia de vitest dio 2 fallos en 2 archivos** y no capturé cuáles. No se reprodujo en las 7 corridas siguientes (2 de ellas concurrentes). Si vuelve en CI, los primeros sospechosos son los tests con reloj falso y `shouldAdvanceTime`: "sigue al poll" y "sucursal se desconecta".

**Prueba de mutación** (todo quedó restaurado y la suite otra vez en verde). Qué se cambió y qué test la atrapó:
- sin folio, sin verificar mesa/hora → 2 de `seleccion.test`;
- folio repetido → el primero: 1;
- $0.00 como "Sin dato": el de anidados;
- sin recursión: el de anidados;
- `refetch()` al abrir: el de abrir/cerrar y el de "sigue al poll";
- modal dentro del condicional del grid: el de "sucursal se desconecta";
- el foco no vuelve: el de abrir/cerrar;
- overflow restaurado a `''`: el de foco/scroll;
- sin tope de profundidad: 1;
- modificadores ausentes = null: 4;
- sin reset de la selección al cambiar de alcance: el de "cambiar de sucursal" (tuve que agregarle el regreso a "Todas"; antes la mutación sobrevivía);
- panel sin `tabIndex`: el de foco/scroll;
- sin la rama Tab/Shift+Tab desde el panel: el de foco/scroll (con Shift+Tab).

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Decisión abierta para Ricardo (F1-022/F1-090):** los cheques cerrados siguen con modificadores PLANOS (`ModificadorDto`, `jsonb` de `cheque_partidas`, vista Tickets). Si SR los anida, esas tres cosas cambian. Está en §3 y §13.
- **Accesibilidad, para F1-092:** los `<li>` de partidas y modificadores del modal llevan `aria-label` = sólo el nombre del producto. Un lector de pantalla podría leer "Refresco" sin cantidad ni precio. Los tests se apoyan en ese nombre: si se cambia, hay que ajustarlos.
- Las mismas de F1-050 para F1-092 siguen en pie (cifras de Inicio frente al Monitor, KPI "Última lectura").
- **Hallazgos sobre SoftRestaurant: ninguno visto en SR real.** §3, §5 y §13 de esquema-sr.md ganaron los supuestos de esta tarea, marcados como tales.

**Qué haría distinto.** Probar primero la trampa de foco con un clic sobre texto: es el camino real de un usuario con mouse, y fue el hueco que encontró el revisor.

## 2026-09-21 02:35 — F1-060 · CRUD de empresas, sucursales y usuarios
**Estado:** CERRADA (PR en esta rama; el número lo da `gh pr create`)

**Qué quedó hecho.**
- **API, administración** (`api/src/administracion/`):
  - `POST /empresas`, `PATCH /empresas/:id`: sólo admin_global (403 por ruta para los demás).
  - `POST /sucursales`, `PATCH /sucursales/:id`: admins, en su alcance. Otra empresa = 404, idéntico a inexistente.
  - `GET /usuarios?empresaId=`, `POST /usuarios`, `PATCH /usuarios/:id`, `POST /usuarios/:id/password` (reset, 204).
  - `POST /cuenta/password` (cambio propio, CUALQUIER rol, en `api/src/auth/cuenta.controller.ts`): devuelve una sesión nueva y pone la cookie como el login. Throttle `login` 5/min.
  - Sin DELETE en nada: baja = `activo=false`.
- **Helper de scope** (la parte sensible):
  - Altas por `ScopedPrismaService.admin(scope)` → `api/src/scope/escritura-admin.ts` (`EscrituraAdmin`): `crearEmpresa` (exige scope global), `crearSucursal` y `crearUsuario` (verifican la empresa CON scope → 404). Recibe el cliente con tipo `Prisma.TransactionClient`, no importa `PrismaClient`.
  - Ediciones por `para(scope).X.updateMany` como siempre.
  - **Arreglado el riesgo que dejó F1-012**: `validarEscritura` ahora usa `whereAcota()` (`scoped-prisma.service.ts`), que rechaza un where de puros `undefined`, incluidos operadores (`{id:{equals:undefined}}`), `AND` vacíos, `OR` con alguna rama vacía, y `NOT`/`not` solos. 12 casos nuevos en su spec.
- **Sesiones**: migración `20260921081020_version_sesion` (`usuarios.version_sesion INT DEFAULT 0`).
  - El refresh token lleva claim `ver`; el refresh lo compara con la base.
  - Reset por admin, cambio propio y dar de baja la incrementan en la MISMA sentencia que escribe.
  - Un refresh sin `ver` (emitido antes de este cambio) vale como 0; `ver` null, negativo, decimal o texto = 401.
- **Auditoría** (`api/src/comun/auditoria.ts`): una línea JSON por cambio, `Logger('Auditoria')`: `{accion, actorId, actorRol, recurso, recursoId, empresaId, campos}`.
  - `campos` son NOMBRES de columna, nunca valores.
  - También la rotación de API key (F1-012): `ApiKeyService.rotar` ahora devuelve además `empresaId` para la auditoría; la respuesta HTTP no cambió.
  - Sólo tras éxito. Un intento rechazado no deja línea (hay test).
- **Web**:
  - `Administracion.tsx` con pestañas en la URL (`?tab=`): Sucursales, Usuarios, Empresas (sólo admin_global). Sucursales y Usuarios trabajan sobre la empresa del selector del Topbar.
  - API key: confirmación que avisa que el agente se corta en ese momento → modal "Cópiala ahora, no se volverá a mostrar" que NO se cierra con Escape ni clic afuera.
  - "Mi cuenta" (`/cuenta`, enlace en el Topbar) para todos los roles.
  - Los admin_global se listan aparte ("Administradores globales"), sólo para otro admin_global.
- **Checks**:
  - /api: lint y typecheck limpios, `prisma validate` ok, migrate "Already in sync", **599/599, 0 skips**.
  - /web: build y lint limpios, **275/275, 0 skips** (13 nuevos en `Administracion.test.tsx`).
  - OpenAPI regenerado.
  - CI: no hay carril nuevo que encender.
- **Revisor:** plan BLOQUEADO una vez (faltaba el arreglo de `updateMany` que dejó F1-012) y aprobado en la segunda pasada con 4 observaciones, todas atendidas. Entregable APROBADO CON OBSERVACIONES en la primera pasada. De las observaciones, arreglé dos después del veredicto:
  - Un admin ya no puede resetear SU PROPIA contraseña por `POST /usuarios/:id/password` sin dar la actual: responde 400 y lo manda a `/cuenta/password`. En la web, el botón no aparece en tu fila. Hay tests en los dos lados.
  - `cambiarPassword` escribe con `where: { id, activo: true }`: si lo dieron de baja entre la lectura y la escritura, responde 401 y no emite token.
  El resto de las observaciones está abajo.

**El "Listo cuando": qué se probó.**
- "Un admin_empresa no puede tocar otra empresa ni crear admin_global": e2e en `administracion.e2e.spec.ts`, bloque "AC", contra Postgres real.
  - Cada cruce da 404, idéntico al de un id inexistente, y la base queda intacta (se compara la fila antes y después).
  - Crear admin_global da 403 con o sin empresa.
  - Un admin_global es 404 para él, también con `rol` en el body.
- "Auditoría mínima en log de api (quién creó/rotó qué)": e2e del bloque "auditoría".
  - Espía `Logger.prototype.log` filtrando el contexto `Auditoria`.
  - Compara la secuencia exacta de 9 eventos.
  - Verifica que ni la API key, ni las contraseñas, ni `$argon2`, ni el nombre nuevo aparezcan en el log.
- **No se probó en un navegador real** (igual que F1-040..051).

**Decisiones que tomé y por qué.**
- **Matriz de permisos:**
  - Empresas: sólo admin_global. Un admin_empresa tampoco renombra la SUYA: 403 por ruta, que no filtra nada.
  - Usuarios y sucursales: admin_empresa sólo en su empresa.
  - El rol se edita sólo entre visor ↔ admin_empresa.
  - Si un admin_empresa pide `admin_global`, es 403. Si lo pide un admin_global para un usuario de empresa, es 400.
  - Cambiarle el rol a un admin_global es 400. Si no, el CHECK `usuarios_rol_empresa_chk` daría 500.
  - Nadie se da de baja ni se cambia el rol a sí mismo (400).
- **El destino de un PATCH de usuario se lee CON scope ANTES de evaluar cualquier regla de rol.** Así ningún 400/403 revela que existe un usuario ajeno. Hay mutación probada.
- **Zona horaria:** sólo nombres que estén literalmente en `Intl.supportedValuesOf('timeZone')` del Node del API (`zona-horaria.ts`).
  - `Intl.DateTimeFormat` acepta `+05:00`, y Postgres lo lee con signo POSIX invertido en `AT TIME ZONE`: los cortes saldrían corridos 10 h sin error.
  - OJO: `UTC` NO está en esa lista en Node 24, así que no se puede dar de alta una sucursal en `UTC`. Para México no importa.
- **Cambio propio en `/cuenta/password`, no en `/auth/`.** El cliente web no refresca ante un 401 de `/auth/*` (`cliente.ts`), y aquí un access vencido sí debe refrescarse. Contraseña actual mala = 400, no 401: el 401 significa "sin sesión".
- **Las escrituras de la web NO usan `useMutation`** (`web/src/paginas/admin/consultas.ts`, `useAccion`). TanStack guarda variables y respuesta de cada mutación en su caché varios minutos, y ahí viajarían contraseñas y la API key en claro. Hay un test que revisa las cachés de queries y mutaciones después de mostrar la key.
- **Modal propio** (`web/src/paginas/admin/Dialogo.tsx`) con el mismo comportamiento que el de F1-051. No toqué `Detalle.tsx`: una tarea por corrida.
- **Contraseñas nuevas:** 12..128 caracteres (`PASSWORD_MIN/MAX`). La del login sigue aceptando 1..256, para no dejar fuera a usuarios existentes.

**Trampas que encontré.**
- **`python` en Windows escribe CRLF** al abrir en modo texto. Si editas con un script de Python, `prettier --check` marca el archivo. `npx prettier --write <tus archivos>` lo deja en LF y git no ve diferencia de contenido.
- **Los heredocs largos siguen fallando en la herramienta Bash** (la trampa de F1-051/F1-011, me volvió a pasar con un .tsx). Usa Write desde el principio para archivos de más de ~100 líneas.
- **`expect(fn()).rejects` truena si `fn` lanza en síncrono.** `EscrituraAdmin.crearEmpresa` tiene que ser `async` para que el throw de "exige scope global" sea un rechazo.
- **supertest:** un helper `async` que devuelve un `request.Test` lo resuelve a `Response` (es thenable). En el e2e, `como(a, u).post()` resuelve adentro y devuelve la respuesta (misma trampa que F1-012).
- **`claims.ver ?? 0` aceptaba `ver: null` como 0.** Lo atrapó el test; ahora es `'ver' in claims ? claims.ver : 0`.
- **En los tests web, `POST /auth/refresh` también es un POST.** `llamadas.find(l => l.metodo === 'POST')` encuentra el refresh primero. Filtra por ruta.
- **`npx jest a b` con dos suites de base SIN `--runInBand` da decenas de fallos falsos**: las dos comparten las fixtures de F1-011 y se pisan. `npm test` ya lleva `--runInBand`; si corres archivos sueltos, agrégalo tú.
- **El CI dio `read ECONNRESET` con 8 requests de supertest en `Promise.all`** contra la misma app, que en local pasaban. Cada `request(server)` abre su propio listener. En los e2e, manda los requests EN SERIE. Me costó un intento de CI.
- La fixture `sucursalA2` está en `America/Mexico_City` (default), no en Tijuana como en la API falsa de la web. No asumas que coinciden.

**Qué quedó abierto — decisiones para Ricardo** (ninguna es tarea nueva de la cola):
- **CRUD del catálogo de formas de pago:** `schema.prisma` y `esquema-sr.md §4` decían "lo trae F1-060", pero el texto de F1-060 no lo pide. No se hizo. Corregí las dos notas. Si hace falta, es una tarea nueva: Ricardo decide dónde va.
- **Un 409 por email duplicado revela que el email existe en OTRA empresa.** Se aceptó porque el email es único global. La alternativa sería emails únicos por empresa, que es un cambio de modelo.
- **Los access tokens NO se revocan:** tras un reset, una baja o un cambio de contraseña, el access vigente vale hasta 15 min. Sólo los refresh mueren al instante.
- **Cambiar la zona de una sucursal con historial reclasifica sus ventas pasadas** en los cortes por día. Se permite con aviso en la UI y en el OpenAPI.
- **Carrera en el cambio propio (web):** se espera el refresh que ya esté en vuelo (`esperarRefreshEnVuelo`). Si el timer proactivo arranca un refresh DURANTE el POST y responde después, recibe 401 con la cookie vieja y puede cerrar la sesión recién emitida. La ventana es de milisegundos, una vez cada ~14 min.
- **Una zona que el ICU de Node lista pero el tzdata de Postgres no conoce** (p. ej. `America/Ciudad_Juarez`, que es de 2022) haría fallar los agregados de esa sucursal. No lo verifiqué contra el Postgres de producción.
- **Una empresa inactiva sigue aceptando altas** de sucursales y usuarios. Decisión conservadora: no inventé la regla. Desactivar la empresa ya deja fuera a sus usuarios y a sus agentes.
- **`whereAcota` todavía acepta filtros que acotan poco:** `{ nombre: { contains: '' } }` o `{ id: { mode: 'insensitive' } }` pasan como "acota". Hoy no se llega desde HTTP, porque todo `updateMany` usa `{ id }` con `ParseUUIDPipe`. Quien use `updateMany` con filtros de texto tiene que endurecerlo.
- **`editarUsuario` decide las reglas de rol con una lectura previa** y luego escribe con `updateMany`: es una carrera de lectura y escritura. El caso grave (tocar a un admin_global) lo cubren la regla y el CHECK de la base. Aceptado y anotado.
- **Para F1-092:** logout en la API (sigue sin existir); un límite por IP para fallos; y que el reset por admin no tiene throttle propio (es ruta de admin autenticado).
- **Hallazgos sobre SoftRestaurant: ninguno.** La tarea no toca SR. En `esquema-sr.md` sólo se corrigió la nota del catálogo.

**Qué haría distinto.** Meter en el plan desde el principio las deudas que el log dejó asignadas a esta tarea. El bloqueo del plan fue exactamente eso: el log de F1-012 decía "F1-060 debe arreglar `updateMany`" y no lo leí antes de escribir el plan. Busca tu ID de tarea en `docs/nocturno-log.md` antes de planear.

## 2026-09-21 03:40 — F1-061 · Estado de agentes
**Estado:** CERRADA (PR en esta rama; el número lo da `gh pr create`)

**Qué quedó hecho.**
- **"Contacto" del agente** (la pieza que faltaba para saber si un agente está vivo):
  - Tabla nueva `agente_contacto (sucursal_id PK, empresa_id, ultimo_contacto_at)` en la migración `20260921085338_agente_contacto`. Tiene FK compuesta Restrict e índice por empresa, igual que `agente_estado`.
  - La escribe **todo lote con sobre válido** de `POST /ingesta/eventos`, con `Reloj.ahora()`, aunque todos sus eventos salgan rechazados (el agente está vivo). Un 400 del sobre o un 401 no cuentan.
  - La escritura es `OperacionesSucursal.registrarContacto` (`api/src/scope/escritura-sucursal.ts`): un `INSERT ... ON CONFLICT DO UPDATE SET ... = GREATEST(...)`. Dos lotes en paralelo no chocan y el contacto nunca retrocede.
  - Si falla, se loguea y el lote se procesa igual (`IngestaService.registrarContacto`, con spec).
- **Heartbeat con `tamanoCola`** (entero 0..2^31−1; ausente = null). Columna `agente_estado.tamano_cola` con CHECK `agente_estado_tamano_cola_chk` escrito a mano en la migración. Entra en `mismoEstado` y sigue la regla de siempre: un heartbeat que llega tarde se descarta completo.
- **`GET /agentes/estado?empresaId=`** (`api/src/agentes/estado-agentes.*`):
  - Sólo admins. El visor recibe 403 por ruta, como en F1-060.
  - Otra empresa da 404, con el mismo body que un uuid inexistente.
  - Una fila por sucursal ACTIVA. Trae `ultimoContactoAt`/`edadContactoSegundos` (reloj del servidor), `ultimaLecturaAt`/`edadLecturaSegundos` (reloj del POS, recortado a ≥ 0), versiones, cola y último error. Si la sucursal nunca reportó, todo va en null.
  - El API NO decide "conectado": devuelve edades, igual que `/mesas/abiertas`.
- **Web**:
  - Pestaña **Agentes** en Administración (`?tab=agentes`, los dos roles admin): `web/src/paginas/admin/Agentes.tsx`.
  - Badge en el sidebar junto a "Administración" (`AlertaAgentes` en `layout/Sidebar.tsx`), con el número de sucursales que llevan > 10 min sin reportar. Enlaza a esa pestaña y conserva el alcance.
  - Las reglas puras están en `admin/reglasAgentes.ts`. La consulta es `useEstadoAgentes` (`admin/consultas.ts`), cada 20 s, con una llave que comparten la tabla y el badge.
- OpenAPI regenerado; `openapi.spec.ts` tiene el path nuevo. `esquema-sr.md` §5 ganó una nota (no hay hallazgo de SR).
- **Checks:**
  - /api: lint y typecheck limpios, `prisma validate` ok, migrate in sync, **631/631, 0 skips**.
  - /web: build y lint limpios, **294/294, 0 skips**.
  - CI: no hay carril nuevo que encender.
- **Revisor:**
  - Plan: APROBADO CON OBSERVACIONES (13), todas atendidas.
  - Entregable: APROBADO CON OBSERVACIONES en la primera pasada, con cero bloqueos.
    - Corregí el título de un test web que prometía "< 1 min". Ahora dice "al cruzar 90 s desde el último contacto".
    - Quité un parámetro `habilitado` que nadie usaba en `useEstadoAgentes`. El visor queda fuera porque el badge cuelga de la entrada "Administración", que él no ve.
    - Agregué una nota en la ficha de F1-025 del `backlog.md`, en esta misma rama.

**El "Listo cuando": qué se probó y qué NO.**
- **AC "refleja en < 1 min la caída del agente": NO cumplido literalmente. Decisión abierta para Ricardo.**
  - La detección llega a los **90 s del último contacto**, más ≤ 5 s de re-render: en el peor caso, ≤ 95 s.
  - Se siguió la regla explícita de F1-025 ("desconectado tras 3 intervalos sin heartbeat", 3 × 30 s). Es el mismo umbral del Monitor de Mesas (`UMBRAL_DESCONEXION_S`, que se importa, no se duplica).
  - Para cumplir < 1 min desde la caída hace falta una de dos: que el intervalo del agente sea ≤ ~18 s, o bajar el umbral a menos de 2 intervalos, con riesgo de falsos "desconectado".
- **"Probado matando el servicio": PENDIENTE.** No hay agente (F1-020/F1-025/F1-026). La cadena real agente → API → panel no se ha ejercitado nunca.
- Lo que sí se probó, como pide el backlog ("lógica de frescura con el estado manipulado en base"):
  - e2e `api/src/agentes/estado-agentes.e2e.spec.ts`, contra Postgres real con `Reloj` fijo:
    - contacto registrado → reloj + 91 s → el endpoint da 91;
    - edades exactas con 89/90/91/600/601 s escritos en base;
    - agente vivo sin lectura de SR (contacto 5 s, lectura 45 min);
    - reloj del POS adelantado → 0;
    - reenvío ×3: `agente_estado` idéntico y el contacto avanza;
    - dos lotes en paralelo → una fila;
    - el contacto no retrocede.
  - vitest `web/src/paginas/Agentes.test.tsx`: con el API caído después de una respuesta de 40 s, la fila pasa sola a "Desconectado" a los 50 s de la última respuesta buena. Los refetch fallidos no rejuvenecen el dato.
  - Badge: aparece a 601 s y no a 600, no aparece con "nunca reportó", y se prende solo al envejecer. El visor ni siquiera pide `/agentes/estado`.
- No se abrió en un navegador ni se midió a 390 px (igual que F1-040..060). La tabla va en un `overflow-x-auto`.

**Decisiones que tomé y por qué.**
- **`agente_contacto` queda FUERA de la foto de idempotencia a propósito** (decisión abierta para Ricardo; hay un comentario en `foto()` de `ingesta.e2e.spec.ts`).
  - El contacto es "cuándo nos habló el agente", como el `last_used_at` de una API key, no dato de la ingesta. Un reenvío lo mueve porque el agente sí nos volvió a hablar. Cheques, partidas, pagos, snapshots y `agente_estado` siguen idénticos, y el e2e de idempotencia de F1-031 no se tocó y sigue verde.
  - **No es precedente** para excluir otra tabla de la foto.
  - Alternativas descartadas:
    - (a) Una columna en `agente_estado` actualizada en cada heartbeat: mueve `updated_at` en un reenvío y rompe la foto.
    - (b) El id del evento como identidad del heartbeat: un lote con dos heartbeats reenviado mueve el contacto igual.
    - (c) Un `generadoAt` del agente para ordenar: depende del reloj del POS, y un reloj que se atrasa daría "desconectado" falso.
  - Por qué no bastaba lo que había: `agente_estado.updated_at` sólo cambia si el heartbeat cambia algo. `ultima_lectura_at` es del reloj del POS y se congela cuando el agente vive pero no lee SR.
- `DECISION PROVISIONAL (nocturno)` en `web/src/paginas/admin/reglasAgentes.ts` (`sinReportar`): **una sucursal que NUNCA reportó no prende el badge.** Sale "Sin reporte" en la tabla. Si no, una sucursal recién dada de alta sin agente dejaría el badge prendido para siempre.
- **El badge mira sólo la empresa del selector del Topbar** (el endpoint exige `empresaId`, como todos). Un admin_global no ve alertas de otras empresas. Mientras no haya empresa elegida, no hay badge; la normalización del alcance elige la primera de la lista en cuanto carga. Decisión abierta para Ricardo.
- **Sólo sucursales activas.** Una inactiva tiene la key rechazada y saldría "desconectada" para siempre.
- **El contacto cuenta cualquier lote aceptado**, no sólo los que traen heartbeat. Consecuencia para F1-024/F1-025: el agente debe mandar al menos un heartbeat por ciclo aunque no haya cheques. Si no, el contacto no avanza.
- **No se agregó la latencia de query** del heartbeat: es de F1-025, una tarea por corrida.

**Trampas que encontré.**
- **Windows no distingue mayúsculas: `admin/agentes.ts` y `admin/Agentes.tsx` chocan.** `tsc` da TS1149 ("differs only in casing"). Por eso las reglas se llaman `reglasAgentes.ts`.
- **Agregar un modelo de Prisma rompe a propósito dos inventarios:** `scope.helper.spec.ts` (`LLAVE_EMPRESA`) y `scoped-prisma.service.spec.ts` (lista de delegados). Además hay que borrar la tabla nueva en `limpiarFixtures` (`test/fixtures-auth.ts`), antes que las sucursales (FK Restrict).
- **En el test web del badge, `findByRole('link', {name:'Administración'})` aparece ANTES de que llegue `/agentes/estado`.** Si "tiras" el API en ese momento, la primera respuesta ya es 503 y nunca hay dato. Espera `pedidas(api).length === 1` y un `advanceTimersByTimeAsync(0)`.
- **Con `shouldAdvanceTime` y un pulso de 5 s, los bordes de tiempo se corren ~1 s.** Deja margen de un pulso completo en los tests de envejecimiento.
- `prettier --check` sobre carpetas enteras marca archivos que no tocaste (CRLF, la trampa de F1-051). Pásalo sólo por tus archivos.

**Prueba de mutación** (todo restaurado y las suites en verde). Qué se cambió y qué test la atrapó:
- sin `GREATEST`: 1 ("el contacto nunca retrocede");
- `edadAhora` sin envejecer: 4 (2 de reglas, el AC de la tabla, el badge que se prende solo);
- badge contando "nunca reportó": 2.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Decisiones para Ricardo:** el AC < 1 min contra los 3 intervalos; `agente_contacto` fuera de la foto de idempotencia; el badge por empresa del selector; "nunca reportó" sin badge.
- **F1-025:** latencia de query en el heartbeat (migración + DTO). Si el intervalo termina siendo configurable, que viaje en el heartbeat y `UMBRAL_DESCONEXION_S` se vuelva un dato por sucursal (ya lo decía F1-050). Recordar que primero se despliega el api (`forbidNonWhitelisted`).
- **F1-024:** el agente manda `tamanoCola` en el heartbeat.
- **F1-025** tiene ahora una nota en su ficha del `backlog.md`: el agente manda un lote por ciclo aunque no haya cheques, o la sucursal sale "Desconectado" en falso.
- **F1-092:** el badge re-renderiza el sidebar cada 5 s para los admins (`useAhora`). Es barato, pero es un poll de 20 s en todas las vistas de un admin.
- Hallazgos sobre SoftRestaurant: ninguno (la tarea no lee SR).

**Qué haría distinto.** Leer primero cómo se escribe `agente_estado` (el "si nada cambió, no escribe") antes de diseñar la frescura. Ahí estaba el bug que el backlog anunciaba, y cambia todo el diseño.

## 2026-09-21 03:50 — F1-020 · Esqueleto del servicio + configuración
**Estado:** CERRADA PARCIAL (el número de PR lo da `gh pr create`). Falta verificar con
`sc create` elevado el arranque con Windows y el reinicio tras una caída: eso es
**F1-020b**, en **Diurnas**.

**Qué quedó hecho.**
- **Servicio** (`agent/src/ArkonAgente`, exe `agente`):
  - `AddWindowsService(ServiceName="ArkonAgente")`.
  - Serilog configurado en código: consola + `C:\ProgramData\ArkonAgente\logs\agente-AAAAMMDD.log`, diario, 14 archivos. Override de `Microsoft`/`System.Net.Http` a Warning.
  - `appsettings.json` borrado: ya no lo leía nadie.
  - Publicación con `dotnet publish src/ArkonAgente -c Release -r win-x64`: queda un solo `agente.exe` self-contained de 79 MB. Va con un PropertyGroup condicionado al RID, así que el CI en Linux compila sin RID.
- **Config** (`Configuracion/`):
  - `CargadorConfiguracion` lee `config.json` `{apiUrl, apiKey, connectionString, intervaloSegundos}`. Tolera comentarios y comas finales.
  - Da un error por campo, en español, y ninguno repite la key ni el password: nunca se usa `ex.Message` de JSON ni de SqlClient.
  - `http://` sólo se acepta en loopback. `intervaloSegundos` es opcional (30 por defecto) y va de 5 a 3600. La cadena debe traer servidor y base.
  - `RutasAgente` recibe la carpeta inyectada. La variable `ARKON_AGENTE_DIR` sólo se lee en `Program.cs`, así los tests corren en paralelo sin tocar el entorno.
- **`agente test`** (`LineaDeComandos.cs`, `Diagnostico/`):
  - Corre SIEMPRE las dos verificaciones, aunque falle la primera. La última línea dice cuál falla ("FALLA la conexión a X. La otra funciona." / "FALLAN las dos").
  - Códigos de salida: 0 OK, 1 falla alguna conexión, 2 config inválida (no prueba nada), 64 comando desconocido.
  - SQL: `Sql/Consultas/diagnostico.sql`, un solo SELECT de funciones de sistema con `CommandTimeout=5`. **Un usuario que puede escribir es FALLA** aunque conecte: sysadmin, db_owner, db_datawriter, db_ddladmin, INSERT/UPDATE/DELETE/ALTER/CREATE TABLE sobre la base, o INSERT/UPDATE/DELETE/ALTER sobre el esquema dbo.
  - API: `GET {apiUrl}/agente/yo` con `X-Api-Key` y timeout de 10 s. Distingue DNS, TLS, red, timeout, 401, 404 y 5xx.
  - `HttpClient` a mano, sin `IHttpClientFactory`, para que la key no llegue a un log.
- **Conexión** (`Sql/ConexionSoftRestaurant.cs`):
  - Fuerza `Application Name=ArkonAgente` y `ApplicationIntent=ReadOnly`. Es sólo una pista, **no un control de seguridad**.
  - `Connect Timeout` de 5 s si no viene en la cadena; tope 15 s.
  - `Resumen()` no incluye el password.
- **Worker**:
  - Con config inválida no se cae: registra el error una vez por cada cambio y la relee cada 60 s.
  - Con config válida registra el diagnóstico y entra a un `PeriodicTimer` vacío, donde F1-021/F1-024 meterán el trabajo.
  - **Una excepción no prevista termina el proceso con `Environment.Exit(1)`** después de `LogCritical`.
- **Tests** `agent/tests/ArkonAgente.Tests` (xUnit, en el `.sln`): **104/104, 0 omitidos**.
- **CI**: **encendí `dotnet test` en el carril agent** (el backlog se lo daba a F1-021). La ficha de F1-021 lo dice. Se actualizaron el encabezado y el comentario del carril.
- **Otros archivos**:
  - Plantilla `infra/config.example.json`. Un test la pasa por el cargador.
  - `agent/README.md`: build, publish, config, `icacls`, `agente test`, `sc create/failure/failureflag/start/delete`.
  - `backlog.md`: F1-020b en Diurnas y notas en F1-021 y F1-026.
  - `esquema-sr.md` §11: supuestos de conexión.

**Qué se probó y qué NO.**
- **Probado:** build Release sin warnings y tests 104/104.
- **Prueba de mutación** (todo restaurado). Qué se cambió y cuántos tests fallaron:
  - cortar tras la primera falla: 4;
  - `Evaluar` sin permisos: 9;
  - `ToString` con secretos: 1;
  - worker que registra el error en cada reintento: 2;
  - http aceptado fuera de loopback: 3.
- **Probado a mano con el exe publicado**, contra el api local en :3999. Le puse una key sintética a "Sucursal Centro" en la base de desarrollo; **después la dejé en null otra vez**. Resultados:
  - key buena: `[OK] API ... 'Sucursal Centro'` + `[FALLA] SQL` (puerto cerrado) → "FALLA la conexión a SQL Server (SoftRestaurant). La otra funciona.", exit 1;
  - key mala: 401 → "FALLAN las dos", exit 1;
  - config inválida: exit 2, con los 4 errores juntos;
  - sin config: exit 2.
- **Modo servicio en consola:**
  - con config inválida no se cae y escribe `logs\agente-20260921.log`, con el error una sola vez;
  - con config válida registra el diagnóstico, y un grep de la key y del password en el log da 0.
- **NO probado. Que nadie lo lea como hecho:**
  - **El camino exitoso de `VerificacionSql` nunca corrió contra un SQL Server** (no hay ninguno en esta máquina). Quedan sin probar:
    - `FilaDiagnostico.Leer` sobre un resultado real;
    - los tipos que devuelven `IS_SRVROLEMEMBER`/`HAS_PERMS_BY_NAME` (se leen con `Convert.ToInt32`);
    - la clasificación de 18456 / 4060 / certificado / TLS;
    - el efecto de `InvariantGlobalization=false`.
    
    Todo eso se probó con filas armadas a mano o contra el puerto cerrado. F1-090/F1-091 lo validan.
  - **`sc create`, el arranque con Windows y el reinicio tras una caída**: la sesión no tenía consola elevada. Queda en F1-020b, con su "Listo cuando".
  - El `icacls` del README no se corrió, por la misma razón.

**Decisiones que tomé y por qué.**
- **DECISION ABIERTA para Ricardo: ¿el agente debe NEGARSE a leer SR si el usuario SQL puede escribir?**
  - Hoy `test` marca FALLA (exit 1). El servicio sólo registra Warning y sigue: `DECISION PROVISIONAL (nocturno)` en `Worker.cs`, `DiagnosticarAsync`.
  - En F1-020 no lee SR, así que no había nada que negarle. F1-021 debería decidirlo, o preguntar.
- **`Environment.Exit(1)` ante una falla interna** (`DependenciasWorker.TerminarDeVerdad`). Es la guía de Microsoft para BackgroundService en servicios.
  - Con el default de .NET 8 (`StopHost`) el servicio se reportaría detenido sin error y `sc failure` no lo levantaría.
  - En los tests va inyectado como `TerminarProceso`.
- **Config inválida = el proceso sigue vivo y reintenta.** Si terminara, `sc failure` lo reiniciaría en bucle sin arreglar nada. La aprobó el revisor.
- `DECISION PROVISIONAL (nocturno)` **`InvariantGlobalization=false`** en el exe y en los tests (los csproj). El texto de SR probablemente viene en codepage 1252 y no se pudo comprobar en modo invariante. Está en §11.
- `DECISION PROVISIONAL (nocturno)` **`TrustServerCertificate=True` en la plantilla** (SQL Express con certificado autofirmado). Está en §11.
- **La plantilla usa autenticación SQL.** Con `Integrated Security` el servicio (LocalSystem) entraría como SYSTEM, que en los Express viejos suele ser sysadmin. `test` y el log avisan si la cadena la usa.
- **Logs en `logs\`**, dentro de la misma carpeta del config.
- **LocalSystem** como cuenta del servicio. La cuenta virtual `NT SERVICE\ArkonAgente` queda anotada en F1-026.
- **`icacls` por SID** (`*S-1-5-18`, `*S-1-5-32-544`). En un Windows en español, "Administrators" no existe.

**Observaciones del revisor y cómo quedaron.**
- **Plan: APROBADO CON OBSERVACIONES**, 12 observaciones, todas atendidas:
  - permisos de escritura como FALLA;
  - query con sysadmin/ddladmin/UPDATE/DELETE/ALTER/CREATE TABLE;
  - auth SQL en la plantilla y aviso de Integrated Security;
  - `InvariantGlobalization` conservador;
  - cierre PARCIAL + F1-020b;
  - supuestos en §11;
  - test de guardia de las `.sql`;
  - rutas inyectadas;
  - `tcp:` en el test del puerto cerrado;
  - forma exacta de `AgenteYoDto`;
  - sin factory de HttpClient;
  - test del worker con config inválida.
- **Entregable: APROBADO CON OBSERVACIONES** en la primera pasada, sin bloqueo. Lo que se corrigió:
  1. Una falla interna ahora mata el proceso con código 1. Agregué `sc failureflag 1` al README, el caso nuevo al "Listo cuando" de F1-020b y un test (`Falla_interna_se_registra_como_critica...`).
  2. `icacls` por SID, en dos pasos: primero `grant`, luego `/inheritance:r`.
  3. Permisos sobre el esquema `dbo`: 4 columnas nuevas y 4 casos en el Theory. El texto de OK ahora dice lo que de verdad comprueba: "sin permisos de escritura a nivel servidor, base ni esquema dbo". El límite por objeto quedó anotado en §11 y en el `.sql`.
  4. Esta nota dice con claridad qué no se probó.
  5. (menor) El test del puerto cerrado baja de 20 a 10 s.

**Trampas que encontré.**
- **La herramienta Bash colapsa `\\` a `\` dentro de un heredoc**, aunque el delimitador vaya entre comillas (`<<'EOF'`). Por eso:
  - un `.cs` salió con `"127.0.0.1\SQLEXPRESS"` (error CS1009);
  - un script de Python metió un carácter BEL (`\a`) en `backlog.md` (`logs\agente` → `logs<BEL>gente`).
  
  Para escribir texto con barras invertidas usa la herramienta Write/Edit, no un heredoc. Si ya usaste uno, busca `chr(7)` en el archivo.
- **Un heredoc largo con `'apiUrl'` adentro se cortó a medias** y dejó un archivo truncado sin avisar (sólo un warning de "here-document delimited by end-of-file"). Revisa el final del archivo, o usa Write.
- **La consola de Windows arranca en la página OEM**: los acentos del reporte salían como `�`. Se arregló con `Console.OutputEncoding = UTF8`, pero sólo en modo `test`. En modo servicio no hay consola, y el archivo de log ya sale bien en UTF-8.
- **El api no carga `.env` solo.** Para levantarlo a mano: `PORT=3999 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... node -r dotenv/config dist/main.js`, con secretos de relleno de 32 o más caracteres.
- **Contra `tcp:127.0.0.1,1` en Windows, SqlClient da el error 258 (timeout)** y no "connection refused". Cae en la rama genérica "No se pudo llegar", que es correcta.
- En los tests, un `public` Theory no puede recibir un tipo `internal` (`FilaDiagnostico`): CS0051. Se pasa el nombre del permiso y la fila se arma adentro.

**Qué quedó abierto** (nada es tarea nueva de la cola, salvo F1-020b, que va en Diurnas):
- **F1-020b** (Diurnas): `sc create` real, reinicio de Windows, `taskkill`, falla interna y el `icacls`.
- **F1-021**:
  - decidir si el agente se niega a leer con un usuario que escribe;
  - la guardia `ConsultasEmbebidasTests` no revisa `NOLOCK` ni timeouts: agregar eso cuando haya queries sobre tablas;
  - si las tablas de SR no están en `dbo`, agregar ese esquema a `diagnostico.sql`;
  - ya existen `ConsultasEmbebidas` y `TimeoutComandoSegundos`.
- **F1-026**: cuenta virtual del servicio, `icacls` dentro de `instalar.ps1` y los comandos `sc` del README. El T-SQL sólo con `db_datareader` se puede comprobar con el propio `agente test`.
- **F1-090**: validar todos los supuestos de §11 (certificado, TLS, SYSTEM sysadmin, collation, nombre de instancia y timeouts).
- **Hallazgos reales sobre SoftRestaurant: ninguno.** La tarea no lee SR; todo lo de §11 es SUPUESTO.

**Qué haría distinto.** Escribir el archivo de apoyo de tests con Write desde el principio y
no con heredoc. Y pensar desde el plan qué pasa con el código de salida del proceso ante
`sc failure`. Lo encontró el revisor, y es justo el AC ("sobrevive reinicios").

## 2026-09-21 04:05 — F1-021 · Descubrimiento de la base y versión de SoftRestaurant
**Estado:** CERRADA (el número de PR lo da `gh pr create`). Sin PARCIAL. **Ojo:** el *envío*
de la versión y del error en el heartbeat **no está hecho**. Se delegó a F1-025, que ahora
tiene en su ficha un "Listo cuando" verificable. Que F1-021 tenga `[x]` no quiere decir "ya
se manda".

**Hallazgo grande: en esta máquina YA HAY un SoftRestaurant 10 real.**
- Instancia `.\NATIONALSOFT` (servicio `MSSQL$NATIONALSOFT`), base `softrestaurant10`, SQL
  Server 2014 SP1 Express (12.0.4100.1).
- El exe está en `C:\Program Files (x86)\Softrestaurant10` (`softrestaurant.exe` 10.0.323).
- El log de F1-020 decía que no había SQL Server; ya lo hay.
- Para entrar: `sqlcmd -S ".\NATIONALSOFT" -E -d softrestaurant10`. **Así eres sysadmin**:
  sólo SELECT, siempre con NOLOCK y `-t`.
- No se creó un usuario de solo lectura: crearlo es escribir en el servidor del POS.
- Sólo se miró el catálogo y la columna de versión. Ningún dato de negocio entró al repo.
- Todo lo visto quedó en `docs/esquema-sr.md` §1, §11 (recuadro), §12 y en la tabla de
  instalaciones.

**Qué quedó hecho.**
- **Detección** (`agent/src/ArkonAgente/SoftRestaurant/`):
  - `sr_estructura.sql` lee sólo el catálogo, con NOLOCK: qué tablas candidatas hay en `dbo`
    y si existe `parametros2.versiondb`.
  - Si existe, `sr_version.sql` lee `TOP (2) versiondb FROM dbo.parametros2 WITH (NOLOCK)`.
  - `HuellaSr.Desde` pasa las filas a una huella y `SelectorReader.Elegir` decide. Las dos
    son puras.
  - Mayor 10 → `SrV11Reader`. Mayor 11 → `SrV11Reader` más un Aviso, que el Worker registra
    como Warning.
  - Todo lo demás es NoSoportada con un mensaje claro:
    - otra versión mayor;
    - base sin `parametros2`/`versiondb` (el mensaje da 3 causas);
    - tabla vacía;
    - filas con versiones distintas;
    - valor ilegible;
    - faltan tablas núcleo.
  - `DetectorVersionSr` corre las queries. Cualquier falla sale como `SinConexion`, con el
    mensaje de `ClasificarError` y sin secretos.
- **`EstadoSoftRestaurant`** es un singleton con reader, `VersionSr` y `UltimoError`: lo que
  F1-025 tiene que mandar. `ResultadoDeteccion` ya acota los textos a 50 y 2000 caracteres.
- **Worker:**
  - Detecta antes del primer tick y en cada tick hasta tener reader.
  - Registra una sola vez cada mensaje distinto: Information, Error o Warning según el
    caso. Nunca se cae.
  - Con reader elegido deja de detectar. **Si SR se actualiza con el agente corriendo, hay
    que reiniciar el servicio.** Anotado en la ficha de F1-022.
- **`ConexionSoftRestaurant.CrearComando(conexion, "consulta")`**: todo comando contra SR
  sale de ahí, con el texto embebido y el timeout de 5 s. `VerificacionSql` también lo usa.
- **Guardia de NOLOCK** en `ConsultasEmbebidasTests`:
  - todo `FROM`/`JOIN` a un objeto lleva `WITH (NOLOCK)`;
  - los joins con coma y `APPLY` están prohibidos;
  - no mira comentarios ni textos.
- **Arreglo que no estaba en el plan** (el revisor lo aceptó dentro del alcance):
  - **El problema:** sin `TrustServerCertificate`, en un Windows en español el error real es
    "*La cadena de certificación fue emitida por una entidad en la que no se confía*"
    (Number -2146893019). `ClasificarError` sólo buscaba "certificate" o "certificado", así
    que lo mandaba a la rama de TLS con la sugerencia equivocada ("Encrypt=False / actualiza").
  - **Lo que cambié:**
    - reconoce el número y la palabra "certificación";
    - la sobrecarga `ClasificarError(int, string, conexion)` se puede probar;
    - agregué el caso 229 (lectura denegada).
  - **Por qué entra:** los mensajes de la detección pasan por ahí y viajan en el heartbeat.
- **Docs:**
  - `agent/README.md`: sección de detección.
  - `backlog.md`, notas en tres fichas:
    - F1-025: el "Listo cuando" del envío;
    - F1-022: la decisión sobre el usuario con escritura y lo que hereda de F1-021;
    - F1-090: la SR local, lo pendiente con `db_datareader` y la v11.

**Qué se probó y qué NO.**
- `dotnet build -c Release`: 0 advertencias. `dotnet test`: **173/173, 0 omitidos**.
- **Prueba de mutación** (todo restaurado). Tests que fallaron con cada cambio:
  - quitar NOLOCK de `sr_version.sql`: 1;
  - quitar lo de registrar cada mensaje una sola vez: 2;
  - quitar el chequeo de tablas faltantes: 1.
- **Contra la base real**, con el exe Release en consola, `ARKON_AGENTE_DIR` en el scratchpad
  e Integrated Security:
  - `softrestaurant10` → `SoftRestaurant versión 10.021800 detectado; se lee con SrV11Reader.`
    **Éste es el AC.**
  - `Database=master` → Error con las 3 causas; no se cae y reintenta.
  - Sin `TrustServerCertificate` → Warning de certificado con la sugerencia correcta (tras
    el arreglo).
  - `agente test` → FALLA SQL por sysadmin, que es lo correcto. Así `FilaDiagnostico.Leer`
    quedó probado contra un servidor real, que era un pendiente de F1-020.
  - Un grep de la api key en los logs da 0.
- **NO probado. Que nadie lo lea como hecho:**
  - **Con un usuario `db_datareader` nunca corrió**, sólo con sysadmin. Con
    `db_datareader`, `sys.tables` sólo lista lo que el usuario puede leer (supuesto, §1).
    Queda para F1-090 / F1-026.
  - **SR 11**: nunca vista. Que use `parametros2.versiondb` y el mismo esquema es SUPUESTO.
  - **El servicio como LocalSystem** contra esta base: no hubo consola elevada (F1-020b).
  - **Cancelación a media query** (observación del revisor):
    - **El riesgo:** SqlClient puede lanzar `SqlException` ("Operation cancelled by user")
      en vez de `OperationCanceledException`, y `DetectorVersionSr` la convierte en
      `SinConexion`. No hace daño: el timer sale en el siguiente tick.
    - **Qué hacer:** la próxima tarea que toque el detector debe agregar
      `catch (SqlException) when (cancelacion.IsCancellationRequested) { throw new OperationCanceledException(cancelacion); }`.
    - **Ojo:** tiene que lanzar una OCE, no relanzar la `SqlException`. El Worker sólo trata
      la OCE como parada normal; con cualquier otra excepción mataría el proceso con
      código 1.

**Decisiones que tomé y por qué.**
- **La versión sale de `parametros2.versiondb` y se reporta tal cual** (`"10.021800"`, sin
  redondear).
  - Hay columnas señuelo: `configuracion.versiondb` vale NULL y `parametros.versiondb` vale
    `'0'`.
  - Que la parte entera sea la versión mayor es SUPUESTO. Cómo se relaciona `021800` con el
    exe 10.0.323, no se sabe.
- **Nombres del catálogo comparados exactos (ordinal).** La instalación es CI y los nombres
  vienen en minúsculas. Con una collation CS rara saldría "faltan tablas", y eso es mejor
  que leer a ciegas.
- **Varias filas en `parametros2`:** si dicen lo mismo se acepta; si difieren, NoSoportada.
  Nunca se ha visto.
- **`DECISION PROVISIONAL (nocturno)` en `Worker.cs`, `DiagnosticarAsync`, sigue abierta.**
  - Con un usuario que puede escribir, el agente sólo registra un Warning y sigue.
  - F1-021 sólo lee el catálogo y una fila de parámetros.
  - La ficha de F1-022 dice lo conservador: si Ricardo no ha decidido, **no leer tablas de
    operación con ese usuario**.
- **ISoftRestaurantReader no tiene métodos de lectura**, sólo `Nombre` y `Version`. Los
  agregan F1-022/F1-023. No quedó nada a medio cablear.

**Observaciones del revisor y cómo quedaron.**
- **Plan: APROBADO CON OBSERVACIONES.** Todas atendidas:
  - "Listo cuando" verificable en F1-025;
  - Warning para la v11;
  - mensaje con las 3 causas;
  - filas con el mismo valor aceptadas;
  - comparación exacta de nombres;
  - guardia NOLOCK que también prohíbe joins con coma y APPLY;
  - detección inyectable en el Worker;
  - `HuellaSr.Desde` puro y probado;
  - decisión provisional marcada, con nota en F1-022;
  - docs §1, §11 y §12, sin marcar el codepage como validado.
- **Entregable: APROBADO CON OBSERVACIONES** en la primera pasada, sin bloqueo:
  1. Decir en el log que el envío del heartbeat se delegó a F1-025: hecho, arriba.
  2. Cancelación a media query: anotada arriba para la próxima tarea.
  3. Repetir que no se probó con `db_datareader` y que la decisión sigue abierta: hecho.
  4. Esta entrada.

**Trampas que encontré.**
- **La misma de F1-020, y caí otra vez.**
  - Un heredoc con `python -` dentro, con regex que llevaban `\\b`, dejó **caracteres de
    retroceso (0x08)** en un `.cs`. Y un `\\n` salió como salto de línea real.
  - Luego, un heredoc largo con comillas simples desbalanceadas falló entero ("unexpected
    EOF").
  - **Lo que tenga barras invertidas o comillas raras escríbelo con Write o Edit.** Para
    detectar el daño, busca caracteres de control con Python (ord < 32 que no sean salto,
    retorno ni tabulador).
- **SQL Server 2014 no tiene `STRING_AGG`** (error 195). Las queries del agente tienen que
  ser T-SQL de 2014.
- **SqlClient escribe en consola** "*el elemento TLS 1.0 negociado es un protocolo
  inseguro*". Este SQL 2014 SP1 no ofrece TLS 1.2, pero conecta igual.
- **En modo servicio en consola los acentos salen como `�`**: `Console.OutputEncoding` sólo
  se ajusta en `test`. El archivo de log sale bien en UTF-8. Es cosmético; no se tocó.

**Qué quedó abierto** (ninguna es tarea nueva de la cola):
- **F1-025:** mandar `EstadoSoftRestaurant.VersionSr` y `UltimoError` en el heartbeat. Está
  en su ficha.
- **Ricardo:** decidir si el agente se niega a leer con un usuario que puede escribir, antes
  de F1-022.
- **F1-090** (hay SR 10 local, ver su ficha): mapear columnas, probar con `db_datareader` y,
  si aparece, la v11.
- **F1-026:** el T-SQL de `db_datareader` ya se podría probar contra `.\NATIONALSOFT`, pero
  crear el usuario **es escribir en el servidor del POS**. Lo decide Ricardo de día, no una
  sesión nocturna.

**Qué haría distinto.**
- Buscar desde el primer minuto si la máquina ya tiene SR (`sc query state= all`, filtrando
  por SQL) en vez de creerle al log anterior. Eso convirtió la tarea de "supuestos" en
  "validada".
- No volver a escribir código con barras invertidas en un heredoc.

## 2026-09-21 04:25 — F1-024 · Cola local resiliente + envío
**Estado:** CERRADA (el número de PR lo da `gh pr create`). Sin PARCIAL. **Ojo:** en
producción, hoy, **la cola siempre está vacía**. Nadie encola todavía: los cheques los
produce F1-022, los snapshots F1-023 (las dos Diurnas, bloqueadas por F1-090) y el heartbeat
F1-025. El envío está cableado en el Worker y probado, pero **nunca se ha usado con datos
reales de un restaurante**.

**Qué quedó hecho.**
- **`agent/src/ArkonAgente/Cola/ColaLocal.cs`**: la cola en `C:\ProgramData\ArkonAgente\cola.db`
  (SQLite, `Microsoft.Data.Sqlite` 8.0.11). Tabla `eventos` con las columnas del backlog más
  tres: `clave` (el `folioSr` de los cheques), `rechazado_at` y `motivo_rechazo`.
  - WAL, `synchronous=FULL`, `Pooling=False` (el archivo no queda abierto).
  - Fechas UTC como texto de ancho fijo (`yyyy-MM-ddTHH:mm:ss.fffffffZ`), para que comparar
    textos sea comparar instantes (la purga depende de eso).
  - `Encolar` valida que el payload sea un objeto JSON y que un cheque traiga `folioSr`; si
    no, truena (bug del productor, no basura en la cola).
  - **Sólo el último pendiente cuenta** para: snapshot, heartbeat y cada `folioSr`. Encolar
    borra el pendiente anterior en la misma transacción.
  - `Purgar`: enviados y rechazados de más de 7 días. Nunca un pendiente.
  - `ContarPendientes` existe para el `tamanoCola` de F1-025.
- **`agent/src/ArkonAgente/Cola/EnviadorCola.cs`**: vacía la cola hacia
  `POST {apiUrl}/ingesta/eventos`.
  - Lotes de hasta 100, FIFO, body en gzip con `Content-Encoding: gzip`, `X-Api-Key`.
  - `min(intervaloSegundos, 20)` lotes por ciclo: nunca más de 60 peticiones por minuto
    (el API permite 120 por sucursal). **Esto no estaba en el plan**: con 20 fijos y el
    intervalo mínimo de 5 s eran 240 por minuto. Lo encontré construyendo.
  - 2xx: `procesados` → enviado; `reintentable:false` → rechazado (con motivo, Error en el
    log); `reintentable:true` o ausente de las dos listas → sigue pendiente y backoff. Los
    rechazos se ubican por `indice`, no por `id` (el id puede venir nulo).
  - 413: parte el lote a la mitad; un evento solo que da 413 → rechazado.
  - Red, timeout (30 s por petición), 400, 401, 429, 5xx, cualquier otro código, 2xx
    ilegible: nada se descarta, `intentos+1`, backoff 30 s → 60 → … → 10 min, medido con
    `TimeProvider`. Se reinicia con un envío bueno; en memoria (reiniciar = intento inmediato).
  - La parada del servicio a media petición propaga `OperationCanceledException` (no cuenta
    como falla).
- **`Worker.cs`**: nuevo `DependenciasWorker.CrearEnvio`. En `CicloAsync` crea el envío una
  vez, lo corre al arrancar (lo pendiente de antes de un reinicio sale sin esperar) y en cada
  tick después de la detección. Una excepción de SQLite no se atrapa: código 1 y `sc failure`.
- **`RutasAgente.ArchivoCola`**. `agent/README.md`: sección "Cola local y envío (F1-024)".
- **`backlog.md`**: notas "cómo encolar" en F1-022 y F1-023, y en F1-025 una nota que también
  es "Listo cuando" (encolar el heartbeat antes de enviar, `tamanoCola`, reportar rechazos y la
  falla vigente en `ultimoError`, rate limit).
- **`docs/esquema-sr.md`:** la tarea no lee SoftRestaurant y no hubo hallazgos. Sólo se
  anotó en la decisión abierta de folios repetidos que la cola también depende de ella.

**Qué se probó y qué NO.**
- `dotnet build -c Release`: 0 advertencias. `dotnet test`: **222/222, 0 omitidos** (eran 173).
- **El AC** (`EnviadorColaTests.AC_una_hora_sin_internet_...`): 120 ciclos de 30 s con reloj
  falso y el cliente HTTP lanzando `HttpRequestException` (así lo pide el backlog). Cada ciclo
  encola un cheque, un snapshot y un heartbeat; cada 4 ciclos reprocesa un folio viejo; en el
  ciclo 45 una ráfaga de 30; en el 60 **reinicio** (se reabre `cola.db`). Comprueba en cada
  ciclo que pendientes = folios distintos + 2, que el backoff acota los intentos (5..20, no
  120), y al reconectar: los 150 cheques, en el orden de su último encolado, cada uno en su
  última versión, más un solo snapshot y un solo heartbeat.
- **Respuesta perdida** (el API guarda y la respuesta no llega): cero pérdidas y se reenvía.
  **La garantía es "al menos una vez", no "exactamente una vez"**: la idempotencia la pone el
  API con su upsert por `(sucursal, folioSr)`.
- **Versión vieja reintentable vs. nueva** (observación obligatoria del revisor): la v1 vuelve
  como reintentable, se encola la v2, y al API sólo llega la v2.
- **Mutaciones** (todo restaurado): sin colapso por folio → 3 tests rojos; sin colapso de
  snapshot/heartbeat → 3; sin la guardia del backoff → 2; reintentable tratado como enviado → 1.
- **Contra el API real, en esta máquina** (Postgres 16 local, servicio `postgresql-x64-16`;
  api con `node -r dotenv/config dist/main.js` en el puerto 3999; key nueva de "Sucursal
  Centro" del seed, generada con el admin del seed):
  - `dotnet publish -r win-x64` da un solo `agente.exe` y **el SQLite nativo va dentro** (el
    exe creó `cola.db` sin DLL al lado).
  - Metí 5 eventos sintéticos en `cola.db` con Python (folios `E2E-F1024-*`, uno con
    `total: "cien"`) y corrí el exe: 4 enviados; el malo rechazado con el motivo real del
    API (`datos.total: total debe ser un importe decimal…`). **El gzip lo acepta el API real.**
  - Maté el API, encolé otra vez, corrí el exe: `Error ... No se pudo conectar con el API
    (ConnectionError). Nada se pierde…`, 5 pendientes con `intentos=1`. Levanté el API y
    corrí el exe: se mandó todo. En Postgres quedaron **2 cheques con 1 partida cada uno**
    tras el reenvío: la idempotencia se sostiene de punta a punta.
  - **Quedaron en la base local de desarrollo** los cheques `E2E-F1024-1` y `-2` de la
    "Sucursal Centro" del seed, y la key de esa sucursal rotada. Son sintéticos; no los borré.
- **NO probado:**
  - El servicio instalado (`sc create`) con la cola: sigue pendiente F1-020b.
  - Un `cola.db` corrupto de verdad o el disco lleno: sólo está razonado (código 1 y
    `sc failure`), documentado en el README.
  - Un corte de red real de una hora con el servicio corriendo: el AC se probó con reloj
    falso y la caída simulada en el cliente, y el corte real duró segundos.

**Decisiones que tomé y por qué.**
- **`DECISION PROVISIONAL (nocturno)` en `ColaLocal.Encolar`**: el heartbeat también se
  colapsa, aunque el backlog sólo lo dice del snapshot. El API sólo guarda el último estado
  (e ignora uno que llega tarde) y el contacto del agente sale del lote, no del heartbeat.
  Sin esto, un corte de días acumula 2 880 heartbeats diarios. El revisor estuvo de acuerdo.
- **Colapso por `folioSr`** (lo pidió el revisor): el API sobrescribe sin mirar versiones,
  así que un reintento de la versión vieja pisaba a la nueva. Efecto colateral: al
  reprocesarse, el folio se va al final de la cola FIFO. Es a propósito.
- **Un 400 no se bisecta**: el sobre lo arma el agente y un 400 masivo (proxy, API de otra
  versión) descartaría la cola entera. Precio: un 400 permanente la detiene para siempre
  (reintento cada 10 min). Está en el README y en la ficha de F1-025.
- **Sentencias de SQLite en constantes de `ColaLocal`**, no en `Sql/Consultas/`: ésas son las
  de SoftRestaurant, sólo lectura, con la guardia que prohíbe `INSERT`/`DELETE`. Si alguien
  las mueve ahí, la guardia truena, y está bien que truene.
- **API sincrónica** en `ColaLocal` (Microsoft.Data.Sqlite no tiene I/O asíncrono real).

**Observaciones del revisor y cómo quedaron.**
- **Plan: APROBADO CON OBSERVACIONES.** Todas atendidas:
  1. (obligatoria) clave por `folioSr`, con su test;
  2. heartbeat colapsado con la marca de decisión provisional;
  3. los rechazos definitivos, obligatorios en la ficha de F1-025;
  4. el 400 que no se va, en el README y en F1-025;
  5. la composición real probada (`La_composicion_real_crea_la_cola_en_cola_db...`) y este
     log dice que la cola hoy está vacía;
  6. el backoff sólo con `TimeProvider`, la respuesta perdida y el reinicio a mitad del corte
     en el test del AC;
  7. fechas de ancho fijo, `e_sqlite3` dentro del exe (verificado), `cola.db` corrupto en el
     README y el rate limit anotado.
- **Entregable: APROBADO CON OBSERVACIONES** en la primera pasada, sin bloqueo. Las cuatro
  eran documentales y quedaron en la rama:
  1. La decisión abierta "¿SR reinicia folios?" (`docs/esquema-sr.md`) ahora dice que la
     `clave` de la cola depende de ella, igual que el upsert del API.
  2. Un evento siempre `reintentable: true` frena la cola (~99 eventos cada 10 min): nota
     en F1-025.
  3. La bisección por 413 no respeta el tope de peticiones (hasta ~199 en un ciclo; un 429
     es falla con backoff): nota en F1-025.
  4. La limpieza de la base local de desarrollo va también en el PR.

**Trampas que encontré.**
- **Otra vez las barras invertidas en un heredoc**: un `python - <<EOF` (sin comillas) con
  `.\\NATIONALSOFT` dio `SyntaxError: malformed \N`. Para cualquier cosa con `\`, un archivo
  escrito con Write. Ya van tres sesiones seguidas con esta trampa.
- **`rm -rf` en el scratchpad lo niega el permiso de la sesión.** No hace falta: las carpetas
  de prueba se pueden reutilizar.
- **La tabla de cheques en Postgres es `cheques`** (`@@map`), no `cheque`. Mejor consultar con
  Prisma (`p.cheque.findMany`) que con SQL a mano.
- **El Postgres local sí existe** como servicio de Windows (`postgresql-x64-16`), aunque
  F1-001 no pudo levantar el de Docker. Con él se puede probar el agente contra el API real.
- Una `TaskCanceledException` que no viene de la parada del servicio se trata como timeout;
  así la ve `HttpClient` cuando vence el CTS de la petición.

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **F1-025**: todo lo de su ficha (nota de F1-024). Lo más importante: los rechazos
  definitivos hoy sólo llegan al log local.
- **F1-022 / F1-023**: encolar según sus notas.
- **F1-026**: `instalar.ps1` no debe borrar `cola.db` al reinstalar, y el `icacls` de la
  carpeta ya lo cubre (vive junto al `config.json`).
- La observación de F1-021 sobre la cancelación a media query en `DetectorVersionSr` sigue
  pendiente: esta tarea no tocó el detector.

**Qué haría distinto.** Hacer la cuenta del rate limit con el intervalo **mínimo** desde el
plan, no sólo con el de 30 s. Y buscar desde el principio qué servicios hay en la máquina
(Postgres local) para planear la prueba contra el API real.

## 2026-09-21 05:05 — F1-025 · Heartbeat y auto-diagnóstico
**Estado:** CERRADA (el número de PR lo da `gh pr create`). Sin PARCIAL. **Ojo:** "última
lectura" hoy es una **sonda**, no una lectura de ventas (ver Decisiones).

**Qué quedó hecho.**
- **Agente, ciclo nuevo** (`Worker.UnCicloAsync`), al arrancar y en cada tick:
  `ConsultarSrAsync` (detectar si falta; con reader, sonda) → `EncolarHeartbeat` →
  `envio.CicloAsync`. Sale **un lote por ciclo aunque no haya cheques** (nota de F1-061).
- **`SoftRestaurant/SondeoSr.cs` + `Sql/Consultas/sr_sondeo.sql`**: `SELECT TOP (1) 1 FROM
  dbo.parametros2 WITH (NOLOCK)`, timeout corto, mide la ejecución (sin el Open) en ms. La
  cancelación a media consulta sale como `OperationCanceledException` (la observación
  pendiente de F1-021, aplicada aquí; **el detector sigue sin ese arreglo**).
- **`EstadoSoftRestaurant`**: ahora con lock; `RegistrarSondeo`, `UltimaLecturaAt` (no
  retrocede si la sonda falla), `LatenciaQueryMs`, `ErrorLectura`.
- **`Salud/ArmadorHeartbeat.cs`** (puro): arma el `datos`. `ultimoError` = hasta 3 partes,
  ` | `, en orden **rechazos definitivos → envío → SR**, cada parte ≤ 600 y total ≤ 2000, sin
  partir pares sustitutos. `versionAgente` = informational version con hash de 7
  (`1.0.0+1a99dc7`).
- **`EnviadorCola.Estado`** (`EstadoEnvio`): falla vigente con la hora de la PRIMERA falla y
  las fallas seguidas; al recuperar, `UltimoIncidente` (desde/hasta), que el heartbeat reporta
  durante 1 h ("falló de … a …"). `ICicloEnvio` ahora expone `Cola` y `Estado`.
- **`ColaLocal`**: `ContarPendientesSinHeartbeat()` y `ResumenRechazados()` (total, cheques,
  el último con folio/motivo/fecha; lo que sigue en `cola.db`, o sea 7 días).
- **`CargadorConfiguracion`**: aviso si `intervaloSegundos > 30` (el panel usa 90 s fijos).
- **API**: `agente_estado.latencia_query_ms` (migración `20260921103313_latencia_query`, CHECK
  ≥ 0 a mano), `DatosHeartbeatDto.latenciaQueryMs`, `mismoEstado`, y el campo en
  `GET /agentes/estado`. `openapi.json` regenerado.
- **Web**: sólo `latenciaQueryMs` en `tipos.ts` y en dos fixtures de tests (contrato). La vista
  NO la muestra.
- **Docs**: `agent/README.md` (sección F1-025), `docs/esquema-sr.md` §1 (la sonda),
  `backlog.md` notas en F1-022 y F1-061.

**Qué se probó y qué NO.**
- `/agent`: build Release 0 advertencias; `dotnet test` **262/262** (eran 222), 0 omitidos,
  estable 3 corridas. Mutación: encolar el heartbeat DESPUÉS de enviar → 4 tests rojos.
- `/api`: lint, typecheck, `npm test` **637/637**, `prisma migrate dev` + `validate` limpios.
- `/web`: build, lint, test 294 verdes.
- **Manual, de punta a punta** (api con `PORT=3999` + `JWT_*_SECRET` sintéticos en la línea de
  comando porque el `.env` local no los trae; `agente.exe` publicado con `ARKON_AGENTE_DIR` en
  el scratchpad, `intervaloSegundos: 5`; key sintética de "Sucursal Centro" rotada con
  `hashApiKey` directo en la base local):
  - SR 10 local (`.\NATIONALSOFT/softrestaurant10`): `versionSr 10.021800`, `latenciaQueryMs 1`,
    `ultimaLecturaAt` a 1-3 s, `tamanoCola 0`, `ultimoError null`.
  - `Database=master`: `ultimoError` = el error de detección con las 3 causas.
  - API detenida 40 s con el agente vivo y levantada otra vez: al reconectar,
    `"El envío al API falló de 10:51:28 a 10:52:02: No se pudo conectar con el API (ConnectionError)."`.
  - Agente matado: a los 97 s, edad de contacto 97 (> 90 → "Desconectado" por la regla de
    F1-061, que no se tocó). **La vista web no se abrió**; la regla está probada en F1-061.
- **NO probado:** el servicio instalado (`sc create`, sigue F1-020b); la sonda con un usuario
  `db_datareader` (sólo sysadmin, igual que §1); ningún test prueba que una falla de SQLite en
  `EncolarHeartbeat` termine con código 1 (se razona igual que en el envío; observación 2 del
  revisor, pendiente).

**Decisiones que tomé y por qué.**
- **`DECISION PROVISIONAL (nocturno)` en `SondeoSr.cs`: sonda ≠ lectura de ventas.** El
  backlog pide "última lectura" y "latencia de query" y el agente no lee ventas (F1-022/023
  bloqueadas). El panel puede decir "última lectura hace 10 s" sin un solo cheque. **F1-022 la
  reemplaza** (nota en su ficha). Obligatoria del revisor.
- **`tamanoCola` NO cuenta el heartbeat**, a propósito, aunque la nota de F1-024 decía
  `ContarPendientes()`: el heartbeat se colapsa y viaja en el mismo lote. No "corregir".
- **Una excepción en detección o sonda ya NO mata el proceso** (observación obligatoria del
  revisor): si cortara el ciclo, no saldría el heartbeat y el panel diría "desconectado" con el
  agente vivo. Por eso **se reemplazó el test `Una_excepcion_al_detectar_es_falla_interna_y_
  termina_con_codigo_1`** por `Una_excepcion_al_detectar_no_corta_el_ciclo_el_heartbeat_sale_
  con_el_error` (más estricto). Config ilegible y SQLite siguen terminando con código 1.
- **Sonda sólo con reader elegido.** Antes, la detección es la que habla.
- **Con la sonda fallando, `latenciaQueryMs` va null** (no la última buena) y
  `ultimaLecturaAt` se queda en la última buena.
- **`DECISION PROVISIONAL (nocturno)` en `CargadorConfiguracion`: umbral de 90 s fijo**; no
  se manda el intervalo en el heartbeat. Decisión abierta para Ricardo, en la ficha de F1-061.
- **Namespace `ArkonAgente.Salud`**, no `ArkonAgente.Heartbeat`: ese nombre tapaba la constante
  `Heartbeat` de `ColaLocalTests` (CS0118).

**Observaciones del revisor y cómo quedaron.**
- **Plan: APROBADO CON OBSERVACIONES**, las 8 atendidas (4 obligatorias: sonda documentada,
  heartbeat pase lo que pase con test, `tamanoCola` anotado, contrato en `tipos.ts`).
- **Entregable: APROBADO CON OBSERVACIONES** en la primera pasada, sin bloqueo:
  1. (oblig.) esta entrada.
  2. Sin test de "SQLite falla en `EncolarHeartbeat` → código 1": **pendiente**, anotado arriba.
  3. `SondearDeVerdad` usa `TimeProvider.System` y no `_dep.Reloj`: **deuda**, sin cambio (en
     producción da igual).
  4. `ResumenRechazados` parseaba con un formato copiado: **arreglado**, constante única
     `ColaLocal.FormatoFecha`.

**Trampas que encontré.**
- **La base local de desarrollo guarda estado de sesiones anteriores.** Una fila
  `agente_estado` de "Sucursal Centro" (`versionAgente 0.0.0-e2e`) dejada por la prueba manual
  de F1-024 hacía fallar **localmente** `prisma/esquema.spec.ts` con P2002 (en CI no, la base es
  nueva). La borré, y al terminar borré también las filas `agente_estado`/`agente_contacto` que
  dejó esta prueba. **Si haces pruebas manuales, limpia al final.** La key de "Sucursal Centro"
  quedó rotada (sintética, no se guardó).
- **El `.env` local del api no trae `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`**: `node dist/main.js`
  truena al arrancar. Pásalos sintéticos por variable de entorno. Leer `.env` lo niega el permiso.
- **`dist` del api no tiene `src/`**: es `dist/agentes/api-key.js`, no `dist/src/...`.
- **`git checkout -- archivo` para deshacer una mutación revierte a HEAD**, y el archivo tenía
  cambios SIN commitear: perdí `Worker.cs` y lo salvé de un respaldo en `/tmp`. **Commitea antes
  de mutar**, o restaura desde copia, nunca con checkout.
- **Heredocs otra vez**: un `python - <<'PYEOF'` largo falló con "unexpected EOF". Script con
  Write, siempre.
- `sleep` en primer plano está bloqueado: la prueba de caída se orquestó con un `.ps1`
  (`Start-Process`/`Start-Sleep`/`Stop-Process`).

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **Ricardo:** umbral por intervalo (ficha F1-061); mostrar `latenciaQueryMs` en la vista.
- **F1-022:** reemplazar la sonda por la lectura real (nota en su ficha).
- **F1-026:** el instalador debería dejar `intervaloSegundos` en 30 (o sin poner).
- Arreglo de cancelación a media query en `DetectorVersionSr` (de F1-021): sigue pendiente.

**Qué haría distinto.** Commitear antes de cualquier mutación. Y revisar la base local
(`agente_estado`) antes de correr la suite del api.

## 2026-09-21 05:40 — F1-026 · Instalador y guía de instalación
**Estado:** REABIERTA por Ricardo (2026-09-21). El salto fue por la facturación de GitHub Actions, no por el código: el CI no arrancó ningún job. **Vuelve a la cola: tómala.**

**Qué pasó.**
- Entregable completo en la rama `feat/F1-026`, **PR #22**:
  - instalador `agent/instalador/`;
  - guía `docs/instalacion-agente.md`;
  - `dotnet test` 328/328, 0 omitidos;
  - revisor: plan y entregable APROBADOS CON OBSERVACIONES, todas atendidas.
- Iba a cerrar como `[x] PARCIAL`, con el resto en F1-020b (T-SQL nunca ejecutado,
  `instalar.ps1` nunca corrido elevado, cuenta virtual sin probar) y la medición de 15 min
  en F1-091.
- **Los 4 jobs del CI (guardia, api, web, agent) fallan en 2-3 s sin arrancar**, con este
  mensaje: "*The job was not started because recent account payments have failed or your
  spending limit needs to be increased. Please check the 'Billing & plans' section in your
  settings*". Relancé dos veces (`gh run rerun 35594239424`) y dio lo mismo.
- **Ya pasaba antes de esta tarea:** el push a main de F1-025 (#21, 11:03 UTC) y el del
  `[x]` de F1-025 fallaron igual. El último CI verde fue el PR de F1-025, a las 11:01 UTC.
- Por el protocolo (CI rojo tras 2 intentos → SALTA): cerré el PR #22 con un comentario y
  borré la rama. **No se marcó nada en el backlog.**

**Para retomar F1-026 (Ricardo):**
1. Arreglar la facturación de GitHub Actions: Settings → Billing & plans.
2. Restaurar la rama: botón "Restore branch" en el PR #22, o
   `git fetch origin pull/22/head:feat/F1-026`.
3. Reabrir el PR #22 y esperar el CI.
4. Al cerrar, marcar `[x] **PARCIAL:** falta ...` (el texto
   exacto está en la entrada de la rama).

**El detalle completo está en la entrada de F1-026 dentro del PR #22** (en
`docs/nocturno-log.md` de la rama): decisiones, trampas y lo que no se probó.

**⚠️ Para la sesión siguiente, y para Ricardo: mientras la facturación siga así, NINGÚN PR
puede ponerse verde.** F1-092, la única que queda en la cola, va a chocar con lo mismo y se
va a saltar igual. Antes de construir nada, revisa `gh run list --limit 3`. Si el último run
dice "*job was not started ... payments*", la tarea no se va a poder cerrar esta noche.

## 2026-09-21 12:10 — F1-092 · Hardening y pulido final
**Estado:** REABIERTA por Ricardo (2026-09-21). El salto fue por la facturación de GitHub Actions, no por el código: el CI no arrancó ningún job. **Vuelve a la cola: tómala.**

**Qué pasó.**
- Entregable completo en la rama `feat/F1-092`, **PR #23**:
  - API: cabeceras de seguridad, `trust proxy` con `TRUST_PROXY_SALTOS` y rate limit de refresh;
  - Caddy: snippets en `infra/caddy/seguridad.caddy`;
  - web: marca, login y 404, `check:bundle` en el CI, contraste.
  - Checks locales verdes: jest 651/651 y vitest verde, sin skips.
  - Revisor: plan y entregable APROBADOS CON OBSERVACIONES, las obligatorias atendidas.
  - Lighthouse móvil en local ≥ 92 en todas las vistas.
- El CI del PR (run `35596936229`) falló igual que el de F1-026: "*The job was not started because
  recent account payments have failed or your spending limit needs to be increased*". Lo relancé
  dos veces con `gh run rerun` y dio lo mismo.
- Por el protocolo: PR #23 cerrado con comentario, rama borrada, **nada marcado en el backlog**.

**Para retomar F1-092 (Ricardo):**
1. Arreglar la facturación de GitHub Actions (Settings → Billing & plans).
2. Restaurar la rama: "Restore branch" en el PR #23, o
   `git fetch origin pull/23/head:feat/F1-092`.
3. Reabrir el PR #23 y esperar el CI.
4. (Hecho: la línea de estado ya dice REABIERTA.)

Lo mismo vale para F1-026 (PR #22).

**El detalle completo está en la entrada de F1-092 dentro del PR #23:**
- lo que **F1-002 tiene que saber**: que `TRUST_PROXY_SALTOS=1` no es opcional, la decisión de
  HSTS y el `keepalive 4s`;
- los números de Lighthouse;
- las trampas.

**Estado de la cola:** F1-026 y F1-092 REABIERTAS (ver la entrada siguiente). La cola vuelve a tener tareas tomables.
La siguiente sesión debería crear `COLA_VACIA.txt`, salvo que Ricardo reabra alguna.

## 2026-09-21 — REABIERTAS F1-026 y F1-092 (decisión de Ricardo)
**Estado:** REABIERTAS. Las dos vuelven a la Cola nocturna, en su orden: primero F1-026 y
luego F1-092.

**Por qué.** Las dos se saltaron sólo porque el CI no arrancaba ningún job (facturación de
GitHub Actions). El código y el revisor estaban bien. Ninguna de las dos falló por sí misma.

**Cómo retomarlas. No las rehagas desde cero:**
1. Antes de nada, corre `gh run list --limit 3`. Si el último run sigue diciendo "*job was
   not started ... payments*", la facturación no se ha arreglado. Esa tarea va a chocar
   igual: no gastes la sesión construyendo.
2. Recupera la rama del PR cerrado: `git fetch origin pull/22/head:feat/F1-026` (F1-026) o
   `git fetch origin pull/23/head:feat/F1-092` (F1-092). Rebasa sobre main actualizado,
   corre los checks locales y pásala por el revisor (el entregable, no el plan: el plan
   ya se aprobó).
3. Reabre el PR (`gh pr reopen 22` / `gh pr reopen 23`) o abre uno nuevo desde la rama
   rebasada. Espera el CI y cierra por el protocolo normal.
4. El `[x]` de F1-026 lleva `**PARCIAL:**`. El texto exacto está en su entrada dentro del
   PR #22.

**Otro cambio de esta misma corrida:** `.github/workflows/ci.yml` ahora tiene `paths-ignore`
para `backlog.md` y `docs/nocturno-log.md`. Un commit que sólo toca esos archivos (el `[x]`
de cierre, una entrada SALTADA directa a main) ya no dispara CI. Un PR de tarea toca código,
así que sigue corriendo el CI completo.

## 2026-09-21 05:27 — F1-026 · Instalador y guía de instalación
> **Retomada tras la reapertura (2026-09-21, tarde).** Esta entrada es la original del
> PR #22, que se cerró como SALTADA sólo porque GitHub Actions no arrancaba jobs
> (facturación). La facturación ya está arreglada (`gh run list` en verde). La rama se
> recuperó con `git fetch origin pull/22/head:feat/F1-026` y se **rebasó sobre 4b6aea5**.
> **El código no cambió**; el único conflicto fue este log, y se resolvió conservando las
> entradas SALTADA/REABIERTA de main y ésta al final. Checks tras el rebase: build Release
> 0 advertencias, 328/328 tests, 0 omitidos. Revisor del entregable: APROBADO CON
> OBSERVACIONES (sólo esta nota y un salto de línea). **El PR de cierre es uno nuevo** (el
> número lo da `gh pr create`), no el #22. El `[x]` va con
> `**PARCIAL:** falta ...` apuntando a F1-020b y F1-091.

**Estado:** CERRADA PARCIAL (el número de PR lo da `gh pr create`). El `[x]` lleva
**PARCIAL**. Lo que falta no cabe en una sesión nocturna y se sumó a **F1-020b** (Diurnas),
cuyo "Listo cuando" se reescribió:
- **el T-SQL nunca se ha ejecutado**;
- **`instalar.ps1` nunca corrió con elevación**: ni `sc.exe create`, ni `icacls` en
  ProgramData, ni la cuenta virtual;
- **la medición de "< 15 min con una persona no técnica" es de F1-091** (nota en su ficha).

No se creó `F1-026b`: el resto es exactamente lo que F1-020b ya iba a verificar con consola
elevada. Se siguió el precedente de F1-001b.

**Qué quedó hecho.** Todo en `agent/instalador/`, que es el paquete junto con `agente.exe`.
Cómo se arma está en `agent/README.md` ("Armar el paquete del instalador").
- **`crear-usuario-lector.sql`**: T-SQL compatible con SQL 2008. Crea el login
  `monitor_lector` (`CHECK_POLICY=ON`), su usuario en la base y `sp_addrolemember
  'db_datareader'`. **Nada más.** Antes de tocar nada se detiene con `RAISERROR` + `RETURN`
  en estos casos:
  - el servidor es "sólo Windows";
  - la base es de sistema;
  - el login ya tiene un rol o un permiso de servidor (distinto de CONNECT SQL);
  - el login es dueño de la base;
  - el usuario tiene otro rol o un GRANT propio (distinto de CONNECT);
  - el usuario pertenece a otro sid.
  
  Además:
  - **avisa**, sin detenerse, si `public` puede escribir;
  - si el login ya existía, sólo repone la contraseña;
  - si el login está deshabilitado **no lo habilita**, sólo avisa;
  - lleva `:on error exit` y los mensajes van sin acentos.
- **`crear-usuario-lector.ps1`** es el paso 3 de la guía:
  - Busca `sqlcmd`. Si no lo encuentra, ofrece la alternativa con SSMS en modo SQLCMD.
  - Propone la instancia a partir del servicio `MSSQL$X`.
  - Lista las bases leyendo `sys.databases` y propone la `softrestaurant*`.
  - Pide la contraseña dos veces con `-AsSecureString` y la valida con reglas estrictas.
  - Corre el `.sql` con `-E -b -l 10 -t 30`. `-UsuarioAdmin sa` pide la contraseña de sa y
    la pasa por `SQLCMDPASSWORD`.
  - **Las contraseñas viajan por variables de entorno** (`BASE_SR`, `PASSWORD_LECTOR`), no
    en la línea de comando, y se borran en `finally`.
- **`instalar.ps1`** es el paso 4, en 8 pasos:
  1. Revisa que la consola sea de admin y que el exe exista.
  2. Detiene el servicio si ya existe.
  3. Copia el exe a `Program Files\ArkonAgente`, con reintentos.
  4. Aplica siempre el `icacls` por SID en `ProgramData\ArkonAgente` y **avisa** si queda
     otra entrada explícita.
  5. Escribe `config.json` en UTF-8 sin BOM, `intervaloSegundos: 30`, sólo si no existe o
     con `-ReemplazarConfig`. La key y la contraseña se piden seguras. **No hay parámetros
     para secretos, a propósito.**
  6. Registra el servicio: `sc.exe create`/`config` con `binPath` entre comillas internas,
     `delayed-auto`, `obj=` según la cuenta, `description`, `failure`, `failureflag 1`,
     `sidtype unrestricted` y `icacls` Modificar para el SID del servicio.
  7. Lo arranca. Si no arranca, muestra la cola del log y sugiere `-CuentaServicio
     LocalSystem`.
  8. Corre `agente test` y comprueba que el servicio siga `RUNNING` a los 5 s.
  
  Códigos de salida: 0 / 1 / 2 / 3. **Nunca borra `cola.db` ni los logs.**
- **`funciones-instalador.ps1`**: las funciones compartidas. Las puras son las que se
  prueban:
  - validaciones de URL, contraseña nueva, contraseña de la cadena, valores y **nombre de la
    base**;
  - armado de la cadena y del JSON;
  - los argumentos de `sc.exe`.
- **`docs/instalacion-agente.md`**: guía para una persona no técnica.
  - Pasos con tiempos y tablas de "si sale X, haz Y" con los textos reales de `agente test`.
  - El checklist de firewall.
  - Cómo actualizar y desinstalar, y "qué NO hacer".
- **Tests**: 262 → **328**, 0 omitidos.
  - `InstaladorSqlTests` parsea el `.sql` con **ScriptDom `TSql100Parser`** (paquete nuevo,
    sólo en el proyecto de tests). Tiene una lista cerrada de sentencias, prohíbe el SQL
    dinámico, sólo permite `sp_addrolemember('db_datareader','monitor_lector')`, y ALTER
    LOGIN sólo con PASSWORD. Incluye 14 mutaciones que la guardia debe detectar.
  - `InstaladorPs1Tests` corre PowerShell de verdad (`powershell.exe` en Windows, `pwsh` en
    el CI; si no hay, falla). Cubre:
    - parseo de los 3 `.ps1` y un recorrido del AST que prohíbe `sc`/`iex`;
    - BOM en los 4 archivos;
    - **config que escribe el `.ps1` → `CargadorConfiguracion` real**;
    - validaciones, `sc` args y la instancia.
- **Otros**:
  - `VerificacionSql.AvisoAutenticacionWindows` ya menciona la cuenta virtual.
  - README actualizado.
  - `docs/esquema-sr.md` §11, subsección "Usuario de solo lectura e instalador".
  - `.gitattributes`/`.editorconfig`: CRLF y BOM en `agent/instalador`.
  - Comentario del carril agent en `ci.yml` (pwsh).

**Qué se probó y qué NO.**
- **Probado:**
  - build Release con 0 advertencias y 328/328 tests;
  - **mutaciones** (restauradas): JSON sin doblar `\` → 1 rojo; `db_owner` en el `.sql` →
    13; `sc stop` en `instalar.ps1` → 1; `binPath` sin comillas → 1;
  - los 3 `.ps1` parsean en PS 5.1;
  - sin elevación, los dos scripts salen con 3 y el mensaje de "consola de administrador".
- **Contra la SR local**, sólo lectura: la consulta de catálogo de §11 (modo mixto; `public`
  sólo con SELECT) y un `PRINT` para ver que `sqlcmd` 2014 lee UTF-8 con BOM y toma
  variables de entorno. Una variable que falta → exit 1 sin mandar el lote.
- **NO probado. Que nadie lo lea como hecho:**
  - el T-SQL (ninguna rama, ni la buena ni las de ALTO);
  - `sc.exe` de verdad;
  - `icacls` sobre ProgramData y el aviso de entradas extra;
  - la cuenta virtual `NT SERVICE\ArkonAgente`: si el servicio arranca y puede escribir
    logs y `cola.db`;
  - `Get-ServidorSugerido` y `Find-Sqlcmd` en una PC real;
  - `-UsuarioAdmin sa`;
  - la medición de 15 min.
  
  Todo eso está en F1-020b / F1-091.

**Decisiones que tomé y por qué.**
- **`DECISION PROVISIONAL (nocturno)` en `instalar.ps1`, paso 6: cuenta virtual por
  defecto**, con `-CuentaServicio LocalSystem` como salida. Es de menor privilegio. El
  revisor lo aprobó: LocalSystem tampoco está probada como servicio. Si F1-020b ve que no
  funciona, se cambia el default y se quita la marca.
- **Un wrapper `crear-usuario-lector.ps1` en vez de enseñar `sqlcmd -v PASSWORD=...`**
  (obligatoria del revisor). Así la contraseña no queda en el historial de PSReadLine.
- **Funciones en un archivo aparte** (`funciones-instalador.ps1`). Si se hace dot-source de
  un script con `param()`, se pisan las variables del que lo llama: `$Servidor`/`$Base` del
  wrapper se volvían `$null`.
- **Contraseña nueva con una lista cerrada** (`A-Za-z0-9` y `-_.!@#*+=?`, de 12 a 64). Viaja
  dentro del T-SQL entre comillas, en la cadena de conexión y por la consola, y así no hay
  nada que escapar. La de la cadena es más permisiva (sin `;`, `'` ni `"`), por si el
  usuario se creó a mano.
- **Nombre de la base con una lista cerrada** (`A-Za-z0-9_-`), obligatoria del revisor del
  entregable. Va dentro de `USE [$(BASE_SR)]`, y un `]` inyectaba T-SQL (`-Base "x] ALTER
  SERVER ROLE sysadmin ADD MEMBER [monitor_lector"`). **Una base de SR con espacios o
  acentos no pasaría.** No se ha visto ninguna así; si aparece, hay que escapar `]` → `]]` en
  vez de rechazar.
- **Sin `db_denydatawriter`**: el backlog dice literalmente "sólo db_datareader", y en la
  instalación vista `public` no escribe. Queda como **DECISIÓN ABIERTA para Ricardo** en
  §11.
- **`sp_addrolemember` y no `ALTER ROLE ADD MEMBER`**, y nada de `IS_ROLEMEMBER`: SR puede
  ir sobre SQL 2008.
- **Mensajes del `.sql` sin acentos.** Con BOM `sqlcmd` los lee bien, pero la consola OEM
  igual puede romperlos.
- **`sc.exe` con `Start-Process -ArgumentList "<línea literal>"`**: en 5.1, pasar
  `"\"C:\...\""` como argumento de un exe pierde las comillas internas.

**Observaciones del revisor y cómo quedaron.**
- **Plan: APROBADO CON OBSERVACIONES**, 8 obligatorias. Todas atendidas (ver arriba), más
  las recomendadas 9, 11, 12 y 13. De la 10 (avisar si `public` escribe) quedó el aviso.
- **Entregable: APROBADO CON OBSERVACIONES** en la primera pasada, sin bloqueo:
  1. (oblig.) Inyección por `-Base`: **arreglado**, con `Test-NombreBase` y 8 casos de test.
  2. (oblig.) Faltaba `-t` en la corrida del T-SQL: **`-t 30`**.
  3. (oblig.) Esta entrada.
  4. `icacls /grant:r` no quita entradas explícitas previas: **aviso en pantalla** con el
     `icacls /remove` a correr. No se quita a ciegas.
  5. `*.sql` en `.gitattributes`: **hecho**.
  6. Repetir los supuestos en el PR: **hecho**.

**Trampas que encontré.**
- **Heredoc con barras invertidas, cuarta sesión seguida.** Un script de mutación en
  `python - <<'EOF'` convirtió `'\\\\'` en otra cosa y el `assert` falló. Lo que lleve `\`,
  escríbelo con Write en un `.py` del scratchpad y córrelo.
- **Con `python -c "..."` bash hace la sustitución de `$(VAR)`** dentro de las comillas
  dobles: el archivo de prueba de `sqlcmd` salió sin la variable y parecía que "sqlcmd la
  dejaba vacía". Falso: si no existe, falla.
- **PowerShell 5.1 lee un `.ps1` sin BOM como ANSI.** Los `.ps1` y el `.sql` del instalador
  llevan BOM (hay test). Si los editas con Write, vuelve a ponérselo:
  `scratchpad/normalizar.py`, o pon BOM + CRLF a mano.
- **En PowerShell 5.1, `sc` es `Set-Content`**: `sc stop X` crea un archivo "stop". Hay un
  test que lo prohíbe en el AST.
- **`$pwd` es una variable automática** (`$PWD`, sin importar mayúsculas). Casi la uso para la
  contraseña.
- **La salida de un exe dentro de una función de PS se vuelve parte del valor de retorno.**
  `& agente.exe test` sin `| Out-Host` habría convertido el código de salida en un arreglo.
- **Con `$ErrorActionPreference='Stop'` en 5.1, `& exe 2>&1` corta el script en la primera
  línea de stderr.** Dentro de esas funciones se pone `'Continue'`.
- `git config core.autocrlf` = true en esta máquina: el índice guarda LF y el checkout pone
  CRLF. El BOM sí sobrevive (verificado con `git show`).

**Qué quedó abierto** (nada es tarea nueva de la cola):
- **F1-020b** (Diurnas, reescrita): lector en la SR local con autorización de Ricardo,
  `instalar.ps1` elevado con la cuenta virtual, y lo de F1-020.
- **F1-091**: medir los 15 min con la guía y corregirla.
- **Ricardo**: `db_denydatawriter` (§11); y si una base de SR con caracteres raros obliga a
  escapar `]` en vez de rechazar.
- Lo de F1-021 sigue pendiente: la cancelación a media query en `DetectorVersionSr`.

**Qué haría distinto.** Pensar desde el plan dónde se interpola cada entrada del usuario
(T-SQL, cadena, JSON, línea de comando), no sólo la contraseña. La inyección por `-Base` la
encontró el revisor, y era el mismo razonamiento que ya había hecho para la contraseña.

## 2026-09-21 11:58 — F1-092 · Hardening y pulido final
> **Retomada tras la reapertura (2026-09-21, tarde).** Esta entrada es la original del PR #23,
> que se cerró como SALTADA sólo porque GitHub Actions no arrancaba jobs (facturación). La
> facturación ya está arreglada. La rama se recuperó con `git fetch origin pull/23/head:feat/F1-092`
> y se **rebasó sobre 8fcb504** (con F1-026 ya mergeada). **El código no cambió**; el único
> conflicto fue este log (se conservaron las entradas de main y ésta va al final). Los checks y
> el revisor del entregable tras el rebase están en la sección "Cierre tras la reapertura", al final.

**Estado:** entregable completo y aprobado por el revisor (plan y entregable APROBADOS CON
OBSERVACIONES, sin bloqueos). Rama `feat/F1-092`. **El cierre depende del CI**, que a las 11:32 UTC
seguía sin arrancar jobs por la facturación de GitHub Actions (re-verificado con `gh run rerun`
antes de construir). Si el CI sigue rojo tras 2 intentos, la tarea se SALTA como F1-026: el PR queda
cerrado y restaurable, con todo esto dentro.

**Qué se hizo.**
- **API** (`configurarApp`, así los e2e prueban lo que corre):
  - cabeceras en toda respuesta: `nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: no-referrer`, `Cache-Control: no-store`;
  - sin `X-Powered-By`;
  - `trust proxy` con `TRUST_PROXY_SALTOS` (default 0; valor inválido truena);
  - throttler nuevo `refresh`, 30/min por IP, en `POST /auth/refresh`. Constantes en
    `api/src/auth/throttlers.ts`.
  - **Cada ruta con `ThrottlerGuard` salta explícitamente los cubos que no son suyos:**
    login, refresh, `cuenta/password` y `@AutenticacionAgente()`. Si agregas un throttler, toca las
    cuatro. El test de 120/min de agentes es el que detecta que un cubo nuevo se coló en la ingesta.
  - OpenAPI regenerado (429 en refresh).
- **Caddy** (`infra/caddy/seguridad.caddy`): snippets `cabeceras_seguridad`, `api` y `spa`, que
  importa el Caddyfile de F1-002; el uso está al inicio del archivo. `Caddyfile.local` es sólo para
  probar en local.
  - La CSP es estricta y va sólo en la SPA: `script-src`/`style-src 'self'`, sin `unsafe-*`.
  - `web/src/seguridad/csp.test.ts` la vigila leyendo el snippet con `?raw`.
- **Web**:
  - marca propia (`web/src/marca/Marca.tsx` + `public/favicon.svg`; el logo usa `currentColor` y
    sigue al acento);
  - meta `description` y `theme-color`;
  - login rediseñado y 404 con código y botón;
  - `pesosCompactos`/`compacto` en `dinero.ts`: los ejes daban `$-1.2 k` y ahora dan `-$1.2 k`;
  - contraste `slate-400` → `slate-500`;
  - `npm run check:bundle` (tope 400 kB gzip, sumando también los chunks lazy), agregado al job web
    del CI.

**Números (todo en LOCAL, no en el VPS).**
- Bundle: 210.6 kB gzip.
- Lighthouse 13.5.0 móvil contra el Caddy local + API local + seed, con cookie de refresh por
  `--extra-headers`, sin teclear contraseña en el navegador (performance / accesibilidad /
  buenas prácticas):

  | Página | Perf | A11y | BP |
  |---|---|---|---|
  | `/login` | 99 | 100 | 96 |
  | `/` | 95 | 100 | 100 |
  | `/reportes` | 92-99 | 100 | 100 |
  | `/mesas` | 99 | 100 | 100 |
  | `/tickets` | 99 | 100 | 100 |
  | `/admin` | 99 | 100 | 100 |
  | 404 | 99 | 100 | 100 |

  - En `/login`, BP baja por el 401 esperado del refresh sin cookie.
  - En todas las páginas hubo 0 errores de consola y 0 violaciones de CSP. Se cargaron los chunks de
    Recharts, así que la CSP estricta sí se probó con gráficas.
- **Sin `encode zstd gzip` la performance daba 76-77.** Ese `encode` está sólo en la SPA; en `/api`
  no, por BREACH.

**Para F1-002 (diurna, llega en frío). Lee esto.**
1. **`TRUST_PROXY_SALTOS=1` en la API detrás de Caddy NO es opcional.** Sin él todos los usuarios
   son una sola IP:
   - el login admite 5 intentos/min para el sistema entero;
   - el refresh silencioso (30/min) se agota en hora pico y saca a la gente al login.

   No configures `trusted_proxies` en Caddy sobre el origen público. El default ignora el
   `X-Forwarded-For` del cliente; lo probé con curl: falsificarlo no reinicia el cubo.
2. **HSTS va sin `includeSubDomains` ni `preload`. Decisión abierta para Ricardo:** los dos afectan a
   subdominios de un dominio que todavía no conocemos.
3. **`keepalive 4s` en el `reverse_proxy`:** vi UN 502 en `/api/auth/refresh`. Mi explicación:
   Node cierra a los 5 s las conexiones ociosas y Caddy las reusa hasta 2 min. El A/B de 24 intentos
   por lado NO lo reprodujo: es una mitigación estándar, **no una corrección demostrada**. Si en
   producción aparecen 502 esporádicos, empieza por ahí.
4. El snippet ya reescribe `Path=/auth` → `Path=/api/auth` en la cookie (verificado con curl).
5. **Los assets que no existen dan 404**, las rutas de la SPA dan `index.html`. OJO: `try_files` NO
   acepta matcher (toma `@x` como nombre de archivo). Por eso quedó `@rutaSpa { not path /assets/*;
   not file }` + `rewrite`.

**Trampas que encontré.**
- **Git Bash convierte `/` y `/ruta` en `C:/Program Files/Git/...`** al pasarlos como argumento a
  node. Usa `MSYS_NO_PATHCONV=1`.
- **Lighthouse con `--extra-headers='{json}'` y `shell:true` en Windows pierde el JSON.** Pásale un
  archivo.
- **chrome-launcher truena al final en Windows** (no puede borrar su temporal), pero el JSON ya quedó
  escrito.
- **El refresh rota la cookie:** usa una cookie nueva por corrida de Lighthouse, y ojo con el límite
  de 5 logins/min.
- Caddy no está instalado: bajé el binario oficial v2.11.4 al scratchpad con `gh release download`
  (curl falla por la revocación de schannel) y verifiqué el checksum. **No entra al repo.**
- La prueba manual no dejó filas nuevas: la API local corrió con secretos JWT sintéticos por entorno.

**Qué quedó abierto.**
- Medir Lighthouse en el VPS real (F1-002/F1-091).
- La decisión de HSTS (punto 2 de arriba).
- `/docs` (Swagger) detrás de Caddy no se probó; la CSP no le aplica, porque está sólo en `spa`.
- Del revisor, no obligatoria: en `/api/*`, Caddy deja `Referrer-Policy` en
  `strict-origin-when-cross-origin` en vez del `no-referrer` de la API. Es a propósito y está
  comentado.

### Cierre tras la reapertura (2026-09-21, tarde)
**El "Estado" de arriba ya no aplica.** Dice que el cierre depende del CI y que la tarea se saltaría:
eso era antes de que se arreglara la facturación. Esta entrada lleva hora 11:58 y va DESPUÉS de la
de las 12:10 (la "REABIERTA") sólo por el rebase; no es un duplicado.

- **Checks locales tras el rebase sobre 8fcb504:**
  - /api: lint limpio, typecheck limpio, jest **651/651** (28 suites), 0 skips.
  - /web: build limpio, lint limpio, vitest **302/302** (24 archivos), 0 skips; `check:bundle`
    210.6 kB gzip.
  - /infra: `docker compose config` OK.
- **Revisor del entregable (tras el rebase): APROBADO CON OBSERVACIONES**, sin bloqueo. La única
  obligatoria era esta sección. El número de PR lo da `gh pr create`; es uno nuevo, no el #23.
- **"Listo cuando"** (revisión cruzada sin hallazgos críticos abiertos) se da por cumplido **sobre el
  alcance literal de la ficha**: headers, rate limits, bundle, Lighthouse, formatos, marca, 404 y
  login. Lo de abajo NO estaba en la ficha y no se hizo, para no meter nada "de pasada".

**⚠️ Pendientes que otras sesiones anotaron "para F1-092" y que F1-092 NO resolvió.** Esta era la
última tarea de la cola: si nadie los recoge aquí, quedan apuntando a una tarea cerrada. Son
**decisión abierta para Ricardo** (convertirlos en tareas o descartarlos):
1. **RIESGO DE SEGURIDAD — no hay logout ni revocación** (log, líneas ~265-290 y ~844). "Salir" sólo
   limpia el cliente; la cookie de refresh sigue valiendo hasta 7 días. En una PC compartida,
   `fetch('/api/auth/refresh',{method:'POST'})` desde la consola entra como el usuario anterior. Hace
   falta `POST /auth/logout` que borre la cookie y, mejor, revoque (tabla de sesiones o versión de
   token). Relacionado: un usuario desactivado sigue entrando a rutas de datos hasta que vence su
   access (15 min); rotar el refresh no invalida el anterior. **Es lo primero que yo haría.**
2. Sin límite de fallos por IP en login más allá del cubo de 5/min; el reset de contraseña por admin
   no tiene throttle propio (línea ~1423).
3. Exportar CSV (líneas ~1021-1026): "Hoy" en hora pico aborta seguido; folios con ceros a la
   izquierda se pierden en Excel; `aCentavos(x) ?? 0n` muestra $0.00 sin aviso
   (`inicio/Tarjetas.tsx`, `inicio/puntosHora.ts`); la anti-inyección sólo mira el primer carácter;
   cancelados listados en Tickets (decisión de producto).
4. Inicio vs Monitor (líneas ~1244-1245, ~1332): "Venta en vivo" suma sucursales desconectadas y el
   Monitor no; el KPI "Última lectura" con "Todas" muestra la más vieja.
5. Accesibilidad del modal de consumo: `aria-label` sólo con el nombre del producto (línea ~1331).
6. El badge de agentes re-renderiza el sidebar cada 5 s para admins (línea ~1510).
7. Menores anteriores: regla de lint de Prisma brincable con `require`/subrutas (línea ~282);
   `statement_timeout` en nuestra base (línea ~736); tope de 5 MB también en `/auth/login`
   (línea ~561); 390 px sin medir en navegador (línea ~891).

**Comentarios de código que quedan desactualizados** (no se tocaron, sería "de pasada"):
`web/src/auth/marcaCierre.ts:5,9` y `web/src/api/cliente.ts` (~73) dicen "logout (F1-092)", y
`web/src/paginas/tickets/exportar.ts:35` dice "anotado para F1-092". Quien haga el logout, que los
corrija.

**Otra decisión abierta para Ricardo** (del revisor, no nueva de este diff): el nombre del producto
"Monitor SoftRestaurant" usa la marca de un tercero; el logo sí es propio. Va junto a la de HSTS.

**Estado de la cola al cerrar:** con F1-092 `[x]` no queda nada en la Cola nocturna. La siguiente
sesión debe crear `COLA_VACIA.txt` y terminar, salvo que Ricardo agregue tareas (p. ej. el logout).

## 2026-09-21 12:09 — F1-093 · Logout y revocación de refresh tokens
**Estado:** CERRADA si el PR se mergea (el número lo da `gh pr create`). Plan: APROBADO CON
OBSERVACIONES (sin bloqueo). Entregable: ver "Revisor del entregable" al final.

**Qué quedó hecho.**
- **`POST /auth/logout`** (`api/src/auth/auth.controller.ts`):
  - `@Public()`: lo que identifica la sesión es la cookie de refresh, que sólo viaja a `/auth`, y
    el access puede haber vencido.
  - Responde 204 y **siempre** borra la cookie, con los mismos atributos con que se puso.
  - Idempotente: sin cookie, con basura, con un access en la cookie o con una sesión ya revocada,
    también 204.
  - Throttle: el cubo `refresh` (30/min por IP, con su propio contador de ruta).
  - OpenAPI regenerado.
- **Tabla `sesiones_usuario`** (migración `20260921120000_sesiones_usuario`): una fila por login.
  - El refresh lleva un claim `sid` con el id de la fila, y **lo conserva al rotar**.
  - El logout pone `revocada_en`. Con eso mueren el refresh vigente y todos los anteriores ya
    rotados de esa sesión, y **sólo** los de esa sesión: el mismo usuario sigue dentro en otro
    navegador.
  - `version_sesion` (F1-060) sigue igual y sigue invalidando TODAS las sesiones: cambio o reset de
    contraseña, y baja.
  - El refresh exige las dos cosas: la versión igual y la sesión viva.
- **SPA.** "Salir" pone la marca de localStorage, luego hace `POST /auth/logout` (best-effort, tope
  de 5 s, nunca lanza) y al final limpia el cliente, en ese orden (`web/src/auth/AuthProvider.tsx`).
  El botón se deshabilita mientras sale.
  - Comentarios "logout (F1-092)" de `marcaCierre.ts` y `cliente.ts` corregidos. La marca **se
    queda**: es la red cuando el POST no llega (sin red o pestaña cerrada), porque en ese caso la
    cookie sigue viva.

**Decisiones que tomé y por qué.**
- **Tabla de sesiones, no subir `version_sesion` en el logout.** Subir la versión no cuesta
  esquema, pero "Salir" en la PC sacaría también al celular del dueño. Y en restaurantes donde
  varios encargados comparten una cuenta, cada "Salir" sacaría a todos. La ficha pide revocar "el
  refresh de esa sesión".
- **Un refresh sin `sid` (emitido antes de esta migración) recibe 401.** Ese token no tiene fila que
  el logout pueda revocar, y aceptarlo dejaría sesiones imposibles de cerrar.
  **⚠️ Al desplegar esto, TODOS los usuarios tienen que volver a hacer login una vez.** Hoy no hay
  producción, así que no afecta a nadie. Un `sid` que no es UUID también es 401: si pasara a la
  columna UUID daría 500.
- **`sesiones_usuario.empresa_id` denormalizado** (nulo sólo para admin_global).
  - `LLAVE_EMPRESA` (`scope.helper.ts`) obliga por tipo a registrar todo modelo con `id` o
    `empresaId`. Es el mismo patrón que `AgenteEstado`.
  - FK compuesta `(usuario_id, empresa_id) → usuarios(id, empresa_id)`, llamada
    `sesiones_usuario_usuario_empresa_fkey`, con `ON DELETE CASCADE ON UPDATE CASCADE`. Por eso
    `usuarios` ganó `@@unique([id, empresaId])`.
  - Hoy ningún endpoint cambia `usuarios.empresa_id`. Si algún día lo hace, el `ON UPDATE CASCADE`
    arrastra las sesiones en lugar de fallar.
  - Con `empresa_id` NULL la FK compuesta no aplica (MATCH SIMPLE). Queda la FK simple sobre
    `usuario_id`, también en cascada.
- **Las sesiones se leen FUERA del helper de scope, a propósito.** Es infraestructura de auth, no
  dato de negocio.
  - Sólo `AuthService` las toca (`api/src/auth/auth.service.ts`, que ya estaba en la allowlist de
    Prisma crudo; la allowlist NO creció, sólo su comentario).
  - Siempre por `sid` + `usuario_id` sacados de un JWT firmado por nosotros, o del usuario que se
    acaba de autenticar.
  - El logout y el refresh ponen `usuarioId` en el WHERE. Un `sid` de otro usuario no revoca ni
    refresca nada; hay test con A usando el `sid` de B, que es de otra empresa.
- **Efecto colateral que el revisor debe ver:** `ScopedPrismaService.para(scope)` expone un delegado
  por cada modelo de `Prisma.ModelName`, así que ahora también expone `sesionUsuario` (lecturas y
  `updateMany`, filtrado por `empresa_id` como todos). Nadie lo usa.
  - Quitarlo exigía tocar el tipado del helper de scope, y no era parte de esta tarea.
  - El test `scoped-prisma.service.spec.ts` se adaptó a la lista nueva.
- **Rotar el refresh desliza `expira_en` 7 días**, con UNA sentencia `updateMany` con
  `revocadaEn: null, expiraEn > ahora` y `count !== 1` → 401. Un logout concurrente gana o pierde
  entero.
- **Limpieza.** Cada login borra las sesiones vencidas de ESE usuario, revocadas o no, en la misma
  transacción que crea la nueva. No hay cron; la tabla crece como mucho con las sesiones vivas y las
  revocadas que aún no vencen.

**Lo "relacionado" de la ficha que NO entró (sigue abierto, decisión para Ricardo):**
1. **Rotar no invalida el refresh anterior mientras la sesión vive.** Tras el logout sí mueren
   todos. Invalidarlo al rotar (guardar el `jti` vigente por fila) choca con varias pestañas
   refrescando a la vez con la misma cookie: el single-flight de la SPA es por pestaña, así que la
   segunda recibiría 401 y sacaría al usuario. Necesita una ventana de gracia y detección de reúso.
   Sería una tarea aparte.
2. **Un usuario desactivado sigue entrando a rutas de datos con su access hasta 15 min.** Resolverlo
   pide leer la base en cada request (en el guard global) o una lista de revocación en memoria. No
   es gratis. Si se quiere, que sea tarea propia.

**Trampas que encontré.**
- **`prisma migrate dev` se niega en modo no interactivo** porque agregar un `@@unique` a `usuarios`
  dispara un aviso de confirmación. Ni `--create-only` lo salta. Lo que funcionó:
  1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel
     prisma/schema.prisma --script > .../migration.sql`, con la base local al día.
  2. `npx prisma migrate deploy`.
  3. `npx prisma migrate dev`, que ya dice "Already in sync".

  `--from-migrations` pide una shadow DB y falla por credenciales.
- **Un test de "orden" que pasaba por el motivo equivocado.** Comprobaba, dentro del manejador de
  `/auth/logout`, que el usuario siguiera en el DOM. Con el orden invertido (limpiar y luego POST)
  también pasaba, porque React re-renderiza después. Ahora comprueba `tokenActual() !== null`, y la
  mutación sí lo tumba (probado).
- **El test viejo "refresh de un usuario ya inactivo → 401"** habría pasado sólo porque la sesión no
  existe. Ahora crea una sesión viva en base, para que el 401 salga del usuario inactivo.
- También verifiqué con una mutación que quitar `usuarioId` del WHERE del logout hace fallar el test
  de aislamiento.
- **`npx prettier --write` sobre un glob reescribe archivos que no tocaste** (CRLF → LF): aparecen
  como modificados sin diff real. Antes de commitear, revierte los que `git diff --name-only` no
  lista.
- **`cat > archivo` sin redirección de entrada en un comando de Bash se queda esperando stdin** y el
  comando muere a los 120 s. Me pasó una vez; no dejó rastro en el repo.

**Qué haría distinto.** Revisar desde el plan qué tests existentes firman tokens a mano o dependen de
la lista de modelos (`LLAVE_EMPRESA`, los delegados del helper de scope, el contrato OpenAPI). Los
cuatro que rompieron eran previsibles.

**Revisor del entregable: APROBADO CON OBSERVACIONES**, sin obligatorias. Re-corrió 239/239 de auth,
scope, esquema y administración. Verificó las tres obligatorias del plan y la revisión aparte de
scope: no hay fuga entre empresas. De sus observaciones queda abierta una, **para Ricardo**:
- El delegado `sesionUsuario` del helper de scope permite `updateMany`. Un servicio futuro con scope
  podría tocar `revocadaEn`/`expiraEn` de las sesiones de su propia empresa (sin cruzar empresas).
- Valdría la pena una lista de modelos "de infraestructura" que `para(scope)` no exponga. No se hizo
  aquí: sería "de pasada" y toca el helper de scope.

**Estado de la cola al cerrar:** sigue **F1-094** (pendientes que quedaron "para F1-092", /web).

## 2026-09-21 18:30 — F1-094 · Pendientes que quedaron "para F1-092"
**Estado:** CERRADA si el PR se mergea (el número lo da `gh pr create`). Sólo /web + docs.
Plan: APROBADO CON OBSERVACIONES (5 obligatorias, todas atendidas; ver abajo). Entregable: ver
"Revisor del entregable" al final.

**Qué quedó hecho (los 4 "Listo cuando").**
1. **CSV de Tickets, folio como texto.** `textoExcel()` en `web/src/csv/csv.ts`: escribe
   `="<folio>"`, con las comillas dobladas dos veces (dentro del literal de la fórmula y luego para
   el CSV). Es un literal de cadena: Excel no evalúa nada de adentro, así que la inyección no
   aplica. Con salto de línea o más de 255 caracteres (el límite de Excel para una cadena en
   fórmula) cae a `texto()`, la regla del apóstrofo. Sólo la columna Folio lo usa.
   - **Trade-off:** un programa que lea el CSV sin ser hoja de cálculo ve `="000123"`. LibreOffice
     y Google Sheets lo evalúan igual que Excel.
   - Tests: `web/src/csv/csv.test.ts` (nuevo) compara el campo completo con `toBe`, incluido un
     intento de escape `1" & HYPERLINK("http://x") & "`. Los tests de `tickets/csv.test.ts` y
     `Tickets.test.tsx` que esperaban `1001` o `'-5` en la columna Folio se adaptaron al formato
     nuevo.
2. **Importes inválidos ya no se muestran como $0.00.**
   - `puntosHora.ts`: una hora que viene con un importe ilegible queda como `valor: null` (la línea
     se corta) y "Sin dato". Una hora que falta sigue siendo un cero real. La tarjeta avisa debajo
     de la gráfica (`horas-sin-dato`).
   - `TarjetaFormasPago`: una forma ilegible sale con "Sin dato" y queda fuera del total. Con
     **una sola** ilegible **no hay % ni dona**, porque la base está incompleta (O2 del revisor), y
     aparece una nota (`formas-incompletas`). Si todas son ilegibles se ve "Sin dato" en cada fila,
     no "Sin pagos".
   - El tooltip se prueba directo con `TooltipHora`, sin hover en jsdom.
3. **Inicio y Monitor.**
   - **Regla única:** sólo suman las sucursales **conectadas**. `ventaEnVivo(filas, respuestaAt,
     ahora)` ahora **delega en `armarMonitor`**, así que la cifra es la misma por construcción.
   - Para no crear un ciclo de imports, `importeDe`/`totalDe` (con su `DECISION PROVISIONAL`) se
     movieron de `inicio/ventaEnVivo.ts` a `mesas/mesa.ts`.
   - La tarjeta envejece el dato con `useAhora` **dentro de un subcomponente**
     (`VentaEnVivoCifras`), para que las gráficas de Recharts no se vuelvan a pintar cada 5 s.
     Nombra las desconectadas ("Desconectadas, sin contar: …"). Si ninguna está conectada dice
     "No hay datos en vivo que mostrar.", como el Monitor, sin $0.00.
   - **`useMesasAbiertas` de Inicio pasó de 60 s a 20 s (`POLLING_MS`).** Con 60 s y un umbral de
     90 s, un snapshot sano de ~35 s cruzaría el umbral antes del siguiente refresco y parpadearía
     a "desconectada" cada minuto. Usa la misma llave de query que el Monitor. Cuesta 3 requests
     por minuto en vez de 1.
   - **"Última lectura" cambió de significado** (regla documentada en `Kpis.ultimaLectura`,
     `reglas.ts`). Ahora es la lectura más vieja **de las conectadas**; antes incluía las
     desconectadas. Sin conectadas es `null`. El "dato de hace…" de Inicio es ese mismo valor.
   - Tests adaptados: `reglas.test.ts` y `Mesas.test.tsx` esperaban la lectura de la
     desconectada; ahora esperan la de Centro, y en el caso 90/91 s la frescura es `demorada`.
     El fixture de Inicio pasó de 180 s (que ahora sería desconectada) a 30 s.
   - En el test de "periodo que no incluye hoy" se mantuvo el avance de 60 s (O3): los agregados
     siguen en 1 y el vivo ahora son 4.
   - Tests nuevos:
     - unitario: `ventaEnVivo === armarMonitor` con una desconectada, y la sucursal que envejece
       sola;
     - integración: Inicio y luego Monitor con los mismos datos muestran la misma cifra
       ($1,550.50, con la desconectada fuera); todas desconectadas; y la sucursal que sale sola de
       la suma con reloj falso.
   - `docs/esquema-sr.md` §5 actualizado (O1): la "diferencia conocida" ya no aplica, están la
     regla nueva y dónde vive `totalDe`. **No hay hallazgo nuevo de SR.**
4. **Accesibilidad y rendimiento.**
   - `Detalle.tsx`: el `aria-label` de una partida es `"3 × Refresco, $150.00"`, con el mismo
     formateador y el mismo "Sin dato" que el texto visible. El de un modificador es
     `"Sin hielo, $0.00"`: **el snapshot no trae cantidad por modificador** (supuesto de §5), así
     que para los modificadores el "Listo cuando" se cumple con nombre e importe, sin inventar una
     cantidad. Los tests de `Mesas.test.tsx` usan ahora el nombre completo exacto.
   - Badge de agentes: hook nuevo `useConReloj(calcular)` en `mesas/consultas.ts`, con
     `useSyncExternalStore`. La suscripción es una función de módulo (estable) con un intervalo de
     5 s; el snapshot es `calcular(Date.now())`, un primitivo. React sólo vuelve a pintar cuando el
     valor cambia. `AlertaAgentes` lo usa para el **conteo**.
   - **O5, verificado:** el test nuevo de `Agentes.test.tsx` ("el reloj del badge no vuelve a pintar
     nada…", `<Profiler>` alrededor de `<Rutas/>` en `/cuenta` como admin, con el badge montado a
     700 s) **se corrió primero contra el código viejo y falló con `["update","update","update"]`**:
     un commit por pulso. Con el hook da `[]`.
   - El unitario del hook (`mesas/consultas.test.tsx`) comprueba 0 renders extra en 30 s y
     exactamente 1 al cruzar. Incluye un control con `useAhora` que da 6 renders en 30 s.
- `exportar.ts`: el comentario "anotado para F1-092" ahora dice que el punto ("Hoy" en hora pico
  aborta el export) **sigue abierto** y apunta a este log (entrada F1-092, "Pendientes", punto 3).

**Checks locales (/web):** build limpio, lint limpio, vitest **329/329** (26 archivos, antes
302/24), 0 skips; `check:bundle` 210.9 kB gzip (tope 400). No se tocó /api.

**Decisiones y lo que sigue abierto (para Ricardo).**
- R1 del revisor, a medias: el snapshot de `useConReloj` usa `Date.now()` y no un `ahora` guardado
  en un ref. En dev, React compara dos snapshots seguidos y sólo avisaría si justo entre ellos se
  cruza un umbral, que es un caso rarísimo y sólo de dev. Lo dejé así por simple.
- Con todas las sucursales desconectadas, el Monitor no pinta KPIs y la tarjeta de Inicio no da
  cifra: en ese caso no hay "misma cifra" que comparar, y ninguna de las dos inventa $0.00.
- Siguen abiertos del log de F1-092, sin tocar: anti-inyección más allá del primer carácter,
  cancelados en Tickets, "Hoy" en hora pico, throttles de login y reset, lint de Prisma,
  `statement_timeout`, 390 px. Más las decisiones de HSTS y de la marca, y las dos de F1-093.

**Trampas.**
- **Python con `open()` en modo texto + `newline=''` al escribir convierte CRLF → LF**; git lo
  normaliza al commitear (`autocrlf`), así que el diff queda limpio. Pero `npx prettier --write`
  sobre una CARPETA reescribe archivos que no tocaste: revierte con `git checkout --` los que sólo
  cambian en espacios (me pasó con `SelectorPeriodo.tsx`, `Tarjeta.tsx` y `graficas.tsx`).
- `\r\n` dentro de un heredoc de Python sin `r''` se escribe como un salto de línea REAL en el
  `.ts`, y deja un regex roto. Revisa con `cat -A`.
- En un test de React Testing Library, `tarjeta('X')` (`getByRole`) antes del primer `await`
  truena: la región todavía no existe. Usa `findByRole`.

**Revisor del entregable: APROBADO CON OBSERVACIONES.** Re-corrió vitest 329/329, build y lint.
Revisó a mano las dos capas de escape de `textoExcel` y comparó los asserts viejos con los nuevos:
12 cambiaron, todos por el comportamiento nuevo y ninguno se aflojó. La única obligatoria era esta
sección. De las no obligatorias:
- R1 (snapshot de `useConReloj` con `Date.now()`): queda como está, ver arriba.
- R2: un folio de más de 255 caracteres cae a `texto()` y ahí Excel sí puede convertirlo. Ya quedó
  dicho en el JSDoc.
- R3, **dato para Ricardo:** Inicio pide `/mesas/abiertas` 3 veces más seguido (cada 20 s). Comparte
  la llave de caché con el Monitor, así que no duplica peticiones entre vistas.

**Estado de la cola al cerrar:** con F1-094 `[x]` no queda nada en la Cola nocturna. La siguiente
sesión debe crear `COLA_VACIA.txt` y terminar, salvo que Ricardo agregue tareas.

## 21/09/2026 — Ricardo: arranca la RONDA 2

La Cola nocturna NO está vacía. La entrada anterior decía que no quedaba nada "salvo que
Ricardo agregue tareas": Ricardo las agregó. `backlog.md` tiene una cola nueva, la RONDA 2,
con 45 tareas. No crees `COLA_VACIA.txt`: toma la primera de esa tabla que no esté `[x]`.

**Sobre el "Fuera de alcance" de CLAUDE.md.** Esa línea sigue diciendo que la Fase 2 está
fuera de alcance "salvo tarea explícita". La autorización explícita de Ricardo existe y está
al inicio de `backlog.md`, en el bloque "AUTORIZACIÓN EXPLÍCITA DE RICARDO — 21/09/2026".
Tomar una tarea de la RONDA 2 es cumplir el protocolo, no saltárselo: no te detengas a
preguntar, no la marques SALTADA por este motivo, y no edites CLAUDE.md. La línea de
CLAUDE.md queda pendiente de un PR aparte porque el pre-push no deja ese archivo ir directo
a main, y eso es el hook haciendo su trabajo, no una contradicción.

Antes de construir, lee en backlog.md "Las cuatro reglas de la RONDA 2". Si tomas una
F2-1xx, tu "Listo cuando" es el de la tabla "Cierre nocturno de las tareas heredadas",
no el original.

## 2026-09-21 18:45 — F2-200 · Instalación limpia sin fricción
**Estado:** CERRADA (PR en esta rama, se mergea al terminar el CI)

**Qué quedó hecho.**
- `api/package.json`: `postinstall: prisma generate`, `seed` (= `prisma db seed && npm run
  seed:ventas && npm run seed:mesas`) y `setup:env` (`api/scripts/setup-env.ts`: copia
  `.env.example` → `.env` si no existe; si existe, no lo toca y avisa).
- **`api/src/config/cargar-env.ts` (`cargarEnvLocal`)**, llamado en la primera línea de
  `api/src/main.ts` y al inicio de `main()` de los tres seeds. No estaba en el plan; ver abajo.
- `allowScripts` en el `package.json` raíz (generado con `npm approve-scripts` /
  `npm deny-scripts`): aprueba prisma, @prisma/client, @prisma/engines, @parcel/watcher,
  unrs-resolver fijados a su versión; niega @scarf/scarf (telemetría).
- Tests: `api/scripts/instalacion.spec.ts` (contrato de `package.json`: postinstall, orden
  del seed, setup:env), `api/scripts/setup-env.spec.ts`, `api/src/config/cargar-env.spec.ts`.
  `jest.config.js` y `tsconfig.json` incluyen `scripts/` (el build no: `tsconfig.build.json`
  sólo compila `src/`, `dist/main.js` no se mueve).
- README "Levantar todo en local" reescrito para PowerShell 5.1 (uno por línea, sin `&&`,
  `Set-ExecutionPolicy -Scope Process Bypass -Force`, alternativa `npm.cmd`). Es la **fuente
  única** de la secuencia; `0-INSTALACION.md` tiene la nota de PowerShell en requisitos y una
  sección 8 con el resumen y el enlace.
- `docs/verificacion-arranque.md`: corrida real en clon limpio con PowerShell 5.1, salida
  incluida, desviaciones listadas, secretos tapados. Incluye la corrida fallida y el test de
  contrato en rojo.

**Checks.** /api: lint limpio, typecheck limpio, jest 32 suites / 685 verdes, 0 skips. /web
(cambió el `package.json` raíz): build limpio, lint limpio, bundle 210.9 kB gzip, vitest
329/329 en tres corridas seguidas. **Una primera corrida de vitest dio 1 fallo** mientras la
suite de /api corría en paralelo en la misma máquina; no toqué /web y no pude reproducirlo.
Posible test sensible a carga/tiempo: si vuelve a salir, identificar cuál (no lo vi).

**Decisiones que tomé y por qué.**
- **El backlog se equivocaba en la causa del punto 1.** npm 11.17 NO bloquea los scripts de
  instalación: su propia doc (`npm-approve-scripts.md`) dice que `allowScripts` es consultivo
  "in the current release". El cliente quedaba vacío porque el `postinstall` de
  `@prisma/client` corre con cwd en la **raíz** del monorepo, busca `prisma/schema.prisma`
  ahí, no lo encuentra (vive en `api/prisma/`) y genera el stub (`PrismaClient: any`, 0
  `Decimal`; el bueno tiene 313). El arreglo es el `postinstall` del workspace. `allowScripts`
  se agregó sólo para apagar el aviso y prevenir el día que npm bloquee de verdad. **No
  "arregles" `allowScripts` pensando que era la causa.**
- **`cargarEnvLocal` (desviación del plan, aceptada por el revisor).** La corrida real
  mostró que la API no leía `api/.env` en runtime (`npm run dev` → "JWT_ACCESS_SECRET es
  obligatorio" con el `.env` recién creado) y que `seed:ventas`/`seed:mesas` tampoco
  ("Environment variable not found: DATABASE_URL"). El log ya lo decía desde F1-0xx ("El api
  no carga `.env` solo"); las sesiones anteriores exportaban variables a mano. El cliente de
  Prisma **no** vuelca el `.env` a `process.env` ni resuelve `DATABASE_URL` desde él; sólo la
  CLI (`migrate`, `db seed`) lo carga. Implementación: `util.parseEnv` + asignar sólo lo que
  no existe en el entorno (misma regla que `node --env-file`). No uso `process.loadEnvFile`
  porque jest aísla `process.env` y el test no veía el efecto. En los seeds se carga antes
  del chequeo `NODE_ENV=production`, para que un `NODE_ENV` del `.env` cuente.
  **Riesgo anotado:** un contenedor de producción al que le copien un `api/.env` rellenaría
  las variables que falten. Cuando llegue el compose de producción (F1-002), que no se copie
  `api/.env` a la imagen.
- **`npm audit`: las 3 altas se quedan.** Son una sola: `deepmerge-ts <8`
  (GHSA-ggr8-5vv4-36mx) por `prisma@6.19.3 → @prisma/config@6.19.3 → deepmerge-ts@7.1.5`.
  Evidencia (`npm view`, 21/09/2026):
  ```
  npm view @prisma/config@6 dependencies.deepmerge-ts
    ... @prisma/config@6.17.1 '7.1.5' · 6.18.0 '7.1.5' · 6.19.0..6.19.3 '7.1.5'
  npm view @prisma/config@latest version dependencies.deepmerge-ts
    version = '7.10.0'   dependencies.deepmerge-ts = '7.1.5'
  npm view @prisma/config@8.1.0-dev.7 dependencies.deepmerge-ts
    8.0.2
  ```
  O sea: **ni Prisma 7 lo cierra**; sólo la 8 (en desarrollo). `npm audit fix --force` baja
  prisma a 6.12.0 (rompe). `overrides` a `deepmerge-ts@8.0.2` (global, con alcance
  `@prisma/config`, rango y exacto; con y sin borrar la entrada del lock): npm 11.17 o no lo
  aplica, o **saca la dependencia del lock** y `prisma` truena con `ERR_MODULE_NOT_FOUND`.
  Riesgo bajo: sólo la CLI de Prisma la usa para fusionar su propia config.
- **`prisma.config.ts`: no se migró.** Con archivo de config, Prisma 6 deja de cargar
  `api/.env` y `prisma validate` falla en `getConfig` (probado). Se hace con la subida de
  Prisma, con carga explícita del `.env` en ese archivo.
- La guía usa `npx prisma migrate deploy` (no interactivo); `migrate dev` queda para quien
  crea migraciones. El `seed` agrupado **no** migra: son pasos distintos a propósito.
- Web: sin script `setup:env` propio (fuera de alcance); la guía usa una línea
  `if (-not (Test-Path ...)) { Copy-Item ... }` que no pisa un `.env.local` existente, y es
  opcional (los valores por defecto sirven).

**Trampas que encontré.**
- **Una variable de entorno tapa el bug del `.env`.** Mi primera verificación exportaba
  `DATABASE_URL` hacia una base limpia y el seed "pasaba". La buena edita el `.env` del clon
  para que sea la única fuente. Si verificas arranque, no exportes variables.
- En esta máquina **ya corre otra API de desarrollo en el 3000** (y un vite): usé `PORT=3100`.
- El heredoc de bash del harness se come las `\` en scripts de Python con rutas de Windows:
  escribe el script a un archivo con Write.
- La salida de `powershell.exe` capturada desde bash sale en la página de códigos de la
  consola: pon `[Console]::OutputEncoding = UTF8` al inicio del script.
- `npx prettier --check package.json` avisa en main también (fines de línea del working
  copy); no es nuestro.
- No hay hallazgo de SoftRestaurant: `docs/esquema-sr.md` no se tocó.

**Qué quedó abierto.**
- El error `npm.ps1 ... deshabilitada` no se pudo reproducir (el proceso ya venía en
  Bypass); la guía lo cubre por documentación.
- `npm ci --omit=dev` fallaría en el `postinstall` (prisma es devDependency): anotado en el
  README para cuando exista el Dockerfile de producción.
- `deepmerge-ts`: revisar cuando Prisma estable suba el pin.
- El vitest que falló una vez bajo carga (arriba).

**Qué haría distinto.** Correr la verificación sin variables de entorno desde el principio:
me habría ahorrado una vuelta.

## 2026-09-21 20:05 — F2-201 · Seed maestro: realismo y datos para todos los módulos
**Estado:** CERRADA (PR en esta rama, se mergea al terminar el CI)

> Retomada: una sesión anterior murió por límite de uso tras escribir el plan y
> `seed-maestro/azar.ts` + `catalogos.ts` sin commitear (rama local sin commits). Se
> reusaron, el plan se volvió a pasar por el revisor y se construyó en una rama recreada
> desde main.

**Qué quedó hecho.**
- `api/prisma/seed-ventas.ts`: **90 días, 750 cheques por sucursal** (1500). Productos,
  precios por sucursal, grupos, meseros (nombre + clave), áreas, canales y clientes salen de
  `api/prisma/seed-maestro/catalogos.ts`. Mostrador y domicilio van con `mesa: null`; ~3 %
  de cheques sin área. El producto P008 y los meseros M06/N05 están dados de baja y no
  aparecen desde su día de baja.
- **El día en curso no inventa futuro.** `OpcionesVentas.ahora`: los cheques se generan igual
  (el PRNG avanza lo mismo) y se descarta todo el que CIERRE después de `ahora` (comparación
  por instante, vale para cualquier zona). Como los folios van en orden cronológico, lo
  descartado es la cola: sin huecos, y lo anterior es idéntico con o sin reloj. Un cheque que
  abrió antes de `ahora` pero cierra después **se descarta entero**: el histórico no trae
  cuentas "en curso" (ésas son del seed de mesas). `main()` usa `relojDelSeed()`:
  `SEED_AHORA` si viene, si no el minuto en curso **truncado**. Dos corridas dentro del mismo
  minuto dejan lo mismo; una que cruce de minuto puede sumar los cheques que cerraron en ese
  minuto, y es lo correcto.
- `api/prisma/seed-maestro/` (puro, sin Prisma client; `Prisma.Decimal` para dinero y
  cantidades a 3 decimales): `insumos.ts` (unidades, 6 grupos, 44 insumos, 6 proveedores,
  2 almacenes por sucursal: GEN y BAR), `recetas.ts` (24 de 26 productos; **P020 Refresco y
  P021 Cerveza sin receta a propósito**; costo de receta 20–45 % del precio, el spec lo
  afirma), `inventario.ts` (simulación día por día **contra las ventas**: inicial al máximo,
  compras lunes/jueves hasta el punto medio y cualquier día bajo mínimo, consumo = recetas ×
  ventas + 0–4 % de merma, mermas ocasionales, traspaso quincenal A→B, y un **ajuste de
  conteo físico el último día** que deja un insumo EN CERO y otro BAJO MÍNIMO por almacén;
  existencias = saldo de los movimientos con costo promedio ponderado a centavos),
  `gastos.ts` (renta, nómina, luz, agua, gas, mantenimiento, publicidad), `index.ts`
  (`generarUniverso()` y `resumenPorModulo()`). En `seed-ventas.ts`,
  `universoDe(op, cheques)` arma el universo.
- `npm run seed` imprime el conteo por módulo y la tarea que lo persistirá.
- `/web`: `datosPorHora(filas, horaTope?)` + `useHoraEn(zona)` (en `filtros/useHoy.ts`):
  con el periodo "Hoy" la gráfica termina en la hora en curso; una hora posterior con
  cuentas se conserva (otra zona puede ir adelante). El contenedor lleva
  `data-testid="grafica-por-hora" data-horas=N` para testearlo.
- `seed-mesas.ts`: meseros con los nombres del catálogo (test de que meseros, productos,
  grupos y precios son los del catálogo).

**Decisión central (el revisor la aceptó): el universo NO tiene tablas todavía.** No se
crearon modelos ni migraciones para catálogos/inventario/compras: eso es diseño de F2-230 y
F2-120…F2-126, y adelantarlo pisaría su `origen_sr_id`/hash. El "test por módulo contando
filas" del Listo cuando se mide **sobre el universo generado, no sobre Postgres**
(`seed-maestro.spec.ts`, un `describe` por módulo). La tarea que cree cada tabla
**persiste desde `generarUniverso()`/`universoDe()`** en su `sembrar…()`, y su test cuenta
filas en la base. Quién persiste qué: F2-230 grupos, productos, meseros, clientes · F2-145
precios por sucursal · F2-233 áreas y canales · F2-120 unidades, grupos de insumo, insumos,
almacenes, proveedores · F2-121 existencias · F2-122 pólizas y movimientos (F2-123 conteos,
F2-124 traspasos) · F2-125 recetas · F2-126 compras y gastos. Lo mismo quedó en
`backlog.md` (nota bajo la tabla de heredadas y una línea en F2-230…F2-233).
**`ChequeSeed.maestro`** (meseroClave, area, canal, clienteClave) y
**`PartidaSeed.productoClave` NO se persisten**: `sembrarVentas` los quita antes del
`createMany`. Cuando `cheques` gane esas columnas, se dejan de quitar.

**Otras decisiones.**
- Idempotencia: se mantiene **borrar lo `SEED-%` propio + recrear con ids deterministas** en
  una transacción (patrón de F1-032), aunque el texto dice `upsert`: con fechas relativas a
  hoy, un upsert dejaría cheques huérfanos de corridas de otro día. **Riesgo:** las FK de
  partidas/pagos son `onDelete: Restrict`; en cuanto otra tabla (p. ej. F2-101, códigos de
  facturación) cuelgue una FK de `Cheque`, este borrado truena, y habrá que borrar también
  esa tabla sembrada o cambiar de estrategia.
- Sin `DECISION PROVISIONAL` en el seed: no es un supuesto sobre SR, es invención. En
  `docs/esquema-sr.md` quedó una nota antes de §6 que lo dice. **§6–§10 siguen
  _(pendiente)_** aunque el bloque H del backlog diga que "ya documentan" catálogos: todavía
  no es cierto.
- Mínimo/máximo por almacén × insumo = 2 y 7 días del consumo teórico promedio, redondeados
  hacia arriba a 0.5 (piezas: entero). Insumos sin consumo (refresco y cerveza, que no tienen
  receta): mínimo 2 y máximo 10; sólo se mueven por inicial y mermas.

**Checks.** /api: lint limpio, typecheck limpio, jest **33 suites / 716 verdes / 0 skips**
(~200 s). /web: build limpio, lint limpio, vitest **26 archivos / 333 verdes**, bundle
211.1 kB gzip (tope 400). **`npm run seed` completo: 13.0 s** contra el Postgres local
(1497 cheques a las 19:50 CDMX, 7960 movimientos, 608 compras). Sin cambio de esquema
Prisma, sin endpoints (OpenAPI intacto), sin tocar el agente.

**Tests existentes adaptados (ninguno aflojado; el revisor los verificó uno por uno).**
- `agregados-ventas.service.spec.ts`: el cálculo a mano creaba dos `Intl.DateTimeFormat`
  por llamada y con 1500 cheques pasaba de los 5 s; ahora cachea uno por zona. La referencia
  sigue siendo independiente del SQL. Escenario "30 días" → "90 días completos". El tope de
  300 ms por agregado **no se tocó** y pasa.
- `lectura.e2e.spec.ts`: el prefijo de folio `'12'` ya no caía en el rango (los folios del
  rango ahora son ~500–750); pasó a `'74'` y se añadió que el folio 74 existe y queda fuera.
- `seed-ventas.spec.ts`: conteos 500 → 1500; timeouts de 60 s en los tests que siembran
  1500 cheques (tiempo de ejecución, no aserciones).

**Trampas que encontré.**
- **Jest a 5 s + transacción larga = FK falsa.** El primer rojo fue "Foreign key constraint
  violated" al borrar cheques: el test anterior había vencido a los 5 s con su transacción
  aún viva y el siguiente empezó encima. Si ves ese error en un seed, mira primero el timeout.
- `react-hooks/purity` rechaza `Date.now()` en el render; la hora va en un hook con estado
  (`useHoraEn`), como `useAhora` de mesas.
- Leer `web/.env` (grep, cat) está bloqueado por una regla de permisos: no lo intentes.
- Un heredoc largo de bash con comillas simples sueltas dentro (p. ej. `'74'`) se rompe con
  "unexpected EOF": escribe textos largos con Write/Edit.

**Qué quedó abierto.**
- `main()` genera las ventas dos veces (una dentro de `sembrarVentas`, otra para el
  universo). Barato hoy (~0.7 s); si crece, pasar los cheques.
- El reparto área→canal y las recetas son del seed: cuando F2-240/F2-241 lean SR, lo que diga
  SR manda y el seed se adapta.

**Qué haría distinto.** Correr los tests contra Postgres desde el principio: los timeouts de
5 s sólo se ven ahí.

## 2026-09-21 20:40 — F2-202 · Adaptadores externos e interruptor de modo demo
**Estado:** CERRADA (PR en esta rama, se mergea al terminar el CI). Revisor: plan aprobado con
observaciones; entregable BLOQUEADO una vez (fecha de timbrado en la TZ del proceso) y
aprobado al segundo intento.

**Qué quedó hecho.**
- `api/src/adaptadores/`: tres puertos con falso determinista y real, elegidos por
  `PAC_IMPL` (`falso`|`facturama`), `CORREO_IMPL` (`falso`|`brevo`) y `ARCHIVOS_IMPL`
  (`falso`|`disco`). Sin variable, `falso`. `config.ts` (`leerAdaptadoresConfig`) truena
  con valor desconocido, con credencial faltante de la real elegida (la nombra, nunca su
  valor) y con `NODE_ENV=production` + cualquier `falso` (nombra cada variable).
  `AdaptadoresModule` (global) lo lee en un `useFactory`: la app no se construye.
  Verificado a mano: `NODE_ENV=production node dist/main.js` aborta con
  `PAC_IMPL=falso, CORREO_IMPL=falso, ARCHIVOS_IMPL=falso no se permite con NODE_ENV=production`.
- **Cómo lo consume una tarea de negocio:** `@Inject(PUERTO_TIMBRADO) t: PuertoTimbrado`
  (ídem `PUERTO_CORREO`, `PUERTO_ARCHIVOS`, `ADAPTADORES_CONFIG`; tokens en
  `adaptadores.module.ts`). Nunca importes una implementación.
  `adaptadores.module.spec.ts` prueba que el mismo servicio recibe falso o real sólo por la
  variable.
- **Timbrado** (`timbrado/`): `SolicitudCfdi` en `Prisma.Decimal`, con `zonaHoraria` de la
  sucursal (el CFDI lleva fecha local sin offset). `emitir` devuelve `{uuid, idPac, xml,
  pdf, fechaTimbrado}`; **guarda los dos ids**: Facturama cancela y consulta por su `Id`
  (`idPac`), no por UUID. `cancelar({uuid, idPac, motivo, folioSustitucion?})`,
  `consultarEstado({uuid, idPac})`. Errores: `ErrorTimbrado{codigo, mensaje en español,
  reintentable}`.
  - Falso: UUID v4 = sha256(`referencia`) (mismo cheque, mismo UUID), XML CFDI 4.0 bien
    formado con sellos `SIN-VALIDEZ-FISCAL` y `RfcProvCertif="FALSO"`, PDF 1.4 a mano
    (`pdf-minimo.ts`, sólo ASCII) con "DOCUMENTO NO FISCAL". RFC reservados en
    `RFC_CON_ERROR`: `XEXX010101000` no inscrito, `XFAL010101CP0` CP, `XFAL010101RF0`
    régimen, `XFAL010101PAC` PAC caído (reintentable). `XAXX010101000` SÍ timbra (lo usará
    la global).
  - Real: `TimbradoFacturama` = funciones puras `peticionEmitir/Cancelar/Consultar/
    Descarga` + `ClienteHttp` (fetch, timeout 30 s, Basic auth sólo en cabeceras).
- **Correo** (`correo/`): `enviar(destinatario, plantilla YA renderizada {nombre, asunto,
  html, texto}, adjuntos, {empresaId?})`. Falso: `<tmp>/correos/<id>/correo.json` +
  adjuntos (nombres saneados) y una fila en la tabla nueva `correos_enviados` (migración
  `20260922020738_correos_enviados`; `empresa_id` NULL permitido, índice y FK Restrict).
  Real: `CorreoBrevo` (`POST https://api.brevo.com/v3/smtp/email`, `api-key` en cabecera).
- **Archivos** (`archivos/`): `ArchivosDisco` es la implementación de las dos variantes
  (falso: raíz temporal y secreto fijo `solo-desarrollo-no-usar-…`; disco: raíz absoluta,
  secreto ≥32 y URL base obligatorios). Clave validada (bloquea `..`, absolutas, `\`),
  escritura atómica, `urlFirmada` = `${base}/${clave}?expira=<s>&firma=<HMAC b64url>`, y
  `verificarFirma` exportada para el endpoint de descarga que traerá F2-105 (hoy no hay).
- **Modo demo:** `GET /sistema` público → exactamente `{modoDemo}` (OpenAPI regenerado).
  Web: `web/src/sistema/MarcaDemo.tsx` va en `Proveedores` (cubre login, todas las vistas y
  404): banda ámbar "Datos de ejemplo" no cerrable y título `[Datos de ejemplo] …`. Si
  `/sistema` falla, no hay marca. `AuthProvider` ya no hace `queryClient.clear()` al salir:
  borra mutaciones y todas las queries menos `['sistema']`.
- Tests de contrato en snapshot (`__snapshots__/`): Facturama (emitir, cancelar 02 y 01,
  consultar), Brevo (con y sin adjuntos), URL firmada. **Si un snapshot se mueve es un cambio
  de contrato con un tercero**: revísalo como tal, no lo regeneres a ciegas.

**Decisiones que tomé y por qué.**
- **Marca demo por endpoint, no `VITE_MODO_DEMO`:** una sola variable (`MODO_DEMO`) y la
  API es la que sabe si sus datos son de ejemplo.
- **"Real" de archivos = disco** en el volumen persistente, porque F2-191 habla de volumen
  y respaldo, no de S3.
- **Allowlist de Prisma:** sólo `src/adaptadores/correo/correo-falso.ts` (INSERT en su
  bandeja). El módulo recibe el cliente por el token `BANDEJA_CORREO_FALSO`
  (`useExisting: PrismaService`) definido en ese archivo, para no importar `PrismaService`.
  `restriccion-prisma.spec.ts` tiene casos positivos y negativos. `CorreoEnviado` entró a
  `LLAVE_EMPRESA`; se adaptaron las dos listas exactas de modelos en `scope.helper.spec.ts`
  y `scoped-prisma.service.spec.ts` (modelo nuevo, nada aflojado).
- `DECISION PROVISIONAL (nocturno)` (cabecera de
  `api/src/adaptadores/timbrado/timbrado-facturama.ts`): `TaxStamp.Date` sin zona se lee
  como hora LOCAL de la sucursal (`instanteDesdeLocal` en `cfdi-comun.ts`, no depende de
  la TZ del proceso); `Status` distinto de `active`/`canceled` (o ausente) =
  `ESTADO_DESCONOCIDO` reintentable, nunca "vigente"; red caída/timeout = `PAC_SIN_RESPUESTA`
  reintentable.
- **Supuestos no validados de terceros** (Facturama y Brevo: rutas, campos, mapeo de
  respuesta) marcados en el código; se confirman en F2-190/F2-191 (Diurnas). No son de SR:
  `docs/esquema-sr.md` no se tocó (no hubo hallazgo del POS).

**Trampas que encontré.**
- `prisma migrate dev` falló en el `generate` con `EPERM ... query_engine-windows.dll.node`:
  la API de desarrollo que ya corre en esta máquina tiene el DLL abierto. La migración sí se
  aplicó y los tipos (`index.d.ts`) sí se regeneraron; sólo el rename del DLL falló (misma
  versión, no importa). No mates ese proceso: no es tuyo.
- `new Date('2026-09-21T20:20:05')` se lee en la TZ del PROCESO. El primer entregable lo
  tenía así en `fechaTimbrado` y el revisor lo bloqueó: en el VPS (UTC) quedaba 6 h corrido.
  Setear `process.env.TZ` en runtime sí cambia la zona en Node: así se prueba.
- `queryClient.clear()` NO notifica a los observadores montados: la marca no parpadeaba en
  jsdom aunque la caché se borrara. El test útil verifica la caché, no la pantalla.
- La primera corrida completa de vitest venció a 5 s dos tests viejos (Inicio "pinta
  exactamente lo que devuelven los endpoints" y Reportes "pinta los tres reportes"); aislados
  y en las dos corridas completas siguientes pasaron. Es carga de la máquina (ya anotado en
  F2-200), pero ahora cada test que monta `Proveedores` pide también `GET /sistema` (404 en
  sus API falsas): si vuelven a vencer, sospecha primero de eso.
- `react-refresh/only-export-components`: constantes y hooks van en `sistema.ts`, el
  componente solo en `MarcaDemo.tsx`.

**Qué quedó abierto.**
- **Reintento de `emitir` (F2-104/F2-109):** un `PAC_SIN_RESPUESTA` en emitir es ambiguo (el
  PAC pudo timbrar). Antes de reintentar hay que consultar o usar llave de idempotencia; un
  reintento ciego puede duplicar un CFDI. **Lo mismo al cancelar:** un 200 sin `Status` (o
  con uno pendiente) da `ESTADO_DESCONOCIDO` aunque la cancelación pudo ocurrir; F2-109
  consulta el estado antes de volver a cancelar.
- `instanteDesdeLocal` resuelve sin avisar una hora local inexistente (salto de primavera)
  o repetida (otoño). Caso borde aceptado.
- **El PAC falso no modela extranjeros:** `XEXX010101000` (RFC genérico de extranjeros en el
  SAT real) está reservado como "no inscrito" porque el backlog lo pidió así. F2-107/F2-109
  no deben darlo por probado.
- Estado de cancelaciones del PAC falso **en memoria** del proceso (se pierde al reiniciar;
  `consultarEstado` de un UUID que ese proceso no emitió → `no_encontrado`). El estado fiscal
  nuestro lo persiste F2-109.
- `CorreoFalso` usa `randomUUID()` para el id (el contenido y la fecha sí son deterministas
  con el reloj). Si un test necesita ids fijos, inyectar un generador.
- `verificarFirma` existe pero ningún endpoint la usa: el de descarga es de F2-105.
- `ClienteFetch` no clasifica errores de red (lo hace cada adaptador): `CorreoBrevo` hoy deja
  pasar el error crudo; F2-105 decide su reintento.

**Qué haría distinto.** Probar la lectura de fechas de terceros con `TZ=UTC` desde el
primer test: cualquier `new Date(texto)` sin zona en un adaptador es sospechoso.

## 2026-09-21 21:17 — F2-203 · Deudas visuales y de datos detectadas en la revisión
**Estado:** CERRADA si el PR se mergea (el número lo da `gh pr create`). Revisor: plan APROBADO
CON OBSERVACIONES (sin bloqueo); entregable: ver el final de esta entrada.

**Qué quedó hecho, punto por punto de la ficha.**
1. **Leyenda de formas de pago** (`web/src/paginas/inicio/Tarjetas.tsx`, `formasPago.ts`).
   - **La causa real no era sólo el `truncate`.** La dona se ponía al lado de la lista con
     `sm:flex-row`, o sea según el ancho de la PANTALLA. En la rejilla de 3 y 4 columnas la
     tarjeta mide 220–360 px, y al lado de la dona la lista se quedaba en 84 px a 1280 px
     (de ahí el `E…`/`T…`) y en **0 px a 1024 px**: las letras se apilaban y la página
     desbordaba 34 px.
   - Arreglo: un contenedor `@container` con `@sm:flex-row` (dona al lado sólo si la TARJETA
     mide ≥ 24rem). El nombre va sin `truncate` ni `min-w-0` (`flex-1 whitespace-nowrap`), y
     la fila tiene `flex-wrap`: si no cabe, el importe baja de renglón.
   - Medido en Chrome a 390, 640, 820, 1024, 1280, 1440 y 1920 px: nombre completo en todos,
     ninguno recortado (`scrollWidth <= clientWidth` del span) y sin desborde de página.
   - Tests: `formasPago.test.ts` (etiquetas distintas por par, sin abreviaturas) e
     `Inicio.test.tsx` (4 textos visibles distintos, ninguno con `truncate`).
2. **Pendientes del log (F1-092 "Pendientes" y F1-094), uno por uno:**
   - a. **Anti-inyección CSV** (`web/src/csv/csv.ts`, `PARECE_FORMULA = /^\s*[=+\-@|\t\r\n]/`):
     neutraliza también con blancos iniciales (espacio, U+00A0, U+FEFF, tab) y `|` (DDE).
     `textoExcel` (folios) no cambia y su caída a `texto()` hereda la regla. **CERRADO**, con
     tests en `csv/csv.test.ts`.
   - b. **Cancelados en Tickets: NO se cambió código.** Es decisión de producto, y **F2-222 ya
     la trae** como filtro "canceladas sí/no/sólo". Queda para F2-222.
   - c. **"Hoy" en hora pico abortando el export: CERRADO CON SALVEDAD.** Se agregó un corte
     por RECEPCIÓN a `GET /ventas/tickets`:
     - `corte` opcional (ISO con zona obligatoria; sin zona → 400). Filtra
       `recibido_at <= corte`, donde `recibido_at` = `cheques.created_at`. Es una columna
       nueva y aditiva en las CTEs `ventas`, `cancelados` y `tickets` del helper de scope, sin
       tocar ningún filtro.
     - La respuesta trae siempre `corte`: el pedido, o si no vino, uno SUGERIDO, que es
       "ahora − 30 s" del reloj de POSTGRES. **Sin `corte` no se filtra:** la lista normal ve
       todo.
     - El export (`exportar.ts`) primero hace una llamada de 1 ticket para obtener el corte, y
       luego pide TODAS las páginas (la 1 incluida) con ese corte.
     - **Salvedad (revisor, obligatoria):** el corte sólo congela lo que LLEGA. Un cheque ya
       recibido que cambia de rango o de estado (se cancela, se corrige su fecha, o una cuenta
       abierta que se cierra, si el agente llegara a mandarlas) sigue moviendo el conteo, y el
       export aborta. Está anotado en `docs/esquema-sr.md` §2 como supuesto no validado, con
       `DECISION PROVISIONAL (nocturno)` en `api/src/ventas/tickets.service.ts`. Lo fija el
       e2e "una cuenta abierta que se cierra SÍ mueve el total".
     - **Lo que el export tampoco detecta:** un IMPORTE corregido de un ticket ya bajado,
       porque el conteo no se mueve. Hay un test que lo fija como límite conocido (en
       `exportar.test.ts`). Detectarlo sería alcance nuevo (p. ej. un hash de la página o
       `updated_at <= corte`).
   - d. **Throttles** (`api/src/auth/throttlers.ts`): cubo nuevo `login-hora` (30/h por IP) en
     `/auth/login` y `/cuenta/password`, además del de 5/min; cubo nuevo `reset` (10/min por IP)
     en `POST /usuarios/:id/password`. **CERRADO**, con `throttlers.e2e.spec.ts`.
     - **`SoloThrottlers(...propios)`** reemplaza los `@SkipThrottle` a mano: salta todos los
       cubos de `THROTTLERS` menos los nombrados. **Un cubo nuevo va en `THROTTLERS` y queda
       saltado solo en las demás rutas.** Un test por metadata afirma que cada ruta aplica
       exactamente sus cubos (el agente incluido, que va en la clase).
     - El test del intento 31 "vence" sólo el cubo `login` entre tandas de 5 (pone su contador
       en cero en el storage), sin tocar límites, y atribuye cada 429 por `Retry-After-<cubo>`.
   - e. **Lint de Prisma** (`api/eslint.config.mjs`): subrutas (`@prisma/client/*`,
     `.prisma/client`) en `no-restricted-imports`, y `no-restricted-syntax` para `require()`,
     `import x = require()` e `import()` dinámico de esos módulos y de `prisma.service`.
     **CERRADO**, con casos positivos y negativos en `restriccion-prisma.spec.ts`.
   - f. **`statement_timeout` en nuestra base: CERRADO.** `PrismaService` abre sus conexiones
     con `options=-c statement_timeout=15000` en la URL (`api/src/prisma/url-timeout.ts`).
     - Si la URL ya trae `options`, se combina en el mismo parámetro; si ya fija el timeout, se
       respeta el que trae.
     - **Verificado ANTES de escribirlo:** Prisma 6.19.3 sí pasa `options` al servidor
       (`SHOW statement_timeout` devolvió `1234ms` con un valor de prueba). El test lo vuelve a
       comprobar contra Postgres real: `15s`, y un `pg_sleep(2)` con tope de 200 ms se corta.
     - Los agregados siguen con su `SET LOCAL` de 5 s. `prisma migrate` y los seeds no
       heredan el tope (usan `DATABASE_URL` crudo).
   - g. **390 px: MEDIDO en Chrome real.** Usé un arnés temporal (`web/arnes-390.html` +
     `src/arnes390.tsx`, con `fetch` falso, datos sintéticos de nombres larguísimos y sin
     teclear contraseñas). **Ya está borrado y no está en el commit.** Cada vista se cargó en
     un iframe de 390 px del mismo origen.
     - Todas dan `scrollWidth == clientWidth` (375 = 390 − barra de scroll) y cero elementos
       pasan del borde derecho: login sin sesión, `/`, `/mesas`, el modal de consumo abierto
       (390/390), `/tickets` con una fila expandida, `/reportes`, `/cuenta`, `/admin` en sus
       4 pestañas, la 404 y el menú móvil abierto.
     - **jsdom no mide layout:** de esto no hay test automatizado, sólo esta medida.
3. **Consola UTF-8** (`scripts/nocturno-v2.ps1`): `[Console]::OutputEncoding` y
   `$OutputEncoding` en UTF-8, justo después del `param()`. El script sigue siendo ASCII con BOM.
   - Probado con **PowerShell 5.1.22621** (el que usa el orquestador), leyendo la salida de git
     del commit de F1-093. Antes: consola 850, `revocaci` + `U+251C U+2502` (`├│`, el bug).
     Después: `U+00F3` (`ó`).
   - `Parser::ParseFile` del script da 0 errores.

**Decisiones que tomé y por qué.**
- **Corte por `created_at` y no por `momento`:** el agente puede mandar cheques viejos (cola
  offline); cortar por la hora de cierre dejaría entrar a media descarga un cheque que cerró
  hace una hora y llegó ahora.
- **Corte del reloj de Postgres, no de Node.** Medido: un cheque creado ANTES de tomar un
  `new Date()` en Node quedó con `created_at` 3 ms DESPUÉS. El margen de 30 s es mayor que el
  timeout de 5 s de la transacción de ingesta.
- **30/h cuenta aciertos también** (la librería no distingue fallos). Una oficina detrás de
  una IP tiene 30 inicios de sesión por hora entre todos; con sesiones de 7 días sobra. **El
  límite por CUENTA (no por IP) queda fuera**; sería otra tarea.
- **Hallazgos sobre SoftRestaurant: ninguno nuevo.** Sólo el supuesto de 2c, que se agregó a
  `docs/esquema-sr.md` §2 ("Corte por recepción").

**Trampas que encontré.**
- **`npx prettier --write <carpeta>` reescribió 20 archivos que no toqué** (sólo fines de
  línea). Revertí con: los de `git diff --name-only` que no salen en
  `git diff -w --ignore-cr-at-eol --name-only` → `git checkout --`. **Formatea sólo archivos.**
- `@typescript-eslint/no-require-imports` (del preset) ya marca cualquier `require`; los tests
  negativos de la regla de scope filtran a `no-restricted-imports`/`no-restricted-syntax`.
- La ruta de reset es `/usuarios/:id/password` (controlador `usuarios`), no `/admin/...`.
- Un heredoc con template literals y comillas mezcladas truena en el Bash de esta máquina; los
  scripts de edición largos van mejor a un archivo en el scratchpad.

**Qué quedó abierto.**
- F2-222 decide cancelados sí/no/sólo (2b).
- Export: el cambio de importe de un ticket ya bajado no se detecta (2c).
- Si el agente manda cuentas abiertas, el corte no basta (2c, esquema-sr §2).
- Throttle por cuenta, y el storage en memoria por proceso (con varias réplicas no alcanza,
  como ya decía el log).
- **El CSV deja fuera, sin avisarlo en la pantalla, lo recibido en los 30 s antes de pulsar
  exportar**: su conteo puede no coincidir con el que muestra la lista en ese momento. Hoy sólo
  lo dice el contrato. Mostrarlo en la UI ("recibidos hasta HH:MM:SS") le toca a F2-222, que
  rehace el export de lo filtrado.
- Falta un test que reenvíe un lote por la ingesta y compruebe que `created_at` no se mueve.
  Hoy lo garantiza el tipo `DatosCheque` (no trae `createdAt`) y `sinIntocables`.

**Revisor del entregable.** Hubo un **BLOQUEO (1 de 2 en este gate)**:
- Causa: el e2e "un cheque que llega DESPUÉS del corte…" pasaba de los 5 s por defecto de jest
  en la máquina del revisor. Recorría ~14 páginas de 37 con detalle, más ~200 ms de esperas del
  reloj. Arrastraba a la prueba siguiente con `ECONNRESET`.
- Arreglo, sin tocar ninguna aserción: timeout explícito de 30 s en las pruebas del bloque del
  corte, y `porPagina: 100` (6 páginas).
- Además, un e2e nuevo: con `corte`, otra empresa sigue dando 404.
- `lectura.e2e.spec.ts` corrido dos veces seguidas: 138/138 las dos (22.4 s y 20.6 s). Tras el
  arreglo: lint y typecheck limpios, y jest completo **868/868, 44 suites, 0 skips**. Web:
  build y lint limpios, vitest 369/369, bundle 211.5 kB gzip.
- El revisor aprobó sin objeciones la revisión aparte de 2c (helper de scope aditivo, corte
  opt-in, aislamiento intacto).
- **Segunda pasada: APROBADO CON OBSERVACIONES** (sin bloqueo). El revisor corrió él mismo
  `lectura.e2e.spec.ts` dos veces: 138/138 las dos (20.0 s). Quedó sugerida, no hecha, la
  prueba de reenvío de lote (ver "Qué quedó abierto").

**Qué haría distinto.** Medir la tarjeta en varios anchos ANTES de arreglar la leyenda: el
síntoma era de 1280 px y a 390 px no se veía nada. Y ponerle timeout explícito desde el principio
a todo e2e que recorra páginas.

## 2026-09-21 22:02 — F2-210 · Navegación por secciones tipo centro de control
**Estado:** CERRADA si el PR se mergea. Revisor: plan APROBADO CON OBSERVACIONES (0 bloqueos);
entregable APROBADO CON OBSERVACIONES (0 bloqueos). Sólo /web: sin API, sin OpenAPI, sin
hallazgos de SoftRestaurant (no se tocó `docs/esquema-sr.md`).

**Qué quedó hecho.**
- `web/src/layout/menu.ts` es el **mapa del producto**: `SECCIONES`, con las seis secciones y
  sus entradas en el orden y con los nombres exactos de la ficha. Cada entrada tiene `destino`
  (módulo construido: `{ ruta, tab? }`) **o** `pendiente` (`{ tarea?, razon }`), nunca las dos.
  - Construidas hoy: Inicio `/`, Tickets, Monitor de mesas, Reportes, y en Administración
    Sucursales / Usuarios / Agentes / Empresas → `/admin?tab=...`.
  - Pendientes con tarea: Comparativos F2-140, Resumen F2-220, Análisis F2-221, Productos y
    Orquestador F2-145, Meseros F2-231, Clientes F2-232, Existencias F2-121, Conteos F2-123,
    Recetas F2-125, Proyecciones F2-127, Compras y Gastos F2-126, Traspasos F2-124, Ventas por
    canal F2-144 (la razón menciona F2-233), Facturación F2-100 + F2-106.
- `Sidebar.tsx`: encabezado de sección = botón con `aria-expanded`. Lo colapsado es
  `<ul hidden>` **sin hijos** (sale del orden de Tab). El colapso se recuerda en
  `localStorage` con la clave `monitor.menu.colapsadas.<usuarioId>`; si el storage falla o trae
  basura, el menú sale abierto.
- **Pendiente = `<button aria-disabled="true">`** (no `disabled`, para que siga en el Tab). La
  razón se expone por `aria-describedby`, en el `title` ("Nombre: razón") y debajo al enfocar
  con teclado en el lateral completo y en el cajón móvil. Lleva la etiqueta "Pronto". Clic,
  Enter y Espacio no hacen nada.
- La entrada activa de Administración sigue a `?tab=` (sin tab o con uno desconocido =
  Sucursales, igual que `Administracion.tsx`): `entradaActiva()`.
- El badge de agentes (F1-061) está ahora en la entrada **Agentes**. Con Administración
  colapsada **sube al encabezado** (nunca dos a la vez).
- Rol: el visor no ve la sección Administración. admin_empresa no ve Administración › Empresas.
  Ocultar por permiso sí; ocultar por "no construido", nunca.

**Interpretación de "se colapsa a iconos en pantallas chicas" (anotada como tal):**
- `< md`: cajón con ☰, como antes. Cerrado queda `invisible` y fuera de pantalla.
- `md` a `lg` (768–1023 px): riel de iconos de 64 px. Los textos van `md:hidden`, y el nombre
  accesible sale del `aria-label` de cada control, más `title` a la vista. El riel no tiene
  barra de scroll visible (`scrollbar-width:none`) porque se comía el icono.
- `≥ lg`: lateral completo de 256 px.
- El aside es `md:sticky md:top-0 md:h-screen` con `overflow-y-auto` en todos los anchos: con
  30 entradas ya no cabe a lo alto.

**Decisiones que tomé y por qué.**
- **DECISION ABIERTA (F2-250)** — `SIN_TAREA` son cuatro entradas que ninguna tarea construye:
  - Principal › Empresas y Principal › Sucursales: vistas de consulta. La gestión está en
    Administración.
  - Catálogos › Grupos de insumos e Insumos: F2-120 sólo sincroniza, no pinta vista.
  - Salen deshabilitadas **sin inventarles tarea**. `menu.test.ts` exige que la lista sea
    EXACTAMENTE esa: si alguien agrega una pendiente sin tarea, el test truena. **F2-250 decide
    si llevan tarea nueva o salen del menú.**
- `lucide-react` **1.47.0 fijo** (`--save-exact`), con imports icono por icono. Bundle:
  **211.5 → 218.1 kB gzip** (tope 400). Si un día aprieta, la salida es SVG inline, no subir
  el tope.
- Sin `truncate` en los nombres del menú: "Orquestador de menú" pasa de renglón. Lección de
  F2-203: no recortar etiquetas. Ojo: `sr-only`/`not-sr-only` no sirve para el riel, porque
  `not-sr-only` repone `white-space: normal`. Por eso se usa `md:hidden lg:block` + `aria-label`.
- Texto de las pendientes en `slate-500`, no `slate-400`, que queda bajo 4.5:1 sobre blanco.
  F2-211 hará el test de contraste de verdad.

**REGLA PARA LAS TAREAS SIGUIENTES.** Cuando una tarea construya su módulo, **cambia su
entrada de `pendiente` a `destino` en `menu.ts`**. El test de `Sidebar.test.tsx` monta `Rutas`
en cada destino y falla si cae en "No encontrada", así que primero se agrega la ruta en
`App.tsx`. `menu.test.ts` fija la tarea de cada pendiente: al pasarla a destino, quita su línea.

**Tests.**
- Nuevos: `menu.test.ts` (ficha exacta, destino XOR pendiente, `SIN_TAREA`, tareas por
  entrada, rol, activa por pestaña, storage) y `Sidebar.test.tsx` (AC1–AC4 contra la app real,
  rutas reales, badge).
- Adaptados porque cambió el comportamiento, **sin aflojar**, en `App.test.tsx`:
  - visor: ahora afirma la ausencia del encabezado, de Usuarios/Agentes/Facturación y de
    cualquier href a `/admin`;
  - admin_empresa: afirma la sección y que Sucursales es la activa en `/admin`.
- Web: lint limpio, build limpio, **vitest 393/393** (30 archivos, 0 skips), `check:bundle`
  218.1 kB.

**AC5 (390 px), medido en Chrome real** con un arnés temporal (`web/arnes-390.html` +
`src/arnes390.tsx`, fetch falso, sin contraseñas). **Ya está borrado y no va en el commit.**
Se midió en /cuenta, /tickets y /admin?tab=agentes:
- 390 px: `scrollWidth == clientWidth == 390`, aside `visibility:hidden` con `right=0`, main
  desde x=0 y 390 de ancho.
- 820 px: riel de 64 px, main de 756.
- 1280 px: lateral de 256, main de 1024.
- Cero controles recortados o fuera del aside. La tabla de agentes a 390 desborda dentro de su
  propio `overflow-x-auto` (ya era así).

**Trampas.**
- `npx prettier --check` marca `layout/Layout.tsx` y `layout/Topbar.tsx`: **vienen así de
  main** (verificado con stash), no los toqué. Formatea sólo tus archivos.
- La herramienta de Chrome bloquea la salida de JS que contenga query strings: devuelve
  índices en vez de URLs. Los screenshots con varios iframes a veces se congelan: es mejor
  medir con JS y fotografiar la página sola.
- En Testing Library, `getAllByRole` no acepta un regex como rol: usa `querySelectorAll`.

**Qué quedó abierto.**
- Las cuatro de `SIN_TAREA` → F2-250.
- El título de la página sigue siendo "Monitor de Mesas" (`Mesas.tsx:61`) y el menú dice
  "Monitor de mesas", como la ficha. No se tocó (fuera de alcance); lo alinea F2-223 o F2-250.
- En el riel, quien usa teclado no VE la razón de una pendiente: sólo `title` al pasar el
  cursor, y el lector de pantalla por `aria-describedby`. Pulido para F2-250.
- Hay dos "Sucursales" y dos "Empresas" (Principal = botón pendiente, Administración =
  enlace). Los tests futuros que busquen por nombre tienen que acotar por sección o por rol.

**Qué haría distinto.** Mirar el lateral completo en Chrome antes de dar por buena la clase
del texto: el `not-sr-only` rompiendo el `truncate` no lo ve jsdom.

## 2026-09-21 22:36 — F2-211 · Modo oscuro
**Estado:** CERRADA si el PR se mergea. Revisor: plan APROBADO CON OBSERVACIONES (0 bloqueos,
11 observaciones, todas atendidas); entregable APROBADO CON OBSERVACIONES (0 bloqueos). Sólo
/web: sin API, sin OpenAPI, sin hallazgos de SoftRestaurant (no se tocó `docs/esquema-sr.md`).

**Qué quedó hecho.**
- **`web/src/tema/paleta.ts` es el ÚNICO lugar con colores.** Tokens semánticos con valor
  para `claro` y `oscuro`:
  - superficies: `fondo`, `superficie`, `realce`, `realce-fuerte`;
  - líneas: `linea-suave`, `linea`, `linea-fuerte`;
  - texto: `tinta`, `tinta-medio`, `tinta-suave`, `tinta-tenue`;
  - estados: `peligro|aviso|exito` con `-fondo`, `-borde`, `-fuerte`, más `sobre-peligro` e
    `info`;
  - semáforo: `semaforo-ok|alerta|rojo|sin-dato`;
  - gráficas: `serie-2..4`, `rejilla`; y `velo` para los diálogos.
- **Acento derivado** (`tema/acento.ts`): el relleno `acento` es el de `VITE_COLOR_ACENTO` en
  los dos temas. Por tema se calculan `acento-texto` (≥ 4.5 contra toda superficie),
  `acento-borde` (≥ 3: foco, borde activo y `serie-1`) y `sobre-acento` (blanco o negro). Se
  hace empujando el color 5 % por paso hacia negro o blanco. Así un acento configurado
  cualquiera sigue siendo legible (probado con `#ffff00`, `#111`, `#777`...). Ojo: el acento de
  fábrica `#0f766e` da 4.44:1 sobre `realce-fuerte`, así que en claro `acento-texto` sale un
  pelo más oscuro (`#0e7069`). Es correcto, no un bug.
- **`index.css` no tiene ni un color.**
  - `@theme { --color-*: initial }` apaga la paleta de fábrica de Tailwind: `text-slate-500`
    ya NO genera CSS.
  - `@theme inline` mapea `--color-x: var(--x)`, de donde salen `bg-fondo`, `text-tinta`...
  - `body` hereda `color: var(--tinta)` y `background-color: var(--fondo)`.
  - Todo `::placeholder` usa `tinta-tenue` con opacidad 1: el de fábrica quedaba en ~3.5:1.
- **Cómo se aplica.** `aplicarTema()` (`tema/tema.ts`) pone cada token como `--x` en `:root`
  por CSSOM (`style.setProperty`), más `data-tema` y `color-scheme`. Es compatible con la CSP
  `style-src 'self'`. **No lo cambies** a `setAttribute('style')` ni a un `<style>` inyectado:
  hay un test que lo vigila.
- **El orden de montaje.** `main.tsx` llama `iniciarTema()` antes del primer render.
  `ProveedorTema` va dentro de `AuthProvider` (en `Proveedores` de `App.tsx`) y
  `InterruptorTema` en la `Topbar`: tres botones con `aria-pressed` (Tema claro / Tema oscuro /
  Tema del sistema).
- **Gráficas.** Recharts recibe hex, no `var()`, porque SVG no lee bien `var()` en atributos.
  Los saca de `useTema().colores`, que re-renderiza al cambiar de tema. La dona usa
  `SERIES_FORMA` (`serie-1..4`) en `puntosHora.ts`; `ACENTO` y `COLORES_FORMA` ya no existen.
- **Migración mecánica.** ~290 clases pasaron a tokens con un script. Los casos a mano:
  - el badge rojo del menú usa `sobre-peligro`;
  - `sin-dato` del semáforo usa `border-semaforo-sin-dato`;
  - los `focus:border-acento` pasaron a `acento-borde`.
- **Tabla de Tickets atenuada:** ya no usa `opacity-60`, que bajaba el texto de 4.5:1. Ahora es
  `bg-realce` con `aria-busy`.

**Decisiones que tomé y por qué.**
- **DECISION PROVISIONAL (nocturno)** en `web/src/tema/tema.ts`: la preferencia vive en
  **localStorage, por usuario Y por navegador**. No se sincroniza entre dispositivos.
  - Claves: `monitor.tema.<usuarioId>` y `monitor.tema.ultimo`. La segunda es la que ven el
    login y el arranque.
  - Salir no borra ninguna: por eso el tema sobrevive al logout.
  - Quien entre después en esa máquina sin preferencia propia hereda `ultimo`. Es el mismo
    precedente que `monitor.menu.colapsadas.<id>`.
  - Una columna en `Usuario` metería migración, endpoint y OpenAPI para algo de pura
    presentación. **Ricardo decide** si lo quiere entre dispositivos, y eso sería una tarea de
    /api.
- **La regla de lint es un plugin local** (`web/eslint/sin-colores.mjs`, regla
  `tema/sin-colores`), no `no-restricted-syntax`: esquery no parsea regex con `\w`, `\d` ni
  `\[`.
  - Marca clases de la paleta de Tailwind, hex, `rgb()`/`hsl()`/`oklch()` y
    `var(--color-slate-*)`.
  - Deja pasar `text-[10px]`.
  - Cubre `src/**` salvo `paleta.ts` y los tests.
- **Los tests que corren en Node** (`css.node.test.ts`, `lint.node.test.ts`) se llaman
  `*.node.test.ts` a propósito:
  - `tsconfig.app.json` los excluye y `tsconfig.node.json` los tipa, así los tipos de Node no
    se cuelan al código del navegador;
  - llevan `// @vitest-environment node`;
  - `css.node.test.ts` lee `index.css` del disco porque `?raw` pasa por el plugin de Tailwind.
- El default sin preferencia es **"sistema"**.

**REGLA PARA LAS TAREAS SIGUIENTES.**
- Un color nuevo = un token nuevo en `paleta.ts`, con valor en los DOS temas.
- `index.css` suma su línea `--color-x: var(--x)`; si falta, `css.node.test.ts` truena.
- En `paleta.test.ts`:
  - un color de texto va a `TEXTOS`;
  - una pareja texto-sobre-fondo nueva (insignia, botón) va a `PAREJAS`;
  - un color gráfico va a `GRAFICOS`.
- Nunca `dark:`: el tema cambia los valores, no los componentes.
- En tests, `test/matchMedia.ts` trae `temaDelSistema(true)` para simular el SO en oscuro.

**Tests.**
- Nuevos:
  - `paleta.test.ts` (AC1): cada texto contra las 4 superficies en los dos temas, las
    parejas de insignias y botones, lo gráfico ≥ 3:1, y ΔE ≥ 20 entre los estados del
    semáforo (con `linea` incluida) y entre las series. Con deuteranopia, ΔE ≥ 10.
  - `contraste.test.ts`: la aritmética contra valores de referencia. Encontró un bug real en
    mi conversión a Lab: todos los ΔE salían en ~1.
  - `acento.test.ts`: los derivados con acentos extremos.
  - `css.node.test.ts`: mapeo idéntico a la paleta, sin colores, `body` y `::placeholder`.
  - `lint.node.test.ts` (AC4): la regla con la config REAL del repo; marca 9 casos y deja
    pasar 4.
  - `tema.test.tsx` (AC3): storage roto o con basura, arranque, `matchMedia` ausente, el
    cambio del SO en vivo, que deja de escuchar al desmontar, y el cambio de usuario.
  - `App.test.tsx` (AC2): elegir oscuro, recargar, salir (el login sigue oscuro) y volver a
    entrar.
- Adaptado sin aflojar: `Mesas.test.tsx` pasó de `border-red-600` a `border-semaforo-rojo`.
- Web: lint limpio, build limpio, **vitest 599/599** (35 archivos, 0 skips), bundle
  **218.1 → 219.8 kB gzip**.

**Verificación visual.** En Chrome, con un arnés temporal (`web/arnes-tema.html` +
`src/arnesTema.tsx`, fetch falso, sin contraseñas); **ya está borrado**.
- Vistas: Inicio (gráfica, dona, tarjetas), Mesas (los cuatro bordes del semáforo se
  distinguen) y Admin, en oscuro (por sistema) y en claro.
- Elegir claro y recargar lo conserva.
- A 390 px (iframe): `scrollWidth == clientWidth`, y el interruptor baja a la segunda fila de
  la cabecera.
- No se usó la API local con login: habría que teclear una contraseña en el navegador.

**Trampas.**
- **Git Bash se come las `\` y se atraganta con heredocs largos**: el regex salió como
  `[^w-]`, y dos heredocs dieron "unexpected EOF". Escribe los archivos con la herramienta de
  archivos y los regex con `String.raw`.
- `resize_window` no achica la ventana si está maximizada: mide los 390 px con un iframe del
  mismo origen. Y las capturas con iframes cuelgan el renderer (ya lo decía F2-210): mide con
  JS.
- El 5173 lo tenía ocupado otro proceso: usé `--port 5199`.
- `prettier --check` sin `--end-of-line auto` marca ~80 archivos por CRLF del working copy: no
  es real.

**Qué quedó abierto.**
- **Destello posible al cargar:** con "oscuro" elegido y el SO en claro, puede verse blanco un
  instante mientras baja el JS. La CSP no deja un script inline en `index.html`. Está
  documentado en `tema.ts`. Arreglarlo exigiría un hash en la CSP de Caddy, así que es para
  F2-250 o una Diurna.
- **La regla de lint no detecta colores por nombre** (`fill="red"`,
  `style={{ color: 'white' }}`). Hoy no hay ninguno. Si aparece, se extiende
  `sin-colores.mjs`.
- **`disabled:opacity-50/60`** sigue en los botones deshabilitados (Topbar, Inicio, Login,
  Mesas, Tickets, Reportes). WCAG exime los controles deshabilitados: no es un incumplimiento.
- `<meta name="theme-color">` de `index.html` sigue fijo en el acento. No se toca por tema.
- En el arnés, Admin › Agentes decía "hace NaN días": fueron **mis datos falsos con una forma
  equivocada**, no un bug del panel.

**Qué haría distinto.** Escribir primero los tests de la aritmética de color (contraste, ΔE) y
después la paleta. El bug de Lab hizo fallar los 45 casos de distinción a la vez, y por un
momento pareció que la paleta era mala.
