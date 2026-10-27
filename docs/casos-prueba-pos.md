# Casos de prueba capturados en el POS

> Hoja que se llena **a mano mientras se capturan ventas en SoftRestaurant**. Es la verdad
> contra la que se valida `F1-090`: lo que el agente lea de la base y lo que muestre el panel
> tiene que cuadrar **peso a peso** con lo anotado aquí y con el Monitor de ventas de SR.
>
> Base: `softrestaurant10` en `.\NATIONALSOFT` (SR 10, empresa demo, sólo productos). Datos de
> prueba, ningún cliente real. **No anotar aquí contraseñas ni cadenas de conexión.**
>
> La preparación (respaldo, usuario lector y captura de Extended Events) está en
> `docs/preparacion-f1-090.md`.

## Antes de empezar

| Dato | Valor |
|---|---|
| Fecha de la captura | |
| Hora del reloj de la PC al empezar (y zona horaria de Windows) | |
| Versión de SR (`parametros2.versiondb`) | |
| Respaldo `.bak` "antes" (nombre y hora) | |
| ¿Los precios del catálogo incluyen IVA? (lo que diga la configuración de SR) | |
| Último folio que existía antes de empezar (si había alguno) | |
| Sesión de Extended Events arrancada (hora, con segundos) | |
| Meseros del POS que se van a usar (al menos dos) | |
| Áreas del restaurante que existen en el POS | |
| Tipos de servicio que existen en el POS (nombre exacto de cada uno) | |
| Formas de pago que existen en el POS (nombre exacto de cada una) | |
| Estación / caja | |

## Reglas de captura

1. **Un caso a la vez y en el orden de la tabla.** Deja pasar al menos 2 minutos entre un caso
   y el siguiente: es lo que permite saber qué sentencias de la captura de Extended Events
   corresponden a cada caso.
2. **Anota la hora del reloj de la PC, con segundos**, no la del celular. Es la hora en que
   diste el último clic del caso (cobrar, cancelar, etc.).
3. **Si te equivocas, no lo arregles en el POS.** Anota lo que pasó de verdad en "Desviaciones"
   y sigue. Un error anotado es un caso más; uno corregido en silencio descuadra todo.
4. **Si el POS no deja hacer un caso** (no existe la opción, pide un permiso), anótalo como
   "no se pudo" con el mensaje exacto. También es un hallazgo.
5. **Usa montos que no se repitan** entre casos cuando se pueda: un total único se encuentra
   en la base a la primera.
6. **Imprime o fotografía cada ticket** y guárdalo con el nº de caso.
7. La columna **"Monitor de ventas de SR"** se llena al final (caso B7), leyendo el Monitor y
   no de memoria: el **total que muestra para ese folio y su estatus** (pagada, cancelada,
   abierta), o "no aparece".
8. Salvo que el caso diga otra cosa: mesero 1, área principal, servicio de mesa.

## Turno A — termina con corte CERRADO

