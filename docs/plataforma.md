# Panel de plataforma (membresías)

El back office para **nosotros**, los que vendemos el sistema: clientes, planes, pagos,
administradores internos, bitácora y ajustes globales. **Sólo `admin_global`.** Nada de esto
toca SoftRestaurant ni la ingesta.

- API: `api/src/plataforma/` (servicio y controladores) y `api/src/scope/plataforma.ts` (las
  escrituras, parte del helper de scope). Reglas puras en `api/src/plataforma/membresia.ts`.
- Web: `web/src/paginas/plataforma/` (`/plataforma/*`, con su propia barra lateral). El estilo
  vive en `estilos.ts` para poder reestilizar sin tocar pantallas.
- Contrato: `api/openapi.json` (tag `plataforma`, más `/cuenta/membresia` y `colorAcento` en
  `/sistema`).

## Modelo

| Tabla | Qué es |
|---|---|
| `planes` | Lo que vendemos: nombre, precio **mensual** (`NUMERIC(12,2)`, MXN), periodicidad (`mensual`/`anual`: un anual cobra 12 × el mensual por periodo), límite de sucursales (`NULL` = ilimitado), activo. |
| `suscripciones` | La vigente de cada empresa (`empresa_id` único): plan, estado **guardado** (`prueba`, `activa`, `suspendida`, `cancelada`), inicio, vencimiento (= próximo pago), días de gracia (5), **día de corte** (1–28), notas. |
| `pagos_suscripcion` | Pagos capturados a mano: monto, moneda (**sólo `MXN`**, CHECK), fecha de pago, método (`transferencia`, `efectivo`, `tarjeta`, `otro`), referencia, periodo que cubre (desde/hasta), notas, quién lo registró y el **estado de la suscripción antes del pago** (`estado_anterior`, para deshacerlo al anular). **Nunca se borran**: se anulan con motivo (quién y cuándo). |
| `bitacora_plataforma` | Quién (id + correo), qué (`accion`), cuándo, sobre qué empresa/recurso, con `antes`/`despues` en JSON. Sin contraseñas ni hashes. Sólo INSERT, sin FK (un registro de auditoría no se bloquea ni se pierde). |
| `configuracion_plataforma` | Una fila: el color de interfaz global (`color_acento`, una CLAVE de la lista; `NULL` = el del build). |
| `empresas` (+) | Contacto del cliente: `contacto_nombre`, `contacto_telefono`, `contacto_email`, `rfc`, `notas_plataforma`. Nunca salen por las rutas de los clientes. |
| `usuarios` (+) | `ultimo_acceso_at`: el último **login** (no el refresh). |

Fechas: inicio, vencimiento, fecha de pago y periodo son **días de calendario** (`DATE`); "hoy"
es el día en **America/Mexico_City** (la zona de la plataforma, que es quien cobra). Los
instantes (`created_at`, `anulado_at`, `ultimo_acceso_at`) van en UTC.

### La migración no bloquea a nadie

