# Deploy en Railway

Producción multi-cliente de Yo Controlo: **un** proyecto de Railway con tres servicios.

```
navegador / agente ──https──▶ borde de Railway ──▶ web (Caddy: SPA + landing)
                                                     │  /api/* y /api/socket.io
                                                     ▼  (red privada, sin dominio público)
                                                    api (NestJS) ──▶ Postgres (plugin)
```

| Servicio   | Qué es                                  | Config as code      | Dominio público |
| ---------- | --------------------------------------- | ------------------- | --------------- |
| `Postgres` | plugin de Railway                       | —                   | no              |
| `api`      | `api/Dockerfile` (migra y arranca)      | `/api/railway.json` | **no**          |
| `web`      | `web/Dockerfile` (Caddy + estáticos)    | `/web/railway.json` | sí              |

Por qué así:

- **Mismo origen.** El panel y `/api` viven en el MISMO dominio (como con el proxy de Vite en
  local): sin CORS, y la cookie de refresh sigue siendo `HttpOnly; Secure; SameSite=Strict;
  Path=/api/auth`. El socket del tiempo real va por `/api/socket.io` (Caddy sube el WebSocket).
- **La API no tiene dominio público.** Todo entra por el Caddy del `web`, que toma la IP del
  cliente de `X-Real-IP` (la que pisa el borde de Railway) y se la manda a la API como el
  único `X-Forwarded-For`. Por eso `TRUST_PROXY_SALTOS=1`: los rate limits del login (5/min)
  y del refresh (30/min) cuentan por cliente, y un `X-Forwarded-For` inventado no los salta.
  Si la API tuviera dominio propio, ese camino no pasaría por Caddy y la cuenta no cuadraría.
- **Una réplica por servicio** (`numReplicas: 1`). La API trae programadores internos
  (alertas, reportes, folios, conciliación, push): con dos réplicas cada uno corre dos veces,
  y el socket necesitaría sesiones pegajosas. Escalar es vertical (más CPU/RAM al servicio).
- **Producción nunca corre los seeds de demo** (se niegan con `NODE_ENV=production`). El
  primer `admin_global` lo crea el arranque desde `ADMIN_INICIAL_*`.

Lo que hace el contenedor de la API al arrancar (`api/docker-entrypoint.sh`): valida el
entorno (sin secretos de relleno ni obligatorias faltantes, `src/config/produccion.config.ts`)
→ `prisma migrate deploy` → crea el admin inicial si hace falta → `node dist/main.js`.

## 1. Crear el proyecto y Postgres

1. railway.com → **New Project → Deploy from GitHub repo** → `RickCabrera/panel-one`, rama
   `main`. Railway crea un servicio: renómbralo **`api`** (Settings → Service Name).
2. En el proyecto: **+ Create → Database → PostgreSQL**. Déjalo llamarse **`Postgres`**.

## 2. Servicio `api`

Settings del servicio `api`:

- **Source → Root Directory:** vacío (la raíz). Los Dockerfile construyen desde la raíz del
  repo por el lockfile único del monorepo.
- **Config-as-code → Railway Config File:** `/api/railway.json` (ruta absoluta desde la raíz:
  ese archivo trae builder Dockerfile, `dockerfilePath`, healthcheck `/health`, restart
  policy y las rutas que disparan deploy).
- **Networking:** NO generes dominio público. La red privada (`api.railway.internal`) ya viene.

Variables (Variables → **Raw Editor**). Lista comentada completa:
[`infra/railway.env.example`](../infra/railway.env.example). Mínimo:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_ACCESS_SECRET=<generar>
JWT_REFRESH_SECRET=<generar, otro distinto>
PANEL_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
TRUST_PROXY_SALTOS=1
ADMIN_INICIAL_EMAIL=<tu email>
ADMIN_INICIAL_PASSWORD=<generar>
PERMITIR_FALSOS_EN_PRODUCCION=PAC_IMPL,CORREO_IMPL,ARCHIVOS_IMPL,PUSH_IMPL
PAC_IMPL=falso
CORREO_IMPL=falso
ARCHIVOS_IMPL=falso
PUSH_IMPL=falso
```

Los secretos se generan en tu máquina, uno por variable, y se pegan **directo** en Railway
(nunca en un chat, un archivo del repo o un commit):

```sh
openssl rand -base64 48     # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (distintos)
openssl rand -base64 24     # ADMIN_INICIAL_PASSWORD (12–128 caracteres), DOCS_PASSWORD
```

Si algo falta o quedó un valor de relleno (`<generar>`, los de `api/.env.example`), el deploy
falla y el log dice **qué variables** (nunca sus valores).

## 3. Servicio `web`

1. En el proyecto: **+ Create → GitHub Repo → `panel-one`** otra vez. Nómbralo **`web`**.
2. Settings: **Root Directory** vacío; **Railway Config File:** `/web/railway.json`.
3. Variables:

   ```env
   API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
   ```

   (`PORT` lo pone Railway: no lo definas.)
4. **Networking → Generate Domain** (queda `algo.up.railway.app`). Ese es el panel.
5. Redeploy de `api` (su `PANEL_URL` referencia este dominio: antes de generarlo, el
   arranque falla con "PANEL_URL no es una URL válida", y es esperado) y luego de `web`.

Landing pública (opcional): `LANDING_HOST=tu-dominio.mx` y `URL_PANEL=https://panel.tu-dominio.mx/login`
en el `web` (URL_PANEL se lee al construir: redeploy después de ponerla), y agrega ese dominio
también en Networking. Sin `LANDING_HOST` la landing no se sirve.