| Nº | Qué hacer en el POS | Hora | Folio | Total | Forma de pago | Monitor de ventas de SR |
|---|---|---|---|---|---|---|
| A0 | Abrir turno (anotar el fondo inicial de caja en "Total") | | — | | — | |
| A1 | Mesa 1, 2 comensales, 1 producto sin modificadores. Cobrar en **efectivo, pago exacto** | | | | Efectivo | |
| A2 | Mesa 2, **2 piezas del mismo producto** más 1 producto distinto. Cobrar en **efectivo con cambio** (pagar con un billete mayor) | | | | Efectivo | |
| A3 | Mesa 3, 2 productos. Cobrar con **tarjeta**, sin propina | | | | Tarjeta | |
| A4 | Mesa 4, 3 productos. Pago **mixto**: una parte en efectivo y otra con tarjeta | | | | Efectivo + tarjeta | |
| A5 | Mesa 5, 2 productos. **Descuento en % a toda la cuenta** (anotar el % y el motivo). Efectivo | | | | Efectivo | |
| A6 | Mesa 6, 2 productos. **Descuento a UN solo producto** (anotar cuál y cuánto). Efectivo | | | | Efectivo | |
| A7 | Mesa 7, 2 productos. **Cortesía de UN producto**; el otro se cobra en efectivo | | | | Efectivo | |
| A8 | Mesa 8, 1 producto. **Cortesía de la cuenta completa** (total a pagar 0) | | | | Cortesía | |
| A9 | Mesa 9, 2 productos. Tarjeta **con propina en la tarjeta** | | | | Tarjeta | |
| A10 | Mesa 10, 1 producto. Efectivo **con propina en efectivo**, si el POS deja registrarla | | | | Efectivo | |
| A11 | Mesa 11, 3 productos. **Cancelar UN producto** ya capturado (anotar cuál y el motivo). Cobrar el resto en efectivo | | | | Efectivo | |
| A12 | Mesa 12, 2 productos. **Cancelar la cuenta completa ANTES de cobrar** (anotar el motivo) | | | | — | |
| A13a | Mesa 13, 1 producto. Cobrar en efectivo | | | | Efectivo | |
| A13b | **Cancelar la cuenta YA COBRADA** de A13a (anotar si conserva el folio) | | | | — | |
| A14a | Mesa 14, 1 producto. Cobrar en efectivo | | | | Efectivo | |
| A14b | **Reabrir la cuenta** de A14a y agregar 1 producto (anotar si conserva el folio) | | | | — | |
| A14c | **Volver a cobrar** la cuenta reabierta, en efectivo (anotar el folio y el total nuevos) | | | | Efectivo | |
| A15 | Mesa 15, 4 productos, 2 comensales. **Dividir la cuenta en dos**: una parte en efectivo y la otra con tarjeta (anotar ambos folios y ambos totales) | | | | Efectivo / tarjeta | |
| A16 | Mesa 16, 2 productos. **Cambiar la cuenta a la mesa 17** y cobrar ahí en efectivo | | | | Efectivo | |
| A17 | Mesa 18, 1 producto **con modificadores**: uno sin costo y, si hay, uno con costo. Si el POS tiene modificadores **dentro de otro modificador**, usar uno. Efectivo | | | | Efectivo | |
| A18 | Venta que **no es de mesa**: **un caso por cada tipo de servicio** que tenga el POS (para llevar, rápido, domicilio…). Agregar filas A18b, A18c si hay más de uno. Efectivo | | | | Efectivo | |
| A19 | Mesa en una **segunda área** (terraza, barra…), atendida por el **mesero 2**, 2 productos. Efectivo | | | | Efectivo | |
| A20 | Mesa 19 abierta por el mesero 1, 1 producto. **Cambiar el mesero de la cuenta** al mesero 2 y cobrar en efectivo | | | | Efectivo | |
| A21 | Mesa 20, 1 producto. Cobrar con una **tercera forma de pago** si el POS la tiene (vales, transferencia, crédito…). Anotar su nombre exacto | | | | | |
| A22 | **Corte de turno (CERRADO).** Guardar el reporte de corte impreso o en PDF | | — | | — | |

## Turno B — se queda con corte ABIERTO

| Nº | Qué hacer en el POS | Hora | Folio | Total | Forma de pago | Monitor de ventas de SR |
|---|---|---|---|---|---|---|
| B0 | Abrir turno nuevo (anotar el fondo inicial en "Total") | | — | | — | |
| B1 | Mesa 1, 1 producto. Cobrar en efectivo (primera venta del turno nuevo: **fijarse si el folio sigue la numeración del turno A o reinicia**) | | | | Efectivo | |
| B2 | Mesa 2, 2 productos. Cobrar con tarjeta | | | | Tarjeta | |
| B3 | Mesa 21, 3 comensales, 2 productos. **Dejarla ABIERTA, sin imprimir la cuenta.** Anotar si la comanda se mandó o se imprimió | | | | — | |
| B4 | A los 10 minutos, **agregar 1 producto más a la mesa 21** y seguir sin cerrarla. Anotar si esa partida mandó comanda | | | | — | |
| B5 | Mesa 22, 2 productos. **Imprimir la cuenta pero NO cobrarla**; dejarla así | | | | — | |
| B6 | **NO hacer corte.** Anotar la hora en que se terminó de capturar | | — | — | — | |
| B7 | **Abrir el Monitor de ventas de SR**: verlo por día y por cada turno, anotando la hora de cada consulta en "Desviaciones". Llenar con él la última columna de las dos tablas y el "Total esperado del día". **La captura de Extended Events sigue encendida durante este caso** | | — | — | — | |

