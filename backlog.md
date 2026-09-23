# BACKLOG — Monitor tipo Arkhon para SoftRestaurant

> **Cómo usar este archivo.** Todas las tareas (Fase 1 y Fase 2) están detalladas con su
> criterio de **Listo cuando** (los AC originales, íntegros) y sus notas técnicas. IDs
> estables: no renumerar. Estado: `[ ]` pendiente, `[x]` hecha y **mergeada a main**.
>
> El orden de trabajo lo manda la **Cola nocturna**, aquí arriba. Lo que está fuera de la
> cola no es opcional: es lo que **no se puede cerrar de noche**, y está en el bloque
> [Diurnas](#diurnas--requieren-a-ricardo-o-acceso-externo) con la razón de cada una.

---

# COLA NOCTURNA

**La regla de elección, y es toda la regla:**

1. Toma la **primera tarea de la cola vigente (RONDA 2), de arriba abajo, que no esté `[x]`**
   y que no aparezca como **SALTADA** en `docs/nocturno-log.md`.
2. **Una tarea por sesión.** La sesión termina al cerrarla o al saltarla. No encadenes la
   siguiente aunque quede tiempo y aunque sea obvia cuál sigue.
3. `[x]` **sólo tras merge confirmado a main**. No por CI verde, no por "ya pusheé".
4. **No tomes nada del bloque Diurnas**, aunque la cola se vea trabada.
5. Si **no queda ninguna tarea pendiente** en la cola vigente: no inventes ninguna ni te
   adelantes a las Diurnas. Crea el archivo vacío **`COLA_VACIA.txt`** en la raíz del repo
   y termina. El loop lo lee y para.

---

## ⚠️ AUTORIZACIÓN EXPLÍCITA DE RICARDO — 21/09/2026

> **La Fase 2 queda DESCONGELADA y entra a la Cola nocturna.** El `CLAUDE.md` dice que la
> Fase 2 está fuera de alcance "salvo tarea explícita" antes de que F1-091 cierre. **Esta
> sección ES esa tarea explícita**, para todas las tareas listadas en la RONDA 2 y sólo para
> ellas. Una sesión nocturna que tome una tarea de esta cola está cumpliendo el protocolo,
> no saltándoselo, y **no debe detenerse a preguntar** ni marcar SALTADA por este motivo.
>
> **Por qué se descongela.** F1-091 (piloto real) y F1-090 (mapeo del POS) siguen bloqueados
> por el mundo: no hay ventas reales en la base del POS todavía. Esperar a que cierren deja
> la máquina parada semanas. Todo lo que está en esta cola se puede **construir y verificar
> con el seed**, sin POS y sin cuentas externas. Lo que de verdad necesita el mundo real
> quedó separado en Diurnas, tarea por tarea.

## Las cuatro reglas de la RONDA 2 (además del protocolo normal)

Estas cuatro reglas existen porque la Ronda 2 se construye **a ciegas del mundo real**: sin
ventas reales en el POS, sin PAC contratado, sin servidor de correo, sin dominio. Un "Listo
cuando" que dependa de cualquiera de esas cosas no se puede cumplir de noche, y la sesión
que lo intente termina SALTANDO una tarea que era perfectamente construible.

1. **Nada externo bloquea un cierre.** Si la tarea necesita un servicio de terceros (PAC,
   correo, almacenamiento de archivos, push), se construye contra una **interfaz propia** con
   **dos implementaciones**: la real (escrita, tipada, compilando, sin credenciales) y una
   **falsa determinista** para tests y para el modo demo. La elección va por variable de
   entorno. El cierre se mide contra la falsa + **tests de contrato** que fijan la forma exacta
   de la petición que se le mandará al servicio real. Conectar el servicio real es una tarea
   **Diurna**, y nunca bloquea a la nocturna.
2. **El seed es la fuente de verdad del cierre.** Todo AC se mide contra datos de
   `prisma/seed*.ts`. Si el módulo nuevo necesita datos que el seed no genera, **generarlos es
   parte del entregable de esa misma tarea** (y el seed sigue siendo idempotente y
   determinista, con semilla fija). Prohibido cerrar con una pantalla vacía "porque no hay
   datos": una pantalla que no se puede ver no se puede revisar.
3. **Nada que se lea de SoftRestaurant se inventa.** Para catálogos, inventario, recetas y
   canales, el modelo en Postgres y su ingesta se construyen **contra lo documentado en
   `docs/esquema-sr.md`**. Lo que ese documento no cubra se resuelve con la opción **más
   conservadora**, se marca en el código con `# DECISION PROVISIONAL (nocturno):`, se anota en
   `docs/esquema-sr.md` como supuesto no validado y se sigue. Nunca se detiene la sesión por
   esto, y nunca se escribe en la base del POS ni para probar.
4. **Paridad con Arkhon: la referencia está escrita, no en una captura.** Cada tarea de
   paridad dice **qué tiene que verse y qué tiene que poder hacerse**. Esa lista es el AC. No
   hace falta ver Arkhon para cumplirla, y **no se copia su diseño ni su marca**: mismas
   capacidades, nuestra identidad visual.

> **Estados vacíos, la regla que aplica a TODA la ronda.** Ninguna vista nueva miente cuando
> no tiene datos. Nada de `$0.00`, `0` ni una gráfica plana cuando lo cierto es "no hay
> lectura". Se dice **por qué** está vacío (sucursal desconectada, módulo sin sincronizar,
> periodo sin ventas) y **qué haría falta** para llenarlo. Esto ya es el comportamiento del
> Monitor de mesas y de las tarjetas de Inicio: la Ronda 2 lo extiende a todo lo nuevo.

---

# RONDA 2 — COLA VIGENTE (paridad con Arkhon y más)

| # | Tarea | Bloque | Carril |
|---|---|---|---|
| 1 | F2-200 · Instalación limpia sin fricción | A · Cimientos | todos |
| 2 | F2-201 · Seed maestro: realismo y datos para todo | A · Cimientos | /api |
| 3 | F2-202 · Adaptadores externos e interruptor de modo demo | A · Cimientos | /api |
| 4 | F2-203 · Deudas visuales y de datos detectadas en la revisión | A · Cimientos | /web + /api |
| 5 | F2-210 · Navegación por secciones tipo centro de control | B · Cascarón | /web |
| 6 | F2-211 · Modo oscuro | B · Cascarón | /web |
| 7 | F2-212 · Cabecera de operación en vivo y rango libre global | B · Cascarón | /web |
| 8 | F2-220 · Resumen ejecutivo | C · Ventas | /web + /api |
| 9 | F2-140 · Comparativos | C · Ventas | /web + /api |
| 10 | F2-221 · Análisis (mesero, producto, hora × día, área) | C · Ventas | /web + /api |
| 11 | F2-222 · Tickets: filtros y detalle completos | C · Ventas | /web + /api |
| 12 | F2-223 · Monitor de mesas: paridad fina | C · Ventas | /web + /api |
| 13 | F2-224 · Centro de alertas | C · Ventas | /web + /api |
| 14 | F2-141 · Reportes programados por correo | C · Ventas | /api + /web |
| 15 | F2-230 · Catálogos espejo: modelo, ingesta y sincronización | D · Catálogos | /api |
| 16 | F2-145 · Productos y orquestador de menú | D · Catálogos | /web + /api |
| 17 | F2-231 · Meseros y rendimiento por mesero | D · Catálogos | /web + /api |
| 18 | F2-232 · Clientes | D · Catálogos | /web + /api |
| 19 | F2-233 · Áreas, estaciones y canales de venta | D · Catálogos | /web + /api |
| 20 | F2-120 · Catálogos de inventario | E · Inventario | /api |
| 21 | F2-121 · Existencias y valuación | E · Inventario | /web + /api |
| 22 | F2-122 · Movimientos, pólizas y kardex | E · Inventario | /web + /api |
| 23 | F2-123 · Conteos físicos | E · Inventario | /web + /api |
| 24 | F2-124 · Traspasos | E · Inventario | /web + /api |
| 25 | F2-125 · Recetas y consumo teórico | E · Inventario | /web + /api |
| 26 | F2-126 · Compras, gastos y utilidad | E · Inventario | /web + /api |
| 27 | F2-127 · Proyecciones y sugerido de compra | E · Inventario | /web + /api |
| 28 | F2-100 · Datos fiscales y CSD por empresa | F · Facturación | /web + /api |
| 29 | F2-101 · Código corto de facturación por cheque | F · Facturación | /api |
| 30 | F2-103 · Portal público de autofactura | F · Facturación | /web + /api |
| 31 | F2-104 · Emisión de CFDI | F · Facturación | /api |
| 32 | F2-105 · Entrega de la factura | F · Facturación | /api |
| 33 | F2-106 · Dashboard de facturación | F · Facturación | /web + /api |
| 34 | F2-107 · Factura sin ticket y refacturación | F · Facturación | /web + /api |
| 35 | F2-108 · Factura global | F · Facturación | /api + /web |
| 36 | F2-109 · Cancelación de CFDI | F · Facturación | /web + /api |
| 37 | F2-110 · Control de folios del PAC | F · Facturación | /web + /api |
| 37b | F2-110b · Conciliación de reservas colgadas con el PAC | F · Facturación | /api + /web |
| 38 | F2-144 · Ventas por canal (delivery y mostrador) | G · Extras | /web + /api |
| 39 | F2-142 · Tiempo real en el monitor (WebSocket) | G · Extras | /api + /web |
| 40 | F2-146 · PWA instalable con notificaciones | G · Extras | /web + /api |
| 41 | F2-147 · Landing pública y onboarding | G · Extras | /web + /api |
| 42 | F2-143 · Auto-update remoto del agente | G · Extras | /agent + /api |
| 43 | F2-240 · Lector de catálogos de SoftRestaurant | H · Agente | /agent |
| 44 | F2-241 · Lectores de inventario y recetas | H · Agente | /agent |
| 45 | F2-250 · Cierre de Ronda 2: auditoría de paridad y pendientes | I · Cierre | todos |

> **Este orden ya respeta el grafo de dependencias.** No lo reordenes. El bloque A existe
> porque hoy una instalación limpia **no compila** (ver F2-200) y porque el seed no alcanza
> para ver los módulos nuevos (F2-201): sin esos dos, las 43 tareas siguientes se construyen
> sobre arena. El bloque H va al final a propósito: es lo único que toca el POS, y lo que
> lea se valida de día.

<details>
<summary><b>RONDA 1 — cola histórica (24/24 cerradas)</b></summary>

| # | Tarea | Epic | Carril |
|---|---|---|---|
| 1 | F1-001 · Monorepo y tooling base | 0 · Infra | todos |
| 2 | F1-010 · Esquema Prisma núcleo | 1 · Datos | /api |
| 3 | F1-011 · Auth de usuarios (JWT) | 1 · Datos | /api |
| 4 | F1-012 · Auth de agentes (API key) | 1 · Datos | /api |
| 5 | F1-030 · Esquema de ventas en Postgres | 3 · Ingesta | /api |
| 6 | F1-031 · Endpoint de ingesta idempotente | 3 · Ingesta | /api |
| 7 | F1-032 · Servicio de agregados de ventas | 3 · Ingesta | /api |
| 8 | F1-033 · Endpoints de lectura para el frontend | 3 · Ingesta | /api |
| 9 | F1-040 · Base de la SPA | 4 · Panel | /web |
| 10 | F1-041 · Dashboard "Panel de ventas" | 4 · Panel | /web |
| 11 | F1-042 · Vista Tickets | 4 · Panel | /web |
| 12 | F1-043 · Reportes básicos | 4 · Panel | /web |
| 13 | F1-050 · Monitor de mesas en vivo | 5 · Mesas | /web |
| 14 | F1-051 · Detalle de consumo (modal) | 5 · Mesas | /web |
| 15 | F1-060 · CRUD de empresas, sucursales y usuarios | 6 · Admin | /web + /api |
| 16 | F1-061 · Estado de agentes | 6 · Admin | /web + /api |
| 17 | F1-020 · Esqueleto del servicio + configuración | 2 · Agente | /agent |
| 18 | F1-021 · Descubrimiento de la base y versión de SR | 2 · Agente | /agent |
| 19 | F1-024 · Cola local resiliente + envío | 2 · Agente | /agent |
| 20 | F1-025 · Heartbeat y auto-diagnóstico | 2 · Agente | /agent |
| 21 | F1-026 · Instalador y guía de instalación | 2 · Agente | /agent |
| 22 | F1-092 · Hardening y pulido final | 7 · Cierre | todos |
| 23 | F1-093 · Logout y revocación de refresh tokens | 1 · Datos | /api + /web |
| 24 | F1-094 · Pendientes que quedaron "para F1-092" | 7 · Cierre | /web |

</details>

---

## 1 · F1-001 · Monorepo y tooling base
`[x]` **Epic 0 — Infraestructura y esqueleto del proyecto** · **PARCIAL:** falta verificar `docker compose up` en `/infra` (esta máquina no tiene virtualización habilitada en BIOS); el resto está en F1-001b (Diurnas).

Crear repo con carpetas `/agent`, `/api`, `/web`, `/infra`, `/docs`. Configurar:
`.editorconfig`, `.gitignore` por carpeta, ESLint+Prettier en `/api` y `/web`,
`Directory.Build.props` con nullable enable en `/agent`. README raíz con diagrama de
arquitectura y cómo levantar todo en local.

**Listo cuando:** `docker compose up` en `/infra` levanta postgres vacío; `npm run dev` en
`/api` y `/web` corren; `dotnet build` en `/agent` compila.

> **Y además, en el mismo entregable:** descomentar los tres carriles de
> `.github/workflows/ci.yml` (`api`, `web`, `agent`) sin sus pasos de test, que se
> descomentan después. El CI nació con todo comentado justamente para que esta tarea lo
> encienda. Si la tarea cierra con el CI comentado, el revisor bloquea.

## 2 · F1-010 · Esquema Prisma núcleo
`[x]` **Epic 1 — Modelo de datos, auth y multitenancy**

Modelos: `Empresa(id, nombre, activo)`, `Sucursal(id, empresa_id, nombre, zona_horaria,
api_key_hash, activo)`, `Usuario(id, email único, password_hash argon2, nombre, rol
ENUM[admin_global, admin_empresa, visor], empresa_id nullable para admin_global)`,
`AgenteEstado(sucursal_id PK, version_agente, version_sr, ultima_lectura_at,
ultimo_error)`. Índices por `empresa_id` en todo. Seed: 1 admin global, 1 empresa demo con
2 sucursales.

**Listo cuando:** `prisma migrate dev` limpio; seed idempotente (`upsert`); constraint FK
con `onDelete: Restrict`.

## 3 · F1-011 · Auth de usuarios (JWT)
`[x]` **Epic 1 — Modelo de datos, auth y multitenancy**

Endpoints `POST /auth/login` (rate limit 5/min por IP), `POST /auth/refresh`,
`GET /auth/me`. Access token 15 min, refresh 7 días en cookie httpOnly. Guard global de
NestJS + decorador `@Roles()`. Middleware que inyecta `empresaScope`: admin_global ve
todo; los demás solo su `empresa_id` (aplicado en TODOS los queries vía **helper
obligatorio, no opcional**).

**Listo cuando:** tests e2e: login ok, credenciales malas 401, visor de empresa A recibe
**404 (no 403, no filtrar existencia)** al pedir datos de empresa B.

> **Y además:** descomentar en `.github/workflows/ci.yml` el servicio `postgres` y los
> pasos `prisma migrate deploy` + `npm test` del carril `api`. Son los primeros e2e con
> base real del proyecto.

## 4 · F1-012 · Auth de agentes (API key)
`[x]` **Epic 1 — Modelo de datos, auth y multitenancy**

Generación de API key por sucursal desde el panel admin (se muestra una sola vez, se
guarda hash). Guard `AgentAuthGuard`: header `X-Api-Key` → resuelve sucursal, rechaza si
sucursal inactiva. Rate limit 120 req/min por sucursal.

**Listo cuando:** rotar la key invalida la anterior de inmediato; requests del agente
quedan ligados a la sucursal correcta **sin que el agente mande IDs de tenant**.

## 5 · F1-030 · Esquema de ventas en Postgres
`[x]` **Epic 3 — API de ingesta y modelo de ventas**

Modelos Prisma: `Cheque(id, sucursal_id, empresa_id, folio, folio_sr único por sucursal,
abierto_at, cerrado_at, mesa, mesero, comensales, subtotal, impuestos, descuentos, propina,
total, cancelado bool)`, `ChequePartida(cheque_id, producto, categoria, cantidad,
precio_unit, total, modificadores json)`, `ChequePago(cheque_id, forma ENUM[efectivo,
tarjeta, transferencia, otro], forma_raw text, monto)`, `MesaSnapshot(sucursal_id,
capturado_at, payload jsonb)` (solo se conserva el último por sucursal + histórico 24 h
para depurar).

**Listo cuando:** migración limpia; índice único `(sucursal_id, folio_sr)`; índice
`(empresa_id, cerrado_at)` para agregados.

> Todo importe en `NUMERIC(12,2)`. Todo timestamp en UTC.

## 6 · F1-031 · Endpoint de ingesta idempotente
`[x]` **Epic 3 — API de ingesta y modelo de ventas**

`POST /ingesta/eventos` (AgentAuthGuard): recibe lote mixto, valida con
zod/class-validator, procesa en transacción por evento: cheques → upsert por
`(sucursal_id, folio_sr)` reemplazando partidas y pagos; snapshot → upsert del último por
sucursal; heartbeat → update `AgenteEstado`. Respuesta con `procesados[]`/`rechazados[]`
por id de evento para que el agente marque enviados.

**Listo cuando:** reenviar el mismo lote 3 veces deja exactamente los mismos datos (test
e2e); un evento inválido no tumba el lote completo.

> Ésta es **la única frontera entre el agente y el api**. El contrato que se fije aquí es
> el que implementa F1-024 del otro lado: documéntalo bien.

## 7 · F1-032 · Servicio de agregados de ventas
`[x]` **Epic 3 — API de ingesta y modelo de ventas**

Queries SQL (no ORM) para: venta total y nº de cuentas por rango de fechas, serie por hora
del día, desglose por forma de pago (mapeo `forma_raw`→ENUM configurable por catálogo
simple), ticket promedio, comensales totales, descuentos y cortesías, top productos por
importe y por cantidad, comparativo entre sucursales. Todo parametrizado por `empresa_id`,
`sucursal_id?`, `desde`, `hasta` **en zona de la sucursal**.

**Listo cuando:** con seed de 500 cheques generados (script `api/prisma/seed-ventas.ts` con
datos realistas de 2 sucursales × 30 días), cada agregado cuadra contra cálculo manual en
el test; respuesta < 300 ms.

> El seed de esta tarea es lo que permite que todo el frontend (tareas 9–16) avance sin
> esperar al agente. No lo escatimes.

## 8 · F1-033 · Endpoints de lectura para el frontend
`[x]` **Epic 3 — API de ingesta y modelo de ventas**

`GET /ventas/resumen`, `GET /ventas/por-hora`, `GET /ventas/formas-pago`,
`GET /ventas/top-productos`, `GET /ventas/tickets` (lista paginada de cheques con detalle
expandible), `GET /mesas/abiertas` (del último snapshot + edad del dato),
`GET /sucursales`, `GET /empresas`. Todos respetan `empresaScope`; cache in-memory 15 s en
agregados.

**Listo cuando:** contrato documentado con OpenAPI generado por Nest (`/docs` protegido);
tests e2e de scoping por rol.

## 9 · F1-040 · Base de la SPA
`[x]` **Epic 4 — Frontend: Panel de ventas**

Vite + React Router: layout con sidebar (Inicio, Monitor de Mesas, Tickets, Reportes,
Administración según rol), topbar con selector empresa/sucursal persistido en URL
(`?empresa=&sucursal=`), tema claro con acento configurable, responsive (sidebar colapsable
en móvil). Login page + guardas de ruta + refresh silencioso de token. TanStack Query con
`staleTime` 15 s y refetch on focus.

**Listo cuando:** deep-link a cualquier vista con filtros en la URL funciona tras login; en
móvil (390 px) todo es usable sin scroll horizontal.

## 10 · F1-041 · Dashboard "Panel de ventas"
`[x]` **Epic 4 — Frontend: Panel de ventas**

Réplica funcional de la pantalla Inicio de Arkhon: selector de periodo (Hoy / Esta semana /
Este mes / Mes anterior / rango custom), tarjeta Venta total con gráfica de línea por hora
(Recharts, tooltip con monto), dona de Formas de pago con montos y %, tarjetas: Venta en
vivo (suma de mesas abiertas), Ticket promedio + comensales, Descuentos/cortesías.
Indicador "Actualizado hh:mm" y botón refrescar. Auto-refresh cada 60 s solo si el periodo
incluye hoy.

**Listo cuando:** los números coinciden con los endpoints (mismo seed que F1-032); cambiar
sucursal/periodo actualiza todo sin recargar; skeletons en carga, estados vacíos con
mensaje claro.

> **Y además:** descomentar el paso `npm test` del carril `web` en
> `.github/workflows/ci.yml`. Es la primera vista con lógica que vale la pena probar.

## 11 · F1-042 · Vista Tickets
`[x]` **Epic 4 — Frontend: Panel de ventas**

Tabla paginada de cheques cerrados: folio, hora, mesa, mesero, comensales, total, forma de
pago; fila expandible con partidas y modificadores; filtros por fecha, sucursal, búsqueda
por folio; export CSV del filtro actual (generado en cliente).

**Listo cuando:** paginación servidor de 50 en 50 fluida con 10k cheques en seed; el CSV
abre bien en Excel (BOM UTF-8).

## 12 · F1-043 · Reportes básicos
`[x]` **Epic 4 — Frontend: Panel de ventas**

Vista con: top productos (tabla + barra), ventas por día del rango (barras), comparativo
entre sucursales (tabla con venta, tickets, ticket promedio). Export CSV por reporte.

**Listo cuando:** totales cuadran con el dashboard para el mismo rango.

## 13 · F1-050 · Monitor de mesas en vivo
`[x]` **Epic 5 — Frontend: Monitor de mesas**

Réplica funcional del Monitor de Mesas de Arkhon: tarjetas KPI (Mesas abiertas + $ en
curso, Cuentas sin imprimir, Atención >60 min, Última lectura hh:mm con color según
frescura), grid de tarjetas por mesa (nº, total, mesero, minutos abierta, primeras 2-3
partidas + "n partidas más", borde por semáforo: <40 min ok / 40-60 alerta / >60 rojo),
filtro por sucursal. Polling cada 20 s con indicador sutil.

**Listo cuando:** con el agente corriendo contra la base de prueba, abrir una mesa en SR la
muestra en ≤ 60 s; si la última lectura tiene > 3 intervalos, banner "sucursal desconectada"
en lugar de datos viejos como si fueran vivos.