## 4. Dominio propio

`web` → Settings → Networking → **Custom Domain** → `panel.tu-dominio.mx`. Railway da un
CNAME: créalo en tu DNS y espera el certificado (lo emite Railway). Luego cambia en `api`:
`PANEL_URL=https://panel.tu-dominio.mx` (los enlaces de los correos).

HSTS (1 año, sin `includeSubDomains` ni `preload`) lo manda Caddy en todas las respuestas.

## 5. Admin inicial

Con `ADMIN_INICIAL_EMAIL` y `ADMIN_INICIAL_PASSWORD` puestos, el primer deploy de `api` lo
crea. En el log del deploy: `admin-inicial: admin_global … creado`. Entra al panel con él y
**borra `ADMIN_INICIAL_PASSWORD`** de las variables (mientras siga, el arranque lo avisa).

Es idempotente: si ya hay un `admin_global` activo no hace nada (nunca cambia contraseñas,
así que dejar las variables no es una puerta trasera), y si el email ya es de otro usuario
truena sin tocarlo. También existe a mano: `npm run admin:inicial` dentro del contenedor.

## 6. Verificar

Con `DOMINIO` = el del servicio web:

```sh
curl -s https://DOMINIO/api/health          # {"status":"ok","db":"ok"}
curl -sI https://DOMINIO/ | grep -i -E 'strict-transport|content-security'
```

- **Login:** abre `https://DOMINIO/login` con el admin inicial. Recarga la página: si sigue
  dentro, el refresh (cookie `Path=/api/auth`) funciona.
- **Socket:** en DevTools → Network → WS, debe haber una conexión a `/api/socket.io/…` en
  estado 101 al abrir el monitor de mesas.
- **IP por cliente:** 6 logins fallidos seguidos desde tu red dan 429; desde otra red (el
  celular sin wifi) sigue entrando. Si TODOS reciben 429, revisa `TRUST_PROXY_SALTOS=1`.

Lo mismo, automatizado, corre en el CI (job `docker`, `infra/humo-railway.sh`).

## 7. Conectar el agente de un restaurante

1. En el panel: alta de la empresa y la sucursal; copia la **API key** de la sucursal (se
   muestra una vez).
2. En la PC del restaurante, el instalador del agente pide la dirección del panel: pon
   **`https://DOMINIO/api`** (con `/api`: el agente entra por el mismo Caddy). En
   `config.json` queda `"apiUrl": "https://DOMINIO/api"`.
3. `agente test` debe dar OK en la API (`GET /api/agente/yo`). El rate limit de los agentes
   es por sucursal (120/min), no por IP: varios restaurantes detrás del mismo internet no se
   estorban.

## 8. Conectar los servicios externos (hoy en `falso`)

En el servicio `api`. Por cada uno: pon sus variables, cambia su `*_IMPL`, y **quita su nombre
de `PERMITIR_FALSOS_EN_PRODUCCION`** (cuando quede vacía, bórrala). Cada falso que siga
permitido se avisa en el log de arranque.

