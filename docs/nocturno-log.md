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
