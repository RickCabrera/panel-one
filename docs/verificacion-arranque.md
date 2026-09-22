# Verificación del arranque en limpio (F2-200)

Corrida **real** de la guía de [`README.md` → *Levantar todo en local*](../README.md#levantar-todo-en-local)
en un clon limpio, con los comandos pegados en **PowerShell 5.1**. No es una reconstrucción:
la salida de abajo es la que imprimió la consola. La capturó un script que ejecuta cada
comando tal cual e imprime `PS> <comando>` antes de su salida y `[exit N - T s]` después.

## Máquina y versiones

| | |
|---|---|
| Fecha | 21/09/2026, 18:29 (-06:00) |
| Sistema | Windows 11 Pro 10.0.22621 |
| PowerShell | 5.1.22621.4249 |
| Node | v24.19.0 |
| npm | **11.17.0** (el CI usa Node 22 / npm 10, donde el aviso `allow-scripts` no existe) |
| git | 2.55.0.windows.5 |
| Postgres | 16, nativo en `localhost:5432`, rol `monitor` con `CREATEDB` |

Antes de empezar, ni `DATABASE_URL` ni `JWT_ACCESS_SECRET` estaban en el entorno (la corrida
lo imprime en su primera sección). Todo lo que la API y los seeds leyeron salió de `api/.env`.

## Qué se apartó de la guía, y qué se tapó

Éstas son **todas** las diferencias con la guía publicada:

1. **`$env:PORT = "3100"`** antes de empezar. En esta máquina el 3000 lo ocupa otra API de
   desarrollo. Una variable de entorno gana sobre `api/.env`, así que la API escuchó en el
   3100.
2. **`api/.env` editado después de `npm run setup:env`** para apuntar a una base **nueva y
   vacía** (`monitor_arranque`) en lugar de la de desarrollo. Se editó el archivo en vez de
   poner una variable de entorno, y fue a propósito: así el `.env` es la única fuente de
   `DATABASE_URL`, que es justo lo que había que probar (ver *La primera corrida*, abajo).
3. `git clone` apunta al repo local, en la rama del PR (`feat/F2-200`), no a la URL de
   GitHub.
4. `npm run dev` se lanzó con `Start-Process` (misma línea de comando) para poder
   consultarlo desde la misma consola, y se detuvo con `taskkill` al final.
5. Dos líneas son **comprobaciones**, no pasos de la guía, y lo dicen entre paréntesis: el
   conteo de `Decimal` en el cliente generado (el cliente vacío da 0) y `npm run typecheck`.

Se tapó con `[REDACTADO]` la contraseña de `DATABASE_URL` y el access token del login (de
éste sólo se imprime la longitud). La contraseña del admin es la de desarrollo que trae
`api/.env.example`. De la salida de Nest se quitaron los códigos de color ANSI, y en el extracto de la primera corrida un separador `·` que la consola decodificó mal se restauró; nada más.

La política de ejecución del proceso ya venía en `Bypass`, porque el script se lanzó con
`powershell -ExecutionPolicy Bypass`. Por eso el error `npm.ps1 ... deshabilitada` **no se
reprodujo aquí**. El paso `Set-ExecutionPolicy` de la guía corre igual y sale con 0.

## La corrida

```text
Corrida: 2026-09-21 18:29:09 -06:00
PowerShell: 5.1.22621.4249
node: v24.19.0
npm: 11.17.0
git: git version 2.55.0.windows.5
Politica de ejecucion (Process) al arrancar: Bypass
DATABASE_URL en el entorno: False - JWT_ACCESS_SECRET en el entorno: False

PS> $env:PORT = "3100"
    (desviacion 1: el 3000 esta ocupado por otra API de desarrollo)

PS> Set-ExecutionPolicy -Scope Process Bypass -Force
    [exit 0 - 0 s]

PS> git clone --branch feat/F2-200 C:\Users\Admin\Desktop\panel-one arranque2
    (en la guia: git clone <url-del-repo>; aqui, el clon local de la rama del PR)
Cloning into 'arranque2'...
done.
    [exit 0 - 0.8 s]

PS> cd arranque2
    [exit 0 - 0 s]

PS> npm ci
npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 897 packages, and audited 900 packages in 59s

178 packages are looking for funding
  run `npm fund` for details

3 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
    [exit 0 - 59.5 s]

PS> (Select-String -Path node_modules\.prisma\client\index.d.ts -Pattern 'Decimal').Count
    (comprobacion, no es de la guia: el cliente generado (el vacio da 0))
313
    [exit 0 - 0.1 s]

PS> cd api
    [exit 0 - 0 s]

PS> npm run typecheck
    (comprobacion del Listo cuando, sin prisma generate a mano)

> @monitor/api@0.0.1 typecheck
> tsc --noEmit -p tsconfig.json

    [exit 0 - 7.5 s]

PS> npm run setup:env

> @monitor/api@0.0.1 setup:env
> ts-node scripts/setup-env.ts

api/.env creado a partir de api/.env.example (valores de relleno para local).
    [exit 0 - 3 s]

PS> npm run setup:env
    (segunda vez: no debe pisar el .env)

> @monitor/api@0.0.1 setup:env
> ts-node scripts/setup-env.ts

api/.env ya existía: no se tocó. Compáralo con api/.env.example si falta algo.
    [exit 0 - 2.3 s]

PS> (Get-Content .env) -replace '/monitor\?schema', '/monitor_arranque?schema' | Set-Content .env; (Select-String -Path .env -Pattern '^DATABASE_URL=').Line -replace '(://[^:]+:)[^@]+@', '$1[REDACTADO]@'
    (desviacion 2: base nueva y vacia en lugar de la de desarrollo. Se edita el .env, no una variable de entorno, para que el archivo sea la unica fuente de DATABASE_URL)
DATABASE_URL=postgresql://monitor:[REDACTADO]@localhost:5432/monitor_arranque?schema=public
    [exit 0 - 0 s]

PS> npx prisma migrate deploy
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config
System.Management.Automation.RemoteException
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "monitor_arranque", schema "public" at "localhost:5432"

PostgreSQL database monitor_arranque created at localhost:5432

7 migrations found in prisma/migrations

Applying migration `20260921023706_esquema_nucleo`
Applying migration `20260921032708_esquema_ventas`
Applying migration `20260921043324_agregados_ventas`
Applying migration `20260921081020_version_sesion`
Applying migration `20260921085338_agente_contacto`
Applying migration `20260921103313_latencia_query`
Applying migration `20260921120000_sesiones_usuario`

┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 8.0.0-rc.15                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
The following migration(s) have been applied:

migrations/
  └─ 20260921023706_esquema_nucleo/
    └─ migration.sql
  └─ 20260921032708_esquema_ventas/
    └─ migration.sql
  └─ 20260921043324_agregados_ventas/
    └─ migration.sql
  └─ 20260921081020_version_sesion/
    └─ migration.sql
  └─ 20260921085338_agente_contacto/
    └─ migration.sql
  └─ 20260921103313_latencia_query/
    └─ migration.sql
  └─ 20260921120000_sesiones_usuario/
    └─ migration.sql
      
All migrations have been successfully applied.
    [exit 0 - 3.9 s]

PS> npm run seed

> @monitor/api@0.0.1 seed
> prisma db seed && npm run seed:ventas && npm run seed:mesas

warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config
System.Management.Automation.RemoteException
Environment variables loaded from .env
Running seed command `ts-node prisma/seed.ts` ...
Seed aplicado: 1 admin global, 1 empresa demo, 2 sucursales.

The seed command has been executed.

> @monitor/api@0.0.1 seed:ventas
> ts-node prisma/seed-ventas.ts

Seed de ventas aplicado: 500 cheques, 1702 partidas, 531 pagos (30 días hasta 2026-09-21).

> @monitor/api@0.0.1 seed:mesas
> ts-node prisma/seed-mesas.ts

Seed de mesas aplicado: 2 snapshots (Sucursal Centro en vivo por 90 s; Sucursal Norte desconectada hace 2 h).
    [exit 0 - 11.2 s]

PS> npm run dev
    (lanzado con Start-Process, misma linea de comando, para poder consultarlo; su salida abajo)
> @monitor/api@0.0.1 dev
> nest start --watch
[6:30:48 p.m.] Starting compilation in watch mode...
[6:30:55 p.m.] Found 0 errors. Watching for file changes.
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [NestFactory] Starting Nest application...
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] PrismaModule dependencies initialized +31ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] RelojModule dependencies initialized +6ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] AuditoriaModule dependencies initialized +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] JwtModule dependencies initialized +9ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] ThrottlerModule dependencies initialized +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] ScopeModule dependencies initialized +5ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] AppModule dependencies initialized +2ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] MesasModule dependencies initialized +2ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] OrganizacionModule dependencies initialized +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] VentasModule dependencies initialized +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] AdministracionModule dependencies initialized +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] IngestaModule dependencies initialized +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] AgentesModule dependencies initialized +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [InstanceLoader] AuthModule dependencies initialized +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] AppController {/}: +78ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/, GET} route +4ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] AuthController {/auth}: +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/auth/login, POST} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/auth/refresh, POST} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/auth/logout, POST} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/auth/me, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] CuentaController {/cuenta}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/cuenta/password, POST} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] SucursalApiKeyController {/sucursales}: +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/sucursales/:id/api-key, POST} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] AgenteController {/agente}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/agente/yo, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] EstadoAgentesController {/agentes}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/agentes/estado, GET} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] IngestaController {/ingesta}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ingesta/eventos, POST} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] VentasController {/ventas}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/resumen, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/por-hora, GET} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/por-dia, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/comparativo-sucursales, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/formas-pago, GET} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/top-productos, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/ventas/tickets, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] MesasController {/mesas}: +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/mesas/abiertas, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] EmpresasController {/empresas}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/empresas, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] SucursalesController {/sucursales}: +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/sucursales, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] EmpresasAdminController {/empresas}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/empresas, POST} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/empresas/:id, PATCH} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] SucursalesAdminController {/sucursales}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/sucursales, POST} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/sucursales/:id, PATCH} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RoutesResolver] UsuariosAdminController {/usuarios}: +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/usuarios, GET} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/usuarios, POST} route +1ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/usuarios/:id, PATCH} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [RouterExplorer] Mapped {/usuarios/:id/password, POST} route +0ms
[Nest] 14732  - 21/09/2026, 6:31:09 p.m.     LOG [NestApplication] Nest application successfully started +59ms

PS> Invoke-RestMethod http://localhost:3100/ | ConvertTo-Json -Compress
{"servicio":"monitor-api","estado":"arriba"}
    [exit 0 - 0 s]

PS> $sesion = Invoke-RestMethod -Method Post -Uri http://localhost:3100/auth/login -ContentType 'application/json' -Body $cuerpo; $global:tok = $sesion.accessToken; "accessToken: [REDACTADO, $($tok.Length) caracteres] - usuario: $($sesion.usuario.email) - rol: $($sesion.usuario.rol)"
    (login con el admin del seed; el token se tapa)
accessToken: [REDACTADO, 259 caracteres] - usuario: admin@monitor.local - rol: admin_global
    [exit 0 - 0.3 s]

PS> Invoke-RestMethod -Uri "http://localhost:3100/ventas/resumen?empresaId=00000000-0000-4000-8000-000000000001&desde=$desde&hasta=$hasta" -Headers @{ Authorization = "Bearer $tok" } | ConvertTo-Json -Compress -Depth 5
    (lectura con datos del seed: resumen de 30 dias de la empresa demo)
{"venta":"388235.39","cuentas":482,"ticketPromedio":"805.47","subtotal":"334685.66","impuestos":"53549.73","propina":"19734.85","descuentos":{"monto":"5030.81","cuentas":42},"cortesias":null,"comensales":{"total":2043,"cuentasConDato":448,"promedioPorComensal":"176.09"},"cancelados":{"cuentas":18}}
    [exit 0 - 0 s]

PS> Invoke-RestMethod -Uri "http://localhost:3100/mesas/abiertas?empresaId=00000000-0000-4000-8000-000000000001" -Headers @{ Authorization = "Bearer $tok" } | ConvertTo-Json -Compress -Depth 2
    (mesas abiertas del seed)
{"value":[{"sucursalId":"00000000-0000-4000-8000-000000000101","nombre":"Sucursal Centro","zonaHoraria":"America/Mexico_City","snapshot":{"capturadoAt":"2026-09-22T00:30:37.962Z","recibidoAt":"2026-09-22T00:30:37.962Z","edadSegundos":32,"edadRecepcionSegundos":32,"mesas":"       "}},{"sucursalId":"00000000-0000-4000-8000-000000000102","nombre":"Sucursal Norte","zonaHoraria":"America/Mexico_City","snapshot":{"capturadoAt":"2026-09-21T22:30:37.962Z","recibidoAt":"2026-09-21T22:30:37.962Z","edadSegundos":7232,"edadRecepcionSegundos":7232,"mesas":" "}}],"Count":2}
    [exit 0 - 0.1 s]

[npm run dev detenido: taskkill /PID 1220 /T /F]
```

Al terminar se borró la base `monitor_arranque`.

## La primera corrida: lo que la guía todavía no resolvía

La primera vez, con `postinstall`, `setup:env` y `seed` ya puestos, la corrida fue igual
salvo por un detalle: `DATABASE_URL` iba como **variable de entorno** hacia
`monitor_arranque`. `npm ci`, `typecheck`, `migrate deploy` y `seed` salieron bien, pero
`npm run dev` no:

```text
PS> npm run dev
    (lanzado en segundo plano con Start-Process para poder consultarlo; salida abajo)
> @monitor/api@0.0.1 dev
> nest start --watch
[6:14:31 p.m.] Starting compilation in watch mode...
[6:14:38 p.m.] Found 0 errors. Watching for file changes.
[Nest] 6248  - 21/09/2026, 6:14:56 p.m.     LOG [NestFactory] Starting Nest application...
stderr: [Nest] 6248  - 21/09/2026, 6:14:56 p.m.   ERROR [ExceptionHandler] Error: JWT_ACCESS_SECRET es obligatorio y debe tener al menos 32 caracteres.
stderr:     at secreto (<scratchpad>\arranque\api\src\config\auth.config.ts:26:11)
[... resto del stack de Nest omitido ...]

PS> Invoke-RestMethod http://localhost:3100/ | ConvertTo-Json -Compress
No es posible conectar con el servidor remoto
    [exit 0 · 4.1 s]
```

`api/.env` existía (lo acababa de crear `setup:env`) y traía `JWT_ACCESS_SECRET`, pero la
API simplemente **no lo leía**: no hay dotenv ni `ConfigModule`, y el cliente de Prisma no
vuelca el `.env` a `process.env`. Al probar aparte `npm run seed:ventas` y `seed:mesas` sin
`DATABASE_URL` en el entorno, salió lo mismo:

```text
PrismaClientInitializationError:
error: Environment variable not found: DATABASE_URL.
25 |   url      = env("DATABASE_URL")
```

La variable de entorno de esa primera corrida **tapaba** este segundo fallo. Por eso la
corrida buena edita el `.env` en lugar de exportar la variable. El arreglo es
`api/src/config/cargar-env.ts` (`cargarEnvLocal`), que se llama en la primera línea de
`api/src/main.ts` y de cada seed.

## El test de contrato, en rojo

`api/scripts/instalacion.spec.ts` se corrió con el `postinstall` quitado de
`api/package.json`, y después se restauró:

```text
FAIL scripts/instalacion.spec.ts
  ● contrato de instalación de /api › npm ci genera el cliente de Prisma: postinstall = prisma generate

    expect(received).toBeDefined()

    Received: undefined

      at Object.<anonymous> (scripts/instalacion.spec.ts:21:33)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total
```