| Puerto   | Cambiar a                | Variables                                                                                           |
| -------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| PAC      | `PAC_IMPL=facturama`     | `FACTURAMA_USUARIO`, `FACTURAMA_PASSWORD`, `FACTURAMA_URL=https://api.facturama.mx` (sin ella: sandbox) |
| Correo   | `CORREO_IMPL=brevo`      | `BREVO_API_KEY`, `CORREO_REMITENTE` (verificado en Brevo), `CORREO_REMITENTE_NOMBRE`, `CONTACTO_DESTINO` |
| Archivos | `ARCHIVOS_IMPL=disco`    | Volume en `/datos/archivos` + `RAILWAY_RUN_UID=0`, `ARCHIVOS_RAIZ=/datos/archivos`, `ARCHIVOS_SECRETO` (32+), `ARCHIVOS_URL_BASE=https://DOMINIO/api/archivos` |
| Push     | `PUSH_IMPL=webpush`      | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…` (`npx web-push generate-vapid-keys`, una sola vez) |

Mientras siguen en falso: el PAC no timbra (el panel marca la facturación como simulada), los
correos no salen (quedan en la tabla `correos_enviados`), los archivos viven en el disco
efímero del contenedor (se pierden en cada deploy) y el push no sale a la red.

## 9. Respaldos de Postgres

- **Backups de Railway:** servicio `Postgres` → pestaña **Backups** → programa diarios (y
  semanales). Restaurar desde ahí crea el volumen restaurado en el mismo servicio.
- **Copia propia** (además, fuera de Railway): en `Postgres` → Variables, copia
  `DATABASE_PUBLIC_URL` y desde tu máquina:

  ```sh
  pg_dump --format=custom --no-owner "$DATABASE_PUBLIC_URL" > yocontrolo-$(date +%F).dump
  ```

  Guárdala cifrada: trae las ventas de todos los clientes.

## 10. Rollback

- **Código:** servicio → **Deployments** → el deploy bueno anterior → **Redeploy** (o
  Rollback). La imagen del `web` trae su panel y su landing de ese momento.
- **Migraciones:** un rollback de la API NO deshace migraciones ya aplicadas. Por eso las
  migraciones son aditivas (columnas nuevas nulas o con default, sin borrar ni renombrar en
  el mismo deploy que el código que deja de usarlas). Si una migración rompió datos:
  restaura el backup de Postgres (paso 9) y redeploya la versión anterior.
- **Variables:** cada cambio de variables genera un deploy; para volver, deshaz el cambio en
  Variables.

## Prompt para Claude en Chrome

Pega esto en Claude en Chrome con railway.com abierto y tu sesión iniciada:

```text
Vas a configurar en el dashboard de Railway (railway.com) el deploy de producción del repo
GitHub RickCabrera/panel-one (rama main), siguiendo docs/deploy-railway.md del repo. Trabaja
paso a paso, confírmame antes de cada botón que cree o borre algo, y para al final de cada
sección para que yo revise.

REGLA DE SECRETOS: nunca escribas, generes ni muestres secretos en este chat ni en pantallas
que no sean el campo de la variable en Railway. Cuando una variable sea un secreto
(JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ADMIN_INICIAL_PASSWORD, DOCS_PASSWORD), deja el campo
listo y DETENTE: yo lo genero en mi terminal con `openssl rand -base64 48` y lo pego directo.
Si Railway ofrece su generador de secretos en el editor de variables, puedes usarlo sin
leerme el valor.

1. Proyecto: New Project → Deploy from GitHub repo → RickCabrera/panel-one, rama main.
   Renombra el servicio creado a "api".
2. Postgres: + Create → Database → PostgreSQL. Debe llamarse "Postgres".
3. Servicio api → Settings: Root Directory vacío; Config-as-code / Railway Config File =
   /api/railway.json. Networking: NO generes dominio público.
   Variables (Raw Editor), exactamente:
     NODE_ENV=production
     PORT=3000
     DATABASE_URL=${{Postgres.DATABASE_URL}}
     PANEL_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
     TRUST_PROXY_SALTOS=1
     PERMITIR_FALSOS_EN_PRODUCCION=PAC_IMPL,CORREO_IMPL,ARCHIVOS_IMPL,PUSH_IMPL
     PAC_IMPL=falso
     CORREO_IMPL=falso
     ARCHIVOS_IMPL=falso
     PUSH_IMPL=falso
     ADMIN_INICIAL_EMAIL=(pregúntame cuál)
   y crea vacías para que yo las pegue: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
   ADMIN_INICIAL_PASSWORD. Espera a que te diga "listo" antes de seguir.
4. Servicio web: + Create → GitHub Repo → RickCabrera/panel-one (main). Nómbralo "web".
   Settings: Root Directory vacío; Railway Config File = /web/railway.json.
   Variables: API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
   (no definas PORT). Networking → Generate Domain. Dime el dominio que quedó.
5. Deploy: los primeros deploys automáticos de api fallan mientras falten los secretos o el
   dominio del web (PANEL_URL lo referencia): es esperado. Con todo puesto, haz Redeploy
   de api y después de web. Vigila los logs de build y de deploy. En el
   log de api deben aparecer las migraciones aplicadas, "admin-inicial: admin_global …
   creado" y avisos de los puertos en falso. Si el deploy falla con "el entorno de
   producción tiene N problema(s)", léeme la lista (sólo trae nombres de variables) y
   corrijamos.
6. Verifica abriendo https://DOMINIO/api/health (debe decir {"status":"ok","db":"ok"}) y
   https://DOMINIO/login. Yo inicio sesión; después borra ADMIN_INICIAL_PASSWORD de las
   variables de api.
7. Postgres → Backups: programa respaldos diarios si el plan lo permite; si no, avísame.
8. Resume lo que quedó: servicios, dominio, variables puestas (NOMBRES, sin valores) y
   pendientes.
```
