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
  cliente de `X-Real-IP` y se la manda a la API como el único `X-Forwarded-For`. Por eso
  `TRUST_PROXY_SALTOS=1` (en Railway es el ÚNICO valor válido): los rate limits del login
  (5/min) y del refresh (30/min) cuentan por cliente, y un `X-Forwarded-For` inventado no los
  salta. Si la API tuviera dominio propio, ese camino no pasaría por Caddy y la cuenta no
  cuadraría.

  > **SUPUESTO / DECISION PROVISIONAL:** que el borde de Railway **pisa** `X-Real-IP` con la
  > IP real del cliente (y un cliente no la puede colar). Sale de una respuesta de staff en
  > station.railway.com, no de la documentación oficial; hay respuestas de staff que la
  > contradicen y un bug reportado con una CDN delante. **Se confirma en el §6** contra el
  > Railway real antes de dar de alta clientes. **No pongas Cloudflare en modo proxy (nube
  > naranja) delante del dominio**: el borde vería la IP de Cloudflare y todos los usuarios
  > compartirían el límite de intentos. DNS de Cloudflare en modo "DNS only" (nube gris) sí.
- **La landing sólo ve `/api/publico/*`.** En el dominio de la landing (`LANDING_HOST`) Caddy
  pasa a la API únicamente `/api/publico/*` (el formulario de contacto); el resto de `/api`
  —login, `/docs`, todo— responde 404 ahí y vive sólo en el dominio del panel.
- **Una réplica por servicio** (`numReplicas: 1`). La API trae programadores internos
  (alertas, reportes, folios, conciliación, push): con dos réplicas cada uno corre dos veces,
  y el socket necesitaría sesiones pegajosas. Escalar es vertical (más CPU/RAM al servicio).
- **Producción nunca corre los seeds de demo** (se niegan con `NODE_ENV=production`). El
  primer `admin_global` lo crea el arranque desde `ADMIN_INICIAL_*`.

Lo que hace el contenedor de la API al arrancar (`api/docker-entrypoint.sh`): valida TODO el
entorno ANTES de tocar la base (obligatorias, rellenos, adaptadores, formato de `PANEL_URL`,
trust proxy, `/docs`, admin inicial: `src/config/validar-arranque.ts`, un solo mensaje con
todos los problemas) → `prisma migrate deploy` → crea el admin inicial si hace falta →
`node dist/main.js`.

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
- **Deploy → Wait for CI:** encendido, para que un push a `main` sólo despliegue con el CI verde.

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
   arranque falla con `PANEL_URL="https://" no es una URL válida.`, y es esperado) y luego de
   `web`. En `web` también: **Deploy → Wait for CI** encendido.

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
así que dejar las variables no es una puerta trasera). Si el email ya es de **otro** usuario no
lo toca ni crea nada: deja en el log `admin-inicial: ERROR: ADMIN_INICIAL_EMAIL ya pertenece a
un usuario (…)` y **el arranque sigue** (la API ya servía; tumbar el deploy por una variable vieja
dejaría a todos los restaurantes sin panel). También existe a mano: `npm run admin:inicial`
dentro del contenedor.

