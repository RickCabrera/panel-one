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
| _(pendiente)_ | | | |

**Query de detección:**

```sql
-- pendiente: F1-021 / F1-090
```

**Diferencias conocidas entre versiones:** _(pendiente)_

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
- El catálogo todavía no tiene CRUD: lo trae F1-060.

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
- Timeout que se quedó como bueno: _(pendiente)_
- Horas pico del restaurante en las que conviene espaciar la lectura: _(pendiente)_

---

## 12. Rarezas

> El cajón de lo que no encaja en ninguna sección de arriba y le va a costar una tarde a
> alguien si no está escrito: columnas mal nombradas, fechas en formatos distintos entre
> tablas, valores centinela, campos que la interfaz muestra pero la base no guarda.

_(pendiente)_

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
  modificador), el contrato cambia en la tarea que lo descubra y se amplía aquí.
- `DECISION PROVISIONAL (nocturno)` — **la forma de pago se guarda como `otro`** siempre
  (`api/src/ingesta/normalizar.ts#derivarFormaPago`). Sin catálogo de ninguna instalación
  (§4), adivinar por el texto metería errores silenciosos en el desglose. El texto crudo
  queda en `forma_raw`. F1-032 deriva el ENUM **al leer** con el catálogo
  `formas_pago_catalogo` (§4); la columna `forma` guardada no la usa ningún agregado.
- ⚠️ **SUPUESTO — la forma de una mesa en el snapshot todavía no se conoce** (§5, F1-023
  bloqueada por F1-090). El API sólo exige `mesas: object[]` y guarda `{ mesas }` en el
  `payload` tal cual, sin validar lo de adentro. F1-023/F1-050 fijan la forma.
- ❓ **Recordatorio de la DECISIÓN ABIERTA de §2 (folios reiniciados).** F1-031 dejó
  implementado el upsert por `(sucursal_id, folio_sr)`: si SR reinicia folios, un cheque
  nuevo **pisa en silencio** a uno viejo con el mismo `folio_sr`. Sigue sin resolverse y
  es lo primero que hay que mirar en F1-090.

---

## Instalaciones contra las que se ha validado

| Fecha | Versión SR | Restaurante / entorno | Qué se validó |
|---|---|---|---|
| | | | |
