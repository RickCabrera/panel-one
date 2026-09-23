# PWA y notificaciones push (F2-146)

El panel se instala como app (PWA), abre su armazón sin red y manda avisos push aunque la app
esté cerrada. Este documento es el contrato y la lista de lo que se sabe que falta.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Manifest | `web/public/manifest.webmanifest` | Nombre, `start_url`/`scope` `/`, `display: standalone`, íconos 192/512 y maskable. `index.html` lo enlaza. |
| Íconos | `web/public/iconos/` | PNG generados con `npm run iconos:pwa` (`web/scripts/iconos-pwa.mjs`). |
| Service worker | `web/src/pwa/sw.ts` + `sw-logica.ts` | Compilado por `web/pwa-plugin.ts` a `dist/sw.js` (script clásico, alcance `/`). |
| Registro del SW | `web/src/pwa/registrar.ts` | Sólo en el build (`import.meta.env.PROD`), después de `load`. En `vite dev` no hay SW. |
| Push en el navegador | `web/src/pwa/push.ts` | Suscribir, dar de baja y renovar ESTE navegador. |
| Pantalla | `web/src/paginas/cuenta/Notificaciones.tsx` | Cuenta → Notificaciones: un interruptor por aviso, estado del navegador, botón de prueba. |
| Aviso sin red | `web/src/layout/SinConexion.tsx` | Banda "Sin conexión" en el layout. |
| API | `api/src/notificaciones/` | `/cuenta/notificaciones` (contrato en `api/openapi.json`), envío y programador del resumen. |
| Puerto | `api/src/adaptadores/push/` | `PuertoPush` con `PushWebPush` (real) y `PushFalso` (tests y demo). |
| Revisión del build | `web/scripts/revisar-pwa.mjs` | `npm run build && npm run check:pwa`, también en el CI. |

## El service worker

- **Precache del armazón.** Al instalarse guarda `index.html`, cada archivo del build (JS, CSS,
  chunks perezosos) y los de `public/`. La caché se llama `monitor-armazon-<huella>`. La huella
  sale del contenido del build: otro build da otro `sw.js`, el navegador instala el nuevo y
  éste borra las cachés viejas al activarse.
- **Estrategias.** Una navegación (`mode: navigate`) va a la red y, sin red, recibe el
  `index.html` del precache. `/assets/`, `/iconos/`, el manifest y el favicon se sirven
  cache-first. Todo lo demás, sin tocar.
- **Nunca cachea datos.** `/api/*` y `/socket.io/*` pasan siempre a la red. Una cifra vieja
  servida desde caché sería mentir, y una caché del navegador podría enseñar datos de la
  sesión anterior. Sin red, el layout abre, la banda "Sin conexión" explica por qué, y cada
  vista dice que no pudo leer sus datos.
- **Push.** Muestra el `MensajePush` que manda el api. Si el cuerpo no se puede leer, igual
  muestra un aviso genérico (Chrome exige mostrar uno por push). Al tocarlo abre (o enfoca)
  el panel en la `url` del mensaje, y **sólo rutas del mismo origen**: cualquier otra cosa
  abre `/`.

## Avisos

Cuatro avisos. **Todos opt-in:** sin preferencia guardada, no sale nada. Cada uno se prende y
se apaga por separado, y la preferencia vale para todos los navegadores del usuario.

| Aviso | Columna | Quién puede prenderlo | Cuándo sale |
|---|---|---|---|
| Mesa abierta demasiado tiempo | `mesa_abierta` | Todos | Cuando el centro de alertas (F2-224) abre una alerta `mesa_abierta`, con el umbral de la regla de la empresa. |
| Sucursal sin reportar | `sucursal_sin_reporte` | Todos | Cuando el centro de alertas abre una alerta `sucursal_sin_reporte` (la sucursal desconectada). |
| Saldo de folios bajo | `folios_bajo` | Sólo `admin_global` (se revisa al guardar **y** al enviar) | Cuando el aviso de umbral de folios (F2-110) mandó su correo. |
| Resumen de cierre del día | `cierre_dia` | Todos | A las 07:00 en la zona de cada empresa, con la venta de ayer. |

- **Las alertas dependen también de la regla de la EMPRESA.** Si la regla está apagada en el
  centro de alertas, no se abre la alerta y no hay push, aunque el usuario tenga el aviso
  prendido.
- **Una alerta = un push.** Sólo avisan las alertas que se abren de verdad
  (`TransaccionAlertas.abrir` devuelve las filas nuevas; las que ya estaban abiertas no
  vuelven a avisar). El push sale **después del commit**, fuera del candado de alertas y sin
  esperar a que termine: un servicio de push lento o caído no frena la evaluación.
- **Folios:** el push sale sólo cuando el correo salió. Si el correo falla, el aviso se suelta
  y se reintenta, y mandar el push antes lo repetiría en cada reintento.

## Scope: a quién le llega qué

