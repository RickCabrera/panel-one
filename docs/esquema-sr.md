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

---

## 3. Partidas de cuentas cerradas

> Alimenta a `F1-022`. Producto, cantidad, precio, modificadores.

**Tablas:** _(pendiente — tipo `cheqdet`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Cómo se representan los modificadores:** _(pendiente — incluidos los de $0.00, que sí se
muestran en el detalle)_

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

**Cuentas con pago mixto:** _(pendiente — cómo se reparten los montos)_

---

## 5. Cuentas abiertas (mesas en vivo)

> Alimenta a `F1-023` y al monitor de mesas.

**Tablas:** _(pendiente — tipo `tempcheques` / `tempcheqdet`)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Cómo se sabe si la cuenta ya se imprimió:** _(pendiente — KPI "cuentas sin imprimir")_

**Qué pasa con la fila al cerrar la cuenta:** _(pendiente — ¿se borra, se marca?)_

---

## 6. Productos y catálogo

> Alimenta a `F1-032` (top productos) y a `F2-145`.

**Tablas:** _(pendiente)_

| Columna | Tipo | Qué es de verdad | Estado |
|---|---|---|---|
| | | | |

**Productos vendidos que no están en catálogo:** _(pendiente — si pasa, y cómo se ven)_

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

## Instalaciones contra las que se ha validado

| Fecha | Versión SR | Restaurante / entorno | Qué se validó |
|---|---|---|---|
| | | | |
