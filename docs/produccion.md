# Producción (F1-002)

Cómo se levanta el monitor en un VPS con Docker Compose y Caddy, y qué hay que
comprobar allá. Lo que se construyó y probó en local está al final ("Qué se probó y
qué no"). El despliegue automático es F1-003, y los respaldos y el monitoreo son F1-004.

## Qué corre

| Servicio | Imagen | Qué hace |
|---|---|---|
| `postgres` | `postgres:16` | La base del monitor. **No publica puerto**: sólo la alcanza la red del compose. |
| `migrar` | `api/Dockerfile`, etapa `migrar` | `prisma migrate deploy` y termina. La API no arranca si esto falla. |
| `api` | `api/Dockerfile`, etapa `api` | NestJS en `:3000` (interno), `NODE_ENV=production`, usuario `node`. |
| `caddy` | `infra/caddy/Dockerfile` | HTTPS con Let's Encrypt, el panel, la landing y el proxy a la API. |

Archivos: `infra/docker-compose.yml` (el de desarrollo, que define el Postgres) más
`infra/docker-compose.prod.yml` encima. `infra/.env` hace que `docker compose` use los dos.

Volúmenes (todos con el prefijo `monitor-sr_`): `pgdata` (la base), `archivos` (XML y PDF
de las facturas y binarios del agente) y `caddy_data` (certificados). **`pgdata` y
`archivos` los respalda F1-004**. `caddy_data` evita pedir certificados en cada recreación.

## Dominios

Cuatro nombres sobre un solo dominio. Los cuatro necesitan un registro **A** al IP del VPS
**antes** del primer arranque: sin DNS, Let's Encrypt no emite.

| Nombre | Qué sirve |
|---|---|
| `DOMINIO` | La landing (F2-147). De la API **sólo** `/api/publico/*` (el formulario de contacto); el resto de `/api` da 404. |
| `www.DOMINIO` | Redirige a `DOMINIO`. |
| `app.DOMINIO` | El panel (la SPA) con la API en el mismo origen bajo `/api` (la cookie de refresh). |
| `api.DOMINIO` | La API directa, sin prefijo: el `apiUrl` del agente y el `/health` de UptimeRobot. |

**Sólo registros A, no AAAA**, mientras la red de Docker no tenga IPv6. Con un AAAA, las
conexiones IPv6 llegan a Caddy con la IP del gateway de Docker, y todos esos clientes
comparten un solo límite de login (5/min) y de refresh.

El panel en `app.` fija dos variables que el compose ya pone solo: `PANEL_URL` y
`ARCHIVOS_URL_BASE`, y construye la landing con `URL_PANEL=https://app.DOMINIO/login`. Si el
esquema de subdominios cambia, se cambian en el Caddyfile y en el compose a la vez.

## Antes del primer arranque

`NODE_ENV=production` **no arranca** con ningún servicio externo en `falso`
(`api/src/adaptadores/config.ts`). O sea, F1-002 necesita las cuatro cuentas antes de su
primer `up`, aunque conectarlas "de verdad" sea F2-190 y F2-191:

| Variable | Qué pide | De dónde sale |
|---|---|---|
| `PAC_IMPL=facturama` | `FACTURAMA_USUARIO`, `FACTURAMA_PASSWORD` | Cuenta de Facturama. **Sin `FACTURAMA_URL` se timbra contra el sandbox.** |
| `CORREO_IMPL=brevo` | `BREVO_API_KEY`, `CORREO_REMITENTE` | Cuenta de Brevo con el dominio remitente autenticado (SPF, DKIM y DMARC en el DNS, F2-191). |
| `ARCHIVOS_IMPL=disco` | `ARCHIVOS_SECRETO` (32+ caracteres) | Se genera. La ruta y la URL las pone el compose. |
| `PUSH_IMPL=webpush` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` en `/api`, **una sola vez**: rotarlas invalida todas las suscripciones. |

Más `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (distintos, 32+ caracteres),
`POSTGRES_PASSWORD`, `DOMINIO` y `ACME_EMAIL`. Opcionales: `CONTACTO_DESTINO` (sin él, el
formulario de la landing responde 503), `AGENTE_URL_DESCARGA` y `DOCS_USUARIO`/`DOCS_PASSWORD`.
La plantilla completa, con cómo generar cada secreto, es la sección PRODUCCIÓN de
`infra/.env.example`.

**La contraseña de Postgres sólo con letras, números, `-` y `_`**
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`): va dentro de
la URL de conexión, y un base64 trae `/`, `+` y `=`. Además sólo se aplica al **crear** el
volumen: cambiarla después en `infra/.env` no cambia la del Postgres que ya existe.

## Levantar

En el VPS (Docker Engine con Compose **2.24.4 o mayor**, por el `!reset` del override):

```sh
git clone https://github.com/RickCabrera/panel-one.git && cd panel-one/infra
cp .env.example .env        # BORRAR el bloque de desarrollo y llenar la sección PRODUCCIÓN
chmod 600 .env
grep -q '^POSTGRES_PASSWORD=monitor$' .env && echo "ALTO: sigue la contraseña de desarrollo"
docker compose up -d --build
docker compose ps           # api "healthy", migrar "exited (0)"
curl https://api.DOMINIO/health   # {"status":"ok","db":"ok"}
```

Firewall: sólo 22, 80 y 443 (TCP) y 443 (UDP, HTTP/3). Postgres no publica puerto a
propósito: Docker abre los puertos publicados por encima de `ufw`.

**No pegues la salida de `docker compose config`** en un PR, un chat o un log: resuelve el
`env_file` y trae todos los secretos en claro.

**El bloque de desarrollo de `.env.example` trae `POSTGRES_PASSWORD=monitor` sin comentar.**
Si se queda, `${POSTGRES_PASSWORD:?}` no truena y producción arranca con esa contraseña (el
`grep` de arriba lo detecta). Postgres no publica puerto, pero la guardia no sirve de nada.

**Construir las imágenes pide memoria**: el panel se compila con `tsc -b` + Vite dentro de la
imagen. En un VPS chico (1 GB) puede no alcanzar; no se ha medido. Si truena, construir en otra
máquina y cargar las imágenes (eso es F1-003).

## Lista de verificación en el VPS

Es el "Listo cuando" de F1-002 y sus notas "Y además". Lo que ya se vio en local, con curl y
sin Docker, está al final ("Qué se probó y qué no"); **todo** esto se repite en el VPS, y lo
marcado **nunca se ha visto** no se probó en ningún lado.

0. **Nunca se ha visto, las imágenes:** tras el primer `docker compose build`,
   - `docker compose run --rm --no-deps api ls -a /app/api` no lista `.env`;
   - `docker compose run --rm --no-deps api ls /app/node_modules/.prisma/client` trae
     `libquery_engine-linux-musl-openssl-3.0.x.so.node` (o la de arm64);
   - `migrar` sale `exited (0)` (el motor de migraciones lo baja `prisma generate`, con
     `--ignore-scripts` en el `npm ci`);
   - `docker compose port postgres 5432` no devuelve nada.
1. **Nunca se ha visto: en el VPS:** certificado válido de Let's Encrypt en los cuatro nombres (el navegador
   no advierte nada) y `GET https://api.DOMINIO/health` → `{"status":"ok","db":"ok"}`.
2. `docker compose stop postgres` → `/health` responde **503** `{"status":"error","db":"error"}`
   (visto en local) y, en ~90 s, `docker compose ps` marca la API `unhealthy` (**nunca se ha
   visto**). `docker compose start postgres`
   la regresa.
3. En un navegador (en local sólo con curl): login en `https://app.DOMINIO`, recargar la página y seguir dentro (el refresh con la cookie
   `Path=/api/auth; Secure`).
4. DevTools → Network → WS: `/api/socket.io` sale `101 Switching Protocols` (visto con curl) y
   la consola no reporta violaciones de CSP (F2-142; **nunca se ha visto** en un navegador
   detrás de este Caddyfile).
5. `curl -I https://app.DOMINIO/sw.js` → `Cache-Control: no-cache`;
   `curl -I https://app.DOMINIO/manifest.webmanifest` → `Content-Type: application/manifest+json`
   (F2-146).
6. **Nunca se ha visto:** apagar las notificaciones de un navegador en Ajustes (el `DELETE` con
   cuerpo de `/api/cuenta/notificaciones/dispositivos` llega y responde 200). En local sólo se
   vio con curl que el cuerpo llega.
7. `trust proxy`: seis logins malos seguidos, cada uno con un `X-Forwarded-For` inventado
   distinto, dan 429 al sexto (el límite es 5 por minuto; el encabezado falso no lo reinicia).
   **Nunca se ha visto:** desde **otra** red el login sigue entrando (el límite es por IP real,
   no global).
8. **Sólo en el VPS:** Lighthouse de la landing contra el dominio real,
   `npx lighthouse@13.5.0 https://DOMINIO/ --only-categories=performance,accessibility,best-practices,seo`
   (`npm run lighthouse:landing` mide un `vite preview` local, no una URL).
9. `https://DOMINIO/api/auth/login` y `https://DOMINIO/api/docs` → 404; `https://DOMINIO/no-existe`
   → 404; `https://www.DOMINIO/` → 301 a `https://DOMINIO/`.
10. **Nunca se ha visto:** si se definieron `DOCS_USUARIO`/`DOCS_PASSWORD`: `https://api.DOMINIO/docs` pide contraseña y,
    con ella, el Swagger carga (la CSP no aplica en la API).
11. **Nunca se ha visto:** subir un binario del agente (Administración → Agentes) confirma que el
    volumen `archivos` es escribible por la API (`node`).

## Riesgos conocidos

- **Caddy no escribe access log** (no hay directiva `log`), pero **sí** registra en su log de
  errores la URI completa de un request que falló en el proxy (un 502 con la API caída). La
  búsqueda de Clientes viaja en `q`: en una caída puede quedar en `docker compose logs caddy`.
- Un asset inexistente (`/assets/…` que ya no está) responde 404 **con la caché de un año** de
  los assets. Es comportamiento de F1-092; en la práctica un nombre con hash que no existe no
  vuelve a existir.
- `GET /health` es público y sin límite: cada llamada es un `SELECT 1`, y si vence el tope
  de 3 s la consulta sigue ocupando una conexión del pool. Con la base lenta y alguien
  martillando `/health`, el pool se agota. Riesgo bajo; si aparece, un throttle holgado.
- `migrar` corre como root y con las dependencias de desarrollo (necesita el CLI de Prisma),
  y `env_file: .env` también le pasa a la API `POSTGRES_PASSWORD`, `DOMINIO` y `COMPOSE_FILE`.
  Ninguno sale a la red.
- El HSTS va sin `includeSubDomains` ni `preload` (decisión abierta de F1-092).
- `npm run check:landing` rechaza el build de producción: cuenta el `href` absoluto de "Entrar
  al panel" (`https://app.DOMINIO/login`) como "recurso externo", aunque es un enlace y no algo
  que la página cargue. En el CI pasa porque ahí la landing se construye con el `/login` por
  omisión, y la imagen de Caddy no corre ese chequeo. Si se quiere correr contra el build real,
  el chequeo tiene que distinguir un `<a href>` de un recurso (tarea aparte).

## Decisiones abiertas

1. **El primer `admin_global` en producción.** El seed se niega con `NODE_ENV=production` y no
   hay otra vía: sin ese usuario, el panel desplegado no tiene quién entre. Hace falta una tarea
   (un script de alta que no siembre la empresa demo).
2. **Dónde se construyen las imágenes** y de qué arquitectura es el VPS (x86_64 o arm64): cruza
   con F1-003.
3. **De quién son las cuentas** de Facturama, Brevo y el dominio, y quién las da de alta.
4. HSTS `includeSubDomains`/`preload`, pendiente desde F1-092.

## Qué se probó y qué no (26/09/2026)

**Sin Docker**: en la máquina de la prueba Docker Desktop no arranca (WSL no está instalado).
Así que **las imágenes NO se construyeron**, el compose no se levantó y nada de lo que depende
del motor (healthcheck `unhealthy`, permisos del volumen `archivos`, prisma en musl, `init`) se
vio correr. Lo que sí:

- `docker compose config` del de desarrollo solo, y del de producción encima con un `.env` de
  prueba: resuelve el proyecto `monitor-sr`, Postgres sin puertos ni `container_name`, el
  `DATABASE_URL` interno, `PANEL_URL`/`ARCHIVOS_URL_BASE` desde `DOMINIO`, y truena nombrando la
  variable si falta `POSTGRES_PASSWORD`, `DOMINIO` o `ACME_EMAIL`.
- Caddy **2.11.4** (el binario oficial, checksum verificado) valida el `Caddyfile` de producción
  y el `Caddyfile.local`.
- La API **construida** (`node dist/main.js`) con `NODE_ENV=production`, los cuatro puertos en su
  implementación real (credenciales de relleno y los programadores apagados, para que no saliera
  nada a Facturama ni a Brevo) y `TRUST_PROXY_SALTOS=1`, detrás de Caddy corriendo **el mismo
  Caddyfile** con tres cambios de prueba: el host de la API (`127.0.0.1` en vez de `api`), las
  carpetas de los estáticos y los puertos (8081/8443, certificados de la CA local de Caddy, sin
  instalarla en el sistema). Con curl:
  - `api.` y `app./api`: `/health` → 200 `{"status":"ok","db":"ok"}`, sin cabecera `Server`,
    con HSTS, `X-Frame-Options` y `Cache-Control: no-store`. Con el Postgres **apagado de
    verdad** → 503 `{"status":"error","db":"error"}` a los 3 s; al levantarlo, 200 otra vez.
  - Raíz: la landing con la CSP, `/no-existe` y `/login` → 404, `/api/health` y
    `/api/auth/login` → 404, `/api/publico/contacto` llega a la API (400 de validación con
    cuerpo vacío; no se mandó un contacto real para no llamar a Brevo). "Entrar al panel"
    apunta a `https://app.…/login`. `www.` → 301 a la raíz.
  - `app.`: index y rutas de la SPA con CSP y `no-cache`, gzip; `sw.js` con `no-cache`;
    `manifest.webmanifest` como `application/manifest+json`; assets con caché de un año;
    un asset inexistente → 404.
  - Login por `app./api/auth/login` → cookie `Path=/api/auth; HttpOnly; Secure;
    SameSite=Strict`; el refresh con esa cookie → 200.
  - `DELETE /api/cuenta/notificaciones/dispositivos` con cuerpo llega completo (404 de la API
    por endpoint desconocido; sin cuerpo, 400).
  - `/api/socket.io` con upgrade → `101 Switching Protocols`.
  - Seis logins malos con un `X-Forwarded-For` inventado distinto cada uno, tras un login
    bueno en el mismo minuto: `401 401 401 401 429 429`. El quinto malo es el sexto request
    del minuto, así que el límite de 5 se respetó y el encabezado falso no lo reinició.
