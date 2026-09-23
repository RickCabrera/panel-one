# Delivery y canales de venta — spike de F2-144

> **Estado:** spike hecho de noche (F2-144), **sin instalación real a la vista**. Todo lo que
> aquí dice "se sabe" sale del contrato, del código y de `docs/esquema-sr.md` §8; lo que dice
> "falta ver" es lo que tiene que responder F2-192 (validar lectores contra SoftRestaurant) o
> F2-240 (lector de catálogos) en una sucursal de verdad. Lo del POS vive en `esquema-sr.md` §8;
> este documento es la decisión de **alcance** del módulo.

## 1. La pregunta

"Arkhon Delivery" muestra la venta partida por canal (comedor, mostrador, domicilio, plataformas)
con su mezcla y su comparativo. Para dar lo mismo hay que saber **qué dato del POS dice por qué
canal entró cada cuenta**. El backlog pedía abrir con un spike que lo averiguara y decidiera el
alcance antes de construir.

## 2. Lo que se sabe hoy

| Hecho | De dónde | Consecuencia |
|---|---|---|
| El contrato de ingesta trae el **área** de la cuenta (`datos.areaOrigenSrId`) y `cheques.area_origen_sr_id` la guarda. | F2-233, esquema-sr §2 y §13 | Hay una llave por cuenta sobre la cual colgar el canal. |
| **Ni tipo de servicio ni canal viajan en la cuenta.** | Contrato de eventos (`ingesta.dto.ts`) | El canal no se puede leer del POS por cuenta; se deriva. |
| Existe un espejo de "canales / tipos de servicio" del POS (`canales_venta_catalogo`), pero **no hay cruce** cuenta ↔ tipo de servicio. | F2-230, esquema-sr §8 | Ese catálogo no interviene en ninguna cifra. |
| El canal de negocio es **nuestro**: sale del mapeo área → canal (`areas_canal`), se aplica al leer y sobrevive los re-sync. | F2-233 | Cambiar el mapeo recalcula cualquier periodo sin re-ingerir. |
| `GET /ventas/por-area` ya da la venta por canal con "área sin canal" y "sin clasificar" aparte, y Σ = `/ventas/resumen`. Acepta `alturaAl`. | F2-233 | La vista de canales no necesita endpoint ni SQL nuevo. |
| **Hoy ningún agente manda el área** (no hay lector de cuentas, F1-022). | esquema-sr §2 y §13 | En una instalación real, hoy, TODA la venta sale "sin clasificar" y la vista lo explica. |
| El seed reparte las cuentas en tres canales (comedor, mostrador, domicilio) por área, con ~3 % sin área. No siembra "plataformas". | `api/prisma/seed-maestro/catalogos.ts` | Con el seed la vista se ve completa salvo plataformas, que no sale porque no tiene cuentas. |

## 3. Lo que falta ver en una instalación real

Checklist para quien tenga delante la SoftRestaurant del piloto (F2-192 / F2-240). Cada respuesta
va a `esquema-sr.md` §8, no aquí.

1. **¿La cuenta trae el área donde se atendió, y con qué id?** ¿Es el mismo id del catálogo de
   áreas? (Supuesto no validado de F2-233.) Si no la trae, todo el módulo queda "sin clasificar".
2. **¿El POS distingue el tipo de servicio por cuenta** (comedor / para llevar / a domicilio)?
   ¿En qué campo? ¿Es independiente del área o es lo mismo con otro nombre? Si existe y es
   confiable, es mejor fuente que el mapeo de área, y el mapeo pasa a ser el respaldo.
3. **¿Cómo se registran las plataformas (Rappi, Uber Eats, DiDi Food)?** Opciones a comprobar:
   un área propia, un tipo de servicio, una forma de pago, un "cliente" genérico o una mezcla.
   De eso depende si "plataformas" sale del mapeo de áreas o necesita otra regla.
4. **¿El domicilio propio y el de plataforma se distinguen?** Si comparten área, el mapeo no los
   separa y hace falta el dato del punto 2 o 3.
5. **Comisión de la plataforma:** ¿el POS la registra (descuento, forma de pago, nada)? Hoy la
   vista muestra venta bruta del POS; la venta neta de comisión queda fuera de alcance hasta
   saberlo.
