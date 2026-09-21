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

1. Toma la **primera tarea de esta lista, de arriba abajo, que no esté `[x]`** y que no
   aparezca como **SALTADA** en `docs/nocturno-log.md`.
2. **Una tarea por sesión.** La sesión termina al cerrarla o al saltarla. No encadenes la
   siguiente aunque quede tiempo y aunque sea obvia cuál sigue.
3. `[x]` **sólo tras merge confirmado a main**. No por CI verde, no por "ya pusheé".
4. **No tomes nada del bloque Diurnas ni de la Fase 2**, aunque la cola se vea trabada.
5. Si **no queda ninguna tarea pendiente** en esta cola: no inventes ninguna ni te
   adelantes a las Diurnas. Crea el archivo vacío **`COLA_VACIA.txt`** en la raíz del repo
   y termina. El loop lo lee y para.

> **Este orden ya respeta el grafo de dependencias** (que sigue abajo, como referencia).
> No lo reordenes por tu cuenta. Está puesto para que el carril B (api + frontend, que
> avanza con el seed) corra primero y el carril A (agente) después, porque el agente es lo
> único que necesita una instalación real de SoftRestaurant para terminar de validarse.

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
`[ ]` **Epic 6 — Administración**

Vistas admin: alta/edición/desactivación de empresas y sucursales; alta de usuarios con rol
y empresa; generación/rotación de API key de sucursal con modal "cópiala ahora, no se
volverá a mostrar"; cambio de contraseña propio y reset por admin.

**Listo cuando:** un admin_empresa no puede tocar otra empresa ni crear admin_global;
auditoría mínima en log de api (quién creó/rotó qué).

## 16 · F1-061 · Estado de agentes
`[ ]` **Epic 6 — Administración**

Vista con tabla por sucursal: conectado/desconectado, última lectura, versión agente y SR,
tamaño de cola reportado, último error. Badge de alerta en sidebar si alguna sucursal lleva
> 10 min sin reportar.

**Listo cuando:** refleja en < 1 min la caída del agente (probado matando el servicio).

> ⚠️ **Verificación parcial de noche.** "Matando el servicio" necesita el agente instalado
> (F1-020 en adelante, y una máquina Windows). De noche se cierra probando la lógica de
> frescura con `AgenteEstado` manipulado en base — que es donde vive el bug real — y se
> anota el resto como pendiente. Di qué se probó.

## 17 · F1-020 · Esqueleto del servicio + configuración
`[ ]` **Epic 2 — Agente Windows (.NET 8)**

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
`[ ]` **Epic 2 — Agente Windows (.NET 8)**

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

## 19 · F1-024 · Cola local resiliente + envío
`[ ]` **Epic 2 — Agente Windows (.NET 8)**

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
`[ ]` **Epic 2 — Agente Windows (.NET 8)**

Cada ciclo, evento `heartbeat`: versión agente, versión SR, latencia de query, tamaño de
cola, último error. El API lo persiste en `AgenteEstado`.

**Listo cuando:** el panel admin (F1-061) muestra "última lectura hace X min" correcto por
sucursal; matar el servicio pone la sucursal en estado desconectado tras 3 intervalos sin
heartbeat.

## 21 · F1-026 · Instalador y guía de instalación
`[ ]` **Epic 2 — Agente Windows (.NET 8)**

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

## 22 · F1-092 · Hardening y pulido final
`[ ]` **Epic 7 — Validación contra SoftRestaurant real y cierre de fase**

Revisión: headers de seguridad en Caddy (HSTS, CSP básica), rate limits afinados, tamaño de
bundle < 400 kB gzip, lighthouse móvil > 85, textos y formatos de moneda/fecha MX
consistentes, favicon/nombre/branding propio, página 404, pantalla de login presentable.

**Listo cuando:** revisión cruzada de otro dev (o agente revisor) sin hallazgos críticos
abiertos.

> La parte de Caddy se escribe y se valida con `docker compose config` + test local; **no
> se despliega** (el deploy está prohibido en modo autónomo y el VPS es tarea diurna).

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

## F1-023 · Lectura de cuentas abiertas (mesas en vivo)
`[ ]` **Epic 2** · 🔒 **Razón: bloqueada por F1-090.** Mismo caso que F1-022: las tablas
temporales de cuentas abiertas son justo donde más varía SoftRestaurant entre versiones.