## Detalle por caso

Lo que no cabe en la tabla de arriba y `F1-090` necesita para ubicar cada columna. Una fila por
folio (A15 ocupa dos; A13 y A14, una por momento). En "Pagos" va **cada pago por separado**:
forma, importe, y en efectivo también lo recibido y el cambio.

| Nº | Mesa | Área | Mesero | Comensales | Hora de apertura | Hora de cierre | Productos (cantidad × nombre @ precio, y sus modificadores) | Subtotal | IVA | Descuento | Propina | Total | Pagos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | | | | | | | | | | | | | |
| A2 | | | | | | | | | | | | | |
| A3 | | | | | | | | | | | | | |
| A4 | | | | | | | | | | | | | |
| A5 | | | | | | | | | | | | | |
| A6 | | | | | | | | | | | | | |
| A7 | | | | | | | | | | | | | |
| A8 | | | | | | | | | | | | | |
| A9 | | | | | | | | | | | | | |
| A10 | | | | | | | | | | | | | |
| A11 | | | | | | | | | | | | | |
| A12 | | | | | | | | | | | | | |
| A13a | | | | | | | | | | | | | |
| A13b | | | | | | | | | | | | | |
| A14a | | | | | | | | | | | | | |
| A14c | | | | | | | | | | | | | |
| A15 (1ª parte) | | | | | | | | | | | | | |
| A15 (2ª parte) | | | | | | | | | | | | | |
| A16 | | | | | | | | | | | | | |
| A17 | | | | | | | | | | | | | |
| A18 | | | | | | | | | | | | | |
| A19 | | | | | | | | | | | | | |
| A20 | | | | | | | | | | | | | |
| A21 | | | | | | | | | | | | | |
| B1 | | | | | | | | | | | | | |
| B2 | | | | | | | | | | | | | |
| B3 / B4 | | | | | | | | | | | | | |
| B5 | | | | | | | | | | | | | |

## Desviaciones

Todo lo que no salió como dice la tabla: errores de captura, casos que el POS no dejó hacer,
mensajes que aparecieron, permisos que pidió. También las horas de las consultas del caso B7.

| Nº de caso | Hora | Qué pasó de verdad |
|---|---|---|
| | | |
| | | |
| | | |

## Total esperado del día

Se calcula **a mano desde las tablas de arriba**, antes de abrir el Monitor de ventas. La
columna de SR se llena después (caso B7); la diferencia tiene que ser 0.00.

| Concepto | Turno A | Turno B | Día | Monitor de ventas de SR | Diferencia |
|---|---|---|---|---|---|
| Nº de cuentas cobradas | | | | | |
| Nº de cuentas canceladas | | | | | |
| Nº de cuentas abiertas al terminar | — | | | | |
| Venta total (sin propina) | | | | | |
| Subtotal (sin IVA) | | | | | |
| IVA | | | | | |
| Efectivo | | | | | |
| Tarjeta | | | | | |
| Otras formas de pago | | | | | |
| Descuentos | | | | | |
| Cortesías | | | | | |
| Propinas | | | | | |
| Importe de productos cancelados | | | | | |
| Importe de cuentas canceladas | | | | | |
| Importe en mesas abiertas | — | | | | |
| Comensales | | | | | |

**Reporte de corte del turno A** (lo que imprime SR): venta ______ · efectivo ______ ·
tarjeta ______ · propinas ______ · descuentos ______ · cancelaciones ______

**Fecha que el Monitor le asigna a cada turno:** turno A ______ · turno B ______
(si la captura cruza la medianoche, anotar a qué día manda SR las cuentas cerradas después).

## Evidencia guardada

| Qué | Dónde quedó |
|---|---|
| Tickets impresos o fotos, por nº de caso | |
| Captura del Monitor de ventas de SR (día completo y por turno) | |
| Reporte de corte del turno A | |
| CSV exportado de la sesión de Extended Events | |
| Respaldo `.bak` "después" | |

> Los respaldos `.bak`, las capturas de Extended Events y las fotos **no entran al repo**.
> Aquí sólo se anota dónde quedaron.
