# Esquema real de SoftRestaurant

Lo que de verdad hay en la base SQL Server del POS, versión por versión. Este archivo
es la memoria del proyecto sobre SoftRestaurant: **el conocimiento que sólo se consigue
mirando una instalación real y que no está en ningún otro lado.**

## Cómo se usa

- **Se escribe siempre.** Todo hallazgo sobre tablas, columnas o comportamientos raros
  del POS se documenta aquí **en el mismo entregable** que lo descubrió, aunque la tarea
  no sea F1-090. Es regla de `CLAUDE.md` y el revisor bloquea si falta.
- **Se lee antes de tocar el agente.** Lo que parece un bug nuestro suele ser una columna
  que en esta versión del POS significa otra cosa.
- **Supuesto y hecho se distinguen siempre.** Cada dato lleva su marca:
  - ✅ **VALIDADO** contra una instalación real, con la fecha y la versión de SR.
  - ⚠️ **SUPUESTO** — inferido de documentación, de otra versión o a ojo. No se ha visto
    funcionar. Un supuesto disfrazado de hecho es exactamente lo que este archivo existe
    para evitar.
- **Regla de oro, aquí también:** todas las queries de este documento son de **solo
  lectura**, con `WITH (NOLOCK)` y timeout corto. Nada en este archivo escribe en la base
  del POS.

---

## 1. Versiones e identificación

> Cómo saber contra qué versión de SR se está hablando. Alimenta a `F1-021` y a la
> elección de `ISoftRestaurantReader`.

| Versión SR | Cómo se detecta (tabla/columna) | Reader | Estado |
|---|---|---|---|
| 10 (exe `softrestaurant.exe` 10.0.323) | `dbo.parametros2.versiondb` = `10.021800` | `SrV11Reader` | ✅ **VALIDADO** 2026-09-21, instalación local de desarrollo (F1-021) |
| 11 | ⚠️ se supone la misma columna, con parte entera 11 | `SrV11Reader` + Warning en el log | ⚠️ **SUPUESTO** — nunca vista |
| cualquier otra | parte entera ≠ 10 y ≠ 11 | ninguno: log de error, el agente no lee | — |

**Query de detección** (el agente la corre en dos pasos, `agent/src/ArkonAgente/Sql/Consultas/`):

```sql
-- 1) sr_estructura.sql: sólo catálogo. Qué tablas candidatas hay en dbo.
SELECT t.name AS tabla,
       CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.columns AS c WITH (NOLOCK)
            WHERE c.object_id = t.object_id AND c.name = N'versiondb') THEN 1 ELSE 0 END AS bit) AS tiene_versiondb
FROM sys.tables AS t WITH (NOLOCK)
JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = t.schema_id
WHERE s.name = N'dbo'
  AND t.name IN (N'parametros2', N'cheques', N'cheqdet', N'chequespagos', N'tempcheques', N'tempcheqdet');

-- 2) sr_version.sql: sólo si (1) confirmó dbo.parametros2.versiondb (si no, error 208).
SELECT TOP (2) CAST(p.versiondb AS nvarchar(40)) AS version_db
FROM dbo.parametros2 AS p WITH (NOLOCK);
```

**Lo que se vio en SR 10.0.323** (✅ VALIDADO 2026-09-21, sólo metadatos y la columna de
versión; no se copió ningún dato de negocio):

- `dbo.parametros2` tiene **una** fila. `versiondb` es `numeric(15,6) NOT NULL` y vale
  `10.021800`.
- **Columnas señuelo con el mismo nombre, que NO son la versión:**
  - `dbo.configuracion.versiondb` (`varchar(10)`) vale **NULL**;
  - `dbo.configuracion.revisiondb` (`varchar(2)`) vale **NULL**;
  - `dbo.parametros.versiondb` (`varchar(5)`) vale **`'0'`**.
  
  Quien busque "la tabla de versión" por nombre cae en éstas primero.
- Otras columnas con "version" que son de **módulos**, no de la base:
  - `parametros2`: sólo `versiondb`, la buena;
  - `parametros3.versionMIT` y `parametros3.versionfacturacion`;
  - `facturas*.versionfacturacion` y `facturascomplementoine.version`;
  - `ws_cloud.Version`, `AxConfig.ApiVersion`, `registro_dispositivos.app_version`;
  - `configuracion.hotelversionsistema`;
  - `FKVersionControlId` en `CancellationReason`, `Month`, `Periodicity` y `TaxSubject`.
- Existen en `dbo`: `cheques`, `cheqdet`, `chequespagos`, `tempcheques`, `tempcheqdet`,
  `tempchequespagos`, `productos`, `meseros`, `formasdepago`, `turnos`, `configuracion`.
  **Sólo se confirmó que existen**; sus columnas siguen sin mapear (§2–§7, F1-090).
- La base se llama `softrestaurant10`. El agente **no** depende del nombre: toma el de
  `Database` en la cadena.

**Supuestos de la detección** (⚠️ ninguno se ha visto; el código los marca igual):

- ⚠️ **SUPUESTO — la parte entera de `versiondb` es la versión mayor de SR.** Cuadra con
  SR 10, pero no se sabe cómo se relaciona `021800` con el `10.0.323` del ejecutable. Por
  eso el agente reporta el texto tal cual (`10.021800`), sin redondear ni reformatear.
- ⚠️ **SUPUESTO — SR 11 guarda la versión en la misma columna y comparte el esquema de la
  10.** Si una v11 no tiene `parametros2.versiondb`, el agente la reporta como "no
  soportada", con las tres causas posibles: base equivocada, falta de permiso o versión
  desconocida. No la lee a ciegas.
- ⚠️ **Nunca visto — `parametros2` con más de una fila.** Si todas dicen la misma versión,
  se usa ésa. Si difieren, el agente no elige: error "versiones distintas".
- ⚠️ **Con `db_datareader`, `sys.tables` sólo lista lo que el usuario puede leer.** Una
  tabla "faltante" puede ser falta de permiso. Esto no se ha probado: la validación se hizo
  con un login sysadmin (ver §11).

**Diferencias conocidas entre versiones:** ninguna todavía. Sólo se ha visto la 10.

**Sonda de salud por ciclo (F1-025).** Con la versión ya detectada, el agente corre en cada
ciclo `sr_sondeo.sql`: `SELECT TOP (1) 1 FROM dbo.parametros2 WITH (NOLOCK)`. Es una fila de
una tabla de configuración que el POS casi no escribe, no toca las tablas de operación.
- ✅ **VALIDADO** 2026-09-21 contra la SR 10 local (`.\NATIONALSOFT`, `softrestaurant10`),
  con login sysadmin: responde en ~1 ms.
- ⚠️ **Una sonda que responde ≠ una lectura de ventas.** Dice que la base contesta, no que
  los cheques estén llegando. Mientras F1-022 no exista, la "última lectura" del panel sale
  de aquí.
- ⚠️ **SUPUESTO:** que un usuario `db_datareader` pueda leer `parametros2`. No probado (igual
  que el resto de §1).

---

## 2. Cuentas cerradas (cheques)

> Alimenta a `F1-022`. Necesitamos: folio, fecha de apertura y cierre, mesa, mesero,
> comensales, subtotal, impuestos, total, descuentos, propina.