> ⚠️ **Verificación parcial de noche.** La primera mitad del AC necesita un SoftRestaurant
> real, que no existe hasta F1-090. De noche se cierra contra **snapshots del seed**
> (incluido uno con `capturado_at` viejo para probar el banner de desconectada), y la
> verificación contra SR real queda anotada en `docs/nocturno-log.md` como pendiente de
> F1-091. No marques el AC como cumplido entero: di exactamente qué se probó.

## 14 · F1-051 · Detalle de consumo (modal)
`[x]` **Epic 5 — Frontend: Monitor de mesas**

Modal al clickear mesa: encabezado (mesa, mesero, folio, total, tiempo abierta,
comensales), lista de partidas con cantidad, categoría, modificadores ($0.00 incluidos) y
precio, total de la cuenta. Igual al modal de Arkhon.

**Listo cuando:** partidas con modificadores anidados se muestran correctamente;
cerrar/abrir modal no dispara refetch completo del grid.

## 15 · F1-060 · CRUD de empresas, sucursales y usuarios
`[x]` **Epic 6 — Administración**

Vistas admin: alta/edición/desactivación de empresas y sucursales; alta de usuarios con rol
y empresa; generación/rotación de API key de sucursal con modal "cópiala ahora, no se
volverá a mostrar"; cambio de contraseña propio y reset por admin.

**Listo cuando:** un admin_empresa no puede tocar otra empresa ni crear admin_global;
auditoría mínima en log de api (quién creó/rotó qué).

## 16 · F1-061 · Estado de agentes
`[x]` **Epic 6 — Administración**

Vista con tabla por sucursal: conectado/desconectado, última lectura, versión agente y SR,
tamaño de cola reportado, último error. Badge de alerta en sidebar si alguna sucursal lleva
> 10 min sin reportar.

**Listo cuando:** refleja en < 1 min la caída del agente (probado matando el servicio).

> ⚠️ **Verificación parcial de noche.** "Matando el servicio" necesita el agente instalado
> (F1-020 en adelante, y una máquina Windows). De noche se cierra probando la lógica de
> frescura con `AgenteEstado` manipulado en base — que es donde vive el bug real — y se
> anota el resto como pendiente. Di qué se probó.
>
> **Nota de F1-025 — decisión abierta para Ricardo: el umbral de 90 s es fijo.** La web
> marca "desconectado" a los 90 s (3 × 30 s) sin importar el `intervaloSegundos` de cada
> agente, y la config permite de 5 a 3600 s. Con un intervalo mayor a 30 s la sucursal sale
> desconectada en falso; con uno menor, tarda más de 3 intervalos. Hoy el agente sólo avisa
> al cargar la config (`DECISION PROVISIONAL (nocturno)` en `CargadorConfiguracion`). Si se
> quiere "3 intervalos" de verdad: mandar `intervaloSegundos` en el heartbeat, guardarlo en
> `AgenteEstado`, devolverlo en `GET /agentes/estado` y usarlo en `reglasAgentes.ts` (y
> decidir si el Monitor de Mesas lo sigue). Es tarea nueva, no va de pasada.
> F1-025 también agregó `latenciaQueryMs` a `GET /agentes/estado` (y al tipo de la web),
> pero **la vista no la muestra todavía**.

## 17 · F1-020 · Esqueleto del servicio + configuración
`[x]` **Epic 2 — Agente Windows (.NET 8)** · **PARCIAL:** falta verificar con `sc create` en consola elevada el arranque con Windows y el reinicio tras caída (proceso matado y falla interna); el resto está en F1-020b (Diurnas).

Worker Service instalable con `sc create` (documentar) y publicado como single-file
self-contained x64. Config en `C:\ProgramData\ArkonAgente\config.json`:
`{apiUrl, apiKey, connectionString, intervaloSegundos:30}`. Logs rotativos (Serilog,
archivo diario, 14 días) en la misma carpeta. Comando `agente.exe test` que valida conexión
a SQL Server y al API y imprime diagnóstico.

**Listo cuando:** el servicio arranca con Windows, sobrevive reinicios, y `test` reporta
claramente cuál de las dos conexiones falla.

> El `config.json` va en `.gitignore` (trae la cadena de conexión del cliente y la API key
> de la sucursal). Lo que se versiona es la plantilla.

## 18 · F1-021 · Descubrimiento de la base y versión de SoftRestaurant
`[x]` **Epic 2 — Agente Windows (.NET 8)**

Al iniciar: detectar versión de SR consultando tabla de configuración/versión de la base
indicada; registrar en log y mandarla en el heartbeat. Abstraer acceso en interfaz
`ISoftRestaurantReader` con implementación inicial `SrV11Reader` (cubrir v10/v11; **el
mapeo exacto de tablas se valida contra la instalación real — ver F1-090**). Queries en
archivos `.sql` embebidos, no strings inline.

**Listo cuando:** contra la base de prueba, el agente identifica versión y elige el reader;
si la versión no está soportada, log claro + heartbeat con error, sin crashear.

> ⚠️ Todo mapeo que se escriba aquí sin una instalación real delante es un **SUPUESTO** y
> va marcado como tal en `docs/esquema-sr.md` y en el código. Un supuesto disfrazado de
> hecho es lo que el revisor bloquea.
>
> **Y además:** descomentar el paso `dotnet test` del carril `agent` en
> `.github/workflows/ci.yml`. La selección de reader por versión es la primera lógica
> testeable del agente.
>
> **Nota de F1-020:** el paso `dotnet test` **ya lo encendió F1-020**, que trajo la primera
> lógica testeable (validación de config, redacción de secretos, clasificación de fallas).
> Aquí no hay que descomentar nada. Lo que F1-021 hereda: `Sql/ConsultasEmbebidas.cs`
> (lee los `.sql` de `Sql/Consultas/`) y el test de guardia `ConsultasEmbebidasTests`, que
> truena si una consulta embebida contiene `INSERT`/`UPDATE`/`DELETE`/`EXEC`/`INTO`...
> fuera de comentarios y textos. `ConexionSoftRestaurant.TimeoutComandoSegundos` (5 s) es el
> timeout corto para las queries.

## 19 · F1-024 · Cola local resiliente + envío
`[x]` **Epic 2 — Agente Windows (.NET 8)**

SQLite (`cola.db`) con tabla `eventos(id, tipo[cheque|snapshot|heartbeat], payload json,
creado_at, intentos, enviado_at null)`. Envío por lotes de hasta 100 eventos, orden FIFO,
backoff exponencial (30 s → 10 min máx) en fallos de red, compresión gzip del body. Los
snapshots viejos se descartan si hay uno más nuevo sin enviar (solo importa el último).
Purga de enviados > 7 días.

**Listo cuando:** desconectar internet 1 hora y reconectar: los cheques del periodo llegan
completos y en orden; la cola no crece sin límite por snapshots.

> La cola es el **estado propio del agente** y vive en SQLite, **nunca** en la base de SR.
> El AC de desconexión se prueba simulando el fallo de red en el cliente HTTP, no cortando
> el wifi a mano.

## 20 · F1-025 · Heartbeat y auto-diagnóstico
`[x]` **Epic 2 — Agente Windows (.NET 8)**

Cada ciclo, evento `heartbeat`: versión agente, versión SR, latencia de query, tamaño de
cola, último error. El API lo persiste en `AgenteEstado`.

**Listo cuando:** el panel admin (F1-061) muestra "última lectura hace X min" correcto por
sucursal; matar el servicio pone la sucursal en estado desconectado tras 3 intervalos sin
heartbeat.

> **Nota de F1-061:** el panel decide "conectado" por el **contacto** (tabla
> `agente_contacto`: el último lote aceptado por la ingesta, reloj del servidor). El agente
> tiene que mandar **un lote por ciclo aunque no traiga cheques** (con su heartbeat); si sólo
> manda cuando hay datos, la sucursal sale "Desconectado" en falso. `tamanoCola` ya existe en
> el heartbeat; la latencia de query no (migración + DTO aquí).
>
> **Nota de F1-021 — también es "Listo cuando" de esta tarea:** la versión de SR y el error
> de detección ya viven en el singleton `EstadoSoftRestaurant` (`agent/src/ArkonAgente/
> SoftRestaurant/`), pero el agente todavía no los envía. El heartbeat los manda así:
> - **versión no soportada o sin conexión:** `ultimoError` = `EstadoSoftRestaurant.UltimoError`.
>   `versionSr` va null, o con la versión leída si la hubo (una v12 reporta `"12.000000"`
>   y el error).
> - **versión soportada:** `versionSr` = `EstadoSoftRestaurant.VersionSr` (p. ej.
>   `"10.021800"`) y `ultimoError` null.
>
> Se prueba con un test del armado del heartbeat. `ResultadoDeteccion` ya acota los textos
> a lo que acepta el DTO (`versionSr` ≤ 50, `ultimoError` ≤ 2000). Si F1-025 junta varios
> errores en `ultimoError`, el recorte a 2000 lo hace F1-025.
>
> **Nota de F1-024 — la cola ya existe; esto también es "Listo cuando" de esta tarea:**
> - **Encolar el heartbeat en cada ciclo** con `ColaLocal.Encolar(TipoEvento.Heartbeat, …)`
>   en `Worker.CicloAsync`, **antes** de `envio.CicloAsync`. Es lo que hace que salga un lote
>   por ciclo aunque no haya cheques (nota de F1-061). Para eso el Worker necesita la
>   `ColaLocal`: hoy sólo la tiene el `EnviadorCola` (propiedad `Cola`).
> - `tamanoCola` = `ColaLocal.ContarPendientes()`.
> - **El heartbeat pendiente se colapsa** (`DECISION PROVISIONAL (nocturno)` en
>   `ColaLocal.Encolar`): encolar uno borra el anterior sin mandar. Con el API caído sólo viaja
>   el último al reconectar, que es lo único que el API guarda.
> - **Obligatorio: reportar los rechazos definitivos.** Un cheque rechazado por el API
>   (`reintentable: false`, o 413 aunque vaya solo) sale de la cola con `rechazado_at` y
>   `motivo_rechazo`: es una venta que falta en el panel, y hoy sólo queda un Error en el log
>   local. El heartbeat tiene que llevarlo a `ultimoError` (o a un contador nuevo en el DTO),
>   con el recorte a 2000.
> - **También a `ultimoError`: la falla de envío vigente** (400 que no se va, 401, red caída).
>   Mientras dure no llega el heartbeat, pero al reconectar el panel debe poder ver qué pasó.
> - **Rate limit:** el envío usa como máximo `min(intervaloSegundos, 20)` lotes por ciclo, o
>   sea ≤ 60 peticiones por minuto. El heartbeat viaja en el mismo lote, no suma peticiones.
>   Si F1-025 manda algo por fuera de la cola, recalcular contra los 120 por minuto del API.
>   Excepción conocida: partir un lote por 413 no cuenta contra ese tope (un lote de 100
>   puede volverse ~199 peticiones en un ciclo). Si provoca un 429 no se pierde nada: es una
>   falla más, con backoff.
> - **Un evento que el API rechaza siempre como `reintentable: true` frena la cola**: queda
>   primero en cada lote y dispara el backoff cada vez, así que el resto avanza unos 99
>   eventos cada 10 min. No se pierde nada, pero tiene que verse en `ultimoError`.

## 21 · F1-026 · Instalador y guía de instalación
`[x]` **Epic 2 — Agente Windows (.NET 8)** · **PARCIAL:** falta ejecutar el T-SQL del lector y `instalar.ps1` con consola elevada (cuenta virtual, `sc.exe`, `icacls`), que quedan en F1-020b (Diurnas); y medir la instalación de < 15 min con una persona no técnica, que queda en F1-091.

Script PowerShell `instalar.ps1`: copia binarios, crea carpeta de config con plantilla,
registra el servicio, lo arranca, corre `test`. Guía en `/docs/instalacion-agente.md` con:
crear usuario SQL de **solo lectura** en el SQL Server de SR (script T-SQL incluido),
obtener API key del panel, checklist de firewall.

**Listo cuando:** una persona no técnica siguiendo la guía deja el agente reportando en
< 15 minutos sobre una instalación limpia.

> ⚠️ **Verificación parcial de noche.** El AC se mide con una persona real sobre una
> instalación limpia, y eso pasa en F1-091. De noche se entrega el script y la guía
> completos y revisados; la medición de los 15 minutos queda anotada como pendiente.
>
> El script T-SQL **sólo otorga `db_datareader`** sobre la base de SR. Si otorga más, el
> revisor bloquea: es la regla de oro del proyecto convertida en permisos.
>
> **Nota de F1-020:** `agente test` ya marca **FALLA** si el usuario SQL puede escribir
> (sysadmin, db_owner, db_datawriter, db_ddladmin o INSERT/UPDATE/DELETE/ALTER/CREATE TABLE),
> así que el script T-SQL se puede comprobar con el propio `test`. Pendientes que F1-020
> dejó para aquí: (1) cuenta del servicio — hoy LocalSystem; considerar la cuenta virtual
> `NT SERVICE\ArkonAgente` con ACLs sobre `C:\ProgramData\ArkonAgente`; (2) el `icacls` de
> esa carpeta (el `config.json` trae secretos) va en `instalar.ps1`, no sólo en el README;
> (3) los comandos `sc` que documenta `agent/README.md` son los que el script debe correr.

## 22 · F1-092 · Hardening y pulido final
`[x]` **Epic 7 — Validación contra SoftRestaurant real y cierre de fase**

Revisión: headers de seguridad en Caddy (HSTS, CSP básica), rate limits afinados, tamaño de
bundle < 400 kB gzip, lighthouse móvil > 85, textos y formatos de moneda/fecha MX
consistentes, favicon/nombre/branding propio, página 404, pantalla de login presentable.

**Listo cuando:** revisión cruzada de otro dev (o agente revisor) sin hallazgos críticos
abiertos.

> La parte de Caddy se escribe y se valida con `docker compose config` + test local; **no
> se despliega** (el deploy está prohibido en modo autónomo y el VPS es tarea diurna).

## 23 · F1-093 · Logout y revocación de refresh tokens
`[x]` **Epic 1 — Modelo de datos, auth y multitenancy**

`POST /auth/logout` en el api: borra la cookie de refresh y **revoca en el servidor** el
refresh de esa sesión (tabla de sesiones o versión de token por usuario; la decisión va en
el plan). El botón "Salir" de la SPA llama a este endpoint antes de limpiar el cliente.

**Listo cuando:** cerrar sesión invalida el refresh en el servidor; un refresh revocado
recibe 401; hay test e2e que lo cubre (login → logout → refresh con la cookie vieja = 401).

> **Por qué es la primera.** Hoy "Salir" sólo limpia el cliente y la cookie de refresh vale
> hasta 7 días: en una PC compartida, `fetch('/api/auth/refresh', {method:'POST'})` desde la
> consola entra como el usuario anterior (log, entradas de F1-011 y F1-040, y la de F1-092).
>
> **En el mismo entregable:** contrato OpenAPI actualizado con el endpoint nuevo; si hay
> tabla nueva, migración de Prisma. Corregir los comentarios que dicen "logout (F1-092)" en
> `web/src/auth/marcaCierre.ts` y `web/src/api/cliente.ts`.
>
> **Relacionado, a valorar en el plan (no obligatorio para el "Listo cuando"):** rotar el
> refresh no invalida el anterior, y un usuario desactivado sigue entrando a rutas de datos
> hasta que vence su access (15 min). Si la revocación elegida lo resuelve sin costo, se
> incluye; si no, se anota en el log.

## 24 · F1-094 · Pendientes que quedaron "para F1-092"
`[x]` **Epic 7 — Validación contra SoftRestaurant real y cierre de fase**

Pendientes que varias sesiones anotaron "para F1-092" y que F1-092 no tocó (lista completa
en su entrada del log). Esta tarea cubre los cuatro puntos de abajo, **cada uno con su
propio "Listo cuando"**. Lo que no está aquí no se hace de pasada.

1. **CSV de Tickets: folios numéricos.** Excel abre `000123` como `123` y un folio largo en
   notación científica.
   **Listo cuando:** el CSV exportado escribe el folio de forma que Excel lo conserve como
   texto (ceros a la izquierda y folios largos intactos), con test unitario del exportador.
2. **Montos inválidos mostrados como $0.00.** `aCentavos(x) ?? 0n` en
   `web/src/paginas/inicio/Tarjetas.tsx` (`TarjetaFormasPago`) y en
   `web/src/paginas/inicio/puntosHora.ts` convierte un importe que no se puede leer en
   $0.00 sin avisar.
   **Listo cuando:** un importe inválido se muestra como dato no disponible (no como
   $0.00) y no se suma a ningún total; hay test de cada caso.
3. **Totales de Inicio frente al Monitor no cuadran.** "Venta en vivo" de Inicio suma todas
   las sucursales con snapshot, desconectadas incluidas, y el Monitor las excluye. El KPI
   "Última lectura" con "Todas" muestra la lectura más vieja, desconectadas incluidas.
   **Listo cuando:** con una sucursal desconectada, Inicio y Monitor muestran la misma
   venta en vivo (o Inicio distingue explícitamente la parte desconectada), y "Última
   lectura" tiene una regla documentada en el código; hay test con una sucursal
   desconectada.
4. **Accesibilidad y rendimiento menores.**
   - El modal de consumo pone en los `<li>` de partidas y modificadores un `aria-label`
     con sólo el nombre del producto.
   - El badge de agentes (`useAhora` en `web/src/layout/Sidebar.tsx`) re-renderiza el
     sidebar cada 5 s para los admins.
   **Listo cuando:** el `aria-label` incluye cantidad e importe (tests adaptados al texto
   nuevo, no borrados); el sidebar ya no se re-renderiza por el reloj cuando el badge no
   cambia, con test que lo compruebe.

> Corregir en el mismo entregable el comentario "anotado para F1-092" de
> `web/src/paginas/tickets/exportar.ts` si el punto que describe sigue abierto, apuntándolo
> al log.

---

# RONDA 2 — TAREAS NUEVAS