**Caso "se desactivó el último admin_global y las variables siguen puestas":** al siguiente
arranque no hay ningún admin activo, pero el email de `ADMIN_INICIAL_EMAIL` ya existe (es ese
admin desactivado): **no se reactiva ni se le cambia la contraseña**, sólo se registra el error.
Para recuperar el acceso, una de dos: (a) pon en `ADMIN_INICIAL_EMAIL` un email NUEVO y una
`ADMIN_INICIAL_PASSWORD` nueva, redeploya, entra y reactiva al anterior desde el panel; o (b)
reactívalo a mano en la base (`UPDATE usuarios SET activo = true WHERE email = '…'` desde la
consola de Postgres de Railway). Después borra otra vez `ADMIN_INICIAL_PASSWORD`.

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
- **IP por cliente, contra el Railway REAL (confirma el SUPUESTO de `X-Real-IP`).** Desde
  tu máquina, 6 logins fallidos, cada uno con un `X-Real-IP` DISTINTO inventado:

  ```sh
  for i in 1 2 3 4 5 6; do
    curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST https://DOMINIO/api/auth/login \
      -H 'Content-Type: application/json' -H "X-Real-IP: 203.0.113.$i" \
      --data '{"email":"nadie@ejemplo.test","password":"incorrecta-123"}'
  done
  ```

  Lo correcto: del 1 al 5 dan `401` y **el 6.º da `429`** (el borde pisó tu `X-Real-IP` con tu
  IP real: los seis contaron como tuyos). Luego, desde otra red (el celular sin wifi), un login
  normal sigue entrando.
  - **Si los seis dan 401:** el borde NO pisa `X-Real-IP` y cualquiera se salta el límite con
    un header. Mientras se resuelve, quita las dos líneas `trusted_proxies` y
    `client_ip_headers` de `infra/caddy/Caddyfile.railway` y redeploya `web`: el límite queda
    compartido por todos (más estricto, pero no se puede saltar). Y abre la tarea para leer la
    IP de otro header que sí pise el borde.
  - **Si todos (también el celular) reciben 429 juntos:** todos comparten una IP. Revisa
    `TRUST_PROXY_SALTOS=1` en `api` y que NO haya Cloudflare en modo proxy delante.
- **Cuerpo de un DELETE por el proxy:** `DELETE /api/cuenta/notificaciones/dispositivos`
  lleva el endpoint del navegador en el CUERPO; si un proxy lo tirara, desactivar las
  notificaciones (Cuenta → Notificaciones) fallaría con 400. Con el `accessToken` de un login
  (DevTools → Network → respuesta de `/api/auth/login`):

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' -X DELETE \
    https://DOMINIO/api/cuenta/notificaciones/dispositivos \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data '{"endpoint":"https://fcm.googleapis.com/fcm/send/prueba"}'
  ```

  Debe dar **404** (el cuerpo llegó y ese navegador no está registrado), **no 400** (cuerpo
  perdido). El CI lo comprueba igual en `infra/humo-railway.sh`.

Lo mismo, automatizado, corre en el CI (job `docker`, `infra/humo-railway.sh`).

## 7. Conectar el agente de un restaurante

1. **Una vez por despliegue**: en GitHub, la variable del repo `API_URL_PUBLICA=https://DOMINIO/api`
   (con `/api`: el agente entra por el mismo Caddy), y corre el workflow *Instalador del agente*.
   En el servicio **api**, `AGENTE_URL_DESCARGA` con la URL del release `instalador` (ver
   `docs/instalacion-agente.md` › "De dónde sale el paquete").
2. **Por restaurante**: alta de la empresa y la sucursal; en la sucursal, **Conectar sucursal** ›
   código; en la PC del restaurante, descargar el `.zip` del enlace, doble clic en
   `Instalar-YoControlo` y pegar el código. En `config.json` queda
   `"apiUrl": "https://DOMINIO/api"`.
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

Mientras siguen en falso, en producción:

- **PAC:** NO se simula nada. Toda ruta que timbra, cancela o registra un CSD (portal del
  cliente, factura manual, refacturación, global, cancelación, alta de CSD) responde **503 "La
  facturación no está conectada todavía"**, y los programadores no emiten (el puerto truena sin
  inventar CFDI).
- **Correo:** no sale ninguno; quedan en la tabla `correos_enviados`. Eso incluye los reportes
  programados, los avisos de folios y el formulario de la landing: **no hay ningún aviso ni
  recuperación de acceso por correo**; una contraseña olvidada la restablece un admin desde el
  panel.
- **Archivos:** viven en el disco **efímero** del contenedor y **se pierden en cada deploy o
  reinicio** (binarios publicados del agente, XML/PDF).
- **Push:** no sale a la red.

**Condición antes de dar de alta clientes reales:** conectar al menos el correo y los archivos
(y el PAC si van a facturar), o aceptar por escrito esas limitaciones.