**Tablas:** _(pendiente — tipo `cheques`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Cómo se marca una cancelación:** _(pendiente — clave para no contar ventas que no fueron)_

**Cómo se ve una reapertura:** _(pendiente — clave para la ventana de relectura de 2 h)_

**Query incremental:**

```sql
-- pendiente: F1-022
```

**Lo que el modelo de Postgres (F1-030, tabla `cheques`) ya supone de esta sección.** Nada
de esto se ha visto en una instalación real; cada punto es una
`DECISION PROVISIONAL (nocturno)` en `api/prisma/schema.prisma` y se valida en F1-090.

- ⚠️ **SUPUESTO — hay un identificador estable del cheque dentro de SR, y no se repite
  dentro de una misma sucursal.** Es `cheques.folio_sr` y, junto con `sucursal_id`, es la
  llave única de la ingesta (F1-031 hace upsert por ahí). Se guarda como **texto** para
  no suponer si en SR es entero o alfanumérico y para no perder ceros a la izquierda.
  Aparte se guarda `folio`, el folio que ve el cliente en el ticket, también como texto.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — ¿SR reinicia folios?** Si esta versión de SR
  reinicia la numeración (por año, por turno, por reinstalación o por cambio de serie), el
  mismo `folio_sr` va a aparecer en dos cheques distintos de la misma sucursal. El upsert
  de F1-031 **sobrescribiría en silencio el cheque viejo con el nuevo**: se pierde una venta
  y no queda ningún error. Antes de F1-022 hay que confirmar contra una instalación real
  qué columna de SR es realmente única, y si no la hay, armar la llave compuesta con la
  fecha o con la serie.
  **Desde F1-024 depende de esto también la cola del agente:** `ColaLocal` (columna
  `clave` de `cola.db`) deja un solo pendiente por `folioSr`, así que un folio repetido
  descartaría en la cola un cheque *distinto* aún no enviado, antes de llegar al API. Si
  la llave cambia, se cambian juntos el upsert del API y la `clave` de la cola.
- ⚠️ **SUPUESTO — un cheque puede no tener fecha de cierre** (por ejemplo, uno cancelado).
  `cerrado_at` admite nulo. Los agregados de F1-032 filtran por `cerrado_at`, así que un
  nulo no entra en ningún rango.
- ⚠️ **SUPUESTO — SR puede no reportar comensales.** `comensales` admite nulo y no tiene
  default: un 0 inventado contaminaría "comensales totales" y el promedio por comensal.
- ⚠️ **SUPUESTO — los importes pueden venir negativos** (devoluciones o ajustes). No hay
  CHECK de signo en ningún importe: uno que rechazara datos reales tumbaría la ingesta de
  ese cheque.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — cortesías.** F1-032 pide "descuentos y cortesías",
  pero el modelo sólo tiene `descuentos`: no hay forma de distinguir una cortesía. Falta
  saber cómo las marca SR (¿un descuento del 100 %?, ¿una forma de pago?, ¿un flag en la
  partida?) antes de decidir la columna.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — cancelaciones parciales.** Sólo existe
  `cheques.cancelado`, que vale para el cheque completo. Si SR cancela partidas sueltas
  dentro de un cheque que sigue vivo, hoy no hay dónde guardarlo. Hay que saber cómo lo
  representa SR.

**Lo que los agregados (F1-032, `api/src/ventas/agregados-ventas.service.ts`) suponen de
esta sección.** Todo esto se valida en F1-090 contra los reportes nativos de SR del mismo día,
**peso a peso**:

- ⚠️ **SUPUESTO — "venta" = suma de `cheques.total` tal como lo reporta SR, y ese total NO
  incluye la propina.** La propina se reporta aparte (`resumen.propina`). Si el reporte nativo
  de SR incluye la propina en la venta, o aplica los descuentos de otra forma, el panel no va a
  cuadrar: hay que ajustar la definición en `resumen`, no el dato.
- ⚠️ **SUPUESTO — el día de una venta es el día LOCAL de la sucursal en que se CERRÓ la cuenta**
  (`cerrado_at` en `Sucursal.zona_horaria`), y la hora de la serie por hora también. Una cuenta
  abierta a las 23:30 y cerrada a las 00:20 cuenta para el día siguiente. Falta confirmar que
  SR corta igual (algunos POS cortan por turno o por "fecha de negocio").
- ⚠️ **SUPUESTO — los cancelados sin `cerrado_at` se ubican por su `abierto_at`** para contarlos
  (`resumen.cancelados`). Nunca entran en la venta.
- ❓ **Cortesías: siguen sin representarse.** `resumen.cortesias` sale siempre `null`
  (`DECISION PROVISIONAL (nocturno)` en el servicio) hasta que se resuelva la decisión abierta
  de arriba.

**Lo que la lista de tickets (F1-033, `GET /ventas/tickets`) supone de esta sección.** No
descubre nada nuevo de SR; hereda los supuestos de arriba y fija este criterio:

- Un **ticket del rango** es una cuenta NO cancelada cerrada en el rango (por `cerrado_at`
  local, igual que la venta) **o** una cancelada del rango (por `COALESCE(cerrado_at,
  abierto_at)`, igual que `resumen.cancelados`). Las abiertas no aparecen. Es la CTE `tickets`
  del helper de scope (`api/src/scope/consulta-ventas.ts`).
- **Los cancelados se listan con `cancelado: true` y NO suman a nada.** F1-042 no debe sumar
  su total en el pie de la tabla ni en el export CSV. Si al validar en F1-090 resulta que SR
  "cancela" de otra forma (partidas sueltas, cheque en negativo), el criterio se ajusta aquí.
- Orden: por ese mismo momento, del más reciente al más viejo. La búsqueda por folio es por
  prefijo literal del `folio` (el que ve el cliente, §2), **dentro del rango de fechas**.
  ⚠️ **SUPUESTO:** que el folio impreso es texto buscable por prefijo; si SR lo reinicia por
  día o por serie, la búsqueda puede traer varios tickets con el mismo folio (se distinguen
  por sucursal y fecha).
- Los pagos de cada ticket traen la forma derivada AL LEER con el catálogo de §4, igual que
  el desglose; los pagos no traen orden propio del POS (el contrato de ingesta no lo manda) y
  salen en un orden estable pero arbitrario.

**El área de la cuenta (F2-233, `cheques.area_origen_sr_id`).**

- ⚠️ **SUPUESTO — NO VALIDADO: el cheque de SR referencia el área donde se atendió por el MISMO
  id estable que usa el catálogo de áreas de esa sucursal** (el `origenSrId` que manda el agente
  en `POST /ingesta/catalogos`). No se ha visto una instalación real: puede que el cheque guarde
  el nombre del área, la mesa (y la mesa el área), otro id o nada. Es `DECISION PROVISIONAL
  (nocturno)` en `schema.prisma` (modelo `Cheque`) y en `DatosChequeDto.areaOrigenSrId`. Se
  confirma en F1-090/F2-192: si el cheque no trae ese id, toda la venta sale "sin clasificar" o
  "sin canal" en Áreas y canales.
- Nulo = la cuenta no trae área ("sin clasificar"). Sin FK al espejo. Máximo 64, CHECK "no vacío"
  en base. **Hoy ningún agente lo manda** (no hay lector de cheques, F1-022).

**El cliente de la cuenta (F2-232, `cheques.cliente_origen_sr_id`).**

- ⚠️ **SUPUESTO — NO VALIDADO: el cheque de SR referencia al cliente por el MISMO id estable que
  usa el catálogo de clientes de esa sucursal** (el `origenSrId` que manda el agente en
  `POST /ingesta/catalogos`). No se ha visto una instalación real: puede que el cheque guarde otra
  cosa (la clave visible, el nombre, un id de otra tabla) o nada. Es `DECISION PROVISIONAL
  (nocturno)` en `schema.prisma` (modelo `Cheque`) y en `DatosChequeDto.clienteOrigenSrId`. Es lo
  primero que hay que confirmar en F1-090/F2-192: si el cheque no trae ese id, toda la vista
  Clientes sale "sin ficha".
- Nulo = la cuenta no trae cliente. Sin FK al espejo: cheques y catálogos llegan en cualquier
  orden. Máximo 64 (el largo de `origen_sr_id`), CHECK "no vacío" en base.
- Visitas de un cliente = sus cuentas NO canceladas cerradas en el periodo (las mismas que
  `/ventas/tickets?clienteId=…&canceladas=excluir`); varias cuentas el mismo día son varias
  visitas. Sus canceladas van aparte y no suman.
- **Corte por recepción (F2-203, `corte` de `GET /ventas/tickets`).** Para que el export CSV no
  aborte en hora pico, todas sus páginas se piden con un mismo instante y sólo entran los
  cheques que ya habían llegado a NUESTRA base en él (`cheques.created_at`, expuesto como
  `recibido_at` en las CTEs; no es un dato de SR y el upsert de la ingesta no lo reescribe).
  ⚠️ **SUPUESTO NO VALIDADO (nocturno): el agente sólo manda cheques ya cerrados o cancelados.**
  El modelo y la ingesta aceptan un no cancelado con `cerrado_at` nulo, y todavía no hay un
  lector de cheques en el agente que diga si SR expone la cuenta al abrirla. Si la llegara a
  mandar abierta, la cuenta llega ANTES del corte y entra al rango al cerrarse: el corte no la
  congela, el conteo se mueve a media descarga y el export aborta (nunca falta en silencio;
  lo fija `lectura.e2e.spec.ts`). En ese caso el corte sólo estabiliza las cuentas que llegan
  nuevas, y habría que cortar también por `updated_at` o por el instante de cierre. Validar en
  F1-090 / F2-240 junto con el lector de cheques.

**Lo que los reportes (F1-043, `GET /ventas/por-dia` y `GET /ventas/comparativo-sucursales`)
suponen de esta sección.** No descubren nada nuevo de SR; heredan el supuesto del día de cierre
de arriba y lo aplican así:

- La serie **por día** pone cada cuenta en el día LOCAL de cierre de **su** sucursal (columna
  `dia_local` de la CTE `ventas`, calculada en el helper de scope). **Con varias sucursales en
  zonas distintas, "el 1 de septiembre" junta el 1 de septiembre de CDMX y el de Tijuana**, que
  no son el mismo intervalo de tiempo. Es lo mismo que ya hace `resumen` con un rango, y es lo
  que hace que Σ por día = `resumen.venta` exacto. Si en F1-090 resulta que SR corta por "fecha
  de negocio" o por turno, cambia aquí y en `resumen` a la vez, no en uno solo.
- El **comparativo** es una fila por sucursal en alcance, con la misma definición de venta
  (Σ `total`, sin cancelados); Σ comparativo = `resumen.venta` exacto.

**Lo que Análisis (F2-221, `api/src/ventas/analisis.service.ts`) supone de esta sección.** No
descubre nada de SR: son supuestos del modelo, sin validar, y se revisan en F1-090 / F2-240.

- ⚠️ **SUPUESTO — `cheques.mesa` nula = cuenta sin mesa asignada.** Se muestra como "Sin mesa" y
  no entra a la rotación. Que en SR sean mostrador o domicilio es una invención del **seed**, no
  un hallazgo: no se dice en pantalla.
- ⚠️ **SUPUESTO — la mesa es (sucursal, texto de `cheques.mesa`).** La "5" de una sucursal no es
  la "5" de otra. Si SR renombra mesas, una misma mesa física sale como dos filas.
- ⚠️ **SUPUESTO — duración de la cuenta = `cerrado_at − abierto_at`.** Si SR guarda la apertura
  con otra semántica (hora de la primera comanda, reapertura), la duración cambia. Una duración
  negativa (cierre antes que la apertura) no entra al promedio y se cuenta aparte
  (`duracionesInvalidas`); no se corrige.
- ⚠️ **SUPUESTO — día de la semana y hora del mapa de calor = los del CIERRE** en la zona de SU
  sucursal (`dia_semana_local`, `hora_local` de la CTE `ventas`), igual que la venta por día.
- ⚠️ **SUPUESTO (`DECISION PROVISIONAL (nocturno)` en el servicio) — el monto de un cancelado es su
  `cheques.total` tal como llega.** Se supone que SR conserva el importe original de la cuenta
  cancelada y no lo pone en 0 ni en negativo. Si lo pone en 0, "monto cancelado" por mesero saldrá
  en $0.00 con cuentas > 0.
- Los cancelados se atribuyen al `mesero` que trae el cheque cancelado, ubicado por
  `COALESCE(cerrado_at, abierto_at)`, igual que `resumen.cancelados`.
- ⚠️ **SUPUESTO — texto vacío no es "sin dato".** Una `mesa` en `''` sale como una mesa sin
  nombre y cuenta en la rotación; un `mesero` en `''` sale separado de "Sin mesero". No se
  normaliza: si SR manda vacíos en vez de nulos, se decide en F2-231 / F2-222 (o en la ingesta).
  F2-222 **no** lo decidió: sus filtros de mesero y mesa son de igualdad exacta y un `''` sólo se
  encuentra pidiendo `''`, cosa que el filtro no permite (mínimo 1 carácter).

**Lo que los filtros y el detalle de Tickets (F2-222, `api/src/ventas/tickets.service.ts`,
`web/src/paginas/tickets/Tabla.tsx`) suponen de esta sección.** Todo es supuesto no validado:

- ⚠️ **SUPUESTO — el panel no recibe la HORA de una cancelación.** El contrato de ingesta sólo trae
  `cancelado` (sí/no) y las fechas de apertura y cierre del cheque; no hay un "cancelado a las…".
  El detalle de un cancelado dice "El panel no recibe la hora de la cancelación" y da el instante
  por el que la cuenta está ubicada (cierre o, sin cierre, apertura). No se usa `updated_at`: es
  cuándo nuestra base reescribió la fila, no cuándo se canceló en el POS. `DECISION PROVISIONAL
  (nocturno)` en `Tabla.tsx`. Si SR guarda la hora de cancelación (¿en `cheques`?, ¿en una
  bitácora?), el contrato de ingesta la tiene que traer y el detalle la muestra. **Decisión
  abierta para Ricardo** (log de F2-222).
- ⚠️ **SUPUESTO — la cancelación es de la cuenta completa** (ya estaba arriba, "cancelaciones
  parciales"). El detalle lo dice así: "Se canceló la cuenta entera: N partidas por $X".
- ⚠️ **SUPUESTO — mesero y mesa se comparan como TEXTO EXACTO** (`mesero = $1`, sensible a
  mayúsculas y a espacios internos). Si SR guarda el nombre con variantes ("ANA" / "Ana"), el
  filtro las separa. Las cuentas sin mesero o sin mesa (nulo) no se pueden pedir con el filtro.
  **Espacios alrededor:** el web recorta (`trim`) lo que se escribe o llega en la URL, pero ni la
  ingesta ni el API recortan lo guardado. Si SR manda el nombre relleno de espacios (un `CHAR` de
  SQL Server, p. ej. `"Ana   "`), sale en el select de meseros y filtrarlo da 0 tickets. No
  validado; si pasa, se normaliza en la ingesta, no en el filtro.
- ⚠️ **Ordenar por tiempo de mesa con duraciones negativas** (cierre anterior a la apertura, ver
  arriba): el orden usa `cerrado_at − abierto_at` tal cual, así que esas cuentas quedan como las
  más cortas en ascendente, mientras la tabla las muestra como "Sin dato". Se dejó así.
- ⚠️ **SUPUESTO — la forma de pago de un filtro es la del CATÁLOGO de la empresa** (texto sin
  catálogo → `otro`), el mismo criterio que `pagos[].forma` del detalle, **no** la columna
  `cheque_pagos.forma` guardada en la ingesta. Si las dos difieren, manda el catálogo.
- ⚠️ **SUPUESTO — el filtro de producto busca en el NOMBRE de la partida** (`strpos(lower(…))`):
  contiene, sin mayúsculas, **sin ignorar acentos** ("jamon" no encuentra "Jamón"). Si SR guarda
  nombres con y sin acento para el mismo producto, el filtro los separa; `unaccent` necesitaría
  una extensión de Postgres y quedó fuera.
- ⚠️ **SUPUESTO — `folio` ordena por largo y luego por texto** (`length(folio), folio COLLATE
  ucs_basic`): "999" antes de "1000" si los folios son numéricos. Con folios alfanuméricos de
  distinto largo el orden es raro pero estable. `DECISION PROVISIONAL (nocturno)` en el servicio.


---

## 3. Partidas de cuentas cerradas

> Alimenta a `F1-022`. Producto, cantidad, precio, modificadores.

**Tablas:** _(pendiente — tipo `cheqdet`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Cómo se representan los modificadores:** _(pendiente — incluidos los de $0.00, que sí se
muestran en el detalle)_

**Lo que el modelo de Postgres (F1-030, tabla `cheque_partidas`) ya supone de esta sección:**

- ⚠️ **SUPUESTO — las cantidades pueden ser fraccionarias** (kg, litros). Por eso
  `cantidad` es `NUMERIC(12,3)`, no un entero. No es dinero.
- ⚠️ **SUPUESTO — SR guarda importes con más de 2 decimales** (el tipo `money` de SQL Server
  lleva 4). Nuestro `NUMERIC(12,2)` **redondea sin avisar**: `0.125` se guarda como `0.13`,
  y hay un test que deja fijo ese comportamiento (`api/prisma/ventas.spec.ts`). Si cada
  partida se redondea por separado, la suma de las partidas puede no dar el total del
  cheque. Por eso **el total del cheque se guarda tal como lo reporta SR y nunca se
  recalcula sumando partidas** (regla para F1-031 y F1-032). Hay que confirmar la precisión
  real en F1-090.
- ⚠️ **SUPUESTO — el orden de las partidas importa** para mostrar el ticket. Se guarda
  `orden` (0..n, la posición en que llegan en el lote), único dentro de cada cheque.
- Los modificadores se guardan como una lista JSON (`jsonb`, `[]` por defecto) con la forma
  que les dé la ingesta: `[{ nombre, precio }]`, con `precio` en texto a 2 decimales
  (F1-031, supuesto, ver §13). Su forma en SR sigue pendiente.
- ❓ **DECISIÓN ABIERTA para Ricardo (la resuelve F1-022/F1-090): modificadores anidados en
  cuentas CERRADAS.** El Detalle de consumo de mesas (F1-051) ya acepta modificadores de
  modificadores en el snapshot (§5), pero el contrato de cheques cerrados sigue **plano**:
  `ModificadorDto` es `{ nombre, precio }`, el `jsonb` de `cheque_partidas` no tiene
  hijos y la vista Tickets (F1-042) pinta un solo nivel. Si SR resulta tener modificadores
  anidados, cambian el contrato de ingesta, el `jsonb` y Tickets. No está resuelto: sólo
  se dejó de asumir en el panel de mesas.
- ⚠️ **SUPUESTO — el panel no recibe descuentos ni cortesías POR PARTIDA** (F2-222). El contrato
  de ingesta trae `descuentos` sólo a nivel de cheque, y ninguna marca de cortesía. La ficha de
  F2-222 pedía "descuentos y cortesías línea por línea"; el detalle muestra "Descuento de la
  cuenta" y una nota que dice que el panel no recibe el desglose por partida. Si SR guarda el
  descuento por partida (o la cortesía como descuento del 100 % de una partida), el contrato de
  ingesta y `cheque_partidas` lo tienen que traer. **Decisión abierta para Ricardo.**

---

## 4. Pagos

> Alimenta a `F1-022` y al desglose por forma de pago de `F1-032`.

**Tablas:** _(pendiente — tipo `chequespagos`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Catálogo de formas de pago tal como las nombra esta instalación** (el texto crudo que
guardamos en `forma_raw` y su mapeo a nuestro ENUM `efectivo/tarjeta/transferencia/otro`):

| `forma_raw` en SR | Nuestro ENUM | Estado |
|---|---|---|
| | | |

**Dónde vive el mapeo (F1-032):** en la tabla `formas_pago_catalogo(empresa_id, forma_raw,
forma)`, y se aplica **al leer**: el desglose por forma de pago hace `LEFT JOIN` del pago con el
catálogo de su empresa y lo que no está mapeado cuenta como `otro` y además se lista aparte
(`sinCatalogo`), para que se vea qué texto de SR falta mapear. Corregir el catálogo reclasifica
todo el histórico sin reingerir. La columna `cheque_pagos.forma` que guarda la ingesta **no** la
usa ningún agregado.

- `DECISION PROVISIONAL (nocturno)` — **un catálogo por EMPRESA, no por sucursal**, y **match
  exacto** del texto (sin normalizar mayúsculas, acentos ni espacios): normalizar es adivinar.
  Si resulta que dos sucursales de la misma empresa nombran distinto la misma forma, basta con
  dar de alta los dos textos. Si nombran IGUAL formas distintas, hace falta catálogo por sucursal.
- Los textos del seed de desarrollo (`EFECTIVO`, `TARJETA DE CREDITO`, `VALES DESPENSA`, ...) son
  **sintéticos**, no de SR. No los copies a la tabla de arriba como si fueran reales.
- El catálogo todavía no tiene CRUD. F1-060 (administración) no lo incluyó porque su texto en
  el backlog no lo pide: queda como decisión abierta para Ricardo (ver `docs/nocturno-log.md`,
  entrada de F1-060). Mientras tanto se da de alta directo en la base.

**Cuentas con pago mixto:** _(pendiente — cómo se reparten los montos)_

**Lo que el modelo de Postgres (F1-030, tabla `cheque_pagos`) ya supone de esta sección:**
un cheque puede tener varios pagos, uno por fila. `forma_raw` guarda siempre el texto crudo
de SR, y `forma` es el ENUM `forma_pago` (`efectivo/tarjeta/transferencia/otro`) que se
deriva de ese texto con el catálogo de F1-032. ⚠️ **SUPUESTO:** que SR nombra la forma de
pago con un texto que se puede mapear. Mientras no haya catálogo, la ingesta (F1-031) guarda
`forma = otro` en todos los pagos (DECISION PROVISIONAL, ver §13).

---

## 5. Cuentas abiertas (mesas en vivo)

> Alimenta a `F1-023` y al monitor de mesas.

**Tablas:** _(pendiente — tipo `tempcheques` / `tempcheqdet`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Cómo se sabe si la cuenta ya se imprimió:** _(pendiente — KPI "cuentas sin imprimir")_

**Qué pasa con la fila al cerrar la cuenta:** _(pendiente — ¿se borra, se marca?)_

**Lo que la ingesta (F1-031) ya supone de esta sección:** el snapshot llega completo en cada
ciclo como `{ capturadoAt, mesas: object[] }` y se guarda sin validar la forma de cada mesa
(⚠️ SUPUESTO, ver §13). El API conserva el último por sucursal más 24 h de histórico.

**Lo que `GET /mesas/abiertas` (F1-033) supone:** devuelve el ÚLTIMO snapshot de cada
sucursal con `mesas` **tal cual** las mandó el agente (la forma de cada mesa sigue siendo
⚠️ SUPUESTO; la fijan F1-023/F1-050) y dos edades: `edadSegundos` desde `capturadoAt` (reloj
de la PC del restaurante, recortada a ≥ 0 porque un reloj adelantado daría negativa) y
`edadRecepcionSegundos` desde `recibidoAt` (reloj del servidor). ⚠️ **SUPUESTO — el reloj de
la PC del POS puede estar desfasado**: para decidir si una sucursal está "desconectada"
(F1-050) conviene la edad de recepción. El intervalo de lectura del agente no lo conoce el
API: el umbral de "3 intervalos" lo fija F1-050/F1-020.

**Lo que el panel (F1-041, tarjeta "Venta en vivo") supone:** ⚠️ **SUPUESTO no validado,
lo fija F1-023/F1-050** — cada mesa del snapshot trae un campo `total` con el importe de la
cuenta abierta, como texto decimal (`"350.50"`) o número. La tarjeta suma esos `total` en
centavos exactos; si **una sola** mesa no trae un `total` legible, muestra "Sin dato" en vez
de una suma parcial. Falta confirmar contra `tempcheques` (o la tabla que sea) que el total
de una cuenta abierta **ya incluye** descuentos e impuestos como el `total` de un cheque
cerrado, y si una mesa puede traer varias cuentas. El seed de F1-032 no genera snapshots:
esto sólo se probó con respuestas falsas. Código: `totalDe`/`importeDe` en
`web/src/paginas/mesas/mesa.ts` (se movieron ahí desde `inicio/ventaEnVivo.ts` en F1-094);
la tarjeta (`inicio/ventaEnVivo.ts`) calcula con `armarMonitor` del Monitor. La edad que
muestra la tarjeta es `edadRecepcionSegundos` (reloj del servidor).

**Lo que el Monitor de mesas (F1-050) supone.** Todo lo de este bloque es ⚠️ **SUPUESTO no
validado**: nadie ha visto todavía `tempcheques` ni la tabla que sea. Lo valida F1-023 contra
una instalación real (F1-090). Código: `web/src/paginas/mesas/` (`mesa.ts`, `reglas.ts`).

- **Forma provisional de cada mesa del snapshot** (`DECISION PROVISIONAL (nocturno)` en
  `mesa.ts`). El agente (F1-023) tendría que mandarla así; el API sigue sin validarla (§13):
  ```
  { mesa: "12", mesero: "…", folio: "…", abiertoAt: "2026-09-20T19:00:00Z",
    total: "350.50", comensales: 4, impreso: false,
    partidas: [{ producto, categoria, cantidad: "0.750", precioUnit, total,
                 modificadores: [{ nombre, precio }] }] }
  ```
  El panel lee campo por campo, a la defensiva. Lo que falta o no se entiende sale como
  "Sin dato", nunca $0.00 ni 0 min. Un `abiertoAt` sin zona se rechaza, por la misma regla
  de §13.
- ⚠️ **`total`:** la misma regla y la misma duda que "Venta en vivo" (arriba): falta saber si
  ya incluye descuentos e impuestos. Si UNA mesa no trae un total legible, el KPI "$ en
  curso" dice "Sin dato" en vez de dar una suma parcial.
- ⚠️ **`impreso` (KPI "Cuentas sin imprimir"):** se supone un booleano que dice si la cuenta
  ya se imprimió. Falta saber de qué columna de SR sale (ver "Cómo se sabe si la cuenta ya
  se imprimió", arriba). Si alguna mesa no lo trae, el KPI dice "Sin dato" en vez de dar un
  conteo parcial.
- ⚠️ **`abiertoAt` va con el reloj de la PC del POS**, igual que `capturadoAt`. Los minutos
  abierta se calculan como `(capturadoAt − abiertoAt)`, que resta dos horas del mismo reloj
  y por eso no le afecta el desfase, **más** la edad de recepción (reloj del servidor)
  **más** lo que lleva la respuesta en el navegador. Los minutos se truncan a enteros
  antes del semáforo: < 40 ok, 40–60 alerta, > 60 rojo. Una apertura posterior a la
  captura es un dato inconsistente y sale como "Sin dato".
- ⚠️ **`comensales` y `folio`** se muestran en el modal de detalle (F1-051). El `folio` es
  además lo que identifica la cuenta entre un poll y otro (ver "Detalle de consumo", abajo).
- ⚠️ **Una fila = una cuenta.** Si en SR una mesa puede tener varias cuentas abiertas, cada
  una sale como una tarjeta distinta con el mismo número de mesa.
- `DECISION PROVISIONAL (nocturno)` — **la sucursal está "desconectada" cuando la edad de
  recepción pasa de 90 s** (3 intervalos de 30 s, el `intervaloSegundos` por defecto de
  F1-020; constante `INTERVALO_AGENTE_S` en `reglas.ts`). Se usa `edadRecepcionSegundos`
  (reloj del servidor) más el tiempo que lleva la respuesta en el navegador, **no**
  `edadSegundos` (reloj del POS). Así, si el API deja de contestar, el banner también
  aparece. Si el intervalo termina siendo configurable por sucursal, F1-020/F1-025 tienen
  que mandarlo (por ejemplo en el heartbeat) y esta constante pasa a ser un dato por
  sucursal.
  - **El estado de agentes (F1-061) usa el mismo supuesto** (`UMBRAL_DESCONEXION_S`,
    importado de `reglas.ts`), pero medido sobre el **contacto** del agente (tabla
    `agente_contacto`: el último lote aceptado por la ingesta, reloj del servidor), no
    sobre la lectura del POS. Un agente vivo que no puede leer SR sale "Conectado" con su
    último error y la lectura vieja a la vista. Esto no es un hallazgo de SR: la tarea no
    leyó SR. Lo que sí depende del agente real (F1-020/F1-025): que mande un lote por
    ciclo aunque no tenga cheques, para que el contacto avance.
- **Panel y Monitor dan la misma cifra (F1-094).** La tarjeta "Venta en vivo" de Inicio
  se calcula con el mismo `armarMonitor` que el KPI "En curso" del Monitor: **sólo suman las
  sucursales conectadas** (umbral de 90 s de arriba, con la edad que sigue creciendo en el
  navegador). Las desconectadas se nombran ("Desconectadas, sin contar") y, si ninguna está
  conectada, no hay cifra (tampoco $0.00). Inicio consulta las mesas cada 20 s, como el
  Monitor, para que un snapshot sano no cruce el umbral entre dos consultas.
  - **"Última lectura" (KPI del Monitor)** = la lectura **más vieja de las sucursales
    conectadas**, es decir, la edad del dato más viejo que entra en las cifras. Las
    desconectadas no cuentan (tienen su banner). Sin conectadas es `null`. El "dato de
    hace…" de la tarjeta de Inicio es ese mismo valor. Regla en `Kpis.ultimaLectura`
    (`reglas.ts`). No es un hallazgo de SR: son reglas de presentación sobre el supuesto
    del umbral.
- **Lo que el Detalle de consumo (F1-051, modal) supone.** Todo es ⚠️ **SUPUESTO no
  validado**, igual que lo de arriba. Código: `web/src/paginas/mesas/mesa.ts` (lectura,
  `DECISION PROVISIONAL (nocturno)`), `Detalle.tsx` (modal), `seleccion.ts`.
  - **Modificadores anidados con la misma llave:** `modificadores: [{ nombre, precio,
    modificadores?: [...] }]`. Nadie ha visto cómo guarda SR un modificador de modificador
    (grupo, cantidad, tabla aparte…): esto es la forma que el agente (F1-023) tendría que
    mandar, no lo que SR tiene. Si SR trae más estructura, se amplía aquí y en `mesa.ts`.
  - **Tope de 4 niveles** (`PROFUNDIDAD_MAX_MODIFICADORES`). Lo de más abajo no se lee y
    el modal dice "Más modificadores no mostrados". Si F1-023 ve más niveles en SR, se sube
    la constante y esta nota.
  - `modificadores` **ausente = sin modificadores** (misma regla que el contrato de
    ingesta, §13); presente pero no lista = "Sin dato". Un modificador que llega como texto
    (`"Sin cebolla"`) es su nombre, sin precio ("Sin dato"). Los de **$0.00 se muestran**.
  - **Importes del snapshot con 2 decimales como máximo** (requisito para F1-023). El panel
    usa la misma regla que el `total` de la mesa: texto de hasta 2 decimales o número
    finito. Un `"12.5000"` (el `money` de SR con 4 decimales, §3) sale "Sin dato". **Es
    distinto del contrato de cheques cerrados**, que acepta 4 decimales y redondea en el
    API (§13): el snapshot no pasa por esa normalización, así que el agente debe redondear
    antes de mandarlo.
  - **Ni el total de la partida ni el de la cuenta se calculan.** El total de la partida
    se muestra como llega; si falta, "Sin dato", nunca `cantidad × precioUnit`. El total de
    la cuenta es el `total` de la mesa, nunca la suma de sus partidas (§3).
  - **Identidad de la cuenta entre polls** (el modal sigue vivo con cada lectura): por
    sucursal + `folio`. Un folio repetido en el mismo snapshot se trata como ambiguo y el
    modal dice "ya no aparece". Sin folio, sólo se sigue si coinciden posición, número de
    mesa y `abiertoAt`; sin folio **ni** `abiertoAt` no hay forma de confirmarla y el modal
    dice "ya no aparece" en el siguiente poll. Si F1-023 descubre que las cuentas abiertas
    de SR no traen folio, hay que buscar otra llave estable.
- **Lo que el Monitor de mesas (F2-223, paridad fina) supone.** ⚠️ **SUPUESTO no validado.**
  - `DECISION PROVISIONAL (nocturno)` — **`partidas[].comandaImpresa` (bool, opcional)**: si
    la comanda de ESA partida ya salió impresa (cocina/barra). Es distinto del `impreso` de
    la cuenta (la precuenta). **Ni el nombre ni la semántica salen de SR**: nadie ha visto
    cómo marca SR una comanda impresa (¿una columna de `tempcheqdet`?, ¿otra tabla?). Es la
    forma que el agente (F1-023 / F2-240) **tendría que producir**. Pendiente para esas
    tareas: encontrar la columna y mandarlo por partida.
  - Lectura defensiva (`web/src/paginas/mesas/mesa.ts`): sólo cuenta si es booleano; ausente
    o cualquier otra cosa = `null` = "no se sabe". El detalle marca "Pendiente de imprimir"
    las `false` y las cuenta; si **ninguna** partida trae el dato, dice "El agente no reporta
    qué partidas faltan por imprimir." (nunca supone "todo impreso").
  - El contrato de `GET /mesas/abiertas` (DTO `mesas.dto.ts` y `openapi.json`) lo describe
    con el mismo marcador de supuesto. El API sigue sin validar la forma.
  - Los minutos del Monitor salen de una "apertura en el reloj del navegador"
    (`respuestaAt − edadRecepcion − (capturadoAt − abiertoAt)`), estabilizada entre polls por
    sucursal + `folio` con 2 s de tolerancia. No es un hallazgo de SR: es presentación. Otra
    razón más para que F1-023 confirme que el folio de una cuenta abierta es estable entre
    lecturas (sin folio, la tarjeta se vuelve a pintar en cada poll, sin más daño).
  - La llave de React de cada tarjeta es `sucursal:folio:posición en el snapshot`. Si el
    agente reordena las cuentas o intercala una nueva, las tarjetas se remontan aunque el
    folio sea el mismo: costo de repintado, no error de datos. Si F1-023 ve que SR no
    devuelve las cuentas abiertas en orden estable, conviene quitar la posición de la llave.
- El seed de desarrollo `api/prisma/seed-mesas.ts` (`npm run seed:mesas`) genera snapshots
  **sintéticos** con esta forma: la sucursal Centro en vivo y la Norte desconectada hace 2 h.
  Marca los suyos con `payload.origen = 'seed'` y sólo borra ésos. Desde F2-223, Centro trae
  **60 mesas abiertas**: 8 escritas a mano y 52 generadas sin azar con el catálogo maestro
  (F2-201), más `comandaImpresa` por partida. Las 52 y el `comandaImpresa` son **invención del
  seed**, igual que advierte el recuadro de §6–§10: no son evidencia de SR.

---

- **Lo que el centro de alertas (F2-224) supone de esta sección.** ⚠️ **SUPUESTO no
  validado; no es un hallazgo** (la tarea no leyó SR). El API evalúa sus alertas sobre el
  ÚLTIMO snapshot de cada sucursal, con la MISMA forma provisional de arriba, leída en
  `api/src/alertas/observar.ts` (espejo de `leerMesa`):
  - Usa sólo `folio`, `mesa`, `abiertoAt` (ISO con zona) e `impreso`. El **`folio` es la
    identidad de la alerta** entre lecturas: una cuenta sin folio, o con un folio repetido
    dentro del mismo snapshot, se ve en el Monitor pero **no abre alerta**. Si en SR el folio
    de una cuenta abierta cambia (o se reusa) mientras sigue abierta, la alerta se cerraría y
    abriría otra: lo tiene que confirmar F1-023.
  - Minutos abierta: la misma regla del Monitor (`capturadoAt − abiertoAt` + edad de
    recepción), truncados. "Mesa abierta" alerta con `> umbral` (60 por defecto, el borde
    del semáforo rojo); "cuenta sin imprimir" con `impreso === false` y `> umbral` (30).
    `impreso` ausente no alerta.
  - Sólo con un snapshot recibido hace ≤ 90 s (`SNAPSHOT_VIVO_S`, espejo de
    `UMBRAL_DESCONEXION_S`; un test del API lee `web/.../mesas/reglas.ts` y falla si
    divergen). Con uno más viejo esas alertas ni abren ni cierran; al volver la lectura, las
    que ya no están se cierran con la hora de ESA evaluación, no con la hora real del cierre
    en el POS (que no conocemos).
  - "Sucursal sin reportar" mide lo más reciente entre `agente_contacto` y el último
    snapshot recibido (reloj del servidor). Depende del mismo supuesto de F1-061: que el
    agente mande un lote por ciclo aunque no haya cheques.

> ⚠️ **Sobre §6–§10 y el seed maestro (F2-201).** `api/prisma/seed-maestro/` genera
> productos, grupos, precios por sucursal, meseros, clientes, áreas y canales, insumos,
> almacenes, pólizas, existencias, recetas, compras y gastos **sintéticos**. Esas formas
> son **invención del seed, NO evidencia del esquema de SoftRestaurant**: nadie las sacó
> de una instalación. §6–§10 siguen **sin validar** y así se quedan hasta que alguien mire
> una base real. Cuando se mapeen, lo que diga SR manda y el seed se adapta, nunca al revés.
> En particular: el reparto área → canal (comedor/mostrador/domicilio), los ~3 % de cheques
> sin área, los dos almacenes por sucursal y las recetas por unidad vendida son decisiones
> del seed, no hallazgos.

## 6. Productos y catálogo

> Alimenta a `F1-032` (top productos) y a `F2-145`.

**Tablas:** _(pendiente)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Productos vendidos que no están en catálogo:** no se ha visto en SR si pasa ni cómo se ven
(artículos abiertos, "precio libre", productos borrados). Lo que el panel supone hoy (F2-145,
`GET /catalogos/sin-catalogo`, `api/src/catalogos/menu.ts#vendidosSinCatalogo`):

- `DECISION PROVISIONAL (nocturno)` — **el cruce es por NOMBRE**, sin distinguir mayúsculas ni
  espacios de más (los acentos sí cuentan), contra el espejo de productos de **la misma sucursal**
  en cualquier estado. El contrato de cheques no trae id de producto.
- ⚠️ **SUPUESTO — el ticket usa el mismo nombre que el catálogo.** Si SR imprime un nombre corto en
  la partida y guarda uno largo en el catálogo, TODO saldría "sin catálogo" (por eso la lista tiene
  tope de 500 renglones con `truncado`). Es lo primero que hay que mirar en F2-192.
- ⚠️ **Un producto renombrado en el POS dentro del periodo sale con su nombre viejo** como "sin
  catálogo": el espejo sólo guarda el nombre actual. La vista lo avisa.
- Una sucursal **sin sincronización completa** del catálogo de productos no se cruza (sale en
  `sucursalesSinCatalogo`): contra un catálogo parcial todo parecería "sin catálogo".
- Las variantes de escritura del mismo nombre se juntan en un renglón (`variantes`), con el texto de
  la de más importe. El importe es Σ `partidas.total`, antes del descuento de la cuenta.

**El precio por sucursal (F2-145).** Viaja en `RegistroProductoDto.precio` y se guarda en
`productos.precio NUMERIC(12,2)`, nulo = "el POS no lo reporta".

- ⚠️ **SUPUESTO — SR tiene UN precio por producto y sucursal.** Si maneja listas de precios (por
  horario, por área, por canal), el contrato cambia en la tarea que lo descubra.
- ⚠️ **SUPUESTO — no se sabe si el precio de SR incluye IVA.** Se guarda y se muestra tal como llega;
  la vista lo dice. El seed maestro lo genera "con IVA", pero eso es regla del generador, no evidencia
  de SR.
- `DECISION PROVISIONAL (nocturno)` — **"el mismo producto" en dos sucursales se reconoce por su
  CLAVE visible** (sin espacios, sin distinguir mayúsculas); sin clave, por el nombre normalizado
  (`api/src/catalogos/menu.ts#llaveProducto`). No se ha visto si las sucursales de una cadena
  comparten claves en SR: claves distintas para el mismo platillo no se cruzan, y la misma clave para
  cosas distintas sí. El menú dice con qué criterio cruzó cada producto, marca la clave repetida en
  una misma sucursal (`duplicadoEnSucursal`) y el producto que está en grupos distintos según la
  sucursal (`gruposDistintos`; va en el grupo de la primera sucursal por nombre).
- **La discrepancia** compara sólo filas vigentes (`activo` y `activoPos !== false`) con precio no
  nulo, en decimal exacto. Una fila sin precio o dada de baja se muestra y no la dispara.

**Lo que el top de productos (F1-032) supone:** ⚠️ **SUPUESTO — el nombre del producto es
estable.** El contrato de ingesta no trae un id de producto de SR, así que el top agrupa por
`cheque_partidas.producto` (texto). Si SR renombra un producto, aparece como dos. Su `importe`
es la suma de `partidas.total`, **antes** del descuento del cheque: no cuadra con la venta total
y no debe compararse con ella.

**Lo que el desglose por producto de Análisis (F2-221, `GET /ventas/por-producto`) supone.**

- Agrupa por nombre, igual que el top (mismo supuesto de nombre estable), y trae **todos** los
  productos, sin límite.
- ⚠️ **SUPUESTO (`DECISION PROVISIONAL (nocturno)` en `analisis.service.ts`) — lo que no es de
  ningún producto va en UN renglón de diferencia:** `diferenciaCuentas = venta − Σ partidas.total`.
  Así Σ importe + diferencia = venta exacto. La diferencia se lleva el descuento de la cuenta, los
  impuestos **si** `partidas.total` no los trae, y cualquier otro ajuste del POS. **No se sabe**
  si `partidas.total` incluye el IVA ni cómo reparte SR el descuento de la cuenta.
- ⚠️ **Ojo con el seed:** en `seed-ventas.ts` el IVA va DENTRO de las partidas y
  `total = Σ partidas − descuento`, así que con el seed la diferencia sale exactamente −Σ
  descuentos. Esa igualdad es una regla **del generador**, no evidencia de SR: con datos reales la
  diferencia puede tener otra forma (el e2e a mano de `analisis.e2e.spec.ts` ya la prueba con un
  total que no es Σ partidas − descuento).
- ❓ **DECISIÓN ABIERTA PARA RICARDO — ¿renglón de diferencia o prorrateo?** La alternativa es
  prorratear el total de cada cuenta entre sus partidas (la venta "neta" de cada producto). Es
  más útil para margen, pero inventa un reparto que SR no hace. Hasta decidir, el renglón.
- La participación de cada producto se calcula sobre **Σ partidas**, no sobre la venta, y la
  columna lo dice.


**Lo que el espejo de catálogos (F2-230, `POST /ingesta/catalogos`) supone.** Nada de esto se ha
visto en SR: la tabla de productos de §6 sigue `_(pendiente)_`. Lo lee F2-240 y lo valida F2-192.

- ⚠️ **SUPUESTO — cada registro del POS tiene una llave ESTABLE (`origenSrId`, texto 1–64) dentro
  de la base de SU sucursal.** El espejo es por sucursal: el mismo `origenSrId` en dos sucursales
  son dos filas. Si SR reutiliza o renumera ids, el espejo confunde dos productos.
- ⚠️ **SUPUESTO — la clave visible y el id interno pueden ser distintos**: el contrato los lleva
  aparte (`clave` nulable, `origenSrId`). El seed manda los dos iguales.
- `DECISION PROVISIONAL (nocturno)` — **nombre obligatorio, 1–200** (`api/src/ingesta/dto/catalogos.dto.ts`).
  Un registro sin nombre se RECHAZA solo (no tumba la página) y, si ya tenía fila, se marca visto
  sin tocar su contenido. No se sabe si SR tiene productos sin nombre.
- `DECISION PROVISIONAL (nocturno)` — **el grupo del producto va por texto** (`grupoOrigenSrId`,
  sin FK; `schema.prisma`, modelo `Producto`). Un producto con un grupo que aún no llegó no se
  rechaza; la lectura resuelve el nombre en la misma sucursal.
- ⚠️ **SUPUESTO — SR marca la baja de un producto con algún estado** (suspendido, inactivo). El
  contrato lo lleva en `activoPos` (nulable = "no lo reporta"), distinto de desaparecer de la
  lectura (`activo`). No se sabe qué columna es.
- **El precio ya viaja** (F2-145): ver "El precio por sucursal" arriba y §13.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — la metadata propia es por sucursal** (`productos_metadata`
  cuelga del producto espejo de ESA sucursal). Mínimo/máximo tiene sentido por sucursal; foto,
  descripción y etiquetas del menú quizá deberían ser por empresa. **F2-145 la dejó por sucursal**
  (la opción conservadora: sin migrar ni duplicar nada; `DECISION PROVISIONAL (nocturno)` en
  `catalogos.service.ts#menu`): el orquestador lleva el `productoId` de cada sucursal y la ficha la
  edita por sucursal. Sigue abierta.

---

## 7. Meseros y usuarios del POS

> Alimenta a `F1-022`, `F1-023` y al monitor.

**Tablas:** _(pendiente)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Lo que Análisis (F2-221, `GET /ventas/por-mesero`) supone.** El contrato de ingesta sólo trae el
**nombre** del mesero en `cheques.mesero` (texto, nulo permitido), sin id de SR.

- ⚠️ **SUPUESTO — un mesero es (sucursal, texto).** El mismo nombre en dos sucursales son dos
  filas: juntarlas mezclaría en silencio a dos personas que se llaman igual; separar a una misma
  persona que trabaja en las dos es el error menos grave y además se ve. Si SR renombra a un
  mesero, sale como dos.
- `mesero` nulo = "Sin mesero" (una fila por sucursal).

**Lo que el filtro de mesero de Tickets (F2-222) supone.** Las opciones del filtro salen de
`GET /ventas/por-mesero` del mismo alcance y periodo, **por nombre sin repetir** (dos "Ana" de dos
sucursales son una sola opción, y el filtro trae las dos: el filtro es por texto, no por
(sucursal, texto)). "Sin mesero" no aparece: el filtro exacto no puede pedir un nulo.


**Lo que el espejo de meseros (F2-230) supone.** Mismas reglas que §6: llave estable por sucursal
(`origenSrId`), clave visible aparte, nombre obligatorio, `activoPos` para la baja en SR. El espejo
todavía **no** se liga con `cheques.mesero` (texto): esa unión es de F2-231 y hoy sólo puede ir
por nombre.

**Lo que Meseros (F2-231, `GET /catalogos/meseros/rendimiento`) supone.** Todo **sin validar** contra
una instalación real (F2-192):

- ⚠️ **SUPUESTO — el texto del mesero en el cheque es el NOMBRE del mesero en su catálogo.** El
  cruce va por (sucursal, nombre normalizado): sin espacios de más ni mayúsculas, con los acentos
  contando (la misma normalización del orquestador, `menu.ts#normalizarNombre`). `DECISION
  PROVISIONAL (nocturno)` en `api/src/catalogos/meseros.ts`. Si en esta versión del POS el cheque
  guarda la **clave** o un **id** del mesero en vez del nombre, el cruce sale todo "No está en el
  catálogo" y hay que cambiar la llave: es lo primero que hay que mirar en F2-192.
- Dos escrituras que ligan con el **mismo** mesero del espejo (p. ej. "Ana López" y "ANA LÓPEZ")
  se **consolidan** en una fila con la suma exacta: para el POS son la misma persona. Si el espejo
  trae ese nombre dos veces en la sucursal, la fila sale **ambigua** y no se liga a ninguno.
- Sin sincronización completa de meseros en la sucursal, la fila dice "Catálogo sin sincronizar"
  (no "No está en el catálogo"); si la lectura del espejo se trunca (2000), "Catálogo incompleto".
- **Baja:** se lee de `activoPos` del espejo (false = baja en el POS; null = el POS no lo reporta,
  y el panel lo dice así, nunca "Activo"). `activo=false` = ya no vino en la última sincronización
  completa. Un mesero de baja **sale en los periodos en que atendió**, porque las cifras salen de
  los cheques, no del catálogo.
- **Tiempo de mesa por mesero** = cierre − apertura de SUS cuentas (misma regla que Análisis por
  mesa: una duración negativa no entra al promedio). Si SR reabre cuentas y conserva la apertura
  original, el tiempo incluye la reapertura: no verificado.
- ❓ **Pendiente de ver en una instalación real:** un cheque con el mesero **sólo en espacios**
  hoy llega como texto (no nulo), se normaliza a vacío y sale como fila "No está en el catálogo"
  (o "Catálogo sin sincronizar") con el nombre en blanco, no como "Sin mesero". Si SR lo hace,
  la ingesta debería guardarlo como nulo.
- **Promedio de la sucursal** (la comparación de la ficha): venta, cuentas, comensales y propina,
  por mesero con al menos una cuenta (sin "Sin mesero"); ticket y minutos, de TODA la sucursal
  (con las cuentas sin mesero).

---

## 8. Áreas, estaciones y canales de venta

> Alimenta a `F2-144`. **Spike pendiente:** hay que ver si esta instalación distingue
> comedor / mostrador / domicilio / plataformas, y por qué campo.

_(pendiente)_

**Estado del modelo (F2-233):** el contrato de eventos trae el **área** de la cuenta
(`datos.areaOrigenSrId`, §2 y §13) y `cheques.area_origen_sr_id` la guarda; **ni estación ni
canal** viajan en el cheque. El canal de negocio es NUESTRO y sale del mapeo área → canal. El
seed maestro persiste áreas, tipos de servicio, el área de cada cheque y un mapeo demo.

**Lo que el espejo de áreas y canales (F2-230) supone.**

- ⚠️ **SUPUESTO — SR tiene un catálogo de áreas** (comedor, terraza, barra) con llave estable.
- `DECISION PROVISIONAL (nocturno)` — **se supone también algún catálogo de canal o tipo de
  servicio** (comedor / mostrador / domicilio) y se le dio tabla espejo (`canales_venta_catalogo`,
  comentario en `schema.prisma`). Si SR no lo tiene, el agente cierra ese catálogo con `total=0`.
  El mapeo **área → canal de negocio es nuestro** y es de F2-233.

**Lo que Áreas y canales (F2-233) supone y decide** (`GET /ventas/por-area`,
`GET /catalogos/areas/mapeo`, `PUT /catalogos/areas/{id}/canal`, vista `/areas` y el bloque "Por
área y canal" de Análisis).

- **El cruce cuenta ↔ área es por (sucursal, `origen_sr_id`) EXACTO**, contra el espejo en
  cualquier estado (un área dada de baja sigue en sus periodos pasados con su nombre y su canal).
  Nunca por la clave visible ni por el nombre. El mismo id en dos sucursales son dos áreas.
- **El canal de negocio sale SÓLO del mapeo** (`areas_canal`, uno por fila espejo del área), que
  es nuestro: ninguna sincronización lo toca y se aplica al leer, así que cambiarlo recalcula
  cualquier periodo sin re-ingerir. Sin mapeo no se adivina desde el nombre del área.
- **Nada se reparte a ojo:** Σ áreas + "sin clasificar" = Σ canales + "sin canal" + "sin
  clasificar" = `/ventas/resumen`. "Sin clasificar" = la cuenta no trae área. "Sin canal" = área
  sin canal asignado, o un id que el espejo no tiene (`sin-catalogo` si la sucursal sincronizó
  áreas; `sin-sincronizar` si nunca lo hizo, porque entonces no se puede afirmar que falte).
- **El catálogo de canales / tipos de servicio del POS (`canales_venta_catalogo`) NO interviene en
  el cálculo.** Conservador: no se sabe cómo SR liga una cuenta con su tipo de servicio (si es
  que lo hace). Si el cheque trae un tipo de servicio propio, usarlo o no es decisión de
  F2-144/F2-192.
- ⚠️ **Riesgo conocido del supuesto:** si una reinstalación del POS cambia los ids de las áreas,
  llegan filas espejo NUEVAS sin mapeo (las viejas quedan `activo=false` con el suyo) y la venta
  nueva cae en "sin canal" hasta que alguien las asigne. Es lo honesto; no se remapea por nombre.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — el conjunto de canales.** Quedó como enum fijo de Postgres
  (`canal_negocio`: comedor, mostrador, domicilio, plataformas, el de F2-144); agregar uno ("para
  llevar", "eventos") es una migración. Lo cierra el spike de F2-144.
- ❓ **DECISIÓN ABIERTA PARA RICARDO — mapeo por sucursal o por empresa.** El espejo es por
  sucursal, así que el mapeo también: una empresa con 10 sucursales mapea "Terraza" 10 veces.
  ¿Mapear por nombre a nivel empresa? No se construyó sin decisión.
- **Estaciones: sin dato.** No hay espejo, contrato ni seed de estaciones (terminales o puntos
  de cobro); no se sabe si esta versión de SR las registra ni dónde. La vista lo dice en vez de
  inventar un desglose. Queda para F2-240 (leerlas si existen) y F2-192 (validarlas).

**Clientes (F2-230).** ⚠️ **SUPUESTO — no toda instalación usa clientes.** El espejo acepta
nombre, teléfono, correo y RFC tal como el POS los guarde (sin validar formato: rechazar un cliente
por un correo mal escrito sería perderlo). Son datos personales: el API nunca los repite en un
motivo de rechazo ni en el log.

**Lo que la vista Clientes (F2-232) supone y decide.**

- **El cruce cuenta ↔ cliente es por (sucursal, `origen_sr_id`) EXACTO**, nunca por la clave
  visible ni por el nombre (supuesto de §2). El mismo id en dos sucursales son dos clientes (el
  espejo es por sucursal); no se consolida por RFC ni teléfono: sería inventar identidad.
- **"El POS no usa clientes" no se afirma.** Un catálogo que cerró con `total=0` sale `vacio`, y la
  vista dice "llegó vacío y ninguna cuenta trae cliente": también puede ser un agente que leyó cero
  por un error (§13, `total=0`).
- **Un id que traen las cuentas y el espejo no tiene sale "sin ficha"**, por su id del POS, sin
  nombre ni datos inventados; si la sucursal no ha sincronizado clientes, sale "sin sincronizar"
  (no se puede afirmar que falte). La lista del espejo tiene tope de 5000 vigentes, pero los
  registros de los ids que aparecen en las cuentas se leen aparte, sin tope: un cliente con visitas
  siempre liga.
- Un cliente dado de baja (`activo=false`) sólo aparece si tuvo visitas o canceladas en el periodo.
- Ticket promedio = venta / visitas, a 2 decimales mitad lejos de cero (la regla de Análisis y
  Meseros).
- **Datos personales.** La lista no devuelve teléfono, correo ni RFC salvo `contacto=true`, que sólo
  pide el export cuando el usuario marca la casilla; el CSV por defecto identifica al cliente por su
  clave o su id del POS. La búsqueda `q` (puede ser un nombre) se aplica en el servidor sobre la
  lista ya armada: no llega a ninguna consulta SQL ni a ningún log, y la vista no la escribe en la
  URL del navegador. OJO: `q` sí viaja en la query string de la petición; hoy Caddy no tiene access
  log, pero **activar un access log metería nombres en los logs**. El filtro de Tickets usa el
  `id` (uuid) del espejo, nunca el nombre.
- ❓ **DECISIÓN ABIERTA PARA RICARDO: ¿el `visor` debe ver teléfono, correo y RFC en la ficha?**
  Hoy sí (igual que `GET /catalogos/clientes` desde F2-230). No se endureció sin decisión.
- El enlace con `ReceptorFrecuente` (por RFC) queda para F2-100, que crea ese modelo.

---

## 9. Inventario — catálogos (Fase 2)

> Alimenta a `F2-120`. Insumos, grupos de insumos, unidades, almacenes, presentaciones,
> productos-receta.

**Tablas de SR: sin mapear.** Nadie ha visto todavía dónde guarda SoftRestaurant su inventario.
Lo busca y documenta aquí el lector de F2-241, y lo valida F2-192 contra una instalación real.
Lo que sigue **no es un hallazgo**: es el contrato que el panel ya acepta (F2-120) y los
supuestos con que se construyó. Las formas del seed (`api/prisma/seed-maestro/insumos.ts`) son
sintéticas y **no son evidencia** de cómo es SR.

**Contrato (F2-120).** Cinco catálogos más por el MISMO camino de F2-230
(`POST /ingesta/catalogos` + `/cierre`, mismo hash, mismo `visto_at`, misma baja sin borrar; ver
§13): `unidades`, `grupos_insumo`, `insumos`, `almacenes`, `proveedores`. Espejo por sucursal
en `unidades_catalogo`, `grupos_insumo`, `insumos`, `almacenes_catalogo` y
`proveedores_catalogo`. Todos llevan sólo `origenSrId`, `clave`, `nombre` y `activoPos`, salvo el
insumo, que agrega `grupoOrigenSrId` y `unidadOrigenSrId`. Un campo de más (p. ej. `costo`) rechaza
ese registro solo.

- ⚠️ **SUPUESTO — cada sucursal tiene sus propios almacenes** (un almacén es de un POS y no se
  comparte entre sucursales). `schema.prisma#AlmacenCatalogo`. Si en SR un almacén central
  surte a varias sucursales, esto cambia (y con ello los traspasos de F2-124, §10 "Traspasos").
- ⚠️ **SUPUESTO — un insumo tiene UN grupo y UNA unidad**, referidos por el `origenSrId` de
  esos catálogos en la misma sucursal, en texto y **sin FK** (como el grupo del producto, §6): el
  orden de llegada no está garantizado. `RegistroInsumoDto` y `schema.prisma#Insumo`. Omitirlos
  los guarda **nulos, también en una página incremental**: el lector manda siempre lo que lee.
- ⚠️ **SUPUESTO — los proveedores son un catálogo del POS** de cada sucursal, sin RFC ni datos de
  contacto (no se sabe qué guarda SR). `schema.prisma#ProveedorCatalogo`. Si SR no tiene
  proveedores, el lector cierra con `total = 0` (el catálogo queda vacío, no se inventa).
- ⚠️ **SUPUESTO — el catálogo de insumos no trae costo.** El costo con que se valúa el inventario
  es el promedio POR ALMACÉN, que viaja con las existencias (F2-121, §10). Si SR tiene además un
  "último costo" en el insumo, se agrega al contrato cuando se vea.
- ⚠️ **Sin modelar: presentaciones** (empaques de compra, p. ej. "caja con 24") **y
  productos-receta.** El seed no los genera y no se sabe cómo los guarda SR. Las recetas son de
  F2-125; las presentaciones las busca F2-241 y, si existen, piden su propio espejo y contrato.
- ⚠️ **SUPUESTO — la unidad no dice si es fraccionable** (el seed sí lo sabe, SR no se sabe). El
  conteo físico (F2-123) no lo necesitó: acepta hasta 3 decimales en cualquier unidad (lo mismo que
  NUMERIC(12,3)). Si hace falta impedir fracciones de una pieza, sale de SR cuando se vea o se vuelve
  metadata propia.
- **Forzado manual:** desde F2-120 una solicitud de sincronización sigue pendiente hasta que
  cierran los **once** catálogos. Un agente que sólo lea los seis de F2-230 la deja pendiente
  hasta que tenga los lectores de F2-241, y no debe ciclarse ni cerrar con `total = 0` para
  apagarla (ver §13).

---

## 10. Inventario — existencias, movimientos y recetas (Fase 2)

> Alimenta a `F2-121`, `F2-122`, `F2-123`, `F2-124`, `F2-125` y `F2-126`. Existencias por almacén
> con costo promedio, movimientos con referencia a póliza, conteos y traspasos propios
> conciliados contra ellos, explosión de insumos por producto, compras.

**Tablas de SR: sin mapear.** Recetas y compras siguen pendientes (F2-125, F2-126); de existencias y
movimientos tampoco se conoce la tabla (el lector es F2-241 y lo valida F2-193). Lo que sigue **no
es un hallazgo**: son los contratos de existencias (F2-121) y de movimientos (F2-122) que el panel
ya acepta, y los supuestos con que se construyeron.

### Existencias (F2-121): `POST /ingesta/existencias`

Lo define `api/src/ingesta/dto/existencias.dto.ts` y lo publica `api/openapi.json`. Una petición =
la **foto completa de UN almacén** de la sucursal de la API key:
`{ almacenOrigenSrId, capturadoAt, registros: [{ insumoOrigenSrId, cantidad, costoPromedio }] }`.
Se guarda en `existencias` (estado actual por sucursal, almacén e insumo), `lecturas_existencias`
(la última foto aplicada de cada almacén) y, aparte, `limites_existencia` (mínimo y máximo, que son
del panel y **nunca se escriben a SR**).

- ⚠️ **SUPUESTO — SR guarda existencia y costo promedio POR ALMACÉN.** Si el costo promedio es por
  insumo (no por almacén), el lector manda el mismo costo en cada almacén y nada cambia aquí.
- ⚠️ **SUPUESTO — la foto trae TODAS las filas del almacén, también las que están en 0 o negativas.**
  Lo que ya estaba y no viene **se borra** (es estado, no catálogo; la historia es de los
  movimientos, F2-122). Si SR omite las filas en cero, un artículo agotado desaparecería del panel
  en vez de salir "sin existencia": el lector (F2-241) tiene que mandarlas. Un artículo con mínimo
  o máximo que sale de la foto se muestra "sin lectura" (no se oculta) y su alerta de bajo mínimo
  ni se abre ni se cierra.
- ⚠️ **SUPUESTO — la cantidad puede ser negativa** (el POS podría permitir vender sin existencia).
  Se guarda tal cual y cuenta como "sin existencia"; su valor (negativo) SÍ suma al valor total.
  Si el reporte de inventario de SR no suma negativos, F2-193 lo ve al cuadrar contra el piloto.
- `DECISION PROVISIONAL (nocturno)` — **el costo promedio se redondea a 2 decimales** (mitad lejos
  de cero, la regla de dinero de §13) y `valor = round(cantidad × costo, 2)` lo calcula el API. Si
  SR valúa con el costo a 4 decimales, el total puede diferir por centavos de redondeo: F2-193 lo
  mide.
- `DECISION PROVISIONAL (nocturno)` — **un registro inválido se rechaza solo**, como en catálogos: si
  su insumo es identificable, su fila se queda como estaba (ni se actualiza ni se borra); si algún
  rechazo **no** trae insumo identificable, esa foto **no borra ningún ausente**
  (`ausentesConservados=true`). Un insumo repetido rechaza todas sus apariciones. Un valor que no
  cabe en NUMERIC(12,2) rechaza ese registro. El sobre (almacén, fecha, arreglo) es todo o nada: 400.
- **Orden:** una foto con `capturadoAt` anterior a la última aplicada de ese almacén no escribe nada
  (`aplicado=false`); con el MISMO `capturadoAt` gana la que llega después (bajo el candado del
  almacén). Reenviar la misma foto no cambia nada (ni `recibida_at`).
- `DECISION PROVISIONAL (nocturno)` — **0 registros = el almacén quedó vacío** (se borran sus filas),
  igual que `total = 0` en catálogos. Riesgo: un agente que se trague un error de lectura y mande
  cero vacía el almacén en el panel hasta la siguiente foto.
- `DECISION PROVISIONAL (nocturno)` — **tope de 5000 registros por foto.** Un almacén con más insumos
  no cabe en una petición: si pasa en una instalación real, es cambio de contrato (paginar).
- **Almacén e insumo sin FK**, por su `origenSrId` en texto (como §9): la foto puede llegar antes que
  el catálogo. En el panel sale "sin catálogo" hasta que llegue.
- **Frecuencia:** la ficha pide leer cada 30 min (lo decide el agente, F2-241). El panel marca
  "atrasada" una lectura **recibida** hace más de 90 min (`DECISION PROVISIONAL`, 3 × 30 min).
- **Alerta `bajo_minimo`** (centro de alertas): se abre cuando la existencia queda por debajo del
  umbral % de su mínimo (100 % por defecto; en el mínimo exacto no). Una sucursal que nunca mandó
  existencias no se evalúa. Una alerta de un artículo que pasó a "sin lectura" **se queda abierta**
  hasta que vuelva a leerse o se borre su mínimo (opción conservadora; F2-193 decide si se cierra
  tras cierto tiempo).

### Movimientos y pólizas (F2-122): `POST /ingesta/movimientos`

Lo define `api/src/ingesta/dto/movimientos.dto.ts` y lo publica `api/openapi.json`. Una petición = un
**lote de pólizas** (documentos de inventario) de la sucursal de la API key, cada una con TODAS sus
partidas: `{ leidoAt, polizas: [{ origenSrId, folio, tipo, tipoSr?, almacenOrigenSrId, fecha,
referencia, cancelada, partidas: [{ insumoOrigenSrId, cantidad, costoUnitario }] }] }`. Se guarda en
`polizas_inventario` (cabecera, upsert por sucursal + `origen_sr_id`, con el `hash` de su forma
canónica) y `movimientos_inventario` (una fila por partida, con el almacén y la fecha de su póliza).
El panel las muestra en `/movimientos` (línea de tiempo, detalle de póliza y kardex).

- ⚠️ **SUPUESTO — SR agrupa sus movimientos de inventario en pólizas/documentos con un id estable**
  (`origenSrId`) y un folio visible. Si SR guarda movimientos sueltos sin documento, el lector
  (F2-241) arma una póliza por movimiento con el id del movimiento.
- `DECISION PROVISIONAL (nocturno)` — **el tipo es NUESTRO** (`tipo_poliza_inventario`: inicial,
  compra, consumo, merma, traspaso_salida, traspaso_entrada, ajuste, otro). El lector traduce el
  tipo de SR y manda además el código crudo en `tipoSr`, para que F2-192 valide la traducción. Lo
  que no sepa traducir llega como `otro` y la web lo muestra "Otro (sin traducir)", no lo esconde.
- ⚠️ **SUPUESTO — un almacén por póliza.** Un traspaso en SR podría ser UN documento con origen y
  destino: el lector lo manda como DOS pólizas (`traspaso_salida` en el origen y `traspaso_entrada`
  en el destino) con ids distintos. Si SR mezcla almacenes en una póliza, es cambio de contrato.
- ⚠️ **SUPUESTO — la cantidad viaja CON SIGNO** (+ entra, − sale), NUMERIC(12,3), también en un
  ajuste (que puede ir en los dos sentidos). El tipo es una etiqueta: el kardex suma el signo, no
  el tipo. Una partida en 0 se acepta.
- `DECISION PROVISIONAL (nocturno)` — **el importe lo calcula el API**: `round(cantidad ×
  costoUnitario, 2)` mitad lejos de cero, con el costo redondeado antes a 2 (la regla de §13). Si
  SR guarda el importe con más precisión, puede haber centavos de diferencia contra su reporte
  (F2-193 lo mide).
- `DECISION PROVISIONAL (nocturno)` — **una póliza nunca se borra del panel**: si SR la cancela o
  desaparece, el lector la manda con `cancelada = true`. Una cancelada se ve (marcada) en la línea de
  tiempo, en el detalle y en el kardex, pero **no mueve el saldo**. Si SR borra físicamente pólizas
  sin dejar rastro, el lector no puede avisar y el panel conservaría la vieja: F2-192 lo revisa.
- **Idempotencia y orden:** mismo hash = no se toca nada. Hash distinto = se reescribe la cabecera y
  se **reemplazan** todas sus partidas (una corrección con menos renglones no deja renglones viejos).
  `DECISION PROVISIONAL (nocturno)`: `leidoAt` (cuándo leyó el agente el lote) decide qué versión es
  más nueva: una póliza guardada con una lectura más nueva no se toca (`obsoletas`), así un lote
  viejo reintentado no revierte una corrección; con el MISMO `leidoAt` gana el que llega después.
  El mismo contenido leído más tarde sólo avanza `leida_at`.
- **Rechazo POR PÓLIZA:** una partida inválida rechaza su póliza ENTERA (una póliza a medias es un
  hueco en el kardex); un `origenSrId` repetido en el lote rechaza todas sus apariciones; una fecha
  más de 5 min en el futuro o un importe que no cabe en NUMERIC(12,2) rechaza esa póliza; un campo
  de más (tenant incluido) también. El sobre es todo o nada (400).
- `DECISION PROVISIONAL (nocturno)` — **topes del lote: 200 pólizas y 5000 partidas EN TOTAL** (5000
  partidas caben en el body de 5 MB y en el `statement_timeout`). El lector parte los lotes por
  partidas, no sólo por pólizas. Una póliza real de más de 5000 partidas no cabe: cambio de contrato.
- **Almacén e insumo sin FK**, por su `origenSrId` en texto (como §9 y las existencias).
- **Kardex:** saldo inicial = Σ de lo no cancelado antes del rango (días cortados en la zona de la
  sucursal); luego cada movimiento con su saldo corrido. `DECISION PROVISIONAL (nocturno)`: el orden
  es fecha → **folio (como texto)** → renglón. Con folios de SR sin ceros a la izquierda, "10" va
  antes que "9" en la misma fecha: el saldo final no cambia, el corrido intermedio sí. Si pasa,
  el lector manda un orden explícito (cambio de contrato) o F2-192 elige otro desempate.
- **Cuadre contra la existencia:** el kardex compara la existencia de la última foto del almacén
  (F2-121) con Σ de lo no cancelado **hasta el corte de esa foto** (`capturado_at`), no contra todo
  lo recibido: un movimiento posterior a la foto no es diferencia. Sin pólizas recibidas de la
  sucursal, o sin existencia leída del artículo, no hay cuadre (`null`), nunca una diferencia
  inventada. ⚠️ **SUPUESTO — el `capturadoAt` de la foto y la `fecha` de los movimientos son del
  mismo reloj** (el del POS/agente): si no, un movimiento cerca del corte cae del lado equivocado.
  Caso límite conocido: una póliza que se **cancela después** de la foto aparece como diferencia
  (la foto ya traía su efecto y el kardex ya no la suma) hasta la siguiente foto.
- **Qué prueba el seed y qué no.** Con el seed, el kardex de cada artículo reproduce su existencia
  (`prisma/seed-movimientos.spec.ts`): eso prueba que la ingesta y el kardex **conservan** lo que
  simuló el seed maestro. No prueba que SR registre así sus movimientos: el cuadre real es de F2-193.

### Conteos físicos (F2-123): dato PROPIO, nunca se escribe a SR

Un conteo físico **no se lee de SoftRestaurant ni se escribe en él**: se crea y se captura en el
panel (`/inventario/conteos*`, tablas `conteos_fisicos` y `partidas_conteo`), y su reporte de
diferencias es lo que el encargado lleva a SR para registrar ahí el ajuste **a mano**. El agente no
tiene ninguna ruta de conteos (su API key sólo alcanza `/agente/yo` y `POST /ingesta/*`; lo fija
`openapi.spec.ts` y el e2e lo prueba con 401), y la guardia existente del agente
(`ConsultasEmbebidasTests`: ninguna consulta embebida escribe) sigue siendo la prueba del lado
`/agent` de que nada escribe en la base del POS: **F2-123 no toca `/agent`**. El e2e
`inventario/conteos.e2e.spec.ts` además afirma que crear, capturar, cerrar y cancelar dejan
idénticas las tablas espejo de SR (existencias, lecturas, pólizas, movimientos, catálogos).

- ⚠️ **SUPUESTO / `DECISION PROVISIONAL (nocturno)` — el teórico se CONGELA al crear el conteo**:
  es la última foto de existencias del almacén (cantidad y costo promedio por artículo) y su
  `capturado_at`, copiados a las partidas. Una foto posterior no lo mueve. Es como se congela un
  inventario físico; si SR compara su propio conteo contra otro corte (p. ej. al cerrarlo), F2-193
  lo ve contra el piloto. `scope/escritura-conteos.ts#crear`.
- `DECISION PROVISIONAL (nocturno)` — **almacén sin ninguna lectura de existencias = 409**: no se crea
  un conteo que no puede dar diferencias. Almacén que no es de la sucursal (ni en su catálogo ni en
  sus lecturas) o grupo ajeno = 404.
- `DECISION PROVISIONAL (nocturno)` — **"teórico atrasado"**: la foto congelada tenía más de 90 min al
  crear el conteo (la misma regla de "lectura atrasada" de F2-121, aquí contra el corte de la foto).
  Sólo avisa; no impide contar.
- ⚠️ **SUPUESTO — artículos del conteo** = insumos **activos** del catálogo de la sucursal ∪ los que
  vienen en la foto del almacén (el catálogo no dice qué insumo vive en qué almacén, §9). Uno del
  catálogo que no viene en la foto va **"sin teórico"** (nulo, nunca 0). En un conteo **por grupo**,
  un artículo que sólo está en la foto (sin catálogo) no tiene grupo conocido y queda fuera.
- `DECISION PROVISIONAL (nocturno)` — **sin contar ≠ 0**: un renglón vacío al cerrar se reporta aparte;
  quien quiere 0 lo captura. Cerrar con renglones sin contar se permite.
- **Diferencia e importe:** `contado − teórico`; importe = `round(diferencia × costo promedio, 2)`
  mitad lejos de cero (la misma `valorDe` de F2-121), **por renglón**; los totales (faltante,
  sobrante, neto) son la Σ de los renglones ya redondeados, así cuadran aritméticamente con lo que se
  ve. Un teórico negativo (existencia negativa en SR) se compara tal cual.
- `DECISION PROVISIONAL (nocturno)` — **último en llegar gana, por renglón**. Un conteo lo captura
  normalmente un dispositivo; dos a la vez se pisan. El web guarda lo capturado primero en un
  borrador local (llave usuario + empresa + conteo) y lo reenvía al volver: un borrador viejo
  reenviado puede pisar un valor más nuevo que otro dispositivo capturó en el mismo renglón.
- **Candado:** capturar, cerrar y cancelar toman el mismo `pg_advisory_xact_lock` del conteo y leen
  el estado con él puesto: nada se escribe después de un cierre (e2e de concurrencia).
- ⚠️ **SUPUESTO NO VALIDADO — el ajuste en SR regresa como póliza `ajuste`.** El proceso asume que,
  cuando el encargado registra en SR el ajuste que sale del reporte, el lector (F2-241) lo manda como
  una póliza de tipo `ajuste` (F2-122) y la siguiente foto de existencias ya lo refleja. **Cómo se
  llama ese menú en SR y qué documento genera no está mapeado**: la ayuda del panel
  (`web/src/paginas/AyudaConteos.tsx`) lo describe en genérico. F2-193 lo verifica en el piloto.

### Traspasos (F2-124): dato PROPIO conciliado contra las pólizas de SR

Un traspaso del panel (`/inventario/traspasos*`, tablas `traspasos` y `partidas_traspaso`) se
**captura en la web y NUNCA se escribe a SR**: el encargado lo registra también en SoftRestaurant, y
el panel lo concilia solo cuando la ingesta de movimientos (F2-122) trae sus pólizas espejo. Flujo
propio: `enviado` (1.ª confirmación, al crearlo) → `recibido` (2.ª); cancelar sólo desde `enviado` y
sin ningún espejo. Los traspasos **leídos** de SR no son tabla nueva: son las pólizas
`traspaso_salida` / `traspaso_entrada` ya guardadas, que `GET /inventario/traspasos/sr` agrupa por su
`referencia`. `/agent` no se toca y el agente no tiene ninguna ruta de traspasos (401; lo fijan
`openapi.spec.ts` y el e2e).

- **Espejo = (póliza, renglón)**, no el id del movimiento: la ingesta reemplaza los movimientos de una
  póliza corregida (ids nuevos), pero la póliza conserva su id (upsert por `origen_sr_id`). FK
  compuestas: la salida es de una póliza de la sucursal ORIGEN y la entrada de una de la DESTINO,
  las dos de la MISMA empresa (`partidas_traspaso_poliza_salida_fkey` / `…_entrada_fkey`), ON DELETE
  RESTRICT (la ingesta nunca borra pólizas; el seed de movimientos suelta los espejos antes de borrar
  las suyas). Un renglón de SR concilia a lo más UN renglón del panel (únicos).
- `DECISION PROVISIONAL (nocturno)` — **regla del espejo** (`api/src/inventario/traspasos.ts`): la
  salida es una partida de una póliza `traspaso_salida` NO cancelada en la sucursal y almacén de
  origen, del mismo insumo, con cantidad exactamente −q y |fecha − envío| ≤ 24 h; la entrada, una de
  `traspaso_entrada` en el destino con +q y fecha en [envío − 24 h, (recibido ?? envío) + 24 h].
  "± 1 día" = **24 h absolutas**, no días de calendario; cantidad **exacta** a 3 decimales; **no se
  exige la `referencia`** (no se sabe si SR la llena). Entre candidatos gana la fecha más cercana; los
  traspasos van en orden de envío y folio (determinista). Un traspaso está **conciliado** cuando TODOS
  sus renglones tienen salida y entrada; a medias sigue "pendiente de registrar en SR".
- ⚠️ **SUPUESTO — la `fecha` de las pólizas de SR trae hora.** Si SR guarda sólo la fecha (medianoche
  local), la ventana de ± 24 h sigue cubriendo el día del envío y el anterior; un traspaso enviado de
  noche y registrado al día siguiente podría quedar fuera. F2-193 lo mide.
- ⚠️ **SUPUESTO — la clave del insumo (`origenSrId`) es la MISMA en las dos sucursales** (el catálogo
  de SR se replica). El renglón se valida contra el catálogo o la foto de la sucursal ORIGEN; la
  entrada se busca con la misma clave en la destino. Si cada sucursal numera distinto, la entrada
  nunca concilia y hace falta un mapeo (tarea nueva).
- ⚠️ **SUPUESTO — un traspaso de SR llega como DOS pólizas** (salida en el origen, entrada en el
  destino), cada una desde el agente de SU sucursal (ya era el supuesto "un almacén por póliza" de
  F2-122). Si un almacén central surte a varias sucursales (§9), esto cambia.
- `DECISION PROVISIONAL (nocturno)` — **quién concilia y cuándo:** la vuelta del centro de alertas
  (cada 60 s) concilia la empresa ANTES de evaluar, con el scope de la empresa; si el candado de
  traspasos está ocupado, se pospone esa vuelta (a lo más retrasa una alerta), cualquier otro error se
  propaga. Los GET no concilian, pero RE-VERIFICAN al leer cada espejo guardado (sigue sirviendo con
  la misma regla): si SR canceló la póliza en el último minuto, la vista ya no lo pinta. Una empresa
  inactiva sin alertas abiertas no se evalúa y sus traspasos no se concilian.
- `DECISION PROVISIONAL (nocturno)` — **un conciliado se re-verifica 90 días** desde su envío (si SR
  cancela o corrige la póliza a otra cosa, vuelve a pendiente y conserva `conciliado_at` si el espejo
  sigue sirviendo). Pasado eso se da por firme. Uno NO conciliado se busca siempre.
- **Alerta `traspaso_sin_conciliar`** (centro de alertas): un traspaso no cancelado y sin conciliar
  **más de** 48 h después de su envío (a las 48 h exactas, no), por su sucursal de ORIGEN; umbral en
  horas (1–720), advertencia. Se cierra al conciliarse o cancelarse.
- `DECISION PROVISIONAL (nocturno)` — **el costo** de cada renglón es el costo promedio de la foto del
  almacén de origen AL ENVIAR (nulo si el artículo no venía en la foto, nunca 0); importe =
  `round(cantidad × costo, 2)` (la `valorDe` de F2-121). No se valida contra la existencia (la foto
  puede estar vieja): el web sólo avisa.
- **Sin editar cantidades al recibir:** la recepción confirma el traspaso completo. Un faltante en
  el camino hoy no se registra en el panel (queda abierto; SR tendría una entrada distinta y el
  renglón no conciliaría).

---

## 11. Rendimiento y precauciones

> Lo que aprendimos de no estorbarle al POS. Esta sección se llena con experiencia, no
> con documentación.

- Queries que resultaron caras y por qué: _(pendiente)_
- Índices que existen en la base de SR y se pueden aprovechar: _(pendiente)_
- Timeout que se quedó como bueno: ⚠️ **SUPUESTO (F1-020), no validado** — 5 s de
  `Connect Timeout` (si la cadena no trae uno; tope 15 s) y 5 s de `CommandTimeout`
  (`ConexionSoftRestaurant.TimeoutComandoSegundos`). Nadie los ha medido contra un POS con
  carga: F1-090 / F1-091 dicen si alcanzan en hora pico.
- Horas pico del restaurante en las que conviene espaciar la lectura: _(pendiente)_

### Conexión al SQL Server del POS (F1-020)

F1-020 escribió esto sin instalación real, como supuestos, al hacer la plantilla
(`infra/config.example.json`) y el diagnóstico de `agente test`. F1-021 lo contrastó con una
instalación de SR 10 (ver el recuadro de abajo). Lo que no aparece ahí sigue siendo supuesto.

> **Lo que se vio en la instalación local de desarrollo (F1-021, 2026-09-21, SR 10.0.323,
> `versiondb` 10.021800).** ✅ VALIDADO sólo para esa instalación.
>
> **Cómo se validó.** Consola, no servicio, con autenticación de Windows y el usuario del
> desarrollador, que es **sysadmin**. No hay usuario de solo lectura: crearlo habría sido
> escribir en el servidor del POS. Como se esperaba, `agente test` y el diagnóstico del
> servicio marcaron **FALLA** por permisos de escritura. **No es la configuración de
> producción.**
>
> **Servidor y base:**
> - Instancia `.\NATIONALSOFT` (servicio `MSSQL$NATIONALSOFT`).
> - SQL Server **2014 SP1 Express**, `12.0.4100.1`, nivel de compatibilidad 120.
> - Collation de la base: `Modern_Spanish_CI_AS`.
> - Las **354 tablas** de la base están en el esquema **`dbo`**. `diagnostico.sql` revisa
>   el esquema correcto.
>
> **Conexión:**
> - **Sin `TrustServerCertificate=True` la conexión falla.** El certificado es autofirmado,
>   así que la plantilla hace bien en traerlo.
>   - El error trae el número `-2146893019` (`CERT_E_UNTRUSTEDROOT`). En un Windows en
>     español el texto es "*La cadena de certificación fue emitida por una entidad en la
>     que no se confía*" (provider: "Proveedor de SSL").
>   - Ese texto no contiene "certificate" ni "certificado", así que `agente test` lo
>     clasificaba como "falló el cifrado / TLS 1.2" y sugería otra cosa. F1-021 lo
>     corrigió: ahora lo reconoce por el número.
> - **Con `TrustServerCertificate=True` conecta, pero el canal negocia TLS 1.0.**
>   SqlClient lo avisa por consola: "*el elemento TLS 1.0 negociado es un protocolo
>   inseguro*". El supuesto de abajo sobre TLS 1.2 se confirma a medias: este SQL 2014 SP1
>   no ofreció 1.2, pero SqlClient 5.2 **sí conecta** con 1.0 en Windows 11.
> - **`diagnostico.sql` corrió contra un servidor real** y `FilaDiagnostico.Leer` leyó bien
>   los tipos que devuelven `IS_SRVROLEMEMBER`, `IS_ROLEMEMBER` y `HAS_PERMS_BY_NAME`. Era
>   un pendiente de F1-020.
>
> **Permisos:** en esta instalación `IS_SRVROLEMEMBER('sysadmin', 'NT AUTHORITY\SYSTEM')`
> = **0**. El dato sale de la consulta: el servicio no se corrió como SYSTEM. **Varía entre
> instalaciones**, así que el supuesto de abajo sigue en pie como precaución.
>
> **Lenguaje:** SQL Server 2014 **no tiene `STRING_AGG`** (ni `STRING_SPLIT`, que llegó en
> 2016). Toda query del agente tiene que ser T-SQL de 2014 o anterior.
>
> **Lo que NO se validó:**
> - el codepage y `InvariantGlobalization`: ver la collation no es haber decodificado un
>   texto con acentos;
> - el comportamiento con un usuario `db_datareader`.

- **`agente test` no toca tablas de SR.** Su única query, `Sql/Consultas/diagnostico.sql`,
  lee funciones de sistema: versión y edición del servidor, base, login, `IS_SRVROLEMEMBER`,
  `IS_ROLEMEMBER` y `HAS_PERMS_BY_NAME`. Si el usuario puede escribir, `test` marca FALLA.
  **Límite conocido:** revisa roles de servidor y de base, permisos sobre la base y
  permisos sobre el esquema `dbo`. Un `GRANT INSERT ON dbo.<tabla>` sobre una tabla suelta
  (permiso por objeto) **no se detecta**. La defensa real sigue siendo crear el usuario
  sólo con `db_datareader` (script de F1-026). Si en F1-090 las tablas de SR resultan vivir
  en otro esquema, hay que agregarlo a la query.
- ⚠️ **SUPUESTO — SR corre sobre un SQL Server Express local con certificado autofirmado.**
  `Microsoft.Data.SqlClient` 5 cifra por defecto (`Encrypt=True`) y valida el certificado:
  sin `TrustServerCertificate=True` la conexión falla con un error de "certificate chain".
  La plantilla lo trae puesto y `test` lo sugiere cuando ve ese error.
  `DECISION PROVISIONAL (nocturno)`: la conexión va cifrada sin validar el certificado. Es
  aceptable en la misma PC o en la LAN del restaurante, no por internet.
- ⚠️ **SUPUESTO — un SQL Express viejo (2008 / 2008 R2 / 2012 sin parches) puede no hablar
  TLS 1.2.** Síntoma: error de SSL/TLS al abrir la conexión aunque el servidor responda.
  `test` lo reporta como "falló el cifrado" y sugiere actualizar o, si la base está en la
  misma PC, `Encrypt=False`. No se sabe qué versión de SQL Server instala cada versión de SR
  (§1 sigue pendiente).
- ⚠️ **SUPUESTO — en los SQL Express viejos, `NT AUTHORITY\SYSTEM` es sysadmin.** El servicio
  corre como LocalSystem. Con `Integrated Security=True`, el agente entraría a la base del
  POS con permisos de todo, justo lo que la regla de solo lectura prohíbe. Por eso la
  plantilla usa autenticación SQL, y `test` y el log avisan si la cadena usa la de Windows.
- ⚠️ **SUPUESTO — el texto de SR vive en `varchar` con collation en español (codepage 1252,
  p. ej. `Modern_Spanish_CI_AS`).** Por eso el agente corre con `InvariantGlobalization=false`
  (`DECISION PROVISIONAL (nocturno)` en `agent/src/ArkonAgente/ArkonAgente.csproj`): en
  modo invariante no se pudo comprobar que SqlClient decodifique bien acentos y eñes, porque
  no hay SQL Server en la máquina donde se escribió. F1-090 lo confirma leyendo un producto
  con acento.
- ✅ **La instancia se llamó `.\NATIONALSOFT`** en la única instalación vista (SR 10, F1-021).
  Otras instalaciones pueden usar otro nombre, por ejemplo `.\SQLEXPRESS` si SR se montó
  sobre un SQL ya existente. El técnico lo pone en la cadena.

### Usuario de solo lectura e instalador (F1-026)

El instalador (`agent/instalador/`) crea el login `monitor_lector` con
`crear-usuario-lector.sql`, que **sólo** lo agrega a `db_datareader`. **El script nunca se ha
ejecutado**: crear un login es escribir en el servidor del POS, y la única instancia a la
mano es la de desarrollo con SR (lo decide Ricardo de día, F1-020b).

> **Lo que se vio en la instalación local de desarrollo (F1-026, 2026-09-21).** ✅ VALIDADO
> sólo para esa instalación, con una consulta de catálogo de solo lectura (`WITH (NOLOCK)`,
> `sqlcmd -t 10`, login sysadmin de Windows), sin tocar datos:
>
> ```sql
> SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int) AS solo_windows;
> SELECT p.permission_name, p.state_desc, p.class_desc, COUNT(*) AS n
> FROM sys.database_permissions AS p WITH (NOLOCK)
> JOIN sys.database_principals AS g WITH (NOLOCK) ON g.principal_id = p.grantee_principal_id
> WHERE g.name = N'public'
> GROUP BY p.permission_name, p.state_desc, p.class_desc;
> SELECT name, type_desc FROM sys.database_principals WITH (NOLOCK)
> WHERE type IN ('S','U','G') AND principal_id > 4;
> SELECT COUNT(*) FROM sys.procedures WITH (NOLOCK);
> ```
>
> - **Modo mixto** (`IsIntegratedSecurityOnly = 0`): un login SQL como `monitor_lector`
>   puede entrar sin tocar la configuración del servidor.
> - **`public` sólo tiene `SELECT` (GRANT) sobre 140 objetos** de `softrestaurant10`; ningún
>   INSERT/UPDATE/DELETE/EXECUTE/ALTER. O sea: con `db_datareader` y nada más, el lector no
>   hereda escritura por `public`. No se miró qué son esos 140 objetos.
> - La base no tiene usuarios propios (SQL, Windows ni grupos) además de los de sistema.
> - 6 procedimientos almacenados en la base.
> - **`sqlcmd` de SQL 2014** (el que trae esta instalación, en
>   `C:\Program Files (x86)\Microsoft SQL Server\120\Tools\Binn`): lee bien un `.sql` en UTF-8
>   **con BOM** (sin BOM los acentos salen rotos), y **toma las variables de entorno como
>   variables de script** (`$(BASE_SR)`); si una variable no existe, dice "*scripting variable
>   not defined*", sale con código 1 y no manda el lote. Se probó con un `PRINT`, sin
>   escribir nada.

Supuestos del instalador (⚠️ ninguno visto funcionando):

- ⚠️ **SUPUESTO — el administrador de Windows de la PC es sysadmin del SQL del POS**
  (`sqlcmd -E`). En esta instalación lo es, pero desde SQL 2008 `BUILTIN\Administrators` ya
  no entra como sysadmin por defecto, y en otras instalaciones el único acceso puede ser `sa`
  con una contraseña que tiene el soporte de NationalSoft. Por eso
  `crear-usuario-lector.ps1 -UsuarioAdmin sa` (pide la contraseña sin mostrarla y la pasa por
  `SQLCMDPASSWORD`). `sa` sólo se usa para crear el lector, **nunca** va en `config.json`.
- ⚠️ **SUPUESTO — `sqlcmd` viene con el SQL Express de SR.** En la instalación vista sí. Si
  falta, el script da la alternativa con SSMS en modo SQLCMD.
- ⚠️ **SUPUESTO — con `db_datareader` alcanza** para `sys.tables`, `parametros2` y las tablas
  de cuentas (§1). Igual que en §1: nunca se ha corrido con un usuario así.
- ⚠️ **SUPUESTO — SR puede ir sobre un SQL 2008/2008 R2.** Por eso el T-SQL usa
  `sp_addrolemember` y no `ALTER ROLE ... ADD MEMBER` (2012+), no usa `IS_ROLEMEMBER` (2012+),
  y la guardia de los tests lo parsea con el parser de SQL 2008.
- ⚠️ **SUPUESTO — cambiar el modo de autenticación no es opción** (reinicia el SQL del POS =
  la caja no cobra). Si un servidor es "sólo Windows", el script se detiene sin cambiar nada
  y manda a soporte.
- ❓ **DECISIÓN ABIERTA para Ricardo — `db_denydatawriter`.** Agregar al lector a
  `db_denydatawriter` le negaría escritura aunque `public` la tuviera en otra instalación. No
  otorga nada, pero el backlog pide literalmente "sólo `db_datareader`" y en la instalación
  vista `public` no escribe, así que no se agregó. El script sí **avisa** (sin abortar) si
  `public` tiene INSERT/UPDATE/DELETE/EXECUTE/ALTER/CONTROL.

---

## 12. Rarezas

> El cajón de lo que no encaja en ninguna sección de arriba y le va a costar una tarde a
> alguien si no está escrito: columnas mal nombradas, fechas en formatos distintos entre
> tablas, valores centinela, campos que la interfaz muestra pero la base no guarda.

- **`versiondb` está en tres tablas y sólo una sirve** (F1-021, ✅ SR 10):
  - `parametros2.versiondb` es la versión (`10.021800`);
  - `configuracion.versiondb` vale NULL;
  - `parametros.versiondb` vale `'0'`.
  
  Detalle en §1.
- **En la instalación vista, los nombres de tablas y columnas están en minúsculas**, y la
  base es CI (`Modern_Spanish_CI_AS`). Dentro de SQL no importa, pero **el agente compara
  EXACTO los nombres que le devuelve el catálogo** (`HuellaSr.Desde`).
  ⚠️ No se ha visto ninguna instalación con collation CS ni con otras mayúsculas. Si
  aparece una, la detección la reporta como "faltan tablas" y no la lee a ciegas.
- **Hay identificadores que no son ASCII**, por ejemplo la columna
  `configuracion.contraseñainventarios`, con eñe. El agente no la lee. Queda anotado para
  cuando alguna query tenga que nombrar una columna así: el `.sql` embebido es UTF-8.

---

## 13. Contrato de ingesta: lo que el API (F1-031) supone de SR

> `POST /ingesta/eventos` es la única frontera entre el agente y el api. El agente
> **traduce** lo que lee de SR a este contrato (lo define `api/src/ingesta/dto/ingesta.dto.ts`
> y lo publica `api/openapi.json`). Nada de aquí se ha visto en una instalación real: son
> supuestos que F1-022/F1-023 tienen que cumplir al leer SR, y que F1-090 valida.

- ⚠️ **SUPUESTO — SR guarda las fechas en hora local de la sucursal, sin zona.** El API
  **rechaza** cualquier fecha sin zona (`Z` u offset `±hh:mm`): el agente tiene que
  convertir la hora local de SR a un instante con zona usando `Sucursal.zona_horaria`
  (la que devuelve `GET /agente/yo`). Ojo con el cambio de horario: México ya no lo usa,
  pero una hora local ambigua sólo la puede resolver el agente, que sabe de qué sucursal es.
  Se guardan milisegundos; lo que venga más fino (.NET manda 7 decimales) se trunca.
- ⚠️ **SUPUESTO — los importes de SR llevan hasta 4 decimales** (`money`, §3). El contrato
  pide **texto decimal** (`"125.50"`, nunca número JSON) con hasta 10 enteros y 4
  decimales. El API redondea a 2 **mitad lejos de cero** (el mismo redondeo de NUMERIC en
  Postgres) antes de guardar. Un importe que al redondear ya no cabe en NUMERIC(12,2)
  (`9999999999.9999`) se rechaza con `reintentable: false`. El precio de los
  modificadores sigue la misma regla.
- ⚠️ **SUPUESTO — las cantidades caben en NUMERIC(12,3)**: hasta 9 enteros y 3 decimales,
  en texto. No se redondean; más decimales se rechazan.
- ⚠️ **SUPUESTO — un modificador de SR se reduce a `{ nombre, precio }`**, incluidos los de
  $0.00. Si en SR resulta tener más estructura (cantidad, grupo, modificador de
  modificador), el contrato cambia en la tarea que lo descubra y se amplía aquí. El panel de
  mesas (F1-051) ya **lee** modificadores anidados en el snapshot (§5), que el API no
  valida; el contrato de cheques cerrados sigue plano y es decisión abierta (§3).
- `DECISION PROVISIONAL (nocturno)` — **la forma de pago se guarda como `otro`** siempre
  (`api/src/ingesta/normalizar.ts#derivarFormaPago`). Sin catálogo de ninguna instalación
  (§4), adivinar por el texto metería errores silenciosos en el desglose. El texto crudo
  queda en `forma_raw`. F1-032 deriva el ENUM **al leer** con el catálogo
  `formas_pago_catalogo` (§4); la columna `forma` guardada no la usa ningún agregado.
- ⚠️ **SUPUESTO — la forma de una mesa en el snapshot todavía no se conoce** (§5, F1-023
  bloqueada por F1-090). El API sólo exige `mesas: object[]` y guarda `{ mesas }` en el
  `payload` tal cual, sin validar lo de adentro. F1-050 fijó la forma **provisional** que lee
  el panel (§5). Sigue siendo supuesto: F1-023 la confirma o la cambia al ver SR, y en ese
  momento decide si el API la valida.
- ❓ **Recordatorio de la DECISIÓN ABIERTA de §2 (folios reiniciados).** F1-031 dejó
  implementado el upsert por `(sucursal_id, folio_sr)`: si SR reinicia folios, un cheque
  nuevo **pisa en silencio** a uno viejo con el mismo `folio_sr`. Sigue sin resolverse y
  es lo primero que hay que mirar en F1-090.


### Contrato de catálogos (F2-230): `POST /ingesta/catalogos`, `/cierre` y `GET /solicitud`

Lo define `api/src/ingesta/dto/catalogos.dto.ts` y lo publica `api/openapi.json`. Lo que F2-240 tiene
que cumplir al leer SR:

- **Una sincronización = un `sincronizacionId` (uuid del agente) + un `capturadoAt`** = el instante
  en que EMPEZÓ la lectura de ese catálogo. **Todas** sus páginas (1–1000 registros) y su cierre
  repiten el mismo par. Sin cierre, la sincronización es incremental: actualiza y no da de baja nada.
- **El agente no intercala dos sincronizaciones del mismo catálogo** (una incremental espera al
  cierre de la completa). Si lo hace, la fila que toque la más nueva deja de contar para la vieja y
  su cierre responde 409 para siempre: hay que abandonarla y abrir otra.
- **El cierre cuadra antes de dar de baja:** filas vistas por esa sincronización + `rechazados`
  (la suma de `rechazadosSinFila` de sus páginas) >= `total`. Si no, **409 y no se da de baja
  nada** (faltan páginas). El API confía en el `rechazados` del agente (sólo exige
  `0 <= rechazados <= total`): uno inflado dejaría pasar un cierre con páginas perdidas.
- `DECISION PROVISIONAL (nocturno)` — **`total = 0` da de baja todo el catálogo**
  (`catalogos-ingesta.service.ts#cierre`). Es el caso "el POS no usa clientes". Riesgo: un agente
  que se trague un error de lectura y reporte cero deja el catálogo inactivo en el panel hasta la
  siguiente sincronización (no se borra nada).
- **Nada se borra**: desaparecer deja `activo=false` con el último `visto_at`. Reaparecer reactiva la
  MISMA fila.
- **`capturadoAt` > 5 min en el futuro = 400.** Un reloj del agente adelantado congelaría
  `visto_at`. Uno que se corrige **hacia atrás** hace que sus páginas salgan en `obsoletos` hasta
  alcanzar la última sincronización completa aplicada: F2-240 debe registrarlo en su log.
- **Un registro inválido se rechaza solo** (`rechazados[]` con índice, `origenSrId` si era válido y
  motivo SIN el valor). Un `origenSrId` repetido en la página se rechaza en todas sus apariciones.
- **Errores:** 409 = no cuadra (reintentar tras completar); 503 = transitorio o candado del catálogo
  ocupado (reintentar igual); 500 = determinista (**no** reintentar igual).
- **`precio` del producto (F2-145):** texto decimal con la regla de DINERO de `/ingesta/eventos`
  (hasta 10 enteros y 4 decimales; se redondea a 2 mitad lejos de cero ANTES del hash, así que "89",
  "89.0000" y "89.00" son el mismo contenido, y "-0.001" es "0.00"). Uno que no cabe en NUMERIC(12,2)
  rechaza sólo ese registro. **Omitirlo lo guarda nulo, también en una página incremental**: el
  agente (F2-240) manda SIEMPRE el precio que lee, o una incremental borra precios.
- **Cambio de hash por la llave nueva `precio` (F2-145):** el contenido de un producto ahora incluye
  `precio`, así que cada fila guardada antes de F2-145 tiene un hash distinto y **la primera
  sincronización tras el deploy la reescribe una vez** (mueve su `updated_at`); el siguiente reenvío
  ya no cambia nada (lo fija `menu.e2e.spec.ts`). Sin instalaciones leyendo catálogos todavía, no
  afecta a nadie.
- **Forzado manual:** `GET /ingesta/catalogos/solicitud` → `pendiente=true` mientras algún catálogo
  de los **once** (los seis de F2-230 y los cinco de inventario de F2-120, §9) no haya **recibido**
  un cierre (reloj del API) después de la solicitud. Un agente que todavía no lea inventario (F2-240
  sin F2-241) la deja pendiente: **no debe cerrar esos cinco con `total = 0` para apagarla** (eso
  da de baja todo lo que haya) y **no debe ciclarse** resincronizando mientras siga pendiente;
  atiende cada `solicitadaAt` una vez (lo recuerda en su SQLite). Un cierre
  tomado antes pero recibido después la da por atendida (desfase de relojes aceptado).

### Contrato de existencias (F2-121): `POST /ingesta/existencias`

Foto completa de un almacén por petición; todos sus supuestos y decisiones están en §10. Lo que
F2-241 tiene que cumplir: mandar TODAS las filas del almacén (también en 0 y negativas), el costo
promedio en texto con la regla de dinero, y una foto por almacén; no mandar fotos de más de 5000
registros; y no reportar un almacén vacío si la lectura falló.

### Contrato de movimientos (F2-122): `POST /ingesta/movimientos`

Lote de pólizas con todas sus partidas; todos sus supuestos y decisiones están en §10. Lo que F2-241
tiene que cumplir: mandar cada póliza con TODAS sus partidas (una reenviada con otras las reemplaza),
cantidades con signo, `cancelada = true` en vez de dejar de mandarla, `leidoAt` = cuándo leyó, a lo
más 200 pólizas y 5000 partidas por lote, y el tipo traducido más el crudo en `tipoSr`.

### Campo nuevo del contrato de eventos (F2-233): `datos.areaOrigenSrId` del cheque

- Opcional, texto de hasta 64. ⚠️ **SUPUESTO NO VALIDADO** (§2): es el mismo `origenSrId` que el
  catálogo de áreas de esa sucursal. **El campo existe y hoy nadie lo manda**: no hay lector de
  cheques (F1-022, bloqueada por F1-090). Mientras tanto, en una instalación real toda la venta
  sale "sin clasificar" en Áreas y canales; la vista lo dice.
- Mismas reglas que `clienteOrigenSrId`: tal cual; nulo, ausente o sólo espacios = sin área;
  **omitirlo lo guarda nulo** (el cheque viaja completo); entra en la forma canónica
  (`canonico.ts`): cambiarla reescribe el cheque y reenviar lo mismo no toca nada; los cheques de
  antes de F2-233 tienen nulo y un reenvío sin el campo sigue siendo idéntico; uno de más de 64
  rechaza sólo ese evento, con un motivo que no repite el valor.

### Campo nuevo del contrato de eventos (F2-232): `datos.clienteOrigenSrId` del cheque

- Opcional, texto de hasta 64. ⚠️ **SUPUESTO NO VALIDADO** (§2): es el mismo `origenSrId` que el
  catálogo de clientes de esa sucursal. **Hoy ningún agente lo manda**: no hay lector de cheques
  (F1-022 está bloqueada por F1-090); cuando exista, lo manda si SR lo trae.
- Se guarda TAL CUAL (el catálogo tampoco recorta `origenSrId`); nulo, ausente o sólo espacios =
  sin cliente. **Omitirlo lo guarda nulo**: el cheque viaja completo cada vez, así que un reenvío
  sin el campo le quita el cliente (igual que `mesero`).
- Entra en la forma canónica del cheque (`canonico.ts`): cambiar el cliente es un cambio y el
  reenvío lo reescribe; reenviar lo mismo no toca nada. Los cheques guardados antes de F2-232 tienen
  nulo y un reenvío sin el campo sigue siendo idéntico (no hay reescritura masiva).
- Uno de más de 64 rechaza sólo ese evento (`rechazados[]`), con un motivo que no repite el valor.

---

## Instalaciones contra las que se ha validado

| Fecha | Versión SR | Restaurante / entorno | Qué se validó |
|---|---|---|---|
| 2026-09-21 | 10 (exe 10.0.323, `versiondb` 10.021800) | Instalación local de desarrollo (SQL Server 2014 SP1 Express, instancia `.\NATIONALSOFT`). Sin datos de negocio: sólo catálogo y la columna de versión. Login sysadmin (no es config de producción) | Detección de versión y elección del reader (F1-021); conexión, certificado y TLS; `diagnostico.sql` (§1, §11, §12). Modo mixto, permisos de `public` y comportamiento de `sqlcmd` 2014 (F1-026, §11). **No** valida el mapeo de cuentas, pagos ni productos: eso es F1-090. |