> Las tareas de la Ronda 2 que ya estaban escritas (F2-100…F2-147) viven en la sección
> **FASE 2**, al final de este archivo, con su redacción original intacta. Lo único que
> cambia para ellas es **cómo se cierran de noche**, y eso está en
> [Cierre nocturno de las tareas heredadas](#cierre-nocturno-de-las-tareas-heredadas-de-fase-2).
> Las que siguen aquí son nuevas: salieron de la revisión del 21/09/2026 (arranque en limpio
> del proyecto y comparación funcional contra Arkhon Cloud).

## BLOQUE A · Cimientos

### F2-200 · Instalación limpia sin fricción
`[x]` **Bloque A** · /api + /web + /docs

Una instalación limpia del repo **hoy no compila**. Se reprodujo entero el 21/09/2026 en la
máquina de desarrollo y cada tropiezo está aquí. Ninguno es un bug de lógica: son huecos del
arranque, y son justo los que va a pisar el primer cliente y cualquier máquina nueva.

Lo que pasó, en orden:

1. `npm ci` en la raíz **no ejecuta los scripts de instalación** (npm moderno los bloquea y
   avisa con `npm warn allow-scripts`). Sin el `postinstall` de Prisma **el cliente no se
   genera**, y `npm run dev` en `/api` muere con **167 errores de TypeScript** del tipo
   `Namespace 'Prisma' has no exported member 'Decimal'` y `Property 'sql' does not exist`.
   El CI no lo ve porque allá los scripts sí corren.
2. No existe un script `seed` agrupador: hay que saber que son **tres** comandos distintos
   (`npx prisma db seed`, `npm run seed:ventas`, `npm run seed:mesas`) y en ese orden.
3. `api/.env` no se crea solo y la API **se niega a arrancar** sin `JWT_ACCESS_SECRET`. El
   `.env.example` está muy bien documentado, pero ninguna guía dice "cópialo".
4. En Windows, `npm` no corre en PowerShell por la política de ejecución
   (`npm.ps1 ... la ejecución de scripts está deshabilitada`), y las guías usan `&&`, que
   **PowerShell 5.1 no acepta** como separador.
5. `npm audit` reporta **3 vulnerabilidades altas**, y Prisma avisa de que
   `package.json#prisma` queda deprecado en Prisma 7.

Entregable: que `git clone` + los comandos de la guía, **copiados y pegados tal cual en
PowerShell 5.1**, dejen el panel corriendo con datos. Concretamente: `postinstall` que genere
el cliente de Prisma (y/o la configuración que permita sus scripts, documentada), script
`seed` en `/api` que corra los tres en orden, script `setup:env` que copie `.env.example` a
`.env` si no existe y avise si ya existía, y `0-INSTALACION.md` + `README.md` reescritos con
los comandos reales, verificados, uno por línea, **sin `&&`**, con la nota de
`Set-ExecutionPolicy -Scope Process Bypass -Force` y con la alternativa `npm.cmd`. Resolver las
3 vulnerabilidades altas si `npm audit fix` no rompe nada (si rompe, documentar cuál y por qué
se queda). Migrar `package.json#prisma` a `prisma.config.ts` si es directo; si no, anotarlo.

**Listo cuando:** en un clon nuevo, `npm ci` en la raíz deja el cliente de Prisma generado y
`npm run typecheck` en `/api` sale limpio **sin ejecutar `prisma generate` a mano**; `npm run
setup:env && npm run seed && npm run dev` en `/api` levanta la API con datos; un test de
contrato falla si `api/package.json` pierde el `postinstall`; y `docs/verificacion-arranque.md`
registra la corrida completa con su salida real (no una reconstrucción).

### F2-201 · Seed maestro: realismo y datos para todos los módulos
`[x]` **Bloque A** · /api

El seed actual es la única fuente de datos del proyecto hasta que el POS tenga ventas, así que
es también el único lugar donde se puede ver si un módulo nuevo funciona. Hoy le faltan dos
cosas: realismo en el día en curso, y datos para todo lo que la Ronda 2 va a construir.

**El defecto del día en curso, primero.** `seed-ventas.ts` reparte los cierres del día con
`segundoDeCierre()` sobre las 24 horas completas, **también para hoy**. A las 17:04 el panel
mostraba tickets cerrados a las **23:49** y la gráfica "Venta por hora de cierre" llegaba a las
24:00. No es un error de zona horaria —`instanteLocal()` está bien— es el seed inventando
futuro. Arreglo: para el día de hoy, en la zona de cada sucursal, **no generar cierres después
de la hora actual**, y que la gráfica de "Hoy" no dibuje horas que todavía no ocurren.

**Los datos que faltan**, con volumen suficiente para que cada vista se vea llena y se pueda
revisar: 90 días de ventas (hoy son 30) para que los comparativos mes-contra-mes tengan de
dónde; catálogo de productos con grupos, precios y algún producto inactivo, más **un precio
distinto para el mismo producto entre las dos sucursales** (lo va a necesitar F2-145);
meseros con nombre y clave; clientes; áreas y canales de venta (comedor, mostrador, domicilio)
repartidos en los cheques; insumos con unidades, almacenes y existencias, incluyendo
**artículos bajo mínimo y en cero**; movimientos de inventario con póliza, suficientes para un
kardex corrido; recetas para la mayoría de los productos y **al menos dos productos sin receta**
(F2-125 tiene que listarlos aparte sin tronar); compras y gastos por categoría.

Todo determinista: semilla fija, mismo resultado en cada corrida, idempotente por `upsert`.

**Listo cuando:** correr el seed dos veces seguidas deja exactamente los mismos datos; ningún
cheque de hoy cierra en el futuro (test que lo afirma con un reloj falso a las 14:00 y otro a
las 23:30); el seed genera datos para cada módulo de la Ronda 2 y un test por módulo lo
verifica contando filas; y el tiempo total del seed queda bajo los 60 s en una máquina normal.

### F2-202 · Adaptadores externos e interruptor de modo demo
`[x]` **Bloque A** · /api

Cimiento de la regla 1 de la Ronda 2. Sin esto, todo el bloque F (facturación) y F2-141
(correo) se SALTAN por falta de credenciales.

Definir en `/api` tres puertos con su implementación falsa determinista, elegidas por variable
de entorno (`PAC_IMPL`, `CORREO_IMPL`, `ARCHIVOS_IMPL`, con valor `falso` por defecto en
desarrollo y test, y arranque que **falla ruidosamente** si en producción quedan en `falso`):

- **`PuertoTimbrado`** — `emitir`, `cancelar`, `consultarEstado`. La falsa genera UUID v4
  determinista por cheque, XML mínimo bien formado con los campos que el SAT exige, y un PDF
  marcado claramente como **no fiscal**. Puede simular errores por RFC de prueba reservado
  (`XEXX010101000` → "RFC no inscrito", etc.) para probar el manejo de errores sin PAC.
- **`PuertoCorreo`** — `enviar(destinatario, plantilla, adjuntos)`. La falsa escribe a
  `/tmp/correos/` y a una tabla `CorreoEnviado` consultable desde tests.
- **`PuertoArchivos`** — `guardar`, `leer`, `urlFirmada`. La falsa usa disco local bajo una
  raíz configurable.

Y un **modo demo** (`MODO_DEMO=1`): marca visible y permanente en la interfaz ("Datos de
ejemplo"), que no se puede confundir con producción, y que es lo que permite enseñar el
producto sin POS conectado.

**Listo cuando:** un test de contrato por puerto fija la forma exacta del payload que recibirá
el proveedor real (snapshot del JSON, no una llamada de red); cambiar `PAC_IMPL=falso` a
`facturama` no requiere tocar ningún servicio de negocio, sólo la variable; arrancar con
`NODE_ENV=production` y cualquier `_IMPL=falso` **aborta el arranque** con un mensaje que
nombra la variable; y con `MODO_DEMO=1` la marca aparece en todas las vistas y en el título
de la pestaña.

### F2-203 · Deudas visuales y de datos detectadas en la revisión
`[x]` **Bloque A** · /web + /api

Recogida de lo que salió en la revisión del 21/09 y de los pendientes que el log de F1-092 y
F1-094 dejó abiertos. Son chicas y se cierran juntas.

1. **Leyenda de formas de pago ilegible.** En la dona de Inicio la leyenda sale truncada a
   `E.`, `T.`, `T.` y **no se distingue tarjeta de transferencia**, que es exactamente lo que
   la tarjeta existe para mostrar. Nombre completo, o abreviatura inequívoca con el nombre
   completo accesible; nunca dos etiquetas idénticas para formas distintas.
2. **Pendientes abiertos del log**, uno por uno, cerrados o anotados con su razón:
   anti-inyección más allá del primer carácter en el export CSV, cancelados en Tickets,
   "Hoy" en hora pico abortando el export, throttles de login y de reset, lint de Prisma,
   `statement_timeout`, y el layout a 390 px de ancho.
3. **Consola en UTF-8.** `scripts/nocturno-v2.ps1` imprime `revocaci├│n`: agregar
   `[Console]::OutputEncoding = [Text.Encoding]::UTF8` al inicio. El repo está bien; es la
   consola.

**Listo cuando:** un test de la leyenda afirma que dos formas de pago distintas nunca comparten
etiqueta visible; cada pendiente de la lista 2 queda cerrado con su test o anotado en
`docs/nocturno-log.md` con la razón de por qué no; el panel se usa a 390 px sin scroll
horizontal; y la salida del script se ve con acentos correctos.

## BLOQUE B · Cascarón

### F2-210 · Navegación por secciones tipo centro de control
`[x]` **Bloque B** · /web

Hoy el menú es una lista plana de cinco entradas. Al terminar la Ronda 2 habrá más de veinte
vistas, y una lista plana de veinte es inservible. Reorganizar el lateral en secciones con
encabezado, en este orden y con estos nombres:

- **Principal** — Inicio, Empresas, Sucursales, Comparativos
- **Ventas y dirección** — Resumen, Tickets, Monitor de mesas, Análisis, Reportes
- **Catálogos** — Productos, Orquestador de menú, Grupos de insumos, Insumos, Meseros, Clientes
- **Inventario y compras** — Existencias, Conteos físicos, Recetas, Proyecciones, Compras,
  Gastos y utilidad, Traspasos
- **Canales** — Ventas por canal
- **Administración** — Sucursales, Usuarios, Agentes, Empresas, Facturación

Cada entrada que apunte a un módulo todavía no construido aparece **deshabilitada con su razón
al pasar el cursor** ("se construye en F2-xxx"), no oculta y no rota: el menú es el mapa del
producto. Secciones colapsables con estado recordado por usuario. El lateral se colapsa a
iconos en pantallas chicas y el menú entero es navegable con teclado.

**Listo cuando:** el menú muestra las seis secciones con sus entradas; una entrada sin módulo
no navega a una pantalla rota; el foco se mueve con `Tab` por todo el menú en orden visual y
`Enter` navega; la sección colapsada sigue colapsada al recargar; y a 390 px el lateral no tapa
el contenido.

### F2-211 · Modo oscuro
`[x]` **Bloque B** · /web

Interruptor claro / oscuro / sistema en la cabecera, con preferencia persistida por usuario.
Tokens de color en un solo lugar (hoy los colores viven sueltos en clases de Tailwind por toda
la interfaz): definir la paleta como variables y redefinirla para oscuro, sin duplicar
componentes. Las gráficas, los semáforos del monitor, los estados de alerta y la dona de formas
de pago tienen que seguir siendo legibles y distinguibles en oscuro — el semáforo de mesas
**en particular**, porque su único canal de información es el color.

**Listo cuando:** ninguna vista tiene texto bajo contraste 4.5:1 en ninguno de los dos temas
(test automatizado sobre la paleta, no a ojo); el tema elegido sobrevive recarga y cierre de
sesión; con "sistema" seleccionado, cambiar el tema del sistema operativo se refleja sin
recargar; y ningún color queda escrito a mano fuera de los tokens (regla de lint).

### F2-212 · Cabecera de operación en vivo y rango libre global
`[x]` **Bloque B** · /web

Unificar en la cabecera lo que hoy está repartido: indicador de **operación en vivo** (punto
verde con la hora de la última lectura y cuántas sucursales están reportando), selector de
empresa y sucursal, y **selector de periodo único** con los atajos actuales (Hoy, Esta semana,
Este mes, Mes anterior) más **rango libre con dos fechas**, compartido por todas las vistas que
usan periodo. El periodo y la sucursal elegidos viven en la URL, para que una vista se pueda
compartir por link tal como se está viendo.

**Listo cuando:** cambiar de periodo en una vista y navegar a otra conserva el periodo; pegar
la URL en otra pestaña abre exactamente la misma vista con el mismo periodo y sucursal; el
indicador dice "sin lectura reciente" en vez de una hora vieja cuando ninguna sucursal reporta;
y un rango invertido (fin antes que inicio) se corrige o se explica, no se manda a la API.

## BLOQUE C · Ventas y dirección

### F2-220 · Resumen ejecutivo
`[x]` **Bloque C** · /web + /api

Vista "Resumen": lo que un dueño quiere ver en veinte segundos sin filtrar nada. Ventas del día
contra el mismo día de la semana pasada (Δ y %), venta en curso, acumulado del mes contra el mes
anterior a la misma altura, mejor y peor sucursal del periodo, top 5 productos, ticket promedio
y comensales con su tendencia, y la lista de alertas activas (de F2-224 cuando exista; hasta
entonces, sucursales desconectadas y mesas de más de 60 minutos). Todo con su comparación: un
número sin referencia no dice nada.

**Listo cuando:** cada cifra de la vista coincide con la misma cifra calculada desde Tickets o
Inicio para el mismo periodo y sucursal (test de integración que las compara, no dos cálculos
distintos); un periodo sin ventas muestra "sin ventas en el periodo" y no `$0.00`; y una
sucursal sin datos en el periodo de comparación muestra "—" en el Δ, no un `+100%`.

### F2-221 · Análisis
`[x]` **ALCANCE:** sin el desglose por área y canal (no hay dato: lo completa F2-233, ver su nota "Y además (de F2-221)"); el test de suma del AC "para los tres" quedó para mesero y producto más los sustitutos hora × día y tiempo de mesa, y el de área va con F2-233. Cortesías siguen sin representarse (decisión abierta, esquema-sr §2). **Bloque C** · /web + /api

La vista que hoy no existe y que es la que convierte el panel en una herramienta de dirección:

- **Por mesero:** venta, nº de cuentas, ticket promedio, comensales, propina, cancelaciones y
  descuentos aplicados. Ranking y detalle.
- **Por producto:** importe, cantidad, participación en la venta, y ranking de los que más
  cayeron o subieron contra el periodo anterior.
- **Por hora × día de la semana:** mapa de calor de la venta, que es como se decide un horario
  o un turno.
- **Por área y canal:** venta y mezcla (comedor, mostrador, domicilio), cuando el dato exista.
- **Por tiempo de mesa:** duración promedio de la cuenta y rotación por mesa.

Cada bloque con su export CSV y su filtro por sucursal y periodo heredados de la cabecera.

**Listo cuando:** la suma de cualquier desglose (por mesero, por producto, por área) cuadra
exactamente con la venta total del mismo periodo, y hay un test que lo afirma para los tres;
cancelados y cortesías quedan fuera de la venta y visibles aparte; el mapa de calor distingue
"sin ventas" de "cero pesos" y es legible en los dos temas; y un desglose con más de 500 filas
pagina sin tumbar la vista.

### F2-222 · Tickets: filtros y detalle completos
`[x]` **ALCANCE:** la hora de la cancelación y los descuentos/cortesías por partida quedan pendientes de datos del POS (el contrato de ingesta no los trae; decisiones abiertas para Ricardo, esquema-sr §2 y §3): el detalle dice que el panel no los recibe y ubica la cuenta cancelada por su cierre o apertura. El código de facturación espera a F2-101. **Bloque C** · /web + /api

Subir la vista de Tickets a lo que se espera de un buscador de cuentas: filtros por sucursal,
mesero, mesa, forma de pago, rango de importe, canceladas sí/no/sólo, y búsqueda por folio
(ya existe) y por producto contenido en el ticket. Columnas ordenables. Detalle completo de la
cuenta: partidas con modificadores, descuentos y cortesías línea por línea, pagos con su
importe, propina, tiempo de mesa, y **el código de facturación cuando F2-101 exista**. Export
CSV de lo filtrado, no de todo.

**Listo cuando:** cada filtro aplicado se refleja en la URL y sobrevive recarga; el CSV exporta
exactamente las filas filtradas y su conteo aparece en pantalla antes de exportar; el detalle
de un ticket cancelado deja claro qué se canceló y cuándo; y combinar tres filtros a la vez
responde en menos de un segundo con 90 días de seed cargados.

### F2-223 · Monitor de mesas: paridad fina
`[x]` **Bloque C** · /web + /api

El monitor ya tiene lo esencial (KPIs de mesas abiertas, en curso, sin imprimir, semáforo,
detalle de consumo). Falta el pulido que lo vuelve la pantalla que se deja abierta todo el día:

- Ordenar por antigüedad, por importe o por mesa, con el criterio recordado.
- Filtro por sucursal y por estado (todas, sólo atención, sólo sin imprimir).
- KPI de **atención requerida** separado y clicable, que filtra a esas mesas.
- Tiempo transcurrido que avanza solo, sin recargar y sin repintar la vista entera.
- Vista de pared: modo pantalla completa con tipografía grande, pensado para una pantalla
  colgada en la cocina o la oficina, sin menú ni cabecera.
- En el detalle, productos **pendientes de imprimir** marcados, cuando el dato exista.

**Listo cuando:** con 60 mesas abiertas en el seed la vista mantiene 60 fps al avanzar el
reloj (el contador no provoca repintados fuera de su propia tarjeta, como ya se hizo con el
badge de agentes en F1-094); el orden y el filtro elegidos sobreviven recarga; la vista de
pared se lee a dos metros de distancia; y con todas las sucursales desconectadas la pantalla
dice por qué está vacía, sin inventar ceros.

### F2-224 · Centro de alertas
`[x]` **Bloque C** · /web + /api

Las alertas hoy están dispersas (el aviso de sucursal desconectada, el semáforo de mesas).
Unificar en un modelo propio: tipo, severidad, sucursal, momento de apertura, momento de cierre
y regla que la produjo. Reglas iniciales: sucursal sin reportar > 10 min, mesa abierta > 60 min,
cuenta sin imprimir > 30 min, caída de venta contra el mismo día de la semana anterior por
encima de un umbral, y (cuando existan) artículo bajo mínimo y saldo de folios bajo.

Campana en la cabecera con el conteo de alertas abiertas, panel con el historial, y umbrales
configurables por empresa desde Administración. Las alertas se **cierran solas** cuando la
condición deja de cumplirse, y el historial conserva ambas marcas de tiempo.

**Listo cuando:** una alerta que abre y cierra en el seed deja una sola fila con sus dos marcas,
no dos filas; cambiar un umbral recalcula las alertas abiertas sin reiniciar nada; el conteo
de la campana coincide siempre con las filas del panel; y una regla apagada deja de generar
alertas sin borrar el historial de las que ya había.

## BLOQUE D · Catálogos

### F2-230 · Catálogos espejo: modelo, ingesta y sincronización
`[x]` **Bloque D** · /api

> **Datos del seed:** persistir desde `api/prisma/seed-maestro/generarUniverso()` (F2-201),
> no inventar otros. Ver la nota "De dónde salen los datos del seed" bajo la tabla de
> cierre nocturno de las heredadas.

Cimiento de todo el bloque D y una pieza del E. Modelos espejo en Postgres de lo que vive en
SoftRestaurant, con `empresa_id`/`sucursal_id`, `origen_sr_id` para trazabilidad, `hash` del
registro para no reescribir iguales, y `visto_at` para detectar lo que desapareció del POS:
`Producto`, `GrupoProducto`, `Mesero`, `Cliente`, `Area`, `CanalVenta`.

Endpoint de ingesta de catálogos siguiendo el mismo contrato y la misma idempotencia que
`POST /ingesta/eventos` (F1-031): reenviar el mismo lote tres veces deja exactamente los mismos
datos. Sincronización completa diaria más forzado manual desde Administración. **Metadata
propia** (foto, descripción, etiquetas, mínimo/máximo) en tablas aparte que **sobreviven un
re-sync**, porque es nuestra y no del POS. Endpoints de lectura para el frontend, con el helper
de scope obligatorio, y contrato OpenAPI actualizado en el mismo entregable.

**Listo cuando:** el mismo lote enviado tres veces deja las mismas filas y el mismo `updated_at`
en las no modificadas; renombrar un producto actualiza y no duplica; un producto que desaparece
del lote queda marcado inactivo con su `visto_at`, **no se borra**; la metadata propia sigue ahí
después de un re-sync completo; y un visor de la empresa A recibe 404 (no 403) por un catálogo
de la empresa B.

### F2-231 · Meseros y rendimiento por mesero
`[x]` **Bloque D** · /web + /api

> **Datos del seed:** persistir desde `api/prisma/seed-maestro/generarUniverso()` (F2-201),
> no inventar otros. Ver la nota "De dónde salen los datos del seed" bajo la tabla de
> cierre nocturno de las heredadas.

Vista "Meseros": catálogo (nombre, clave, sucursal, activo) y ficha por mesero con su
rendimiento en el periodo — venta, cuentas, ticket promedio, comensales atendidos, propina,
tiempo promedio de mesa, cancelaciones y descuentos aplicados, y su posición en el ranking.
Comparación contra el promedio de la sucursal. Export CSV.

**Listo cuando:** la suma de la venta de todos los meseros del periodo es igual a la venta total
del periodo (test); un mesero dado de baja sigue apareciendo en periodos pasados con sus cifras;
y cancelaciones y descuentos se muestran como conteo e importe, nunca escondidos dentro de la
venta.

### F2-232 · Clientes
`[x]` **ALCANCE:** sin el enlace con `ReceptorFrecuente` por RFC (el modelo nace en F2-100: ver su nota "Y además (de F2-232)"); el id del cliente en el cheque es supuesto no validado (esquema-sr §2, F2-192). **Bloque D** · /web + /api

> **Datos del seed:** persistir desde `api/prisma/seed-maestro/generarUniverso()` (F2-201),
> no inventar otros. Ver la nota "De dónde salen los datos del seed" bajo la tabla de
> cierre nocturno de las heredadas.

Vista "Clientes" con lo que el POS registre (nombre, teléfono, correo, RFC si lo hay) más lo que
se puede derivar de los cheques: número de visitas, ticket promedio, última visita, productos
más pedidos. Si la instalación no usa clientes en SR, la vista lo dice con todas sus letras y
ofrece únicamente lo derivable; no se inventa una ficha vacía por cada cuenta. Los clientes
frecuentes de facturación (F2-100, `ReceptorFrecuente`) se enlazan con la ficha cuando coincida
el RFC.

**Listo cuando:** con el seed sin clientes en SR la vista explica por qué está vacía y qué
haría falta; con clientes, la ficha cuadra sus visitas y su ticket promedio contra Tickets
filtrado por ese cliente; y ningún dato personal aparece en logs ni en el CSV sin que el
usuario lo haya pedido explícitamente.

### F2-233 · Áreas, estaciones y canales de venta
`[x]` **ALCANCE:** sin estaciones (no hay espejo, contrato ni dato del POS: ver §8 de esquema-sr y las notas "Y además (de F2-233)" en F2-240 y F2-192); el área de la cuenta es supuesto no validado y hoy ningún agente la manda (esquema-sr §2, §13). **Bloque D** · /web + /api

> **Datos del seed:** persistir desde `api/prisma/seed-maestro/generarUniverso()` (F2-201),
> no inventar otros. Ver la nota "De dónde salen los datos del seed" bajo la tabla de
> cierre nocturno de las heredadas.

Catálogo de áreas (comedor, barra, terraza), estaciones y canales, con la venta de cada uno en
el periodo y su participación. Es la base sobre la que F2-144 construye la vista de delivery y
la que le da el corte "por área" a F2-221. Incluye el mapeo configurable **área del POS →
canal de negocio**, porque cada restaurante nombra las suyas distinto y ese mapeo es nuestro,
no del POS.

**Listo cuando:** la suma de la venta por canal es igual a la venta total del periodo, con una
fila explícita de "sin clasificar" cuando el cheque no trae área (nunca repartida a ojo);
cambiar el mapeo recalcula los periodos pasados sin re-ingerir nada; y el mapeo sobrevive un
re-sync de catálogos.

> **Y además (de F2-221):** completa el bloque **"Por área y canal"** de Análisis (`/analisis`).
> Hoy es un estado vacío con su explicación (`AREA_PENDIENTE` en
> `web/src/paginas/analisis/textos.ts`) porque `cheques` no guarda área ni canal. Hace falta:
> endpoint `GET /ventas/por-area` por el helper de scope (venta, cuentas y mezcla por área y por
> canal, con la fila "sin clasificar"), su DTO y OpenAPI, el bloque en la vista con su CSV y su
> paginación como los demás, y **el test que afirma Σ área = venta del periodo** (e2e a mano y
> sobre el seed, como `api/src/ventas/analisis.e2e.spec.ts` y el bloque F2-221 de
> `lectura.e2e.spec.ts`). Es el tercer desglose del AC de F2-221 que quedó pendiente.

## BLOQUE H · Agente

> **Estas dos tareas leen SoftRestaurant, y sólo leen.** No dependen de F1-090 para
> construirse: F1-090 valida **ventas y mesas**, que es lo que no se puede mapear sin ventas
> reales. Los **catálogos** (productos, meseros, áreas, insumos, almacenes, recetas) sí están
> en la base "CAFETERIA DEMO" que ya existe, y §6, §7, §8, §9 y §10 de `docs/esquema-sr.md`
> ya los documentan. Lo que estas tareas no pueden hacer de noche es **verificarse contra una
> operación real**: eso queda en Diurnas (F2-193).

### F2-240 · Lector de catálogos de SoftRestaurant
`[ ]` **Bloque H** · /agent

Extender `ISoftRestaurantReader` con la lectura de catálogos: productos con su grupo, precio y
estado; meseros; áreas y estaciones; clientes si la instalación los usa. Envío por el mismo
camino que ya existe (cola SQLite resiliente de F1-024) contra el endpoint de catálogos de
F2-230. Sincronización completa diaria a una hora configurable, más forzado bajo demanda desde
el panel, con **hash por catálogo** para no reenviar lo que no cambió.

Reglas de dominio, sin excepción: conexión de **solo lectura**, `WITH (NOLOCK)` en toda query,
timeout corto, y **cero escrituras** en la base del POS, ni siquiera una tabla auxiliar para
llevar el cursor — ese estado vive en el SQLite del agente. Lo que `docs/esquema-sr.md` no
cubra se resuelve con la opción más conservadora, se marca con
`# DECISION PROVISIONAL (nocturno):`, se anota en ese documento como supuesto y se sigue.

> **Lo que dejó F2-145 (precio).** `RegistroProductoDto.precio` ya existe en el contrato.
> **Omitirlo lo guarda NULO, también en una página incremental**: el lector manda SIEMPRE el
> precio que lee de SR, o una incremental borra precios del panel. Texto decimal (nunca número
> JSON), regla de DINERO. Ver `docs/esquema-sr.md` §6 (supuestos: un precio por producto y
> sucursal, IVA desconocido, el ticket usa el mismo nombre que el catálogo) y §13.

**Listo cuando:** `dotnet test` cubre la lectura contra **fixtures** (no contra una base viva)
para cada catálogo, incluyendo un catálogo vacío y uno con nombres con acentos, comillas y
`NULL`; correr la sincronización dos veces seguidas sin cambios en el POS **no encola nada** la
segunda vez; el agente registra en su log qué catálogo sincronizó, cuántas filas y en cuánto
tiempo; y `agente test` incluye una sonda que **falla ruidosamente** si el usuario SQL
configurado tiene permisos de escritura.

> **Y además (de F2-233).** (1) **Estaciones:** el panel no tiene espejo, contrato ni dato de
> estaciones (terminales o puntos de cobro): F2-233 las dejó fuera y la vista Áreas y canales lo
> dice. Si SR las tiene, este lector las busca y documenta en `docs/esquema-sr.md` §8 dónde
> viven; su espejo, contrato y desglose serían una tarea nueva. (2) **Área de la cuenta:** el
> contrato de `POST /ingesta/eventos` ya acepta `datos.areaOrigenSrId` (el MISMO `origenSrId`
> que este lector manda en el catálogo de áreas). Hoy **ningún agente lo manda**, así que en una
> instalación real toda la venta sale "sin clasificar" en Áreas y canales; lo llena el lector de
> cheques (F1-022) cuando exista, y **omitirlo lo guarda nulo** (el cheque viaja completo). Ver
> §2, §8 y §13.

> **Y además (de F2-120).** El forzado manual (`GET /ingesta/catalogos/solicitud`) sigue
> `pendiente` hasta que cierran los **ONCE** catálogos (los seis de F2-230 y los cinco de
> inventario). Un agente con este lector y sin los de F2-241 la deja pendiente: **no** la apaga
> cerrando el inventario con `total = 0` (eso da de baja todo lo que haya) y **no** se cicla
> resincronizando mientras siga pendiente; atiende cada `solicitadaAt` una vez y lo recuerda en su
> SQLite. Ver `docs/esquema-sr.md` §9 y §13.

### F2-241 · Lectores de inventario y recetas
`[ ]` **Bloque H** · /agent

Lo mismo para lo que come el bloque E: insumos, grupos de insumos, unidades, almacenes y
presentaciones; existencias por almacén con costo promedio, leídas cada 30 minutos; movimientos
de inventario con su póliza, incrementales por cursor persistido en SQLite; recetas con la
explosión de insumos por producto; compras si la instalación las registra. Mismas reglas de
dominio que F2-240, y ventana de relectura para capturar correcciones tardías, como hace
F1-022 con los cheques.

**Listo cuando:** `dotnet test` cubre cada lector contra fixtures, incluyendo existencias
negativas, insumos sin receta y una póliza con partidas en cero; el cursor de movimientos
sobrevive reiniciar el servicio y no reprocesa desde el principio; una query que tarde más del
timeout se cancela y se registra sin tumbar el ciclo; y el agente nunca abre una transacción de
escritura contra el POS (test que lo afirma inspeccionando el modo de la conexión).

> **Y además (de F2-120).** El panel ya acepta y guarda cinco catálogos de inventario por el
> mismo `POST /ingesta/catalogos` de F2-230: `unidades`, `grupos_insumo`, `insumos` (con
> `grupoOrigenSrId` y `unidadOrigenSrId`), `almacenes` y **`proveedores`** — este lector los lee
> TODOS, proveedores incluidos (si SR no tiene alguno, cierra con `total = 0`; el panel no lo
> inventa). El insumo manda SIEMPRE su grupo y su unidad: **omitirlos los guarda nulos, también
> en una página incremental**. El insumo no lleva costo (va con las existencias) y un campo de
> más rechaza el registro. **Presentaciones** (empaques de compra) y **productos-receta** no tienen
> espejo: si SR las tiene, documentar en `docs/esquema-sr.md` §9 dónde viven; su espejo y
> contrato serían tarea nueva (recetas: F2-125). Ver §9 y §13.

> **Y además (de F2-121).** El panel ya acepta las existencias por `POST /ingesta/existencias`:
> una petición = la **foto completa de UN almacén** (`almacenOrigenSrId`, `capturadoAt` = cuándo se
> leyó, y `registros: [{ insumoOrigenSrId, cantidad, costoPromedio }]`), cada 30 min. Obligaciones
> del lector: (1) mandar **TODAS** las filas del almacén, también las que están en **0 y las
> negativas** — lo que no viene se borra del panel y un agotado desaparecería; (2) cantidad en texto
> NUMERIC(12,3) y costo promedio en texto con la regla de dinero (se redondea a 2); (3) **nunca**
> mandar una foto vacía si la lectura falló (0 registros vacía el almacén); (4) a lo más 5000
> registros por foto — si un almacén real tiene más, documentarlo y es cambio de contrato; (5) un
> registro sin `insumoOrigenSrId` válido hace que esa foto no borre nada (no romperlo a propósito).
> Documentar en §10 si el costo promedio de SR es por almacén o por insumo. Ver
> `docs/esquema-sr.md` §10 y §13.

> **Y además (de F2-124).** Los traspasos de SR viajan como pólizas F2-122 y el panel concilia contra
> ellas los traspasos que se capturan en la web: (1) un documento de traspaso de SR se manda como
> DOS pólizas —`traspaso_salida` (cantidades negativas) en el almacén de origen y `traspaso_entrada`
> (positivas) en el de destino, cada una desde el agente de SU sucursal— con la `referencia` del
> documento en las dos; (2) la `fecha` con la hora real del movimiento, no medianoche; (3) si SR
> cancela el traspaso, mandar las dos pólizas con `cancelada = true` (así el panel lo desconcilia);
> (4) documentar en §10 cómo guarda SR un traspaso entre sucursales (un documento o dos) y si hay
> almacenes compartidos. Ver `docs/esquema-sr.md` §10 ("Traspasos").

> **Y además (de F2-122).** El panel ya acepta los movimientos por `POST /ingesta/movimientos`: un
> **lote de pólizas**, cada una con TODAS sus partidas (`{ leidoAt, polizas: [{ origenSrId, folio,
> tipo, tipoSr, almacenOrigenSrId, fecha, referencia, cancelada, partidas: [{ insumoOrigenSrId,
> cantidad, costoUnitario }] }] }`). Obligaciones del lector: (1) la póliza viaja **completa** —
> reenviarla con otras partidas las REEMPLAZA, así que una póliza a medias borra renglones; (2)
> cantidad **con signo** (+ entra, − sale) en texto NUMERIC(12,3) y costo con la regla de dinero (el
> importe lo calcula el API); (3) traducir el tipo de SR al enum del panel y mandar el crudo en
> `tipoSr` (lo que no sepa traducir, `otro`); (4) un almacén por póliza: un traspaso de SR con origen
> y destino son DOS pólizas con ids distintos; (5) una póliza cancelada o desaparecida en SR se
> manda `cancelada = true`, nunca se deja de mandar (el panel no borra); (6) `leidoAt` = cuándo se
> leyó (un lote viejo reintentado no revierte uno nuevo) y la `fecha` del movimiento del MISMO reloj
> que el `capturadoAt` de las existencias (el cuadre del kardex corta ahí); (7) a lo más 200 pólizas
> y **5000 partidas en total** por lote — partir por partidas; (8) el cursor incremental y la
> ventana de relectura reenvían pólizas corregidas completas. Documentar en §10 si SR agrupa sus
> movimientos en documentos y cómo ordena los folios (el desempate del kardex es el folio como
> texto). Ver `docs/esquema-sr.md` §10 y §13.

> **Y además (de F2-125).** El panel ya acepta las recetas por `POST /ingesta/recetas`: un **lote de
> recetas**, cada una con TODOS sus renglones (`{ leidoAt, recetas: [{ productoOrigenSrId,
> renglones: [{ insumoOrigenSrId, cantidad }] }] }`). Obligaciones del lector: (1) la receta viaja
> **completa** — reenviarla con otros renglones los REEMPLAZA; (2) una receta que SR ya no tenga se
> manda con `renglones: []`, nunca se deja de mandar (el panel no la borra y seguiría usando la
> vieja); (3) cantidad en la **unidad del insumo** del catálogo y por **UNA unidad vendida**, texto
> NUMERIC(12,4) sin signo — más de 4 decimales se rechaza, no redondear; (4) `productoOrigenSrId` e
> `insumoOrigenSrId` = los mismos ids de los catálogos `productos` e `insumos` de la sucursal; (5) a
> lo más 500 recetas y 5000 renglones por lote. Documentar en §10 dónde guarda SR la receta, si usa
> una unidad de receta con factor, si tiene subrecetas (elaborados) y si explota modificadores o
> paquetes — cualquiera de esas es cambio de contrato. Ver `docs/esquema-sr.md` §10 ("Recetas") y §13.

> **Y además (de F2-126).** El panel ya acepta las compras a proveedor por `POST /ingesta/compras`:
> un **lote de compras**, cada una con TODAS sus partidas (`{ leidoAt, compras: [{ origenSrId, folio,
> proveedorOrigenSrId?, almacenOrigenSrId?, fecha, cancelada, partidas: [{ insumoOrigenSrId,
> cantidad, costoUnitario }] }] }`). Obligaciones del lector: (1) la compra viaja **completa** —
> reenviarla con otras partidas las REEMPLAZA; (2) `cancelada = true` en vez de dejar de mandarla (el
> panel no la borra); (3) cantidad > 0 en la **unidad del insumo** del catálogo (NUMERIC(12,3)) y
> costo por unidad **SIN IVA**, en texto; (4) proveedor y almacén por los ids del espejo de la misma
> sucursal, o nulos; (5) a lo más 200 compras y 5000 partidas por lote. Documentar en §10 si SR guarda
> la compra como documento propio o sólo como póliza de entrada (hoy se supone documento aparte y el
> panel NO los concilia), y si el costo de SR trae IVA. Ver `docs/esquema-sr.md` §10 ("Compras,
> gastos y utilidad") y §13.

## BLOQUE I · Cierre

### F2-250 · Cierre de Ronda 2: auditoría de paridad y pendientes
`[ ]` **Bloque I** · todos

Última de la cola. Tres cosas, y ninguna es escribir funcionalidad nueva:

1. **Auditoría de paridad.** Recorrer la lista de capacidades de la Ronda 2 y producir
   `docs/paridad.md`: qué se construyó, qué quedó con supuesto provisional, y qué está
   esperando validación diurna. Una tabla honesta, con el estado real de cada módulo, que es lo
   que Ricardo va a leer antes de enseñar el producto.
2. **Cosecha de pendientes.** Recorrer `docs/nocturno-log.md` de toda la ronda y recoger cada
   "queda abierto", cada `DECISION PROVISIONAL (nocturno)` del código y cada supuesto anotado
   en `docs/esquema-sr.md`. Los que se puedan cerrar en la sesión, se cierran; los que no, se
   escriben como tareas nuevas al final de este backlog con su "Listo cuando", para que no
   queden sólo en un log que nadie relee.
3. **Salud del repo.** `npm audit` sin vulnerabilidades altas o con cada una justificada;
   tamaño del bundle bajo su tope; tests verdes en los tres carriles y sin skips; contrato
   OpenAPI al día con todos los endpoints nuevos; `README.md` y `0-INSTALACION.md`
   describiendo el producto que de verdad existe al terminar la ronda.

> **Y además (de F2-110).** ❓ Decisión abierta para Ricardo: el "saldo de folios bajo" NO entró
> al centro de alertas (`folios_bajo`, nota de F2-224): las alertas son por empresa y sucursal y las
> ven los clientes, y el saldo es de la PLATAFORMA. Hoy avisa por correo al admin_global y se ve en
> Facturación → Folios. Si se quiere en la campana, hace falta un centro de alertas de plataforma
> (sólo admin_global): decidir y, si sí, escribirlo como tarea. Ver esquema-sr §2 "Control de folios
> (F2-110)".

> **Y además (de F2-110b).** Tres huecos conocidos de la conciliación con el PAC, a revisar en la
> auditoría: (1) una reserva LIBERADA (dos búsquedas vacías separadas 15 min) que el PAC listara
> después no se detecta; (2) una cancelación hecha FUERA del sistema (portal de Facturama) no se
> detecta: sólo se re-consultan las `sin_confirmar`, no todos los vigentes; (3) una reserva que se
> confirma aunque el PAC ya la reporta cancelada sólo se dice en `requierenRevision` (tarjeta del
> tablero y log): no queda marcada en la base. Decidir si alguno amerita tarea. Ver esquema-sr §2
> "Conciliación con el PAC (F2-110b)".

> **Decisión abierta que dejó F2-140:** Comparativos compara **una empresa a la vez** (la de la
> cabecera); la dimensión "empresa" de la matriz, para admin_global, no se construyó. Costo de
> hacerlo en el front: N empresas × 4 consultas (`resumen` y `comparativo-sucursales`, A y B).
> Alternativa: un endpoint agregado por empresa en `/ventas/*`. Decidir si se hace y, si sí,
> escribirlo como tarea con su "Listo cuando".

**Listo cuando:** `docs/paridad.md` existe y cada renglón suyo apunta a código o a una tarea;
no queda ningún `DECISION PROVISIONAL` sin su entrada en `docs/esquema-sr.md`; los tres
carriles pasan sus checks; y el backlog termina con la lista de lo que falta, que es lo que
arranca la Ronda 3.

---

## Cierre nocturno de las tareas heredadas de Fase 2

Las tareas F2-100 … F2-147 se redactaron pensando en un piloto real, un PAC contratado y una
bandeja de correo de verdad. Su redacción original **se queda como está** —es la definición de
"terminado de verdad"— pero **de noche no se puede medir así**, y una sesión que lo intente
salta una tarea que sí podía construir.

**Regla:** para las tareas de esta lista, el "Listo cuando" que manda en una sesión nocturna es
el de aquí abajo. El original queda vivo y se verifica en su tarea Diurna correspondiente
(F2-190 a F2-194). Una tarea cerrada de noche con este criterio **se marca `[x]` con la nota
`**PENDIENTE DE VALIDACIÓN REAL:** ver F2-19x`** en la misma línea del backlog.

| Tarea | Lo que sustituye al AC original, de noche |
|---|---|
| **F2-100** Datos fiscales y CSD | El alta de perfil fiscal y la carga de CSD funcionan contra `PuertoTimbrado` falso: el `.key` y su contraseña **nunca tocan nuestra base ni un log** (test que inspecciona ambos), un archivo inválido da error claro sin guardar nada, y la vista calcula y muestra vigencia y alerta de < 30 días a partir de la metadata. |
| **F2-101** Código corto | Formato, unicidad por constraint, reintento ante colisión, expiración configurable y endpoint público con su rate limit, todo medido sobre el seed. Un código expirado, uno facturado y uno inexistente responden distinto y ninguno filtra datos del ticket. |
| **F2-103** Portal de autofactura | Flujo completo de las tres pantallas contra el puerto falso, probado en viewport de celular; validación de RFC, régimen, uso de CFDI y CP campo por campo en español; un código ya facturado ofrece re-descargar; branding por sucursal. |
| **F2-104** Emisión de CFDI | El JSON que se construye queda fijado por **test de contrato** (snapshot revisado a mano contra la documentación de Facturama): emisor, receptor, concepto `90101500`, unidad `E48`, importes desde el cheque, forma de pago mapeada, `PUE`, MXN. Doble clic no emite dos veces (lock por código). Los errores del PAC se mapean a mensajes en español a partir de la tabla de códigos documentada. |
| **F2-105** Entrega | XML y PDF se guardan por `PuertoArchivos` en la ruta correcta y sobreviven reinicio; el correo sale por `PuertoCorreo` falso con ambos adjuntos y su plantilla; si el puerto falla, queda registrado para reintento y el portal sigue ofreciendo la descarga. |
| **F2-106** Dashboard de facturación | Todas las cifras cuadran contra los datos de ventas de Fase 1 y contra los CFDI del puerto falso para el mismo rango (test que compara, no dos cálculos); filtros, barras por sucursal/mes/hora, tabla con búsqueda por RFC/UUID/folio y export CSV. |
| **F2-107** Sin ticket y refacturación | La refacturación deja el CFDI viejo cancelado con relación al nuevo y el nuevo con `TipoRelacion 04`, verificado sobre el puerto falso; la captura manual queda marcada `origen=manual` y se distingue en el dashboard. |
| **F2-108** Factura global | La estructura de periodicidad/meses/año del CFDI global se fija por test de contrato; un ticket incluido en una global ya no se puede autofacturar y el portal lo explica con el periodo correcto. |
| **F2-109** Cancelación | Los cuatro motivos SAT, la exigencia de UUID sustituto con motivo 01, los estados intermedios y el efecto en la tasa de facturación, todo contra el puerto falso. |
| **F2-110** Folios | Con saldo simulado en 0 la emisión se bloquea **antes** de llamar al puerto; el reporte mensual cuadra con los CFDI del periodo; la alerta de umbral y la de vigencia anual disparan sobre relojes falsos. |
| **F2-110b** Conciliación | Contra el puerto falso con reloj falso: cada origen colgado (ticket, sin ticket, sustituto, global) se confirma si el PAC timbró y se libera si no; un vigente cancelado en el PAC queda cancelado; la 01 pendiente se cierra; los archivos faltantes se recuperan; el método nuevo del puerto queda fijado por test de contrato. El real contra el sandbox es F2-190. |
| **F2-120 … F2-127** Inventario | Se cierran **contra el seed de F2-201**, no contra el piloto: cada cifra cuadra con lo que el seed generó y hay un test que lo afirma. El kardex reproduce el saldo desde el inicial más movimientos; conteos y traspasos **no escriben a SR** (test que lo afirma sobre el agente); las recetas listan aparte los productos sin receta; la proyección se mide contra una semana simulada del propio seed. |
| **F2-140** Comparativos | Cuadra contra los dashboards individuales para el mismo periodo, con test; sucursal sin datos muestra "—". Ya era cerrable tal cual. |
| **F2-141** Reportes programados | El correo sale por `PuertoCorreo` falso a la hora correcta en la zona de la empresa (reloj falso), con cifras que cuadran contra el panel; la baja funciona sin sesión iniciada. |
| **F2-142** WebSocket | Medido en local: un evento de ingesta se ve en el monitor en < 5 s; matar el socket degrada a polling sin perder datos; el socket exige el mismo JWT y rechaza uno vencido. |
| **F2-143** Auto-update | Medido contra un canal de versiones local y un binario de prueba: hash inválido aborta y alerta; el rollout por sucursal respeta su bandera; nunca quedan dos versiones corriendo. La prueba en una máquina real es Diurna. |
| **F2-144** Delivery / canales | Sobre las áreas y canales de F2-233 y el seed: la mezcla por canal cuadra con el total. El spike de `docs/delivery.md` documenta lo que se sabe hoy y lo que falta ver en una instalación real. |
| **F2-145** Productos / orquestador | Sobre el catálogo del seed, que incluye a propósito el mismo producto con precio distinto entre sucursales: la discrepancia aparece señalada; la metadata propia sobrevive un re-sync. |
| **F2-146** PWA | Instalable desde Chrome de escritorio; el service worker sirve el armazón sin red; las notificaciones se prueban con VAPID local; cada alerta se apaga por separado. |
| **F2-147** Landing y onboarding | Lighthouse > 90 en local; el asistente de alta deja una empresa nueva con sucursales, llaves generadas y su checklist, medido con un cronómetro en el test de flujo. |

> **De dónde salen los datos del seed (lo dejó F2-201).** Catálogos, inventario, recetas,
> compras y gastos ya se generan, puros y deterministas, en `api/prisma/seed-maestro/`
> (`generarUniverso()`, que en `seed-ventas.ts` se obtiene con `universoDe(op, cheques)`),
> simulados contra las ventas del propio seed. **No tienen tabla todavía:** la tarea que crea
> la tabla **persiste desde ahí** en su `sembrar…()` y su test cuenta las filas en la base.
> Quién persiste qué: F2-230 grupos, productos, meseros y clientes · F2-145 precios por
> sucursal · F2-233 áreas y canales · F2-120 unidades, grupos de insumo, insumos, almacenes y
> proveedores · F2-121 existencias · F2-122 pólizas y movimientos (F2-123 conteos, F2-124
> traspasos) · F2-125 recetas · F2-126 compras y gastos. Los datos por cheque que la tabla
> `cheques` aún no guarda (área, canal, cliente, clave de mesero y de producto) vienen en
> `ChequeSeed.maestro` y `PartidaSeed.productoClave`.

> **F2-102 (QR en el ticket) no entra a la cola nocturna.** Necesita una impresora, una
> plantilla real de SoftRestaurant y decidir si el QR lo imprime el POS o el agente. Vive en
> Diurnas.

---

# DIURNAS — requieren a Ricardo o acceso externo

**Estas tareas NO se toman de noche.** No están bloqueadas por el grafo: están bloqueadas
por el mundo. Cada una necesita algo que una sesión autónoma no tiene —un servidor que
alguien contrató, un secreto que alguien pega, un restaurante real— y ninguna cantidad de
código las cierra.

Si la Cola nocturna se vacía, **no bajes aquí**: crea `COLA_VACIA.txt` y termina.

## F1-001b · Verificar `docker compose up` del Postgres local
`[ ]` **Epic 0** · 🔒 **Razón: necesita una máquina con virtualización habilitada en BIOS.**
Resto del corte de F1-001: todo lo demás de su "Listo cuando" quedó verificado (PR #2).
La máquina donde se cerró no puede arrancar el engine de Docker, así que sólo se validó
`docker compose config`. No hay código que escribir salvo que el `up` destape un fallo.

**Listo cuando:** `docker compose up -d` en `/infra` deja el contenedor `monitor-sr-postgres`
en estado `healthy`; `psql` con las credenciales de `infra/.env.example` conecta y la base
`monitor` está vacía (sin tablas); `docker compose down` lo detiene limpio.

## F1-020b · Verificar el instalador y el servicio del agente con consola elevada
`[ ]` **Epic 2** · 🔒 **Razón: necesita una consola elevada (administrador), reiniciar la
máquina y decidir escribir un login en el SQL Server de la SR local.** Resto del corte de
F1-020 **y de F1-026**: el código, `agente test`, `instalar.ps1`, `crear-usuario-lector.ps1`
y su `.sql` están entregados y probados hasta donde se puede sin elevación (ver
`docs/nocturno-log.md`), pero ninguna sesión nocturna ha tenido elevación, y crear el login
es escribir en el servidor del POS, que lo autoriza Ricardo.

**Listo cuando:**
1. **Lector (F1-026), en la SR local de desarrollo** (`.\NATIONALSOFT`, `softrestaurant10`),
   con autorización de Ricardo: `crear-usuario-lector.ps1` termina en "LISTO"; correrlo
   otra vez repone la contraseña sin fallar; `agente test` con `monitor_lector` da **OK en
   SQL** (sin "permisos de escritura") y el servicio detecta la versión y su sonda responde,
   lo que valida el supuesto de §1/§11 de que `db_datareader` alcanza. Al menos una rama de
   "ALTO" probada (p. ej. darle `db_datawriter` a mano y volver a correr: se detiene sin
   cambiar nada; luego quitárselo).
2. **Instalador (F1-026):** `instalar.ps1` en una consola de administrador deja el servicio
   `ArkonAgente` en `RUNNING` **con la cuenta virtual `NT SERVICE\ArkonAgente`**, el
   `icacls` deja la carpeta sólo para SYSTEM, Administradores y el SID del servicio
   (`icacls C:\ProgramData\ArkonAgente` lo muestra), el servicio escribe su log y `cola.db`
   con esa cuenta, y en el panel la sucursal sale "Conectado". Volver a correrlo (actualizar)
   conserva `config.json` y `cola.db`. Si la cuenta virtual no funciona, se documenta por qué
   y se cambia el default a `LocalSystem` (quitar la `DECISION PROVISIONAL (nocturno)` de
   `instalar.ps1`).
3. **Servicio (F1-020):** tras reiniciar
Windows arranca solo (`sc query` = `RUNNING` sin tocar nada) y escribe en
`C:\ProgramData\ArkonAgente\logs\agente-AAAAMMDD.log`; matando el proceso
(`taskkill /F /IM agente.exe`) el administrador de servicios lo levanta de nuevo en ≤ 1 min;
una **falla interna** también lo levanta: con un build de prueba que lance una excepción
dentro del ciclo del worker (hoy no hay manera de provocarla desde afuera, porque el ciclo
todavía no tiene trabajo), el log registra `Critical` + "código 1" y el servicio vuelve a
`RUNNING` en ≤ 1 min;
`sc stop` lo detiene limpio y el log dice "Agente detenido.".

La medición de "una persona no técnica en < 15 minutos" de F1-026 **no** es de aquí: es de
F1-091, con una persona real.

> **Y además (de F2-143):** la auto-actualización se probó de noche con el administrador de
> servicios SIMULADO (`ActualizacionTests`, `docs/actualizacion-agente.md`). Aquí, con elevación:
> `instalar.ps1` deja también `ArkonAgenteActualizador` en `RUNNING` como **LocalSystem**
> (`DECISION PROVISIONAL (nocturno)` en `funciones-instalador.ps1`); publicar en el panel una
> versión con la bandera de la sucursal encendida la instala sola (`sc query ArkonAgente` sigue
> `RUNNING`, el panel la ve "Al día" y `logs\actualizador-*.log` cuenta el swap); una versión que
> se cae al arrancar regresa sola a la anterior (queda `agente.exe.fallido`); con el agente
> detenido a mano durante el swap no quedan dos procesos `agente.exe` del agente
> (`Get-Process agente | Select Path`); matar el watchdog a media sustitución (entre mover
> `agente.exe` a `.anterior` y poner el nuevo) y confirmar que en su siguiente vuelta restaura el
> anterior y arranca el servicio; y la cuenta virtual del agente puede borrar el
> `resultado.json` que escribe el watchdog (herencia del `icacls` de la carpeta).

## F1-002 · Docker Compose de producción + Caddy
`[ ]` **Epic 0** · 🔒 **Razón: necesita el VPS contratado y el dominio con DNS apuntando.**
El AC se mide *en el VPS*, con Caddy emitiendo certificados reales contra Let's Encrypt.
Sin DNS resuelto no hay certificado, y sin servidor no hay dónde levantarlo.

`infra/docker-compose.yml` con servicios: `postgres:16` (volumen nombrado, healthcheck),
`api` (build multistage Node 22 alpine), `caddy` (puertos 80/443). `Caddyfile`:
`api.DOMINIO` → api:3000, `app.DOMINIO` → estáticos del build de `/web` (montados o
servidos por Caddy `file_server`), redirect www. Variables en `.env` (nunca commiteado;
incluir `.env.example` completo).

**Listo cuando:** en el VPS, `docker compose up -d` deja https funcionando con certificado
válido en ambos subdominios; `GET /health` responde `{status:'ok', db:'ok'}`.

> **Y además (de F2-142):** verificar en el VPS que el socket del monitor sube a WebSocket
> detrás de Caddy. El navegador lo pide en `/api/socket.io`, y `handle_path /api/*` +
> `reverse_proxy` debería pasar el upgrade sin config extra. Con DevTools → Network → WS, la
> conexión debe salir `101 Switching Protocols` y la CSP `connect-src 'self'` no debe
> bloquearla. Si el upgrade falla, socket.io se queda en long-polling y funciona igual, pero
> hay que saberlo. Mientras haya **una sola** instancia del api no hace falta el adapter de
> Redis (`docs/tiempo-real.md`, "Límites conocidos").
>
> **Y además (de F2-146):** servir `sw.js` con `Cache-Control: no-cache` (si no, un service
> worker viejo tarda en cambiar) y `manifest.webmanifest` como `application/manifest+json`;
> comprobar que Caddy deja pasar el cuerpo de `DELETE /api/cuenta/notificaciones/dispositivos`,
> y que `trust proxy` hace que el throttler de `POST /cuenta/notificaciones/prueba` vea la IP
> real y no la de Caddy (`docs/notificaciones.md`, "Producción").
>
> **Y además (de F2-147):** servir la landing (`web/dist-landing/`, lo arma `npm run build`) en el
> dominio raíz, y pasar `/api` al api **también en ese dominio** (el formulario postea a
> `/api/publico/contacto` en el mismo origen: no se abre CORS). Si el panel vive en otro
> subdominio, construir la landing con `URL_PANEL=https://…/login` (a dónde lleva "Entrar al
> panel"). `trust proxy` también importa aquí: el límite del contacto (3/min, 20/h) es por IP.
> Correr `npm run lighthouse:landing` contra el dominio real (`docs/onboarding.md`).

## F1-003 · CI/CD con GitHub Actions
`[ ]` **Epic 0** · 🔒 **Razón: necesita los secretos SSH del VPS en GitHub Actions.**
Ricardo genera el par de llaves y pega el secreto; una sesión autónoma no toca llaves de
producción ni despliega (está prohibido explícitamente en `CLAUDE.md`).

Workflow 1 (PR): lint + typecheck + tests de `/api` y `/web`, `dotnet build` de `/agent`.
Workflow 2 (push a `main`): build de imágenes, `docker save`/scp o registry, SSH al VPS,
`docker compose up -d`, migración Prisma (`migrate deploy`) antes de levantar api nueva.

**Listo cuando:** merge a main despliega solo, sin pasos manuales; si la migración falla, no
se reemplaza el contenedor viejo.

> **Nota:** el Workflow 1 ya existe y vive en `.github/workflows/ci.yml` desde el commit
> inicial del repo; las tareas de la cola lo van descomentando carril por carril. Lo que
> esta tarea agrega de verdad es el **Workflow 2, el de deploy**.

## F1-004 · Backups y monitoreo
`[ ]` **Epic 0** · 🔒 **Razón: necesita el VPS (cron del host), una cuenta de
almacenamiento remoto para rclone y el alta de monitores en UptimeRobot.** El AC exige
restaurar un dump de verdad y tirar el api a mano.

Script `infra/backup.sh`: `pg_dump -Fc` nocturno vía cron del host, retención 14 días
local, sincronización con rclone a remoto configurable. Documentar restauración en
`/docs/restore.md` y probarla una vez. Alta de monitores UptimeRobot para
`https://api.DOMINIO/health` y `https://app.DOMINIO`.

**Listo cuando:** existe un dump de prueba restaurado con éxito en un postgres efímero;
UptimeRobot notifica por correo al tirar el api manualmente.

## F1-090 · Mapeo validado del esquema de SR ⚠️ BLOQUEANTE de F1-022/023
`[ ]` **Epic 7** · 🔒 **Razón: necesita acceso a una instalación real (o demo) de
SoftRestaurant.** Es la tarea que convierte todos los supuestos del proyecto en hechos. No
hay forma de adivinarla: o se mira la base, o no se sabe.

Con acceso a una instalación real (o demo) de SoftRestaurant: documentar en
`/docs/esquema-sr.md` las tablas/columnas reales de cuentas cerradas, abiertas, pagos,
productos y meseros para la versión disponible, con queries de ejemplo probadas y capturas.
Ajustar `SrV11Reader` a lo encontrado.

**Listo cuando:** los datos que muestra el panel cuadran **peso a peso** contra los reportes
nativos de SR del mismo día (venta total, nº de cuentas, formas de pago).

> **Atacar EN CUANTO haya acceso a un SR real.** Es el cuello de botella de toda la Fase 1:
> mientras no cierre, F1-022 y F1-023 no se pueden escribir de verdad y el agente no lee
> nada real.
>
> **Nota de F1-021.** En la PC de desarrollo ya hay un **SR 10 instalado**: instancia
> `.\NATIONALSOFT`, base `softrestaurant10`, SQL Server 2014 Express. F1-021 lo usó sólo
> para ver catálogo y la versión (esquema-sr §1, §11). Lo que falta de esta tarea:
> - mapear columnas contra esa base;
> - probar el agente con un usuario **`db_datareader`** real: la detección nunca corrió
>   con él, sólo con sysadmin;
> - si hay acceso a un SR 11, confirmar que usa `parametros2.versiondb` y el mismo
>   esquema. Hoy es SUPUESTO y el agente lo marca con un Warning.

## F1-022 · Lectura de ventas cerradas (cheques)
`[ ]` **Epic 2** · 🔒 **Razón: bloqueada por F1-090.** El mapeo de tablas no está validado;
escribir esta query contra un esquema supuesto es escribirla dos veces. Y el AC se mide
cerrando una cuenta en SoftRestaurant de verdad.

Query incremental sobre cuentas cerradas (tablas tipo `cheques`/`cheqdet`/`chequespagos`
según mapeo validado): folio, fecha apertura/cierre, mesa, mesero, comensales, subtotal,
impuestos, total, descuentos, propina, forma(s) de pago con montos, y detalle de partidas
(producto, cantidad, precio, modificadores). Cursor incremental persistido en SQLite
(`ultimo_folio_procesado` + ventana de relectura de 2 h para capturar reaperturas/
cancelaciones).

**Listo cuando:** cerrar una cuenta en SR aparece en la cola del agente en ≤ 1 ciclo;
reprocesar el mismo folio no duplica (la idempotencia final la da el API, pero el agente no
debe reenviar en bucle).

> **Nota de F1-021 — decisión abierta que esta tarea NO puede pasar por alto.** Falta que
> Ricardo decida si el agente debe **negarse a leer SR con un usuario que puede escribir**.
> Hoy el diagnóstico marca FALLA y el servicio sólo registra un Warning y sigue
> (`DECISION PROVISIONAL (nocturno)` en `Worker.cs`, `DiagnosticarAsync`). Hasta F1-021
> eso bastaba: el agente sólo lee catálogo y una fila de `parametros2`.
>
> Si esta tarea llega y Ricardo no ha decidido, la opción conservadora es **NO leer las
> tablas de operación** (`cheques`, `tempcheques`...) cuando el diagnóstico encontró
> permisos de escritura. Eso va con un error claro en el log y en el heartbeat.
>
> Otras cosas que F1-021 deja para aquí:
> - Existe `ISoftRestaurantReader`, con `SrV11Reader` como implementación. Los métodos de
>   lectura se agregan ahí.
> - Toda query sale de `ConexionSoftRestaurant.CrearComando`, que pone el timeout corto.
> - `ConsultasEmbebidasTests` exige `WITH (NOLOCK)` en todo `FROM`/`JOIN` y prohíbe los
>   joins con coma y `APPLY`.
> - La base es SQL Server 2014: no hay `STRING_AGG` (esquema-sr §11).
> - Si una lectura falla porque SR se actualizó con el agente corriendo, hay que volver a
>   detectar la versión. Hoy sólo se detecta al arrancar.
>
> **Nota de F1-024 — cómo encolar.** `ColaLocal.Encolar(TipoEvento.Cheque, payloadJson)`,
> donde `payloadJson` es el `datos` de `DatosChequeDto` (api/src/ingesta/dto/ingesta.dto.ts)
> como objeto JSON, importes en texto. **Tiene que traer `folioSr`**: es la clave de la cola.
> Encolar un folio que ya tiene un pendiente **borra el pendiente viejo** (sólo viaja la última
> versión), así que re-encolar en cada relectura de la ventana de 2 h no duplica ni crece; lo
> que sí conviene es no re-encolar un cheque que no cambió, para no reenviarlo en cada ciclo.
> Se encola en `Worker.CicloAsync`, **antes** de `envio.CicloAsync`. El cursor incremental
> puede vivir en el mismo `cola.db` (tabla propia), nunca en SR.
>
> **Nota de F1-025 — la "última lectura" hoy es una sonda.** El heartbeat saca
> `ultimaLecturaAt` y `latenciaQueryMs` de `SondeoSr` (`sr_sondeo.sql`, una fila de
> `parametros2`), porque todavía no se leen ventas. Es `DECISION PROVISIONAL (nocturno)`:
> cuando esta tarea lea cheques, **su lectura reemplaza a la sonda** como fuente de las dos
> cifras (registrarla con `EstadoSoftRestaurant.RegistrarSondeo` o un método hermano) y la
> sonda se quita o se deja sólo cuando no hay lectura. El ciclo ya está armado:
> `Worker.UnCicloAsync` = `ConsultarSrAsync` → `EncolarHeartbeat` → `envio.CicloAsync`. Los
> cheques se encolan dentro de `ConsultarSrAsync` (antes del heartbeat, para que
> `tamanoCola` los cuente). Una excepción ahí **no corta el ciclo** (se registra y va a
> `ultimoError`); no la dejes escapar.

## F1-023 · Lectura de cuentas abiertas (mesas en vivo)
`[ ]` **Epic 2** · 🔒 **Razón: bloqueada por F1-090.** Mismo caso que F1-022: las tablas
temporales de cuentas abiertas son justo donde más varía SoftRestaurant entre versiones.

Query sobre tablas temporales de cuentas abiertas (tipo `tempcheques`/`tempcheqdet`): mesa,
mesero, hora de apertura, comensales, partidas con modificadores y precios, total
acumulado, impreso sí/no. Se manda snapshot completo de abiertas en cada ciclo (no delta),
etiquetado con timestamp de lectura.

**Listo cuando:** abrir/modificar/cerrar una mesa en SR se refleja en el snapshot del
siguiente ciclo; una mesa cerrada desaparece del snapshot y su cheque llega por F1-022.

> **Nota de F1-024 — cómo encolar.** `ColaLocal.Encolar(TipoEvento.Snapshot, payloadJson)`
> con el `datos` de `DatosSnapshotDto` (`capturadoAt` + `mesas`). Encolar un snapshot borra el
> pendiente anterior: la cola nunca guarda más de uno sin mandar. Se encola en
> `Worker.CicloAsync`, antes de `envio.CicloAsync`. Ojo con el tope de 5 MB por lote (medido
> ya inflado): un snapshot que solo no cabe se rechaza para siempre (413).

## F1-091 · Prueba end-to-end piloto
`[ ]` **Epic 7** · 🔒 **Razón: necesita un restaurante piloto real (o una VM con SR demo
operada como restaurante durante dos días) y una persona operándolo.** Es el cierre de fase
y la puerta de toda la Fase 2.

Instalar el agente en 1 restaurante piloto (o VM con SR demo operada como restaurante
durante 2 días). Checklist: instalación < 15 min, cero impacto perceptible en el POS, datos
vivos correctos, reconexión tras corte de internet, deploy de una actualización del api sin
perder ingesta.

**Listo cuando:** checklist firmado; bugs encontrados convertidos en issues y resueltos
antes de cerrar fase.

> **Nota de F1-026:** el "instalación < 15 min" se mide con la guía
> `docs/instalacion-agente.md`, seguida por una persona no técnica sobre una instalación
> limpia, con el paquete de `agent/README.md` ("Armar el paquete del instalador"). Es el AC
> de F1-026 que de noche no se pudo medir. Anotar el tiempo por paso y lo que no se
> entendió, y corregir la guía en el mismo cierre.

## F2-190 · Conectar el PAC real (Facturama)
`[ ]` **Bloque F** · 🔒 **Razón: necesita la contratación del Módulo API anual, las
credenciales y un CSD real del SAT.** Todo el Epic 8 se construye de noche contra
`PuertoTimbrado` falso (F2-202). Esta tarea cambia `PAC_IMPL=facturama`, carga credenciales de
sandbox, sube un CSD de prueba y **recorre el AC original** de F2-100, F2-104, F2-107, F2-108,
F2-109 y F2-110 contra `apisandbox.facturama.mx`.

**Listo cuando:** un CFDI del seed timbra en sandbox con UUID real y su XML pasa el validador
estructural; una cancelación con motivo 02 se refleja; un RFC inexistente devuelve el mensaje
en español que ya estaba mapeado; y cada diferencia entre lo que el puerto falso suponía y lo
que Facturama contesta de verdad queda corregida en el test de contrato correspondiente.

> **Y además (de F2-100).** El alta del CSD se construyó contra el PAC falso y deja para aquí:
> 1. **Rutas y cuerpo del alta del CSD** (`POST /api-lite/csds` alta, `PUT /api-lite/csds/{rfc}`
>    reemplazo; `{ Rfc, Certificate, PrivateKey, PrivateKeyPassword }` en base64) y que el emisor
>    multiemisor se identifica por RFC (`facturama_org_id` = RFC). Snapshots en
>    `timbrado.contrato.spec.ts`. Confirmar también que los errores de Facturama que repiten valores
>    quedan limpios con `errorCsdDe` (la contraseña y el base64 nunca llegan al usuario ni al log).
>    Ojo con el **CSD huérfano**: si el PAC registra el CSD y luego `guardarCsd` da 409 (alguien
>    cambió el RFC a media carga), el PAC queda con un CSD que la base no refleja y la siguiente carga
>    sale como `POST` (alta): confirmar si Facturama la rechaza por duplicada y, si sí, usar `PUT`
>    cuando el PAC ya conozca el RFC.
> 2. **Supuestos del SAT marcados en `api/src/facturacion/csd.ts`**, con un CSD de prueba real del
>    SAT: el `.key` es PKCS#8 cifrado DER (¿3DES?), el RFC viaja en `x500UniqueIdentifier` como
>    "RFC / …", el número de certificado es el serial en ASCII, y una contraseña mala se detecta.
>    Subir una **e.firma** en lugar del CSD: ¿Facturama la rechaza? (localmente no se distinguen).
> 3. ❓ **DECISIÓN ABIERTA PARA RICARDO: el CFDI de prueba al guardar el CSD** (AC original de
>    F2-100: "emitir un CFDI de prueba en sandbox y cancelarlo"). En sandbox sí; en producción
>    gastaría un folio real y dejaría un CFDI emitido y cancelado ante el SAT. De noche NO se
>    construyó: hoy la validación es la local (`csd.ts`) más la que haga el PAC al registrar el CSD.
> 4. **Una empresa, un emisor.** `perfiles_fiscales.empresa_id` es único (DECISION PROVISIONAL). Si
>    un cliente factura con varias razones sociales en una misma empresa, es tarea aparte.
>
> **Y además (de F2-101).** Con el piloto: (1) confirmar que "cerrada" en SR ya es "cobrada" y
> facturable, y que una cortesía total o una cancelada no se facturan (`esFacturable`, esquema-sr
> §2); (2) qué hace SR al reabrir o cancelar una cuenta que ya tenía código; (3) que la vigencia
> por default (fin del mes del cierre, zona de la sucursal) es la que el cliente quiere; (4) el
> riesgo del `folio_sr` reusado (el código apuntaría a otra cuenta).
>
> **Y además (de F2-103).** El AC original del portal de autofactura: (1) **flujo completo en
> sandbox desde un celular real en < 2 min**, escaneando el QR del ticket (F2-102) hasta la
> factura emitida (necesita F2-104/F2-105 cerradas); (2) **revisión visual de `/f/{slug}` a ~390 px**
> (cabecera con logo, pasos, teclado numérico en el CP, botones a todo lo ancho): la sesión nocturna
> no pudo verificarla en un navegador real; (3) decidir si el portal de una sucursal acepta códigos
> de otras sucursales de su empresa (hoy sí; DECISION PROVISIONAL, esquema-sr §2); (4) confirmar
> con tickets reales que `subtotal + impuestos = total` (si no, el portal muestra sólo el total).

> **Y además (de F2-104).** Contra el sandbox: (1) el cuerpo de `POST /api-lite/3/cfdis` del CFDI
> de consumo (snapshot en `timbrado.contrato.spec.ts`, "CFDI de consumo desde un cheque");
> (2) **la tabla de errores del SAT** (`api/src/adaptadores/timbrado/errores-sat.ts`): cómo
> reenvía Facturama los rechazos (¿trae el código `CFDI40xxx`? ¿en `Message` o en `ModelState`?)
> y si la numeración supuesta (40144 RFC, 40145 nombre, 40147 CP, 40157/58 régimen, 40161/62 uso)
> es la real; (3) **reintentos**: que 429/503 de verdad signifiquen "no procesé" y que 500/502/504
> puedan llegar después de timbrar (hoy se tratan como ambiguos y NO se reintentan); si Facturama
> tiene llave de idempotencia, usarla y reintentar también lo ambiguo; (4) el piloto: base del CFDI
> = `cheques.total` sin propina, IVA 16 %, tarjeta = `04` (¿débito `28`?), y qué hacer con vales
> (hoy `otro` → no se factura en línea). Todo en esquema-sr §2 "La emisión del CFDI" y §4.

> **Y además (de F2-107).** Contra el sandbox: (1) **refacturación**: emitir un sustituto con
> `Relations: { Type: '04', Cfdis: [{ Uuid }] }` (supuesto de la doc pública; snapshot "el
> sustituto lleva `Relations` 04" en `timbrado.contrato.spec.ts`) y cancelar el anterior con
> `motive=01&uuidReplacement=<sustituto>`: que el SAT acepte la relación y que el anterior quede
> cancelado; y qué contesta Facturama mientras una cancelación está "en proceso" (hoy cualquier
> estado que no sea `active`/`canceled` es `ESTADO_DESCONOCIDO` y la refacturación queda
> `pendiente`). (2) **Factura sin ticket**: un CFDI sin `IdentificationNumber` en el concepto
> timbra. (3) Confirmar que consultar el estado ANTES de emitir el sustituto (`GET
> /api-lite/cfdis/{id}`) es barato y no gasta folio. Supuestos en esquema-sr §2 "Factura sin
> ticket y refacturación".

> **Y además (de F2-108).** Contra el sandbox y con el contador: (1) **factura global**: que timbre
> con `GlobalInformation: { Periodicity, Months, Year }` (año como texto), receptor `XAXX010101000`
> / 616 / S01 con `TaxZipCode` = lugar de expedición, e `Items` `01010101`/`ACT` por ticket con su
> folio (snapshot "factura global (F2-108)" en `timbrado.contrato.spec.ts`); con muchos conceptos
> (un mes real: miles de tickets). (2) **Decisiones abiertas para Ricardo**: esperar a que venzan
> los códigos contra el plazo del SAT para emitir la global (vigencia `dias` o periodicidad menor que
> la vigencia la retrasan; la UI lo avisa), la semana cortada en el cambio de mes, la forma de pago
> dominante de la global, la global POR SUCURSAL, y si la tasa de facturación debe excluir la global.
> Supuestos en esquema-sr §2 "Factura global (F2-108)".

> **Y además (de F2-109).** Contra el sandbox: (1) **cómo reporta Facturama una cancelación en
> proceso** (hoy se supone `Status: "pending"` en el DELETE y en el GET → `en_cancelacion`) y si hay
> un estado explícito de "rechazada por el receptor" (hoy se DERIVA: en proceso → vigente otra vez;
> un valor desconocido se queda consultándose sin resolver); (2) una cancelación con motivo 02 de un
> CFDI de más de $1,000 a un RFC real (necesita aceptación) y una de menos (no la necesita), y que
> el sondeo (`CANCELACION_INTERVALO_S`) las cierre; (3) el acuse de cancelación (hoy no se guarda);
> (4) la cancelación 04 de una global; (5) si el GET trae la FECHA de cancelación (hoy, cuando la
> resuelve una consulta, se anota la hora de la consulta); (6) cuánto tarda Facturama en reflejar
> un DELETE (hoy, a los 10 min de una respuesta ambigua con el CFDI vigente, se da por no
> registrada). Supuestos y decisiones en esquema-sr §2 "Cancelación de CFDI
> (F2-109)"; decisiones abiertas para Ricardo: que 02 y 03 suelten el ticket por igual (la ficha
> decía "nuevo código": se reusa el del ticket), y que la global automática no re-emita un periodo
> con una global cancelada.

> **Y además (de F2-110).** Contra Facturama: (1) que el saldo de folios es UNO para toda la cuenta
> multiemisor (no por emisor) y que cancelar no gasta folio; (2) la vigencia real de un paquete
> (hoy: vence al empezar el mismo día un año después de la compra, en CDMX); (3) si su API expone el
> saldo y la vigencia: si sí, conciliar el saldo local contra el suyo; (4) qué contesta Facturama al
> timbrar SIN saldo (hoy el panel bloquea antes, pero con el control apagado el rechazo sería suyo).
> Supuestos en esquema-sr §2 "Control de folios (F2-110)".
> **Y además (de F2-110b).** Contra Facturama: (1) la búsqueda por serie y folio (`GET
> /api-lite/cfdis?type=issuedLite&rfcIssuer&serie&folioStart&folioEnd&status=all`): que exista, que
> aplique los filtros, que no pagine a un solo resultado, la forma de la fila (`Id`, `Serie`, `Folio`,
> `Uuid`, `Status`, `Date`, ¿trae el RFC emisor?) y la zona de `Date`; (2) cuánto tarda en listar un
> CFDI recién timbrado (hoy: 15 min de edad mínima y dos búsquedas vacías separadas 15 min antes de
> liberar); (3) cuánto puede tardar en registrar un DELETE que contestó ambiguo (hoy: se re-consulta
> 7 días); (4) qué contesta la búsqueda cuando NO encuentra nada (hoy sólo un 200 con `[]` libera;
> un 404 es "estado desconocido"); (5) si la fecha de respaldo del confirmado (la de la reserva)
> mueve facturas de día en los reportes. Supuestos en esquema-sr §2 "Conciliación con el PAC
> (F2-110b)".

## F2-191 · Conectar correo y almacenamiento reales
`[ ]` **Bloque F** · 🔒 **Razón: necesita la cuenta de Brevo, el dominio verificado con sus
registros DNS y el volumen persistente del servidor.** Cambiar `CORREO_IMPL` y `ARCHIVOS_IMPL`
a las implementaciones reales y recorrer el AC original de F2-105 y F2-141.

**Listo cuando:** el correo llega a una bandeja real con XML y PDF adjuntos válidos y sin caer
en spam (SPF, DKIM y DMARC verificados); el resumen diario llega antes de las 9:00 hora local;
y los archivos sobreviven un redespliegue y quedan incluidos en el respaldo de F1-004.

> **Y además (de F2-146):** conectar el push real. Generar las llaves VAPID de producción
> (`npx web-push generate-vapid-keys`, una sola vez, nunca al repo), poner `PUSH_IMPL=webpush` y
> recorrer el "Listo cuando" de F2-146 en dispositivos reales: el botón "Instalar" en Chrome de
> escritorio y en Android; el armazón abre con DevTools → Offline; y una alerta de sucursal
> desconectada llega con la app CERRADA. De noche sólo se midió con `PushFalso`, el test de
> contrato de web-push y `check:pwa` (`docs/notificaciones.md`, "Cómo se probó").
>
> **Y además (de F2-147):** el formulario de contacto de la landing sale por el mismo Brevo al
> buzón de `CONTACTO_DESTINO` (sin ella, en producción responde 503: ver `.env.example`); mandar un
> mensaje real desde la landing y verlo llegar. Poner `AGENTE_URL_DESCARGA` (https) con el zip del
> instalador para que el asistente de alta y la lista de arranque lo enlacen (hasta F2-143, que la
> firma). Los dos están en `docs/onboarding.md`.
>
> **Y además (de F2-143):** el binario del agente que se publica en el canal de versiones vive en el
> mismo `ARCHIVOS_IMPL=disco` (`agente/<version>/agente.exe`) y su enlace se firma con el mismo
> `ARCHIVOS_SECRETO`: con el almacenamiento real, publicar una versión, reiniciar el api y bajarla
> por el enlace del canal. ❓ **Decisión abierta para Ricardo:** el SHA-256 del canal protege la
> integridad, no la autenticidad (`docs/actualizacion-agente.md`, "Seguridad"): ¿se firma el exe
> con Authenticode y el watchdog verifica la firma antes de instalar? Necesita un certificado de
> firma de código. `AGENTE_URL_DESCARGA` (el zip del instalador de F2-147) NO se tocó: sigue siendo
> una variable de entorno.

## F2-192 · Validar los lectores de catálogos e inventario contra SoftRestaurant
`[ ]` **Bloque H** · 🔒 **Razón: necesita el usuario SQL de solo lectura creado (F1-020b) y una
instalación con datos de operación.** F2-240 y F2-241 se construyen de noche contra fixtures.
Esta tarea los apunta a la base real y compara.

**Listo cuando:** el catálogo de productos que muestra el panel coincide **uno a uno** con el
catálogo de SoftRestaurant (conteo y nombres); las existencias cuadran contra el reporte de
inventario del POS del mismo corte; cada `DECISION PROVISIONAL (nocturno)` de los lectores
queda confirmada o corregida y borrada del código; y `docs/esquema-sr.md` pasa de "supuesto" a
"validado" en las secciones 6 a 10, con la instalación y la versión anotadas.

> **Y además (de F2-120).** Validar los supuestos de §9 de `docs/esquema-sr.md`: almacenes por
> sucursal, un grupo y una unidad por insumo (por id), proveedores como catálogo del POS, sin costo
> en el catálogo de insumos, y si existen presentaciones. Cada `DECISION PROVISIONAL (nocturno)` de
> `schema.prisma` (modelos `Insumo`, `AlmacenCatalogo`, `ProveedorCatalogo`) y de
> `ingesta/dto/catalogos.dto.ts#RegistroInsumoDto` queda confirmada o corregida.

> **Y además (de F2-233).** Validar contra una instalación real: que el cheque de SR referencia
> el área por el MISMO id que su catálogo de áreas (`DECISION PROVISIONAL` en `schema.prisma`,
> modelo `Cheque`, y en `ingesta.dto.ts#areaOrigenSrId`); si SR tiene estaciones y dónde; y si
> una reinstalación del POS cambia los ids de las áreas (el mapeo área → canal quedaría colgado
> de las filas viejas y la venta nueva caería en "sin canal"). esquema-sr §8.

## F2-193 · Validar inventario, recetas y utilidad contra la operación real
`[ ]` **Bloque E** · 🔒 **Razón: necesita el piloto con operación real (depende de F1-091).**
Recorre el AC original de F2-121, F2-122, F2-125, F2-126 y F2-127 con datos del restaurante.

> **Y además (de F2-121).** Al cuadrar el valor de inventario contra el reporte de SR: (1) el panel
> redondea el costo promedio a 2 decimales antes de valuar (si SR usa 4, puede haber centavos de
> diferencia); (2) el panel SUMA las existencias negativas (con valor negativo) al total; (3) una
> alerta de bajo mínimo de un artículo que dejó de venir en la foto se queda abierta sin plazo
> (decidir si se cierra tras X horas). Todo en `docs/esquema-sr.md` §10.

> **Y además (de F2-122).** Al comparar el kardex con el saldo real: (1) el panel calcula el importe
> de cada partida (`round(cantidad × costo, 2)`), puede diferir por centavos del de SR; (2) una póliza
> cancelada no suma, y una que SR borre sin rastro se quedaría en el panel; (3) el desempate de dos
> movimientos a la misma hora es el folio como texto (el saldo corrido intermedio puede verse
> distinto al de SR, el final no); (4) el cuadre compara contra lo recibido HASTA el `capturadoAt` de
> la foto de existencias: confirmar que los dos relojes son el mismo, y una póliza cancelada DESPUÉS
> de la foto sale como diferencia hasta la foto siguiente. El AC de F2-122 sólo se probó
> con el seed (conserva lo que simuló): el kardex contra el saldo real del piloto es de aquí. Todo en
> `docs/esquema-sr.md` §10.

> **Y además (de F2-123).** Los conteos físicos se cerraron contra el seed y jsdom; aquí va lo que
> sólo se ve en un almacén real: (1) capturar un conteo de ≥ 50 artículos en un **celular real**
> bloqueando la pantalla y cortando la red a media captura (el borrador local debe reaparecer y
> reenviarse); (2) confirmar que el teórico congelado AL CREAR es el corte con el que SR compararía
> (si SR congela al cerrar, cambia la regla); (3) registrar en SR el ajuste que sale del reporte y
> confirmar que el lector (F2-241) lo trae como póliza `ajuste` y la foto siguiente lo refleja;
> escribir en la ayuda (`web/src/paginas/AyudaConteos.tsx`) el menú exacto de SR, que hoy está en
> genérico. Todo en `docs/esquema-sr.md` §10 ("Conteos físicos").

> **Y además (de F2-124).** Los traspasos se concilian contra el seed; en el piloto: (1) registrar en
> SR un traspaso capturado antes en el panel y confirmar que el lector (F2-241) lo trae como DOS
> pólizas (`traspaso_salida` en el origen y `traspaso_entrada` en el destino) y que el panel lo
> marca conciliado en la siguiente vuelta; (2) confirmar que la `fecha` de esas pólizas trae hora
> (si SR guarda sólo fecha, la ventana de ± 24 h sigue cubriendo el mismo día, pero hay que
> anotarlo); (3) confirmar que la clave del insumo es la MISMA en las dos sucursales (si no, la
> entrada nunca concilia); (4) medir cuántos traspasos quedan en alerta a las 48 h por captura
> tardía en SR y ajustar el umbral por defecto si hace falta. Todo en `docs/esquema-sr.md` §10
> ("Traspasos").

> **Y además (de F2-125).** El consumo teórico se cerró contra el seed (todas las filas de dos semanas
> cuadran con un cálculo a mano desde el universo); aquí va lo que sólo se ve con el piloto: (1)
> validar a mano la variación de **3 insumos de control** (uno vendido por kg, uno que aparece en
> varios productos, uno en piezas) contra la vista `/recetas`; (2) confirmar que el nombre del
> producto en el ticket es el del catálogo (el cruce es POR NOMBRE; si no, todo sale "sin catálogo");
> (3) ❓ **DECISIÓN ABIERTA PARA RICARDO — ¿SR descuenta el inventario por receta al vender?** Si sí,
> la columna "consumo" ya es el teórico de SR y la comparación es casi circular: la métrica útil pasa
> a ser "merma + ajuste contra teórico" o "existencia inicial + compras ± traspasos − existencia
> final". Si no deja pólizas de consumo, el real es sólo merma + ajuste. Hoy el real = consumo +
> merma + ajuste, con el desglose visible; (4) confirmar que la receta de SR está en la unidad del
> insumo y por unidad vendida, y si los modificadores consumen. Todo en `docs/esquema-sr.md` §10
> ("Recetas").

> **Y además (de F2-126).** El estado de resultados se cerró contra el seed
> (`api/prisma/seed-utilidad.spec.ts`: agosto de dos sucursales al centavo contra un cálculo a mano).
> Eso prueba que el COSTO (cruce de recetas y costo de referencia) conserva lo simulado; la venta neta
> ahí sólo prueba que nada se pierde. Con el piloto y el contador, para el mismo mes: (1) ¿`cheques.
> subtotal` es venta NETA de descuento, sin IVA y sin propina? (supuesto de esquema-sr §2; si no, la
> utilidad sale inflada); (2) ¿el contador usa costo de ventas ESTÁNDAR (teórico, lo que hace el
> panel) o por inventarios (inicial + compras − final)? Si es el segundo, la diferencia es la merma y
> hace falta otra métrica; (3) ¿los gastos se capturan SIN IVA acreditable? (supuesto del formulario);
> (4) ¿el piloto registra compras en SR? Si no, ❓ **DECISIÓN ABIERTA PARA RICARDO**: la ficha de
> F2-126 pedía "captura manual si la instalación no las registra" y NO se construyó (las compras no
> entran a la utilidad; ver esquema-sr §10 "Compras, gastos y utilidad"): sería tarea nueva; (5) un
> doble envío del formulario de gasto (dos pestañas, reintento de red) crea dos gastos: el botón se
> deshabilita mientras envía, pero el API no es idempotente para la captura.

> **Y además (de F2-127).** La proyección se cerró contra el seed: todas las filas cuadran con un
> cálculo a mano y el insumo ESTABLE del seed (I063, aceite para freír, agregado por F2-127) acierta
> la semana siguiente con error de 1.9 % y 0.8 %; en los insumos de receta del seed sólo 22 de 67
> caen en ±15 % (demanda de pocas unidades por semana). Con el piloto: (1) proyectar una semana con el
> reloj una semana atrás y comparar contra lo que de verdad salió, al menos en 5 insumos de alta
> rotación; (2) ❓ **si SR no deja pólizas de consumo** (la decisión abierta de F2-125), la demanda
> sería sólo merma y traspasos: cambiar la base a consumo teórico; (3) confirmar que el traspaso de
> salida debe contar como demanda del almacén que surte, y que el ajuste NO; (4) redondear el
> sugerido a la presentación de compra (caja, costal) si SR la tiene en el catálogo; (5) decidir si
> "hoy completo" en el horizonte sobra (hoy la foto ya descontó parte del día). Todo en
> `docs/esquema-sr.md` §10 ("Proyecciones").

**Listo cuando:** el valor de inventario cuadra contra el reporte de SR del mismo corte; el
kardex de un artículo reproduce su saldo real; la variación teórico contra real de tres
insumos de control coincide con lo que el encargado mide a mano; y el estado de resultados del
mes cuadra contra el cálculo del contador dentro de ±1%, con los redondeos documentados.

## F2-194 · Auditoría de paridad lado a lado contra Arkhon
`[ ]` **Bloque I** · 🔒 **Razón: necesita la cuenta de Arkhon de Ricardo y un ojo humano.**
Con las dos herramientas abiertas y los mismos datos, recorrer pantalla por pantalla y anotar
en `docs/paridad.md`: qué hacemos igual, qué hacemos mejor, qué falta y qué no vale la pena
copiar.

**Listo cuando:** cada renglón de `docs/paridad.md` tiene veredicto y, si falta algo, su tarea
correspondiente escrita en el backlog con su "Listo cuando".

## F2-102 · QR y código de facturación en el ticket del POS
`[ ]` **Bloque F** · 🔒 **Razón: necesita una impresora, la plantilla real de tickets de
SoftRestaurant y decidir si el QR lo imprime el POS o el agente.** La redacción completa está
en la sección FASE 2. El camino alterno ya existe sin esta tarea: el código de facturación es
consultable en la vista de Tickets, así que esto es comodidad, no bloqueo.

**Listo cuando:** un ticket impreso lleva el QR escaneable que abre el portal con el código
precargado; si la impresión falla, el código sigue siendo consultable en el panel en menos de
30 segundos.

## Toda la FASE 2
`[x]` **DESCONGELADA el 21/09/2026 por Ricardo.** Lo que decía esta entrada —"no se
adelanta Fase 2 durante el Sprint 1"— dejó de aplicar: la Fase 2 **es** la Ronda 2 y está
en la cola vigente, con la autorización explícita al inicio de este archivo. Lo que sigue
fuera de la noche no es "la Fase 2" entera, son las tareas F2-190 a F2-194 y F2-102 de
arriba, cada una con su razón.

---

# Reglas de trabajo (para humanos y agentes)

> ### ⚠️ Nota de cambio: la regla 1 original fue reemplazada
>
> El backlog original abría con esta regla:
>
> > *"**Tomar tarea:** busca la primera `[ ]` cuyas dependencias (ver grafo abajo) estén
> > todas `[x]`. Márcala `[~] (tu nombre/agente — fecha)` en el mismo commit en que
> > empieces."* — y la regla 2: *"Una tarea `[~]` por persona/agente a la vez."*
>
> **Ya no aplica, y se deja escrita aquí en vez de borrarla en silencio** para que quien
> venga sepa que fue una decisión y no un descuido. Dos razones:
>
> 1. **La marca `[~]` no sirve cuando hay un solo desarrollador y una sesión a la vez.**
>    Servía para que dos personas no chocaran. Aquí no hay con quién chocar: el orquestador
>    lanza **una sesión por tarea** y la sesión termina al cerrarla. Peor todavía, un `[~]`
>    de una sesión que murió por límite de tokens es una tarea que parece tomada y no lo
>    está — y la siguiente sesión la saltaría creyendo que alguien la trae.
> 2. **Elegir por grafo en cada arranque es trabajo desperdiciado y una fuente de error.**
>    La sesión nocturna arranca sin memoria; recalcular el grafo cada vez es pedirle que
>    derive lo mismo doce veces y se equivoque una. El orden ya está resuelto, **una sola
>    vez y respetando el grafo**, en la Cola nocturna.
>
> **En su lugar aplica la regla de cola**, arriba del todo: primera no-`[x]` y no-SALTADA
> de la lista, una tarea por sesión, `[x]` sólo tras merge confirmado. **El grafo se
> conserva abajo como referencia** — sigue siendo la verdad sobre qué depende de qué, y
> hay que consultarlo para entender por qué la cola está en ese orden y para colocar
> cualquier tarea nueva.

1. **Tomar tarea:** ver la **regla de elección de la Cola nocturna**, arriba. La marca
   `[~]` no se usa en este repo.
2. **Una tarea por sesión**, y la sesión termina al cerrarla o al saltarla.
3. **Cerrar tarea:** solo se marca `[x]` si TODOS sus AC se cumplen y están verificados
   (test corriendo, o evidencia en el PR) **y el PR está mergeado a main**. Si un AC no
   aplica o cambió, se edita el AC en el mismo PR explicando por qué, nunca se ignora. Si
   un AC sólo se pudo verificar en parte (las tareas marcadas ⚠️), **se dice exactamente
   qué se probó y qué no**, en el PR y en `docs/nocturno-log.md`.
4. **Un PR por tarea**, título `F1-0XX: descripción`. El commit que marca `[x]` en este
   archivo va **directo a main**, después del merge, y no toca ningún otro archivo.
5. **Bloqueos:** si al trabajar descubres que una tarea necesita algo no listado, NO lo
   resuelvas en silencio: agrega la sub-tarea como `F1-0XXb` bajo la tarea original,
   anótala en `docs/nocturno-log.md`, y di dónde debería ir en la cola.
6. **Descubrimientos sobre SoftRestaurant** (nombres de tablas, columnas, comportamientos
   raros) se documentan SIEMPRE en `docs/esquema-sr.md`, aunque la tarea no sea F1-090.
7. **No adelantar Fase 2 durante el Sprint 1.** Si una decisión de Fase 1 afecta a Fase 2
   (p. ej. dejar un campo listo para el código de facturación), se anota como comentario en
   la tarea de Fase 2 correspondiente, no se implementa. Las tareas F2- solo se toman
   cuando F1-091 esté `[x]`.

## Grafo de dependencias de Fase 1 (referencia)

```
F1-001 → F1-002 → F1-003 → F1-004
   └→ F1-010 → F1-011 → F1-012
                  │        └────────────┐
                  │                     ▼
                  │              F1-020 → F1-021 → F1-022 ┐
                  │                         │      F1-023 ├→ F1-024 → F1-025 → F1-026
                  │                         ▲      (ambas)┘
                  │      F1-090 ────────────┘  ⚠️ bloqueante de F1-022/023:
                  │                               atacar EN CUANTO haya acceso a un SR real
                  ▼
               F1-030 → F1-031 → F1-032 → F1-033
                           │                 └→ F1-041, F1-042, F1-043 (tras F1-040)
                           │                 └→ F1-050 → F1-051 (tras F1-040)
                           └→ (contrato de ingesta: única frontera entre agente y api)
               F1-011 → F1-040 (login)
               F1-012 + F1-025 → F1-061;  F1-010 + F1-011 → F1-060
               TODO lo anterior → F1-091 → F1-092
```

**Rutas paralelas:** tras cerrar F1-012, el trabajo se abre en dos carriles independientes:
carril A = agente (Epic 2), carril B = api + frontend (Epics 3–5 con datos del seed). Solo
se juntan en F1-031 (contrato) y F1-091 (prueba end-to-end). El seed de F1-032 existe
precisamente para que el frontend avance sin esperar al agente.

> **Por qué la cola pone el carril B antes que el A**, aunque el grafo permita los dos a la
> vez: el carril A termina chocando contra F1-090, que es diurna. La cola gasta las noches
> en lo que sí puede cerrarse solo y deja el agente para cuando ya hay un api real contra
> el cual probarlo. F1-022 y F1-023 quedan fuera de la cola por la misma razón, y por eso
> el carril A que sí está en la cola (F1-020, 021, 024, 025, 026) es el que no necesita
> leer tablas reales de SoftRestaurant.

## Contexto y stack (leer antes de cualquier tarea)

- **Producto:** monitor web multiempresa/multisucursal para restaurantes que usan
  SoftRestaurant (POS Windows de National Soft, base SQL Server local). Réplica funcional
  de Arkhon Cloud: panel de ventas en vivo, monitor de mesas, y en fase 2 facturación CFDI
  con portal de autofactura por QR e inventario.
- **Agente:** .NET 8 Worker Service (servicio Windows) en la PC del restaurante. Lee SQL
  Server de SoftRestaurant en **solo lectura**, cola local SQLite, sube deltas por HTTPS con
  API key por sucursal.
- **Backend:** Node 22 + NestJS + PostgreSQL 16 + Prisma. Multitenant por columnas
  `empresa_id`/`sucursal_id` en toda tabla de datos.
- **Frontend:** React 18 + Vite + TS + Tailwind + Recharts + TanStack Query. SPA única;
  rutas públicas para autofactura (fase 2).
- **Infra:** Hetzner CX23 Ubuntu 24, Docker Compose (`api`, `postgres`, `caddy`), Caddy con
  SSL automático, Cloudflare (free) como CDN/proxy, GitHub Actions deploy por SSH, backups
  `pg_dump`+rclone, UptimeRobot.
- **Convenciones:** monorepo `/agent` (.NET), `/api` (NestJS), `/web` (React), `/infra`
  (compose, Caddyfile, scripts). Commits en español, conventional commits. Todo endpoint
  autenticado salvo `/health` y rutas públicas de autofactura. Dinero en `NUMERIC(12,2)`,
  fechas en UTC en base y zona `America/Mexico_City` en presentación.
- **Regla de oro del agente:** jamás escribir en la base de SoftRestaurant. Usuario SQL de
  solo lectura. Cualquier query pesada va con `WITH (NOLOCK)` y timeout corto para no
  estorbar al POS.

---

# FASE 2 — Facturación CFDI, inventario y extras (Sprint 2)

> ✅ **DESCONGELADA el 21/09/2026.** Esta fase entera es la **Ronda 2** de la Cola nocturna.
> Las tareas de abajo conservan su redacción original íntegra, que es la definición de
> "terminado de verdad". Para cerrarlas **de noche** manda la tabla de
> [Cierre nocturno de las tareas heredadas](#cierre-nocturno-de-las-tareas-heredadas-de-fase-2),
> y su validación contra el mundo real vive en las Diurnas F2-190 … F2-194.

> **Contexto fiscal para todo el Epic 8:** el PAC es **Facturama, Módulo API anual**
> ($1,650 MXN/año, incluye API Web y API Multiemisor; folios prepagados $0.50 c/u de 1 a
> 10,000, vigencia anual). Sandbox: `apisandbox.facturama.mx`. El portal de autofactura es
> NUESTRO (Facturama no lo vende); Facturama solo timbra. Todo importe fiscal se calcula
> desde el cheque de Fase 1: `subtotal = total / 1.16`, `IVA = total - subtotal` (tasa 16%
> configurable por empresa). CFDI 4.0 exige del receptor: RFC, nombre/razón social EXACTOS
> a su Constancia de Situación Fiscal, régimen fiscal y CP; el emisor necesita CSD
> (.cer/.key) cargado en Facturama. **Nunca guardar la contraseña del .key en texto plano.**

## Grafo de dependencias de Fase 2

```
(el orden real de trabajo es la RONDA 2 de la Cola nocturna, arriba)
F2-100 → F2-104 → F2-105 → F2-109
F2-101 → F2-102 (agente)     └→ F2-110
F2-101 + F2-100 → F2-103 → F2-104
F2-104 → F2-106, F2-107
F2-101 + F2-104 → F2-108
F2-120 → F2-121 → F2-122 → F2-123, F2-124
F2-120 + cheques F1 → F2-125 → F2-126 → F2-127
Epic 10: F2-140/141/146 tras F2-106; F2-142/143 independientes; F2-144/145 al final
Carriles paralelos del sprint: A = facturación (Epic 8), B = inventario (Epic 9). Epic 10 rellena huecos.
```

## EPIC 8 — Facturación CFDI + portal de autofactura

### F2-100 · Datos fiscales y CSD por empresa
`[x]` **ALCANCE:** sin el CFDI de prueba al guardar (decisión abierta en F2-190) y un emisor por empresa (DECISION PROVISIONAL, esquema-sr §8). **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190. Modelos Prisma: `PerfilFiscal(id, empresa_id, rfc, razon_social, regimen_fiscal, cp,
serie, folio_actual, facturama_org_id, activo)` y `ReceptorFrecuente(rfc, razon_social,
regimen, cp, uso_cfdi, email)` (cache de receptores para autocompletar). Vista admin para
capturar datos fiscales y subir CSD (.cer, .key, contraseña): los archivos van DIRECTO a
Facturama Multiemisor vía API (crear emisor + subir CSD); en nuestra base solo se guarda
`facturama_org_id` y metadata (vigencia del certificado, nº de serie) — nunca el .key ni su
contraseña. Validación al guardar: emitir un CFDI de prueba en sandbox y cancelarlo.

**Listo cuando:** subir un CSD de prueba del SAT crea el emisor en Facturama sandbox y el
CFDI de validación timbra; un .key con contraseña incorrecta muestra error claro sin guardar
nada; la vista muestra vigencia del certificado y alerta si vence en < 30 días.

> **Y además (de F2-232):** la ficha de Clientes (`/clientes`, `GET /catalogos/clientes/{id}/ficha`)
> tenía que enlazarse con el `ReceptorFrecuente` cuando coincida el RFC, y no se pudo porque el
> modelo nace aquí. Al crearlo: ligar por RFC normalizado (trim y mayúsculas) contra
> `clientes_catalogo.rfc` de la MISMA empresa (por el helper de scope), mostrar el receptor en la
> ficha y su test (un RFC de otra empresa no liga; un cliente sin RFC no liga con nada).

### F2-101 · Código corto de facturación por cheque
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (qué es facturable, reapertura/cancelación posterior, vigencia default y `folio_sr` reusado; §2 de esquema-sr). Al ingerir un cheque cerrado (hook en F1-031), generar `CodigoFacturacion(codigo único
9 chars A-Z0-9 sin ambiguos [O,0,I,1], cheque_id, sucursal_id, estado ENUM[pendiente,
facturado, en_global, expirado], expira_at)`. Vigencia configurable por empresa (default:
fin del mes de emisión, regla típica SAT para factura del periodo). Endpoint
`GET /facturacion/codigo/:codigo` (público, rate limit 10/min por IP) que devuelve datos no
sensibles del ticket: sucursal, fecha, total, estado.

**Listo cuando:** colisión de código imposible por constraint único + reintento; un código
expirado o ya facturado responde su estado exacto; el código del ticket de ejemplo
(`7JQRECP3U`) valida el formato elegido.

### F2-102 · QR y código en el ticket de SoftRestaurant
`[ ]` Investigar y documentar en `/docs/ticket-qr.md` el mecanismo real (bloqueante de
diseño: plantilla de ticket de SR con campo custom, o impresión complementaria del agente).
Implementar la vía elegida en el agente: al detectar cheque cerrado, asegurar que el ticket
lleve URL `https://factura.DOMINIO/f/:slug?c=CODIGO` como QR + código en texto + sucursal
(como el ticket de Tierra y Comal). Fallback siempre disponible: el mesero/cajero consulta
el código en el panel (vista de tickets F1-042 muestra el código de facturación).

**Listo cuando:** en el piloto, un ticket impreso lleva QR escaneable que abre el portal con
el código precargado; si la impresión falla, el código es consultable en el panel en < 30 s.

### F2-103 · Portal público de autofactura
`[x]` **ALCANCE:** sin emisión real (el POST responde 503 hasta F2-104) — no se cumple "flujo completo de las tres pantallas contra el puerto falso" — y sin re-descarga de un código facturado (F2-105, decisión abierta); viewport de celular no verificado en navegador real. **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190. Rutas públicas `/f/:slug` (slug por sucursal, estilo `me-facturo`): paso 1 código de
ticket (precargado si viene en URL) → muestra resumen del consumo (fecha, sucursal, total,
desglose subtotal/IVA); paso 2 datos del receptor: RFC (validar forma con regex oficial),
razón social, régimen (select con catálogo SAT), CP, uso CFDI (select filtrado por régimen),
email; paso 3 confirmación → emite (F2-104) → pantalla de éxito con descarga XML/PDF y aviso
de envío por correo. Branding por sucursal (logo + color). Mobile-first: el 90% entrará
desde el celular tras escanear el QR.

**Listo cuando:** flujo completo en sandbox desde un celular en < 2 min; errores de captura
se marcan campo por campo en español claro; un código ya facturado ofrece re-descargar la
factura existente en lugar de fallar.

> **Y además (de F2-101).** El código ya existe y se consulta con `GET /facturacion/codigo/:codigo`
> (pública, 10/min por IP; ver `api/openapi.json`). Lo que F2-101 dejó para aquí:
> 1. **Desglose subtotal/IVA del paso 1.** La consulta sólo da sucursal, fecha, total y
>    vencimiento (lo que pedía F2-101), y SÓLO en `pendiente`. Si el portal necesita el desglose,
>    se agrega a `TicketCodigoDto` (sigue sin folio, mesa, mesero ni partidas) con su test de "no
>    filtra datos" en `codigo.e2e.spec.ts`.
> 2. **"Un código ya facturado ofrece re-descargar".** Hoy un `facturado` responde sólo su estado
>    (`ticket: null`) a propósito: nada del ticket sin demostrar que es tuyo. Cómo se re-descarga
>    sin filtrar el CFDI de otro (¿por correo al receptor? ¿pidiendo el RFC?) se decide aquí.
> 3. **El slug de la sucursal** (`/f/:slug`) no se cruza con el código: la consulta es global.
>    Si el portal de una sucursal no debe aceptar códigos de otra, se valida aquí.
> 4. **El código en el detalle de Tickets** (F2-222 lo esperaba "cuando F2-101 exista"): agregar
>    `codigoFacturacion` (y su estado público) a `GET /ventas/tickets/{id}` y mostrarlo en el
>    panel; es también el respaldo de F2-102 si el ticket no se imprime con el QR.
> 5. Estados que el portal tiene que explicar: `pendiente`, `facturado`, `en_global`, `expirado`
>    y `cancelado` (este último se deriva de la cuenta). Cada uno trae `mensaje` en español.

### F2-104 · Emisión de CFDI vía Facturama
`[x]` **ALCANCE:** sin guardar XML/PDF (F2-105) y sin resolver reservas ambiguas colgadas en `timbrando` (F2-110b). **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (tabla de errores del SAT, 429/503 vs 5xx ambiguos, base = total sin propina, IVA 16 %, tarjeta 04; esquema-sr §2 "La emisión del CFDI"). Servicio `CfdiService.emitir(chequeId, receptor)`: construye el JSON de Facturama
(emisor = perfil fiscal de la empresa, receptor, concepto único "Consumo de alimentos y
bebidas" clave SAT `90101500`, unidad `E48`/Servicio, importes desde el cheque, forma de
pago mapeada del `ChequePago` dominante, método `PUE`, moneda MXN, lugar de expedición = CP
del perfil). Persistir `Cfdi(id, cheque_id, perfil_fiscal_id, uuid, serie_folio, receptor
json, total, xml_url, pdf_url, estado ENUM[vigente, cancelado], emitido_at)`. Manejo de
errores: mapear los códigos comunes del SAT/Facturama a mensajes en español (RFC no está en
lista de contribuyentes, nombre no coincide, CP inválido…); reintento automático solo en
errores de red/5xx (máx 3, backoff), nunca en errores de validación. Config
sandbox/producción por variable de entorno.

**Listo cuando:** test e2e en sandbox: cheque del seed → CFDI timbrado con UUID; el XML
descargado pasa el validador estructural; un RFC inexistente devuelve el mensaje amable, no
el error crudo; doble click en "emitir" no genera dos CFDI (lock por código).

> **Y además (de F2-103).** El portal ya existe y ya llama a la emisión, pero hoy la emisión
> contesta **503**: `POST /facturacion/portal/{slug}/facturas` valida todo lo del portal (slug,
> código de la empresa, estado, receptor campo por campo) y delega en el puerto `EMISION_PORTAL`
> (`api/src/facturacion/emision-portal.ts`), cuya única implementación es `EmisionNoDisponible`.
> Lo que esta tarea tiene que hacer con eso:
> 1. **Cambiar el provider** de `EMISION_PORTAL` (en `FacturacionModule`) por uno sobre
>    `CfdiService.emitir`. La solicitud ya trae `codigoId` (para el candado por código), `chequeId`,
>    `sucursalId`, `empresaId` y el receptor validado con el RFC normalizado.
> 2. **`disponible(empresaId)` de verdad**: perfil fiscal activo, CSD cargado y vigente, y el PAC
>    configurado. Hoy es `false` siempre y el portal, por eso, no pide datos fiscales.
> 3. **Responder el 201 del contrato fijo** `FacturaPortalDto` (`uuid`, `serieFolio`, `total`,
>    `email`, `descargas: { xml, pdf }` con nulos hasta F2-105). El web ya lo consume; quitar del
>    OpenAPI el "HOY RESPONDE 503" y el "Hoy ningún camino lo produce".
> 4. **Una prueba de punta a punta por el POST del portal**: 201 → el código pasa a `facturado` →
>    un segundo POST da 409 con `estado: facturado`; y doble clic simultáneo = un solo CFDI.
> 5. **El test web del flujo completo** (`PortalFactura.test.tsx`) usa hoy un 201 INVENTADO: que
>    use la forma real que devuelve el api (p. ej. una fixture compartida con el e2e).
> 6. **Guardar el receptor frecuente** al emitir (`EscrituraFacturacion.guardarReceptor`, que F2-100
>    dejó listo para esto), en la misma operación que el CFDI.

### F2-105 · Entrega de la factura
`[x]` **ALCANCE:** sin copia al restaurante (no hay dónde configurar su correo), sin re-descarga de un código ya facturado desde el portal (sigue la decisión abierta (a)/(b) de abajo), sin UI del reintento (F2-106) y sin recuperar del PAC los archivos de un CFDI que no se pudieron guardar (F2-110b/F2-191). **PENDIENTE DE VALIDACIÓN REAL:** ver F2-191 (inbox real con Brevo, volumen persistente y backup F1-004). Al timbrar: guardar XML y PDF (obtenidos de Facturama) en disco del VPS bajo
`/data/cfdi/{empresa}/{año}/{mes}/`, servir por endpoint autenticado + token firmado de
descarga pública temporal para el portal; enviar correo vía Brevo (plantilla con branding de
la sucursal, XML y PDF adjuntos, copia opcional al restaurante). Registro `CfdiEnvio(cfdi_id,
email, estado, intento, error)` con reintento manual desde admin.

**Listo cuando:** el correo llega con ambos adjuntos válidos (probado con inbox real); si
Brevo falla, el portal sigue ofreciendo la descarga directa y el envío queda marcado para
reintento; los archivos sobreviven un redeploy (volumen persistente + incluidos en backup
F1-004).

> **Y además (de F2-103).** Dos cosas del portal esperan aquí:
> 1. **`descargas.xml` / `descargas.pdf`** de `FacturaPortalDto` (hoy nulos): los enlaces con token
>    firmado de descarga temporal. La pantalla de éxito del portal ya los muestra si vienen; si no,
>    dice "te enviaremos el PDF y el XML a …".
> 2. **"Un código ya facturado ofrece re-descargar"** (AC nocturno de F2-103, que F2-103 NO cumplió:
>    no había CFDI ni archivos). Hoy un `facturado` dice "Si no recibiste tu factura o necesitas otra
>    copia, pídela en el restaurante con tu ticket" (`QUE_HACER` en `web/src/paginas/portal/
>    reglas.ts`) y el api no da ningún dato del ticket ni del receptor. ❓ **Decisión abierta para
>    Ricardo:** cómo se re-descarga sin filtrar el CFDI de otro: (a) reenviarlo SÓLO al correo con
>    que se emitió (nunca a uno que escriba quien pregunta), o (b) pedir el RFC receptor exacto y
>    entonces dar el enlace temporal. La opción conservadora es (a).

> **Y además (de F2-104).** La emisión ya existe (`api/src/facturacion/cfdi.service.ts`) y NO
> guarda los archivos: `CfdiTimbrado.xml` y `.pdf` llegan del puerto y se descartan; `cfdis.xml_url`
> y `cfdis.pdf_url` quedan nulos. Aquí: (1) guardarlos por `PuertoArchivos` en el mismo paso de
> `confirmarCfdi` (o justo después, sin romper la regla "el PAC nunca corre dentro de una
> transacción"); (2) los CFDI emitidos ANTES de esta tarea (sólo de desarrollo, con el PAC falso) no
> tienen archivos: con el falso no se pueden volver a descargar; con Facturama, por `idPac`
> (`peticionDescarga`). (3) `FacturaPortalDto.descargas` sigue en nulos: llenarlo aquí.

### F2-106 · Dashboard de facturación
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190/F2-191 (tasa con la base emisión/cierre como `DECISION PROVISIONAL`, esquema-sr §2 "El tablero de facturación"). Réplica funcional del dashboard de facturación de Arkhon: filtros (sucursal, rango de
fechas, atajos Hoy/7/30/mes/año), KPIs (ventas del periodo = tickets sincronizados, monto
facturado CFDI, cancelaciones, tasa de facturación = facturado/ventas), barras por sucursal,
por mes y por hora, tabla de CFDI emitidos (UUID, serie-folio, receptor, total, estado,
descargas XML/PDF) con búsqueda por RFC/UUID/folio. Sección "Por facturar": tickets con
código pendiente del periodo.

**Listo cuando:** cifras cuadran contra los datos de ventas de Fase 1 para el mismo rango
(mismo seed extendido con CFDIs de sandbox); export CSV de la tabla de CFDI.

> **Y además (de F2-140):** agrega la columna **Tasa de facturación** a Comparativos
> (`/comparativos`, `web/src/paginas/comparativos/matriz.ts` → `METRICAS`), con A, B y Δ, la
> misma regla de "—" sin datos, su columna en el CSV y su test; y quita "Tasa de facturación"
> de la nota de pendientes de la vista (`NOTA_PENDIENTES` en `paginas/Comparativos.tsx`).

> **Y además (de F2-104).** La tabla es `cfdis` (estado `timbrando | vigente | cancelado`; sólo
> `vigente`/`cancelado` son CFDI emitidos: `timbrando` es una RESERVA, que puede ser una emisión
> ambigua colgada). **El seed no genera CFDI** y ~15 % de sus códigos están `facturado` sin CFDI:
> generarlos (deterministas, con el PAC falso o directo con `uuidDeterminista`) es parte de ESTA
> tarea (regla 2 de la Ronda 2), para que el tablero no mienta.

### F2-107 · Factura sin ticket y refacturación
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (`Relations` 04, cancelación 01 con sustituto y concepto sin `IdentificationNumber` en el sandbox; esquema-sr §2 "Factura sin ticket y refacturación"). Vista admin "Facturar sin ticket": captura manual de importe total + datos de receptor
→ emite CFDI ligado a la sucursal sin cheque (marcado `origen=manual`). Refacturación: sobre
un CFDI vigente, botón "refacturar" = cancelar con motivo 01 (comprobante emitido con
errores con relación) + emitir sustituto relacionado (`TipoRelacion 04`), en una sola acción
guiada.

**Listo cuando:** la refacturación en sandbox deja el CFDI viejo cancelado con relación al
nuevo y el nuevo timbrado con el UUID relacionado; ambos aparecen correctamente en el
dashboard.

### F2-108 · Factura global de tickets no facturados
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (`GlobalInformation` en el sandbox; esperar a que venzan los códigos vs. el plazo del SAT, semana cortada en el mes, forma de pago dominante, global por sucursal y fuera de la tasa: esquema-sr §2 "Factura global (F2-108)"). Job programado (cron en api, `node-cron`) por empresa con periodicidad configurable
(diaria/semanal/mensual, default mensual): agrupa cheques con código `pendiente` ya expirado
del periodo, emite CFDI global a público en general (RFC `XAXX010101000`, un concepto por
ticket con clave `01010101`, periodicidad/meses/año conforme a regla SAT de CFDI global
4.0), marca códigos como `en_global`. Vista previa antes de emitir (modo manual) u opción
100% automática.

**Listo cuando:** en sandbox, la global de un mes de seed timbra con la estructura de
periodicidad correcta; un ticket dentro de una global ya no puede autofacturarse y el portal
lo explica ("este ticket fue incluido en factura global del periodo X, contacta al
restaurante").

> **Y además (de F2-104).** Un código con una reserva `timbrando` (emisión en curso o ambigua)
> NO debe entrar a la global: ya podría tener CFDI propio. `estadoPublico` lo reporta `en_proceso`.

### F2-109 · Cancelación de CFDI
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (`pending` de Facturama, estado de rechazo, fecha de cancelación en el GET, latencia del DELETE y los 10 min de la ambigua, cancelación con/sin aceptación en sandbox; decisiones abiertas: 02/03 sueltan el ticket reusando su código, la global automática no re-emite un periodo con global cancelada, KPI de cancelados por emisión; esquema-sr §2 "Cancelación de CFDI (F2-109)"). Flujo de cancelación desde el dashboard: elegir motivo SAT (01–04; si 01, exigir UUID
sustituto), llamar API de cancelación de Facturama, reflejar estados intermedios (en proceso
/ aceptada / rechazada por receptor) vía polling o webhook de Facturama, notificar por
correo al receptor. El cheque vuelve a ser facturable si la cancelación procede (nuevo
código).

**Listo cuando:** cancelación en sandbox con motivo 02 queda `cancelado` y la tasa de
facturación del dashboard baja en consecuencia; con motivo 01 sin sustituto el formulario no
deja continuar.

> **Y además (de F2-104).** `cfdis.codigo_id` es ÚNICO (es el candado de "doble clic no emite dos
> veces"): hoy un código cancelado no puede volver a emitirse por el portal. Si al cancelar se
> quiere dejar el ticket facturable otra vez, hay que decidir cómo (liberar el código del CFDI
> cancelado, o un índice único parcial `WHERE estado <> 'cancelado'`) y probar que el candado
> sigue valiendo. `estadoPublico` hoy trata un CFDI `cancelado` del código como nada (no lo lee).

> **Y además (de F2-107).** Ya existen `cfdis.motivo_cancelacion` (CHECK 01–04, sólo en
> `cancelado`) y `cfdis.cancelado_at`: la refacturación los llena con motivo 01. Con ellos las
> cancelaciones del tablero se pueden ubicar por `cancelado_at` (hoy van por emisión). El flujo de
> motivo 01 con sustituto ya está en `EmisionAdminService.refacturar` (sustituto 04 → cancelación);
> la cancelación 01 desde aquí debería reusarlo en vez de pedir un UUID a mano. Sin resolver: un
> sustituto que después se cancela deja al anterior con `sustituidoPor` cancelado y la refacturación
> contesta 409 (`sustituye_a_id` es único); decidir si se permite una segunda sustitución.

> **Y además (de F2-108).** (1) **Cancelar una global** (motivo 02/03, o 04 cuando un ticket de la
> global se factura nominativo después): hoy sus tickets siguen amarrados a ella en
> `cfdi_global_codigos` (único por `codigo_id`) y su código dice `en_global`; decidir si al cancelar
> se sueltan (borrar las filas y regresar el código a `pendiente`) para que entren a otra global, y
> probar que el candado sigue valiendo. `estadoPublico` ya trata una global `cancelado` como si no
> estuviera. (2) Una global NO se refactura (409 en `cfdiParaRefacturar`/`reservarSustituto`): se
> cancela y se emite otra. (3) Si SR reabre o cancela una cuenta que ya entró a una global, el
> `total` guardado en su fila no cambia: decidir qué se hace.

### F2-110 · Control de folios del PAC
`[x]` **PARCIAL:** falta la conciliación de reservas colgadas en `timbrando` con el PAC (los cuatro orígenes), la de CFDI vigentes que el PAC canceló tarde, la refacturación con la 01 pendiente y la recuperación de XML/PDF no guardados: todo en **F2-110b**; y sin `folios_bajo` en el centro de alertas (❓ decisión abierta, esquema-sr §2 "Control de folios (F2-110)" y nota en F2-250). **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (saldo único por cuenta, cancelar no consume, vigencia de 12 meses). Contador de folios consumidos por empresa y global (cada timbre exitoso, incluida
global y sustituciones, decrementa saldo local configurado al comprar paquete a Facturama).
Vista admin de saldo + umbral de alerta (default 20%) con aviso por correo al admin_global;
recordatorio de vigencia anual de los folios (fecha de compra + 12 meses). Reporte mensual
de consumo por empresa (base para el recobro en la anualidad del cliente).

> **Y además (de F2-224):** el "saldo de folios bajo" es una regla del centro de alertas.
> Agregar `folios_bajo` al enum `TipoAlerta` (migración), su definición en
> `api/src/alertas/reglas.ts` (unidad, rango, default 20 %, severidad), su condición en
> `api/src/alertas/evaluador.ts` y su texto en `web/src/alertas/textos.ts`. La evaluación
> ya corre sola y bajo candado: sólo falta la condición.

**Listo cuando:** con saldo simulado en 0, la emisión se bloquea ANTES de llamar a Facturama
con mensaje claro; el reporte mensual cuadra con el nº de CFDI vigentes+cancelados del
periodo.

> **Y además (de F2-104).** (1) **Reservas colgadas**: una emisión con respuesta AMBIGUA del PAC
> (timeout, 500/502/504) o cuya confirmación falló deja la fila de `cfdis` en `timbrando` y el
> código en `en_proceso` para siempre; el log del api trae la reserva (y el UUID si lo hubo). Hace
> falta un proceso (manual o programado) que consulte al PAC y la resuelva: confirmarla si timbró,
> o liberarla si no. (2) **Folios**: la reserva toma `perfiles_fiscales.folio_actual + 1`; un
> rechazo del SAT deja hueco a propósito. El conteo de timbres consumidos debe salir de los
> `cfdis` `vigente`/`cancelado`, no de `folio_actual`.

> **Y además (de F2-107).** La conciliación de reservas colgadas de arriba cubre también: (1) el
> **sustituto** de una refacturación que se quedó en `timbrando` (el CFDI anterior contesta 409 "ya
> tiene un sustituto en emisión" hasta que se resuelva) y (2) la **captura manual** colgada (la misma
> `solicitudId` contesta 409 con estado `timbrando`). Los dos mensajes del 409 remiten a esta tarea.
> (3) Una refacturación con la cancelación 01 **pendiente** (anterior `vigente` con sustituto
> `vigente`, `sustitucionPendiente` en la tabla) se reintenta a mano desde el tablero; conciliarla
> en automático (consultar al PAC y anotar la cancelación) cabe en el mismo proceso. (4) Los
> sustitutos y las facturas sin ticket son timbres: cuentan para el saldo de folios.

> **Y además (de F2-108).** Una factura global con respuesta AMBIGUA del PAC se queda en `timbrando`
> con sus tickets AMARRADOS en `cfdi_global_codigos` (no entran a otra global y el portal los dice
> `en_proceso`); la conciliación de reservas colgadas tiene que cubrirla también (confirmar: los
> códigos pasan a `en_global`; liberar: el CASCADE suelta los tickets). La global es un timbre:
> cuenta para el saldo de folios, y un rechazo del PAC deja hueco de folio como las demás.

> **Y además (de F2-109).** (1) Las cancelaciones AMBIGUAS ya se concilian solas: el sondeo de
> `CancelacionProgramador` consulta al PAC las solicitudes `solicitando` (más de 10 min) y
> `en_proceso`; la conciliación de reservas colgadas de esta tarea NO tiene que cubrirlas, SALVO
> el caso de una ambigua que a los 10 min se dio por no registrada (se borró): si Facturama la
> registró después, el CFDI está cancelado ante el SAT y vigente aquí; conciliar CFDI vigentes
> contra el PAC lo cubre. (2)
> Cancelar no es un timbre: no descuenta folios (supuesto de Facturama, F2-190). (3) Un CFDI
> cancelado SÍ cuenta en el reporte mensual como emitido (`vigente` + `cancelado`), y su sustituto o
> la re-emisión del ticket soltado cuentan como timbres nuevos.

## EPIC 9 — Inventario y compras

### F2-120 · Sincronización de catálogos de inventario desde SR
`[x]` **ALCANCE:** sin presentaciones ni productos-receta (el seed no los genera y no se sabe cómo los guarda SR: ver §9 de esquema-sr y la nota "Y además (de F2-120)" en F2-241; recetas son de F2-125); la lectura desde SR es de F2-241 y el forzado manual espera los once catálogos (decisión abierta, nota en F2-240). **PENDIENTE DE VALIDACIÓN REAL:** ver F2-192. Extender el agente (`ISoftRestaurantReader`) con lectura de catálogos: insumos, grupos
de insumos, unidades, almacenes, presentaciones y productos-receta (tablas reales según
`/docs/esquema-sr.md`, extender F1-090 si falta mapeo). Sync completa diaria + hash por
catálogo para detectar cambios y no reenviar iguales. Modelos espejo en Postgres con
`empresa_id`/`sucursal_id` y `origen_sr_id` para trazabilidad.

**Listo cuando:** alta de un insumo en SR aparece en Postgres en ≤ 24 h (o al forzar sync
desde admin); renombrar un insumo actualiza, no duplica.

### F2-121 · Existencias y valuación
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** el lector del agente es F2-241 y el cuadre contra el reporte de SR es F2-193 (ver §10 de esquema-sr). Lectura periódica (cada 30 min) de existencias por almacén desde SR con costo
promedio. Vista "Existencias" réplica de Arkhon: KPIs (artículos visibles, valor estimado $,
atención requerida = bajo mínimo, sin existencia), tabla por artículo/sucursal/almacén
(unidad, existencia, costo, valor, estado semáforo), filtros por sucursal y almacén,
búsqueda. Mínimos/máximos por artículo editables en nuestra web (**no escriben a SR**).

> **Y además (de F2-224):** "artículo bajo mínimo" es una regla del centro de alertas.
> Agregar `bajo_minimo` al enum `TipoAlerta` (migración), su definición en
> `api/src/alertas/reglas.ts`, su condición en `api/src/alertas/evaluador.ts` (llave =
> artículo + almacén) y su texto en `web/src/alertas/textos.ts`.

**Listo cuando:** el valor total estimado cuadra contra el reporte de inventario de SR del
mismo corte (piloto); artículo bajo mínimo aparece en "atención requerida".

### F2-122 · Movimientos y pólizas
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** el lector del agente es F2-241 y el kardex contra el saldo real del piloto es F2-193 (ver §10 de esquema-sr). Ingesta de movimientos de inventario de SR (entradas, salidas, mermas, ajustes) con
referencia a póliza/documento. Vista "Movimientos": timeline filtrable por artículo, tipo,
rango, almacén; detalle de póliza con partidas. Kardex por artículo (saldo corrido).

**Listo cuando:** el kardex de un artículo del piloto reproduce el saldo actual partiendo del
inicial + movimientos; sin huecos ni dobles.

### F2-123 · Conteos físicos
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-193 (celular real con bloqueo y sin red, corte del teórico contra SR y ajuste en SR que regresa como póliza `ajuste`; §10 de esquema-sr). Módulo de conteo desde la web (pensado para tablet/celular en el almacén): crear conteo
por almacén (todos los artículos o por grupo), captura de cantidades con búsqueda rápida,
guardado parcial, cierre con reporte de diferencias vs teórico (unidades y $) y export CSV.
Los ajustes **NO se escriben a SR** (regla de solo lectura): el reporte es el insumo para que
el encargado ajuste en SR; enlace de ayuda documentando el proceso.

**Listo cuando:** un conteo de 50 artículos se captura en móvil sin perder datos al bloquearse
la pantalla; el reporte de diferencias cuadra aritméticamente.

### F2-124 · Traspasos entre sucursales/almacenes
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-193 (dos pólizas por traspaso en SR, fecha con hora, misma clave de insumo en las dos sucursales; §10 "Traspasos" de esquema-sr). Registro de traspasos leídos desde SR (si la instalación los usa) + traspasos propios de
la web con flujo enviado→recibido (dos confirmaciones), generando reporte imprimible; igual
que conteos, **sin escribir a SR**, con estado "pendiente de registrar en SR" hasta que la
sync detecte el movimiento espejo.

**Listo cuando:** un traspaso web queda conciliado automáticamente cuando aparece su
movimiento en SR (match por artículo+cantidad+fecha±1día); los no conciliados en 48 h se
marcan en alerta.

> **Y además (de F2-122).** Los traspasos LEÍDOS de SR ya llegan como pólizas por `POST
> /ingesta/movimientos`: una `traspaso_salida` en el almacén de origen y una `traspaso_entrada` en
> el de destino, con la `referencia` del documento de traspaso (así los arma el seed: `TR-0001`). El
> "movimiento espejo" que concilia un traspaso web se busca en `movimientos_inventario` (artículo +
> cantidad + fecha ± 1 día, y el tipo de póliza). Si SR registra el traspaso como un solo documento,
> ver §10 de `docs/esquema-sr.md` (un almacén por póliza).

### F2-125 · Recetas y consumo teórico
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** el lector del agente es F2-241 y los 3 insumos de control con el piloto (y la decisión abierta "¿SR descuenta por receta al vender?") son de F2-193 (ver §10 "Recetas" de esquema-sr). Ingesta de recetas de SR (explosión de insumos por producto). Cálculo diario de consumo
teórico: ventas de Fase 1 × receta = insumo consumido esperado; comparación contra consumo
real (movimientos F2-122) con % de variación por insumo. Vista "Recetas SoftRestaurant" con
detalle por producto y ranking de variaciones (posibles mermas/robos).

**Listo cuando:** con datos del piloto, la variación teórico-vs-real de 3 insumos de control
validada a mano coincide con la vista; productos sin receta quedan listados aparte, no truenan
el cálculo.

### F2-126 · Compras, gastos y utilidad
`[x]` **ALCANCE:** sin captura manual de compras. Las compras no entran a la utilidad; si hace falta capturarlas a mano es decisión abierta en F2-193. **PENDIENTE DE VALIDACIÓN REAL:** el lector de compras es F2-241, y el cuadre ±1 % con el contador del piloto (qué es `subtotal`, costo estándar o por inventarios, gastos sin IVA) es F2-193 (ver §10 "Compras, gastos y utilidad" de esquema-sr). Ingesta de compras de SR (o captura manual si la instalación no las registra) y captura
de gastos por sucursal con categorías. Vista "Gastos y utilidad": ventas (Fase 1) − costo de
lo vendido (consumo teórico F2-125 a costo) − gastos = utilidad bruta por periodo/sucursal,
con gráfica y export.

**Listo cuando:** el estado de resultados simple del piloto cuadra contra el cálculo del
contador para el mismo mes (±1% por redondeos documentados).

> **Y además (de F2-120):** el espejo de **proveedores** ya existe (`proveedores_catalogo`,
> `GET /catalogos/proveedores`, sembrado desde `PROVEEDORES`): las compras lo referencian por
> `origenSrId` en la misma sucursal, no crean otro catálogo.

> **Y además (de F2-140):** agrega la columna **Utilidad** a Comparativos (`/comparativos`,
> `web/src/paginas/comparativos/matriz.ts` → `METRICAS`), con A, B y Δ, la misma regla de "—"
> sin datos, su columna en el CSV y su test; y quita "Utilidad" de la nota de pendientes de la
> vista (`NOTA_PENDIENTES` en `paginas/Comparativos.tsx`).

### F2-127 · Proyecciones y sugerido de compra
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** la semana real del piloto y la base de la demanda si SR no deja pólizas de consumo son de F2-193 (ver §10 "Proyecciones" de esquema-sr). Proyección de consumo por insumo: promedio móvil ponderado de 4 semanas por
día-de-semana (sin ML, transparente y explicable) → sugerido de compra = proyección próximo
periodo − existencia + mínimo. Vista "Proyecciones" con ajuste manual del horizonte y export
del sugerido como orden de compra CSV.

**Listo cuando:** para un insumo con consumo estable en el seed, el sugerido queda dentro de
±15% del consumo real de la semana siguiente simulada; insumos nuevos sin historial muestran
"sin datos" en lugar de sugerir 0 a ciegas.

## EPIC 10 — Extras de producto

### F2-140 · Comparativos avanzados
`[x]` **ALCANCE:** sin tasa de facturación (la agrega F2-106), sin utilidad (la agrega F2-126) y una empresa a la vez (comparar entre empresas: ver F2-250). Vista "Comparativos": matriz empresa/sucursal × métrica (venta, tickets, ticket
promedio, comensales, tasa de facturación, utilidad si Epic 9 activo) con periodo A vs
periodo B (Δ absoluto y %), ranking de sucursales y export CSV.

**Listo cuando:** comparar "este mes vs mes anterior" cuadra con los dashboards individuales;
sucursal sin datos en un periodo muestra "—", no 0 engañoso.

### F2-141 · Reportes programados por correo
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-191. Configurable por usuario: resumen diario (venta de ayer por sucursal, top 5 productos,
alertas) y/o semanal (comparativo, tendencia), enviado vía Brevo con HTML simple + link al
panel. Cron por zona horaria de la empresa; opción de desuscribirse desde el correo.

**Listo cuando:** el diario llega antes de las 9:00 hora local con cifras que cuadran contra el
panel; darse de baja funciona sin login.

### F2-142 · WebSockets para el monitor de mesas
`[x]` **ALCANCE:** el aviso sólo relee mesas (no ventas); upgrade detrás de Caddy sin verificar (nota en F1-002) y una sola instancia del api (Redis adapter si hay réplicas; `docs/tiempo-real.md`). Sustituir polling del monitor (F1-050) por WebSocket (gateway NestJS + socket.io): el api
emite evento al procesar snapshot/cheque; el front actualiza en caliente con fallback
automático a polling si el socket cae. Autenticación del socket con el mismo JWT.

**Listo cuando:** cambio de mesa visible en < 5 s tras la ingesta; matar el socket degrada a
polling sin que el usuario note más que el indicador de frescura.

### F2-143 · Auto-update remoto del agente
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** el swap con el administrador de servicios de verdad, el rollback y el instalador elevado se probaron sólo simulados: ver F1-020b; ❓ firma Authenticode abierta en F2-191 (ver `docs/actualizacion-agente.md`). Canal de versiones en el api (`GET /agente/version` con url firmada del binario + hash
SHA-256); el agente compara en cada heartbeat, descarga, verifica hash, se auto-reemplaza vía
servicio watchdog (segundo servicio mínimo que hace swap del binario) y reporta versión nueva.
Rollout gradual por sucursal (flag por sucursal en admin).

**Listo cuando:** publicar una versión nueva actualiza una sucursal flageada en ≤ 1 h sin
intervención local; hash inválido aborta y alerta; nunca quedan las dos versiones corriendo.

### F2-144 · Módulo delivery/canales
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-192. **ALCANCE:** sin ingesta nueva (el único dato de canal por cuenta es el área, que ya viaja desde F2-233; ver `docs/delivery.md` §4). ❓ **Las decisiones de canal (enum fijo y mapeo por sucursal) SIGUEN ABIERTAS para Ricardo** (`docs/delivery.md` §5). Alcance mínimo (equivalente a "Arkhon Delivery"): ingesta de ventas por canal
(mostrador/comedor/domicilio/plataformas si SR las distingue por área o tipo de servicio),
vista de ventas por canal con comparativo y % de mezcla. **Nota:** el alcance real se define
viendo qué registra la instalación piloto; esta tarea abre con un spike de 1 día documentado
antes de construir.

**Listo cuando:** spike documentado en `/docs/delivery.md` con decisión de alcance; la vista
muestra la mezcla por canal cuadrando contra el total de ventas.

> **Y además (de F2-233).** Ya existen el mapeo área → canal de negocio (`areas_canal`,
> `PUT /catalogos/areas/{id}/canal`) y `GET /ventas/por-area` (venta por canal con "sin canal" y
> "sin clasificar" aparte, Σ = venta). ❓ **Decisión abierta para Ricardo, que esta tarea cierra
> con su spike:** el conjunto de canales quedó como enum fijo de Postgres (`comedor`,
> `mostrador`, `domicilio`, `plataformas`); agregar uno ("para llevar", "eventos") es una
> migración. Y el mapeo es por área de CADA sucursal: ¿hace falta mapear por nombre a nivel
> empresa? No construyas sobre otra forma sin decidir eso.

### F2-145 · Orquestador de menú / catálogo de productos
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-192. Vista "Productos" y "Orquestador de menú": catálogo de productos leído de SR (grupos,
precios, activos/inactivos), organización visual por categorías, detección de productos
vendidos sin catálogo y de precios distintos entre sucursales. **Solo lectura de SR**;
ediciones son metadata nuestra (foto, descripción, etiquetas) para uso futuro (menú digital).

**Listo cuando:** discrepancia de precio del mismo producto entre 2 sucursales del piloto
aparece señalada; metadata sobrevive re-sync del catálogo.

> **Lo que dejó F2-230.** El espejo de productos, su ingesta y la metadata propia ya existen
> (`productos`, `productos_metadata`, `GET /catalogos/productos`, `PUT /catalogos/productos/{id}/metadata`).
> El **precio no viaja todavía**: esta tarea lo agrega al contrato de `POST /ingesta/catalogos`.
> ❓ **Decisión abierta para Ricardo:** la metadata quedó **por sucursal** (cuelga del producto
> espejo de cada sucursal); foto, descripción y etiquetas del menú quizá deban ser por empresa y
> mín/máx por sucursal. Decidir antes de construir el orquestador. El botón "sincronizar ahora" de
> Administración (`POST /catalogos/sincronizacion/forzar`) tampoco tiene vista todavía.

### F2-146 · PWA con notificaciones
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-191 (instalar en Chrome escritorio/Android y push real con la app cerrada). Convertir la SPA en PWA instalable (manifest, service worker, offline shell para el
layout) con push notifications (web-push, VAPID): alertas configurables por usuario — mesa >
60 min, sucursal desconectada > 10 min, saldo de folios bajo, resumen de cierre del día.

**Listo cuando:** instalable desde Android/desktop Chrome; la alerta de sucursal desconectada
llega con la app cerrada; cada alerta se puede apagar individualmente.

### F2-147 · Landing pública + onboarding
`[x]` **PENDIENTE DE VALIDACIÓN REAL:** ver F2-191 (contacto real por Brevo a `CONTACTO_DESTINO`, zip del instalador en `AGENTE_URL_DESCARGA` y Lighthouse en el dominio real detrás de Caddy). **ALCANCE:** capturas como ilustraciones SVG marcadas (no capturas reales) y precios "por confirmar" (decisión abierta para Ricardo, `docs/onboarding.md`). Landing del producto (dominio raíz): propuesta de valor, capturas, precios, formulario de
contacto (a Brevo) y FAQ. Onboarding semi-self-service: alta de empresa desde admin_global con
wizard (datos, sucursales, generación de API keys, links de descarga del agente y guía),
checklist de arranque visible hasta completarse.

**Listo cuando:** lighthouse de la landing > 90; el wizard deja una empresa nueva lista para
instalar agente en < 10 min de captura.

### F2-110b · Conciliación de reservas colgadas con el PAC
`[x]` **Bloque F** · /api + /web · **PENDIENTE DE VALIDACIÓN REAL:** ver F2-190 (búsqueda por serie y folio de Facturama, plazos de 15 min y 7 días). Resto del corte de F2-110 (ver `docs/nocturno-log.md`, F2-110).

Un proceso (programado, con el patrón de `cancelacion.programador.ts`, más un disparo manual desde
el tablero) que CONCILIA contra el PAC lo que la emisión o la cancelación dejaron sin saber:

1. **Reservas colgadas en `timbrando`** de los cuatro orígenes: ticket (portal), sin ticket (captura
   manual, su `solicitudId` contesta 409 mientras tanto), sustituto de una refacturación (el anterior
   contesta 409 "ya tiene un sustituto en emisión") y factura global (sus tickets quedan amarrados en
   `cfdi_global_codigos`). Si el PAC timbró: CONFIRMAR con `confirmarCfdi` (el código pasa a
   `facturado`, los de la global a `en_global`, el sustituto se lleva el código). Si no timbró:
   LIBERAR con `liberarReserva` (la global suelta sus tickets por CASCADE). Hoy una reserva colgada
   resta saldo de folios ("en emisión") hasta que se concilie.
2. **CFDI vigentes contra el PAC**: una cancelación ambigua que a los 10 min se dio por no
   registrada y que Facturama sí registró deja el CFDI cancelado ante el SAT y vigente aquí.
3. **Refacturación con la cancelación 01 pendiente** (anterior `vigente` con sustituto `vigente`,
   `sustitucionPendiente` en el tablero): consultar al PAC y anotar la cancelación.
4. **Archivos no guardados**: recuperar del PAC el XML/PDF de un CFDI vigente sin archivos (ALCANCE
   de F2-105), con `PuertoArchivos`.

Exige un método NUEVO en `PuertoTimbrado` para encontrar un CFDI sin `idPac` (la reserva ambigua no
lo tiene): por serie y folio o por la referencia. Implementación Facturama (supuesto documentado en
esquema-sr §2, a validar en F2-190) con **test de contrato**, y el PAC falso capaz de "timbrar sin
contestar" para probarlo.

**Listo cuando:** contra el PAC falso, con reloj falso y sobre fixtures propias: (1) una reserva
ambigua de CADA origen que el PAC sí timbró queda confirmada (código/tickets en el estado correcto) y
una que no timbró queda liberada (ticket de nuevo facturable, tickets de la global sueltos), cada una
con un test; (2) un CFDI vigente que el PAC reporta cancelado queda `cancelado` con su fecha; (3) una
refacturación con la 01 pendiente se cierra sola; (4) un CFDI sin archivos los recupera; (5) dos
vueltas simultáneas no confirman ni liberan dos veces (candado en base); (6) el saldo de folios deja
de contar la reserva conciliada; (7) el contrato del método nuevo queda fijado por test de contrato;
(8) una reserva recién tomada (menos de N minutos) NO se toca.