Query sobre tablas temporales de cuentas abiertas (tipo `tempcheques`/`tempcheqdet`): mesa,
mesero, hora de apertura, comensales, partidas con modificadores y precios, total
acumulado, impreso sí/no. Se manda snapshot completo de abiertas en cada ciclo (no delta),
etiquetado con timestamp de lectura.

**Listo cuando:** abrir/modificar/cerrar una mesa en SR se refleja en el snapshot del
siguiente ciclo; una mesa cerrada desaparece del snapshot y su cheque llega por F1-022.

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

## Toda la FASE 2
`[ ]` 🔒 **Razón: congelada hasta que F1-091 cierre.** No es una fecha: es una condición.
La Fase 2 entera (Epics 8, 9 y 10 — facturación CFDI, inventario y extras) vive más abajo,
documentada y sin tocar.

**No se adelanta Fase 2 durante el Sprint 1.** Si una decisión de Fase 1 la afecta (p. ej.
dejar un campo listo para el código de facturación), se anota como comentario en la tarea
de Fase 2 correspondiente, **no se implementa**.

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

> 🔒 **CONGELADA hasta que F1-091 esté `[x]`.** Ninguna tarea de esta fase entra a la Cola
> nocturna, y una sesión autónoma no la toca aunque la cola se vacíe. Está aquí completa
> para no perder el trabajo de análisis, no para tomarse.

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
F1-091 (fase 1 cerrada) → toda F2
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
`[ ]` Modelos Prisma: `PerfilFiscal(id, empresa_id, rfc, razon_social, regimen_fiscal, cp,
serie, folio_actual, facturama_org_id, activo)` y `ReceptorFrecuente(rfc, razon_social,
regimen, cp, uso_cfdi, email)` (cache de receptores para autocompletar). Vista admin para
capturar datos fiscales y subir CSD (.cer, .key, contraseña): los archivos van DIRECTO a
Facturama Multiemisor vía API (crear emisor + subir CSD); en nuestra base solo se guarda
`facturama_org_id` y metadata (vigencia del certificado, nº de serie) — nunca el .key ni su
contraseña. Validación al guardar: emitir un CFDI de prueba en sandbox y cancelarlo.

**Listo cuando:** subir un CSD de prueba del SAT crea el emisor en Facturama sandbox y el
CFDI de validación timbra; un .key con contraseña incorrecta muestra error claro sin guardar
nada; la vista muestra vigencia del certificado y alerta si vence en < 30 días.