6. **Cuántas áreas tiene un restaurante típico y cuántas sucursales las comparten con el mismo
   nombre.** Es el dato que decide la pregunta abierta 2 de abajo.

## 4. Decisión de alcance (lo que F2-144 construyó)

- **ALCANCE RECORTADO: sin ingesta nueva ni endpoint nuevo.** La ficha original pedía "ingesta
  de ventas por canal". No se construyó porque no hay nada nuevo que ingerir: el único dato de
  canal que puede traer una cuenta es su área, que el contrato ya acepta desde F2-233, y hoy
  ningún agente la manda (en una instalación real todo sale "sin clasificar"). Inventar un campo
  de "tipo de servicio" en el contrato sin haberlo visto en el POS sería adivinar (§3, punto 2).
  La venta por canal sale de `GET /ventas/por-area` (F2-233), por el helper de scope, con la
  misma cifra total que `/ventas/resumen`.
- **Vista `/canales` "Ventas por canal"** (menú Canales): periodo A = el de la cabecera, periodo
  B con el mismo selector de Comparativos (comparable / mes anterior / otro rango, con el corte
  "a la misma altura" cuando toca). Por canal: venta, mezcla (% de la venta del periodo),
  cuentas y ticket promedio de A; venta y mezcla de B; Δ de venta ($ y %) y Δ de mezcla en
  puntos porcentuales. "Área sin canal asignado" y "Sin clasificar" van como renglones propios,
  la fila de total es la venta del periodo y la vista afirma el cuadre (Σ filas = venta).
- **Sólo lectura.** El canal de cada área se cambia en Catálogos → Áreas y canales (`/areas`).
- **Estados vacíos honestos:** periodo sin cuentas, todo sin clasificar (el agente no manda el
  área), sucursal sin catálogo de áreas, periodo B sin cuentas ("—", sin Δ).
- **Fuera de alcance:** comisiones de plataforma, tiempos de entrega, repartidores, estatus de
  pedidos, integración directa con las plataformas. Nada de eso existe en el contrato.

## 5. ❓ Las dos decisiones SIGUEN ABIERTAS para Ricardo

El backlog pedía que el spike las cerrara. **No las cierra: las aplaza.** Sin una instalación
real no hay dato para decidir, así que de noche se tomó la opción más conservadora —**no cambiar
la forma que ya existe** y construir encima de ella— y cada una queda como ❓ abierta **y** con
`DECISION PROVISIONAL (nocturno)` aquí, en `esquema-sr.md` §8, en el enum de `schema.prisma` y
en `web/src/paginas/Canales.tsx`. La vista no depende de cómo se decidan.

1. **El conjunto de canales.** Queda el enum fijo de Postgres (`canal_negocio`: comedor,
   mostrador, domicilio, plataformas). Agregar uno ("para llevar", "eventos") es una migración
   de una línea (`ALTER TYPE canal_negocio ADD VALUE …`) más su nombre en
   `web/src/paginas/areas/reglas.ts` (`CANALES`, `NOMBRE_CANAL`) y en `ORDEN_CANALES` del api;
   la vista de canales no cambia. Pasar a un catálogo configurable por empresa sólo vale la pena
   si el piloto muestra canales que no caben en los cuatro.
2. **Mapeo por sucursal o por empresa.** Queda por área de CADA sucursal (el espejo es por
   sucursal y el mismo nombre puede significar cosas distintas en dos locales). Una empresa con
   10 sucursales mapea "Terraza" 10 veces. Si el piloto muestra que eso estorba, la salida más
   barata es un botón "copiar el mapeo de esta sucursal a las demás por nombre" que escriba las
   mismas filas de `areas_canal` (sigue siendo por sucursal, sin regla nueva de cálculo), no un
   mapeo por nombre a nivel empresa que se aplique al leer.

Si el punto 2 de §3 resulta en que el POS sí trae el tipo de servicio por cuenta, **las dos
preguntas cambian**: el canal podría salir de ese dato y el mapeo de áreas quedaría de respaldo.
Eso es una tarea nueva, con su contrato.