`RAILWAY_RUN_UID=0` sólo hace falta con `ARCHIVOS_IMPL=disco` (el volumen se monta como root) y
**tiene costo**: el proceso de la API corre como root dentro del contenedor, así que una falla
explotable en la API tendría permisos de root en él (no en el host). Sin volumen, no lo pongas.

## 9. Respaldos de Postgres

- **Backups de Railway:** servicio `Postgres` → pestaña **Backups** → programa diarios (y
  semanales). Restaurar desde ahí crea el volumen restaurado en el mismo servicio.
- **Copia propia** (además, fuera de Railway): el Postgres NO debe quedar expuesto a internet.
  En `Postgres` → Settings → Networking, **desactiva el TCP Proxy público** y préndelo sólo
  mientras haces la copia. Con él prendido, copia `DATABASE_PUBLIC_URL` y desde tu máquina, con
  un `pg_dump` de la **misma versión mayor** que el servidor (`pg_dump --version`; el plugin de
  Railway hoy es 16: un `pg_dump` más viejo falla y uno más nuevo puede dar un dump que el 16 no
  restaura):

  ```sh
  pg_dump --format=custom --no-owner "$DATABASE_PUBLIC_URL" > yocontrolo-$(date +%F).dump
  ```

  Al terminar, **apaga otra vez el TCP Proxy**. Guarda la copia cifrada: trae las ventas de
  todos los clientes.

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

REGLA DE SECRETOS: tú NO generas, NO escribes, NO lees y NO ves ningún secreto. Ni el
generador de Railway, ni copiar uno de una pantalla a otra. Cuando toque una variable secreta
(JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ADMIN_INICIAL_PASSWORD, DOCS_PASSWORD y cualquier
credencial de PAC/Brevo/VAPID), DETENTE y dime "pega tú el valor de X": yo lo genero en mi
terminal (`openssl rand -base64 48`) y lo pego directo en Railway. No hagas capturas ni leas
el contenido de esos campos después, ni de DATABASE_URL / DATABASE_PUBLIC_URL.

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
   Para JWT_ACCESS_SECRET, JWT_REFRESH_SECRET y ADMIN_INICIAL_PASSWORD: NO las crees tú;
   avísame y espera a que yo las agregue y te diga "listo". Encendido Deploy → Wait for CI.
4. Servicio web: + Create → GitHub Repo → RickCabrera/panel-one (main). Nómbralo "web".
   Settings: Root Directory vacío; Railway Config File = /web/railway.json.
   Variables: API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
   (no definas PORT). Networking → Generate Domain. Dime el dominio que quedó. Encendido
   Deploy → Wait for CI. No pongas Cloudflare ni ningún proxy delante.
5. Deploy: los primeros deploys automáticos de api fallan mientras falten los secretos o el
   dominio del web (PANEL_URL lo referencia): es esperado. Con todo puesto, haz Redeploy
   de api y después de web. Vigila los logs de build y de deploy. En el
   log de api deben aparecer las migraciones aplicadas, "admin-inicial: admin_global …
   creado" y avisos de los puertos en falso. Si el deploy falla con "el entorno de
   producción tiene N problema(s)", léeme la lista (sólo trae nombres de variables) y
   corrijamos.
6. Verifica abriendo https://DOMINIO/api/health (debe decir {"status":"ok","db":"ok"}) y
   https://DOMINIO/login. Yo inicio sesión (tú no escribes la contraseña); después borra
   ADMIN_INICIAL_PASSWORD de las variables de api. La prueba de IP del §6 de la guía
   (6 logins con X-Real-IP distintos) la corro yo desde mi terminal.
7. Postgres → Backups: programa respaldos diarios si el plan lo permite; si no, avísame.
   Postgres → Settings → Networking: confirma que el TCP Proxy público está APAGADO.
8. Resume lo que quedó: servicios, dominio, variables puestas (NOMBRES, sin valores) y
   pendientes.
```