### F2-101 · Código corto de facturación por cheque
`[ ]` Al ingerir un cheque cerrado (hook en F1-031), generar `CodigoFacturacion(codigo único
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
`[ ]` Rutas públicas `/f/:slug` (slug por sucursal, estilo `me-facturo`): paso 1 código de
ticket (precargado si viene en URL) → muestra resumen del consumo (fecha, sucursal, total,
desglose subtotal/IVA); paso 2 datos del receptor: RFC (validar forma con regex oficial),
razón social, régimen (select con catálogo SAT), CP, uso CFDI (select filtrado por régimen),
email; paso 3 confirmación → emite (F2-104) → pantalla de éxito con descarga XML/PDF y aviso
de envío por correo. Branding por sucursal (logo + color). Mobile-first: el 90% entrará
desde el celular tras escanear el QR.

**Listo cuando:** flujo completo en sandbox desde un celular en < 2 min; errores de captura
se marcan campo por campo en español claro; un código ya facturado ofrece re-descargar la
factura existente en lugar de fallar.

### F2-104 · Emisión de CFDI vía Facturama
`[ ]` Servicio `CfdiService.emitir(chequeId, receptor)`: construye el JSON de Facturama
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

### F2-105 · Entrega de la factura
`[ ]` Al timbrar: guardar XML y PDF (obtenidos de Facturama) en disco del VPS bajo
`/data/cfdi/{empresa}/{año}/{mes}/`, servir por endpoint autenticado + token firmado de
descarga pública temporal para el portal; enviar correo vía Brevo (plantilla con branding de
la sucursal, XML y PDF adjuntos, copia opcional al restaurante). Registro `CfdiEnvio(cfdi_id,
email, estado, intento, error)` con reintento manual desde admin.

**Listo cuando:** el correo llega con ambos adjuntos válidos (probado con inbox real); si
Brevo falla, el portal sigue ofreciendo la descarga directa y el envío queda marcado para
reintento; los archivos sobreviven un redeploy (volumen persistente + incluidos en backup
F1-004).

### F2-106 · Dashboard de facturación
`[ ]` Réplica funcional del dashboard de facturación de Arkhon: filtros (sucursal, rango de
fechas, atajos Hoy/7/30/mes/año), KPIs (ventas del periodo = tickets sincronizados, monto
facturado CFDI, cancelaciones, tasa de facturación = facturado/ventas), barras por sucursal,
por mes y por hora, tabla de CFDI emitidos (UUID, serie-folio, receptor, total, estado,
descargas XML/PDF) con búsqueda por RFC/UUID/folio. Sección "Por facturar": tickets con
código pendiente del periodo.

**Listo cuando:** cifras cuadran contra los datos de ventas de Fase 1 para el mismo rango
(mismo seed extendido con CFDIs de sandbox); export CSV de la tabla de CFDI.

### F2-107 · Factura sin ticket y refacturación
`[ ]` Vista admin "Facturar sin ticket": captura manual de importe total + datos de receptor
→ emite CFDI ligado a la sucursal sin cheque (marcado `origen=manual`). Refacturación: sobre
un CFDI vigente, botón "refacturar" = cancelar con motivo 01 (comprobante emitido con
errores con relación) + emitir sustituto relacionado (`TipoRelacion 04`), en una sola acción
guiada.

**Listo cuando:** la refacturación en sandbox deja el CFDI viejo cancelado con relación al
nuevo y el nuevo timbrado con el UUID relacionado; ambos aparecen correctamente en el
dashboard.

### F2-108 · Factura global de tickets no facturados
`[ ]` Job programado (cron en api, `node-cron`) por empresa con periodicidad configurable
(diaria/semanal/mensual, default mensual): agrupa cheques con código `pendiente` ya expirado
del periodo, emite CFDI global a público en general (RFC `XAXX010101000`, un concepto por
ticket con clave `01010101`, periodicidad/meses/año conforme a regla SAT de CFDI global
4.0), marca códigos como `en_global`. Vista previa antes de emitir (modo manual) u opción
100% automática.

**Listo cuando:** en sandbox, la global de un mes de seed timbra con la estructura de
periodicidad correcta; un ticket dentro de una global ya no puede autofacturarse y el portal
lo explica ("este ticket fue incluido en factura global del periodo X, contacta al
restaurante").

### F2-109 · Cancelación de CFDI
`[ ]` Flujo de cancelación desde el dashboard: elegir motivo SAT (01–04; si 01, exigir UUID
sustituto), llamar API de cancelación de Facturama, reflejar estados intermedios (en proceso
/ aceptada / rechazada por receptor) vía polling o webhook de Facturama, notificar por
correo al receptor. El cheque vuelve a ser facturable si la cancelación procede (nuevo
código).

**Listo cuando:** cancelación en sandbox con motivo 02 queda `cancelado` y la tasa de
facturación del dashboard baja en consecuencia; con motivo 01 sin sustituto el formulario no
deja continuar.

### F2-110 · Control de folios del PAC
`[ ]` Contador de folios consumidos por empresa y global (cada timbre exitoso, incluida
global y sustituciones, decrementa saldo local configurado al comprar paquete a Facturama).
Vista admin de saldo + umbral de alerta (default 20%) con aviso por correo al admin_global;
recordatorio de vigencia anual de los folios (fecha de compra + 12 meses). Reporte mensual
de consumo por empresa (base para el recobro en la anualidad del cliente).

**Listo cuando:** con saldo simulado en 0, la emisión se bloquea ANTES de llamar a Facturama
con mensaje claro; el reporte mensual cuadra con el nº de CFDI vigentes+cancelados del
periodo.

## EPIC 9 — Inventario y compras

### F2-120 · Sincronización de catálogos de inventario desde SR
`[ ]` Extender el agente (`ISoftRestaurantReader`) con lectura de catálogos: insumos, grupos
de insumos, unidades, almacenes, presentaciones y productos-receta (tablas reales según
`/docs/esquema-sr.md`, extender F1-090 si falta mapeo). Sync completa diaria + hash por
catálogo para detectar cambios y no reenviar iguales. Modelos espejo en Postgres con
`empresa_id`/`sucursal_id` y `origen_sr_id` para trazabilidad.

**Listo cuando:** alta de un insumo en SR aparece en Postgres en ≤ 24 h (o al forzar sync
desde admin); renombrar un insumo actualiza, no duplica.

### F2-121 · Existencias y valuación
`[ ]` Lectura periódica (cada 30 min) de existencias por almacén desde SR con costo
promedio. Vista "Existencias" réplica de Arkhon: KPIs (artículos visibles, valor estimado $,
atención requerida = bajo mínimo, sin existencia), tabla por artículo/sucursal/almacén
(unidad, existencia, costo, valor, estado semáforo), filtros por sucursal y almacén,
búsqueda. Mínimos/máximos por artículo editables en nuestra web (**no escriben a SR**).

**Listo cuando:** el valor total estimado cuadra contra el reporte de inventario de SR del
mismo corte (piloto); artículo bajo mínimo aparece en "atención requerida".

### F2-122 · Movimientos y pólizas
`[ ]` Ingesta de movimientos de inventario de SR (entradas, salidas, mermas, ajustes) con
referencia a póliza/documento. Vista "Movimientos": timeline filtrable por artículo, tipo,
rango, almacén; detalle de póliza con partidas. Kardex por artículo (saldo corrido).

**Listo cuando:** el kardex de un artículo del piloto reproduce el saldo actual partiendo del
inicial + movimientos; sin huecos ni dobles.

### F2-123 · Conteos físicos
`[ ]` Módulo de conteo desde la web (pensado para tablet/celular en el almacén): crear conteo
por almacén (todos los artículos o por grupo), captura de cantidades con búsqueda rápida,
guardado parcial, cierre con reporte de diferencias vs teórico (unidades y $) y export CSV.
Los ajustes **NO se escriben a SR** (regla de solo lectura): el reporte es el insumo para que
el encargado ajuste en SR; enlace de ayuda documentando el proceso.

**Listo cuando:** un conteo de 50 artículos se captura en móvil sin perder datos al bloquearse
la pantalla; el reporte de diferencias cuadra aritméticamente.

### F2-124 · Traspasos entre sucursales/almacenes
`[ ]` Registro de traspasos leídos desde SR (si la instalación los usa) + traspasos propios de
la web con flujo enviado→recibido (dos confirmaciones), generando reporte imprimible; igual
que conteos, **sin escribir a SR**, con estado "pendiente de registrar en SR" hasta que la
sync detecte el movimiento espejo.

**Listo cuando:** un traspaso web queda conciliado automáticamente cuando aparece su
movimiento en SR (match por artículo+cantidad+fecha±1día); los no conciliados en 48 h se
marcan en alerta.

### F2-125 · Recetas y consumo teórico
`[ ]` Ingesta de recetas de SR (explosión de insumos por producto). Cálculo diario de consumo
teórico: ventas de Fase 1 × receta = insumo consumido esperado; comparación contra consumo
real (movimientos F2-122) con % de variación por insumo. Vista "Recetas SoftRestaurant" con
detalle por producto y ranking de variaciones (posibles mermas/robos).

**Listo cuando:** con datos del piloto, la variación teórico-vs-real de 3 insumos de control
validada a mano coincide con la vista; productos sin receta quedan listados aparte, no truenan
el cálculo.

### F2-126 · Compras, gastos y utilidad
`[ ]` Ingesta de compras de SR (o captura manual si la instalación no las registra) y captura
de gastos por sucursal con categorías. Vista "Gastos y utilidad": ventas (Fase 1) − costo de
lo vendido (consumo teórico F2-125 a costo) − gastos = utilidad bruta por periodo/sucursal,
con gráfica y export.

**Listo cuando:** el estado de resultados simple del piloto cuadra contra el cálculo del
contador para el mismo mes (±1% por redondeos documentados).

### F2-127 · Proyecciones y sugerido de compra
`[ ]` Proyección de consumo por insumo: promedio móvil ponderado de 4 semanas por
día-de-semana (sin ML, transparente y explicable) → sugerido de compra = proyección próximo
periodo − existencia + mínimo. Vista "Proyecciones" con ajuste manual del horizonte y export
del sugerido como orden de compra CSV.

**Listo cuando:** para un insumo con consumo estable en el seed, el sugerido queda dentro de
±15% del consumo real de la semana siguiente simulada; insumos nuevos sin historial muestran
"sin datos" en lugar de sugerir 0 a ciegas.

## EPIC 10 — Extras de producto

### F2-140 · Comparativos avanzados
`[ ]` Vista "Comparativos": matriz empresa/sucursal × métrica (venta, tickets, ticket
promedio, comensales, tasa de facturación, utilidad si Epic 9 activo) con periodo A vs
periodo B (Δ absoluto y %), ranking de sucursales y export CSV.

**Listo cuando:** comparar "este mes vs mes anterior" cuadra con los dashboards individuales;
sucursal sin datos en un periodo muestra "—", no 0 engañoso.

### F2-141 · Reportes programados por correo
`[ ]` Configurable por usuario: resumen diario (venta de ayer por sucursal, top 5 productos,
alertas) y/o semanal (comparativo, tendencia), enviado vía Brevo con HTML simple + link al
panel. Cron por zona horaria de la empresa; opción de desuscribirse desde el correo.

**Listo cuando:** el diario llega antes de las 9:00 hora local con cifras que cuadran contra el
panel; darse de baja funciona sin login.

### F2-142 · WebSockets para el monitor de mesas
`[ ]` Sustituir polling del monitor (F1-050) por WebSocket (gateway NestJS + socket.io): el api
emite evento al procesar snapshot/cheque; el front actualiza en caliente con fallback
automático a polling si el socket cae. Autenticación del socket con el mismo JWT.

**Listo cuando:** cambio de mesa visible en < 5 s tras la ingesta; matar el socket degrada a
polling sin que el usuario note más que el indicador de frescura.

### F2-143 · Auto-update remoto del agente
`[ ]` Canal de versiones en el api (`GET /agente/version` con url firmada del binario + hash
SHA-256); el agente compara en cada heartbeat, descarga, verifica hash, se auto-reemplaza vía
servicio watchdog (segundo servicio mínimo que hace swap del binario) y reporta versión nueva.
Rollout gradual por sucursal (flag por sucursal en admin).

**Listo cuando:** publicar una versión nueva actualiza una sucursal flageada en ≤ 1 h sin
intervención local; hash inválido aborta y alerta; nunca quedan las dos versiones corriendo.

### F2-144 · Módulo delivery/canales
`[ ]` Alcance mínimo (equivalente a "Arkhon Delivery"): ingesta de ventas por canal
(mostrador/comedor/domicilio/plataformas si SR las distingue por área o tipo de servicio),
vista de ventas por canal con comparativo y % de mezcla. **Nota:** el alcance real se define
viendo qué registra la instalación piloto; esta tarea abre con un spike de 1 día documentado
antes de construir.

**Listo cuando:** spike documentado en `/docs/delivery.md` con decisión de alcance; la vista
muestra la mezcla por canal cuadrando contra el total de ventas.

### F2-145 · Orquestador de menú / catálogo de productos
`[ ]` Vista "Productos" y "Orquestador de menú": catálogo de productos leído de SR (grupos,
precios, activos/inactivos), organización visual por categorías, detección de productos
vendidos sin catálogo y de precios distintos entre sucursales. **Solo lectura de SR**;
ediciones son metadata nuestra (foto, descripción, etiquetas) para uso futuro (menú digital).

**Listo cuando:** discrepancia de precio del mismo producto entre 2 sucursales del piloto
aparece señalada; metadata sobrevive re-sync del catálogo.

### F2-146 · PWA con notificaciones
`[ ]` Convertir la SPA en PWA instalable (manifest, service worker, offline shell para el
layout) con push notifications (web-push, VAPID): alertas configurables por usuario — mesa >
60 min, sucursal desconectada > 10 min, saldo de folios bajo, resumen de cierre del día.

**Listo cuando:** instalable desde Android/desktop Chrome; la alerta de sucursal desconectada
llega con la app cerrada; cada alerta se puede apagar individualmente.

### F2-147 · Landing pública + onboarding
`[ ]` Landing del producto (dominio raíz): propuesta de valor, capturas, precios, formulario de
contacto (a Brevo) y FAQ. Onboarding semi-self-service: alta de empresa desde admin_global con
wizard (datos, sucursales, generación de API keys, links de descarga del agente y guía),
checklist de arranque visible hasta completarse.

**Listo cuando:** lighthouse de la landing > 90; el wizard deja una empresa nueva lista para
instalar agente en < 10 min de captura.