- Una alerta de la empresa X llega sólo a usuarios **activos** con `empresa_id = X`, o a
  `admin_global`, que tengan ese aviso prendido.
- El resumen se arma **con el scope del destinatario** (`AgregadosVentasService.resumen`): un
  usuario de empresa recibe el de su empresa y un `admin_global`, uno por cada empresa activa.
  Si el destinatario ya no ve la empresa, `resumen()` responde 404 y no sale nada.
- El dispositivo y la preferencia se guardan para el usuario del **token**. Su empresa y su
  versión de sesión salen de la base, nunca del cuerpo. Las tres tablas están en `LLAVE_EMPRESA`
  y sólo `ScopedPrismaService.push(scope)` (`scope/escritura-push.ts`) escribe en ellas.
- Quitar un navegador ajeno o inexistente devuelve el **mismo 404** en los dos casos.
- Registrar un endpoint que ya es de otro usuario (el mismo navegador con otra sesión) lo
  reasigna **sólo si trae las mismas llaves**, y la respuesta es idéntica a la de uno nuevo. La
  reasignación queda en la auditoría. Con otras llaves, 400 y no se toca.

## El navegador muere con la sesión

- `dispositivos_push.version_sesion` guarda la del usuario al registrarlo. Si el usuario la
  sube (cambio o reset de contraseña, baja), ese navegador deja de recibir y se borra en el
  siguiente envío.
- `renovado_at` se actualiza cada vez que el panel abre en ese navegador (`Layout` →
  `renovarEsteDispositivo`). Si pasan 7 días sin renovarse (lo que dura una sesión inactiva,
  `REFRESH_TTL_SEGUNDOS`), no recibe.
- Si el servicio de push contesta 404/410 (suscripción caducada), el navegador se borra. Otra
  falla cuenta como `fallido` y el navegador se queda.
- Tope: 10 navegadores por usuario. Al registrar el onceavo, sale el menos renovado.
- **Anti-SSRF.** El api hace POST a la URL que manda el navegador. Por eso sólo se acepta
  `https`, puerto 443, sin usuario ni IP, de hasta 1 KB, y de un servicio conocido: FCM
  (Chrome/Edge/Android), Mozilla, WNS y Apple, más lo que diga `PUSH_HOSTS_PERMITIDOS`. Se
  valida al guardar y otra vez en `PushWebPush` justo antes de mandar.

## Resumen de cierre: idempotente, best-effort

- El programador (`NOTIFICACIONES_INTERVALO_S`, por defecto 300 s, 0 = apagado y apagado en
  los tests) revisa en cada vuelta qué empresas ya pasaron las 07:00 en su zona. Usa el mismo
  calendario que F2-141 (`reportes/calendario.ts`, `zonaDeEmpresa`).
- Antes de mandar **reclama** `(usuario, empresa, periodo)` en `envios_push_resumen` (único).
  Otra vuelta u otra réplica pierde el reclamo y no lo repite. Vueltas repetidas o simultáneas
  dan exactamente un resumen por día.
- Sin ningún navegador vigente no se reclama: si el usuario abre el panel más tarde ese día,
  todavía le llega.
- **Pérdida conocida.** El reclamo se hace antes de mandar y no guarda estado. Si el envío falla
  después de reclamar, ese día no se reintenta. Es un aviso de cortesía y el correo diario
  (F2-141) sigue siendo el canal confiable.
- **Pérdida conocida.** Los push de alertas se encadenan en memoria. Si el proceso muere antes
  de mandarlos, se pierden (en un apagado normal, `onModuleDestroy` los espera). La alerta sí
  queda en el centro de alertas.
- Empresa sin ventas ayer: el aviso dice que no llegaron cuentas y qué revisar. **Nunca
  "$0.00"** (regla de estados vacíos de la Ronda 2).

> **DECISION PROVISIONAL (nocturno):** el resumen de cierre lleva la venta, el número de cuentas
> y el ticket promedio en el cuerpo del aviso, y eso se ve en la pantalla bloqueada del
> teléfono. Las alertas no llevan cifras (sólo mesa, minutos y sucursal). Si Ricardo prefiere
> que el resumen tampoco muestre montos, basta con cambiar `mensajeCierreDia` en
> `api/src/notificaciones/mensajes.ts`.

## Límites conocidos (para F2-250)

- **El resumen es por empresa y no dice si faltó una sucursal.** Si una sucursal no mandó
  cuentas ayer, el total sale más bajo sin avisarlo. Sólo el caso "ninguna cuenta en toda la
  empresa" tiene su texto propio. Agregar "(N sucursales sin cuentas)" es una mejora pendiente.
- **Avalancha para `admin_global`.** Recibe `mesa_abierta` y `sucursal_sin_reporte` de TODAS las
  empresas, y un resumen por cada empresa activa. Con muchos clientes hace falta filtrar por
  empresa o agrupar.