Migración `20261103030000_plataforma_membresias` (orden de merge acordado: #83 turnos `010000`,
#85 enlace `020000`, #86 plataforma `030000`).

Las empresas que ya existían quedan **`activa`** en un plan **"Plan inicial"** de **$0.00**,
sin límite de sucursales, con día de corte = el día de la migración (tope 28) y vencimiento un
mes después. `activa` y no `prueba` porque ya operan; $0.00 para no inventar ingresos en el MRR.
Un plan de $0.00 **nunca queda vencido** ni muestra aviso de pago (no se cobra): su mensualidad
cuenta como "pagada". Hay que asignarles su plan real desde el panel.

Las empresas que nazcan **fuera** del panel (`POST /empresas`, alta guiada) quedan **sin
suscripción**: sin límite, sin aviso, sin bloqueo. El panel las lista como "Sin plan" y deja
asignarles uno.

## Reglas de membresía

- **`vencida` se calcula al leer**, no hay job: una suscripción `prueba`/`activa` de un plan con
  precio > $0 y `hoy > vencimiento + días de gracia` es `vencida`. Los planes de $0 nunca. Así nunca hay una fila "atrasada" porque un
  job no corrió, y registrar un pago la "desvence" en el acto.
- **Nada corta el servicio automáticamente.** `vencida` sólo muestra el aviso de "pago
  pendiente" en el panel del cliente (`GET /cuenta/membresia`); sus usuarios entran normal.
  `suspendida`/`cancelada` sólo las pone un admin_global, a mano.
- **Suspendida o cancelada**: sus usuarios no inician sesión (`403`, "Tu cuenta está
  suspendida. Contacta a soporte." / "…cancelada…", sólo con la contraseña correcta) ni
  refrescan (`401` con el mismo mensaje). Suspender incrementa `version_sesion` de todos sus
  usuarios: sus refresh tokens mueren en el acto; su access token vigente, en ≤ 15 min.
- **La ingesta del agente NUNCA se bloquea por membresía**: el guard del agente no mira la
  suscripción; las ventas de una empresa suspendida o cancelada se siguen guardando (test e2e).
- **Registrar un pago** (bajo candado de la suscripción) cubre `periodos` periodos del plan
  **desde el vencimiento actual** (un cliente atrasado paga los meses que debe) y corre el
  vencimiento al final. `prueba` o `suspendida` → `activa`. Una `cancelada` no recibe pagos
  (409): se reactiva primero. La fecha de pago no puede ser futura.
- **Anular un pago**: sólo el **último pago no anulado** de la suscripción por fecha de registro
  (`created_at`); si hay uno posterior vigente, 409. Deshace el pago: el vencimiento regresa al
  inicio de lo que cubría y, si el pago había reactivado la suscripción (venía de `prueba` o
  `suspendida`) y sigue `activa`, regresa a ese estado (el MRR lo refleja). Un cambio de estado
  hecho a mano después se respeta.
- **Límite de sucursales** (alta `POST /sucursales` y reactivación `PATCH … activo: true`):
  conteo y escritura en UNA transacción con `FOR UPDATE` sobre la suscripción, así dos altas o
  reactivaciones simultáneas no se cuelan por el último cupo. Por encima, `409` con `codigo: "limite_sucursales"` y un mensaje claro. Un
  admin_empresa no lo puede pasar; un admin_global sí, con `forzarLimite: true`, y queda en la
  bitácora (`sucursal.forzar_limite`, sólo si la escritura ocurrió). Sin suscripción o plan
  ilimitado: sin límite. Contrato: `LimiteSucursalesDto` en el 409 de las dos rutas.

## API (`/plataforma/*`, sólo admin_global)

Cualquier otro rol recibe **404** en todas (mismo cuerpo que una ruta que no existe); sin token,
401. Toda escritura relee al actor dentro de la transacción (un admin recién desactivado no
escribe) y deja su línea de bitácora en la misma transacción.

- `GET /metricas`: MRR (Σ precio mensual de activas + vencidas), clientes por estado, sin
  plan, cobrado del mes (pagos no anulados) y cuántas vencen en 7 días.
- `GET|POST /planes`, `PATCH|DELETE /planes/:id` (borrar sólo si nadie lo usa; si no,
  desactivar).
- `GET /clientes?estado=&q=`, `POST /clientes` (empresa + contacto + suscripción + su primer
  admin_empresa en UNA transacción), `GET|PATCH /clientes/:id`,
  `PUT /clientes/:id/suscripcion` (plan, vencimiento, corte, gracia; la crea si no hay),
  `POST /clientes/:id/estado`.
- `GET /pagos?estado=&q=` (las mensualidades del mes: pagado / pendiente / vencido),
  `GET|POST /clientes/:id/pagos`, `POST /pagos/:id/anular`.
- `GET|POST /administradores`, `PATCH /administradores/:id`,
  `GET /administradores/buscar-cuenta?email=`, `POST /administradores/convertir`.
- `GET /bitacora?pagina=&porPagina=&empresaId=`.
- `GET|PUT /ajustes` (color de interfaz global). El color sale público en `GET /sistema`.

## Administradores internos

- Se manejan **SÓLO** en `/plataforma/administradores` (candado y bitácora). En `/usuarios`:
  `POST` con `rol: admin_global` es 400, y `PATCH` sobre un admin_global sólo cambia el nombre
  (`activo` o `rol` = 400). La web de Administración › Usuarios ya no ofrece crearlos ni darlos
  de baja; enlaza a la plataforma.
- Cada quien cambia **sólo su propia** contraseña (Mi cuenta). **No hay** ruta ni botón para
  cambiar o restablecer la de otro admin, y `POST /usuarios/:id/password` sobre un admin_global
  responde 400.
- **No se borran.** Se desactivan / reactivan; nadie se desactiva a sí mismo (400). "Siempre
  queda al menos uno activo" lo sostienen juntas tres cosas: el actor se relee activo después de
  tomar el candado de administradores, nadie se desactiva a sí mismo, y sólo esta pieza da de
  baja admins. Dos que se desactivan mutuamente a la vez: el segundo ya no es actor vigente
  (401), test e2e.
- Nombre y correo de otro: sí se editan.
- **Convertir una cuenta de cliente**: se busca por correo a un `admin_empresa`/`visor` y pasa a
  `admin_global` **sin cambiar correo ni contraseña**. Deja de pertenecer a su empresa (un
  admin_global no lleva empresa); la empresa sigue igual con sus demás usuarios. Su sesión de
  cliente se corta (`version_sesion`). Si la empresa se queda sin admin_empresa activo, la
  respuesta lo dice (`empresaSinAdmin`) y la web lo avisa. Queda en la bitácora con el antes
  (rol, empresa) y el después.
- La lista muestra el **último acceso** de cada uno y la etiqueta **"Tú"**.

## Web

- `/plataforma`: Tablero, Clientes (filtro por estado, búsqueda, alta, detalle con suscripción,
  pagos, sucursales con su agente y usuarios; suspender/cancelar/reactivar con confirmación),
  Pagos (mes en curso, 4 tarjetas, pestañas con conteo, "Registrar pago"), Planes, Ajustes,
  Administradores, Bitácora. Barra lateral propia con nombre, correo, interruptor de tema oscuro
  y "Cerrar sesión". Para cualquier otro rol, "No encontrada".
- El admin_global llega desde el botón **Plataforma** de la cabecera del panel.
- **Color global**: lo lee `GET /sistema` al cargar (con el último visto en `localStorage` para
  no parpadear); si no hay, el del build (`VITE_COLOR_ACENTO`). La API guarda la clave, nunca un
  hex.
- Aviso de **pago pendiente** arriba del panel de los clientes con la membresía vencida;
  mensaje de **cuenta suspendida** en el login.

## Seed de desarrollo

`npm run seed` (en /api) corre al final `seed:plataforma`: 3 planes (Esencial, Completo, Cadena
anual), Restaurante Demo `activa` con un pago vigente y uno anulado, Cafetería Ejemplo en
`prueba` y Taquería Ejemplo `vencida`. Idempotente. **No corre en producción:** igual que los
demás seeds, `seed-plataforma.ts` se niega con `NODE_ENV=production` (también si viene del
`api/.env`).

## Contrato

- `POST /auth/login`: 403 `CuentaBloqueadaDto` (`codigo: cuenta_bloqueada`) con la empresa
  suspendida o cancelada.
- `POST /sucursales` y `PATCH /sucursales/{id}`: 409 `LimiteSucursalesDto`
  (`codigo: limite_sucursales`, `limite`, `activas`, `plan`).
- Swagger nombra cada esquema por su CLASE: dos DTO con el mismo nombre se pisan. Un test de
  `openapi.spec.ts` lo impide (por eso los de aquí son `PagoSuscripcionDto`,
  `GuardarMembresiaDto` y `ContactoClienteDto`, y el modificador de tickets pasó a
  `ModificadorTicketDto`).
