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
esto sólo se probó con respuestas falsas. Código: `web/src/paginas/inicio/ventaEnVivo.ts`.
La edad que muestra la tarjeta es `edadRecepcionSegundos` (reloj del servidor).

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
- **Diferencia conocida con el Panel (no es un error de cuadre):** la tarjeta "Venta en
  vivo" de Inicio (F1-041) suma **todas** las sucursales que tienen snapshot, también las
  desconectadas. El Monitor excluye las desconectadas. Con una sucursal desconectada, las
  dos cifras no coinciden. Queda anotado para F1-092.
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
- El seed de desarrollo `api/prisma/seed-mesas.ts` (`npm run seed:mesas`) genera snapshots
  **sintéticos** con esta forma: la sucursal Centro en vivo y la Norte desconectada hace 2 h.
  Marca los suyos con `payload.origen = 'seed'` y sólo borra ésos.

---

## 6. Productos y catálogo

> Alimenta a `F1-032` (top productos) y a `F2-145`.

**Tablas:** _(pendiente)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Productos vendidos que no están en catálogo:** _(pendiente — si pasa, y cómo se ven)_

**Lo que el top de productos (F1-032) supone:** ⚠️ **SUPUESTO — el nombre del producto es
estable.** El contrato de ingesta no trae un id de producto de SR, así que el top agrupa por
`cheque_partidas.producto` (texto). Si SR renombra un producto, aparece como dos. Su `importe`
es la suma de `partidas.total`, **antes** del descuento del cheque: no cuadra con la venta total
y no debe compararse con ella.

---

## 7. Meseros y usuarios del POS

> Alimenta a `F1-022`, `F1-023` y al monitor.

**Tablas:** _(pendiente)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

---

## 8. Áreas, estaciones y canales de venta

> Alimenta a `F2-144`. **Spike pendiente:** hay que ver si esta instalación distingue
> comedor / mostrador / domicilio / plataformas, y por qué campo.

_(pendiente)_

---

## 9. Inventario — catálogos (Fase 2)

> Alimenta a `F2-120`. Insumos, grupos de insumos, unidades, almacenes, presentaciones,
> productos-receta.

_(pendiente — no se toca hasta que F1-091 cierre)_

---

## 10. Inventario — existencias, movimientos y recetas (Fase 2)

> Alimenta a `F2-121`, `F2-122`, `F2-125` y `F2-126`. Existencias por almacén con costo
> promedio, movimientos con referencia a póliza, explosión de insumos por producto,
> compras.

_(pendiente — no se toca hasta que F1-091 cierre)_

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

---

## Instalaciones contra las que se ha validado

| Fecha | Versión SR | Restaurante / entorno | Qué se validó |
|---|---|---|---|
| 2026-09-21 | 10 (exe 10.0.323, `versiondb` 10.021800) | Instalación local de desarrollo (SQL Server 2014 SP1 Express, instancia `.\NATIONALSOFT`). Sin datos de negocio: sólo catálogo y la columna de versión. Login sysadmin (no es config de producción) | Detección de versión y elección del reader (F1-021); conexión, certificado y TLS; `diagnostico.sql` (§1, §11, §12). Modo mixto, permisos de `public` y comportamiento de `sqlcmd` 2014 (F1-026, §11). **No** valida el mapeo de cuentas, pagos ni productos: eso es F1-090. |
