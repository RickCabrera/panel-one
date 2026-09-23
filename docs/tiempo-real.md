# Tiempo real del monitor de mesas (F2-142)

El contrato del socket. No va en `openapi.json` porque no es REST. Lo que sí cambió ahí es sólo
la descripción de `GET /mesas/abiertas`, que ahora apunta aquí.

## La idea: el socket AVISA, no transporta datos

Cuando un lote de `POST /ingesta/eventos` guarda al menos un snapshot o un cheque, la API
emite un aviso a quien mire esa sucursal. El panel, al recibirlo, vuelve a pedir
`GET /mesas/abiertas`, que ya pasa por el scope (`ScopedPrismaService` + `verificarAlcance`).

- Hay un solo camino de datos, con scope. Ninguna mesa, monto ni folio viaja por el socket.
- "Sin perder datos" sale solo: el polling y el socket leen lo mismo.
- El aviso sólo lleva el id de una sucursal a la que el suscriptor ya tenía alcance.

## Conexión

- **Ruta:** `/socket.io` en la API. El navegador la pide en `/api/socket.io`, y el proxy (Vite
  en local con `ws: true`, Caddy en producción) quita el prefijo. Es mismo origen y sin CORS.
- **Auth:** el MISMO access token que HTTP, en `auth.token` del handshake. Un token en la
  query string no cuenta, porque quedaría en los logs.
- **Rechazos del handshake:** sin token, token inválido, vencido, un refresh en lugar de un
  access o firmado con otro secreto → `connect_error` con el mensaje `No autenticado`.
- **Vencimiento:** el servidor corta el socket (`io server disconnect`) cuando vence el `exp`
  del token con que se conectó. El timer se limpia al desconectar. El cliente reconecta con
  el token vigente.

## Mensajes

### `suscribir` (cliente → servidor, con ack)

```json
{ "empresaId": "<uuid>", "sucursalId": "<uuid, opcional>" }
```

Respuestas (ack):

| Respuesta | Cuándo |
|---|---|
| `{ ok: true }` | En alcance. El socket deja sus salas anteriores y entra a `empresa:<id>` (sin sucursal) o `sucursal:<id>`. |
| `{ ok: false, error: 'No encontrado' }` | La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. Es el mismo texto en todos los casos, el equivalente del 404 (nunca un 403). |
| `{ ok: false, error: 'Parámetros inválidos' }` | No son UUIDs, trae llaves de más o no es un objeto. |
| `{ ok: false, error: 'Reemplazada' }` | Salió otro `suscribir` después y ya manda ése. |

Una suscripción rechazada **no suelta** la anterior. Cada socket tiene una sola suscripción
a la vez: la del filtro actual.

Si el socket no tiene sesión vigente (el guard `SocketAuthGuard` lo revisa en **cada**
mensaje), no hay ack: llega `exception { status: 'error', message: 'No autenticado' }`.
Ojo: los `APP_GUARD` globales de HTTP **no** corren en los mensajes de un gateway de Nest (se
comprobó en el e2e). Por eso el gateway lleva su propio guard.

### `ingesta` (servidor → cliente)

```json
{ "sucursalId": "<uuid>", "mesas": true, "cheques": false }
```

- `mesas`: el lote guardó al menos un snapshot.
- `cheques`: el lote guardó al menos un cheque.
- Se emite a `empresa:<empresa del agente>` y a `sucursal:<sucursal del agente>`. Un socket
  que esté en las dos salas lo recibe una sola vez.
- Sale **después** de que las transacciones del lote confirmaron. Un lote sólo de heartbeat,
  o con todos sus eventos rechazados, no avisa.
- No escribe nada, así que no toca la idempotencia: un reenvío idéntico avisa otra vez y el
  panel relee exactamente lo mismo. Si el aviso falla, se loguea y la respuesta de la
  ingesta no cambia.

## El cliente (`web/src/tiempo-real/socket.ts`)

- Abre una conexión por alcance (empresa + sucursal), compartida entre la cabecera y el
  Monitor. Se abre con el primer suscriptor y se cierra con el último.
- **Vivo** quiere decir conectado y con la suscripción aceptada. Con socket vivo, la consulta
  se relee con cada aviso y el polling baja a respaldo (60 s). Si el socket cae, vuelve el
  polling de 20 s. Al reconectar se relee una vez para recuperar lo que pasó mientras
  estuvo caído.
- **Agrupado:** los avisos que llegan en 1 s se juntan en una sola relectura. Con 60
  sucursales mandando cada ~30 s llegarían ~2 avisos por segundo.
- **Sesión:**
  - Al renovarse, reconecta con el token nuevo.
  - Al terminar, cierra todo.
  - Un `connect_error` `No autenticado` pide **un** refresh por ciclo. Si vuelve a fallar
    con el token recién renovado, no insiste y se queda en polling. Así no se come el límite
    de 30 refresh/min de la API.
- **Indicador:** la línea "Consultado HH:MM · en vivo / · cada 20 s" del Monitor y de la
  vista de pared (`data-modo="en-vivo" | "polling"`). Es lo único que el usuario nota si el
  socket cae.
- El semáforo de frescura (fresca / demorada / desconectada) **no** depende del refresco: lo
  sigue calculando el navegador con su reloj (`useConReloj`) sobre la edad del dato.

## Límites conocidos

- **Una sola instancia del api.** Las salas viven en memoria del proceso. Con más de una
  réplica haría falta el adapter de Redis de socket.io; hoy el despliegue es de una
  instancia (F1-002).
- **Sin tope de sockets por usuario.** Cada pestaña abre los suyos (uno por alcance). No
  hay rate limit de conexiones. Aceptable para el volumen actual; revisar en F2-250 si hace
  falta.
- **`suscribir` sin límite de frecuencia.** Cada mensaje hace hasta dos consultas a Postgres
  (`verificarAlcance`), y un usuario autenticado podría mandarlos en ráfaga. El riesgo es
  bajo. Si hace falta, se agrega un tope por socket (F2-250).
- **El logout no cierra un socket ya abierto.** Sigue recibiendo avisos (sólo ids y booleanos)
  hasta que vence su access token (≤ 15 min). HTTP hace lo mismo: el access token no se
  revoca, sólo el refresh. No es una regresión. El cliente propio sí cierra el socket al
  terminar la sesión.
- **Detalle:** si la sesión vence justo entre el guard y el handler, `suscribir` contesta "No
  encontrado" y no "No autenticado". No filtra nada.
- **Producción sin verificar.** El upgrade a WebSocket detrás de Caddy (`handle_path /api/*`
  + `reverse_proxy`, que lo soporta sin config extra) y la CSP `connect-src 'self'` (que en
  navegadores CSP3 cubre `wss:` al mismo host) no se han probado. Si el upgrade falla,
  socket.io se queda en long-polling, que también funciona. Está anotado en F1-002.