- **La cola de envíos de alertas no tiene tope.** Los push se encadenan en memoria
  (`#pendiente`). Si el servicio de push está lento (timeout de 10 s por envío), se acumulan.
- **`envios_push_resumen` no se purga.** Crece una fila por usuario, empresa y día. Es chica,
  pero falta una purga de lo que tenga más de unos días.
- **El conteo de navegadores de la cuenta** (`dispositivos` en `GET /cuenta/notificaciones`)
  incluye los de una sesión muerta hasta que el siguiente envío los borra. Es cosmético.
- **El throttler de `POST /cuenta/notificaciones/prueba` es por IP**, no por usuario. Detrás de
  Caddy depende de `trust proxy` para ver la IP real (nota en F1-002).
- **`DELETE /cuenta/notificaciones/dispositivos` lleva cuerpo** (`{ endpoint }`). Funciona con
  `fetch` y con Vite. Hay proxies que lo tiran, así que hay que comprobarlo detrás de Caddy
  (F1-002).

## Configuración (`api/.env`)

| Variable | Valor |
|---|---|
| `PUSH_IMPL` | `falso` (default): no sale nada a la red. Los envíos quedan en memoria y, con `PUSH_DIR_FALSO` (o `MODO_DEMO=1`, en `<tmp>/push`), en `<dir>/<día>.jsonl`. `webpush`: push real firmado con VAPID. En `NODE_ENV=production`, `falso` truena el arranque. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Obligatorias con `webpush`. Con `falso` van las tres o ninguna. Si están, el navegador local se puede suscribir para probar la UI y el SW. Se validan: pública de 65 bytes y privada de 32 (base64url), y el sujeto `mailto:` o `https://`. |
| `PUSH_HOSTS_PERMITIDOS` | Hosts extra de servicios de push, separados por coma. `.dominio` acepta subdominios. |
| `NOTIFICACIONES_INTERVALO_S` | Segundos entre vueltas del resumen. |

**Llaves VAPID.** Se generan UNA vez con `npx web-push generate-vapid-keys` en `/api` y **nunca
van al repo**. No se rotan: rotarlas invalida todas las suscripciones y cada navegador tendría
que volver a activar los avisos.

## Cómo se probó (y qué no)

- **api e2e** (`notificaciones.e2e.spec.ts`, sobre `PushFalso`). Cubre la cuenta y los roles,
  el navegador que muere con la sesión, a quién llega cada alerta, y el AC "la sucursal
  desconectada llega sin la app abierta" (el envío sale del servidor cuando el centro de alertas
  abre la alerta, sin ningún cliente conectado). También que cada aviso se apaga por separado y
  que el resumen es idempotente con vueltas simultáneas.
- **Contrato de web-push** (`push.contrato.spec.ts`). Con llaves VAPID generadas en el test
  ("VAPID local") fija la petición exacta que sale al servicio: método, `TTL`, `Urgency`,
  `Content-Encoding: aes128gcm`, `Authorization: vapid t=…, k=…` con un JWT ES256 verificable, y
  el cuerpo cifrado que se descifra con la llave del navegador de prueba.
- **web** (vitest). La lógica del SW (estrategias, precache, limpieza de cachés, push y clic), el
  alta y baja del navegador, y la pantalla de Notificaciones.
- **Build** (`check:pwa`). Revisa los criterios que Chrome pide para ofrecer "Instalar" y que el
  precache cubra todo lo que `index.html` pide.
- **Sin probar en un navegador real** (no hay arnés). Faltan el botón "Instalar" en Chrome de
  escritorio y Android, el armazón sin red con DevTools → Offline, y un push real con la app
  cerrada. Es Diurna: ver F2-191 en `backlog.md`.

### Prueba manual en local (Chrome)

1. En `/api`: `npx web-push generate-vapid-keys`, y pon las tres `VAPID_*` en `api/.env`
   (`PUSH_IMPL=falso` alcanza para suscribirse; `webpush` para que el aviso llegue de verdad).
2. `npm run build` en `/web` y `npx vite preview` (el SW sólo existe en el build; `localhost`
   cuenta como origen seguro).
3. Chrome → ícono de instalar en la barra de direcciones. Cuenta → Notificaciones → activar en
   este navegador → "Mandar prueba".
4. DevTools → Application → Service workers → Offline, y recarga: abre el armazón con la banda
   "Sin conexión".

## Producción (pendiente, Diurnas)

- Caddy (F1-002): servir `sw.js` con `Cache-Control: no-cache` (si no, un SW viejo tarda en
  cambiar) y `manifest.webmanifest` como `application/manifest+json`.
- `PUSH_IMPL=webpush` con llaves VAPID de producción y la prueba en dispositivos reales (F2-191).
- iPhone: el push web sólo funciona con el panel instalado en la pantalla de inicio (iOS
  16.4+). La pantalla lo dice como "sin soporte" mientras no esté instalado.
