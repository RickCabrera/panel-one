# Paridad al cierre de la Ronda 2

Auditoría de F2-250 (23/09/2026). Es lo que hay que leer **antes de enseñar el producto**: qué
se construyó, qué descansa en un supuesto, y qué está esperando el mundo real. Una tabla honesta,
no una lista de deseos. Cada renglón apunta a código o a una tarea del backlog; lo verifica
`node scripts/auditoria/paridad.mjs` (desde la raíz).

## En una pantalla

**Se puede enseñar con confianza (con el seed y `MODO_DEMO=1`):**

- **Ventas y dirección.** Inicio, Resumen ejecutivo, Comparativos, Análisis (mesero, producto,
  hora × día, área, tiempo de mesa), Tickets con filtros y detalle, Monitor de mesas y vista de
  pared, centro de alertas, cabecera "en vivo" con periodo global, modo oscuro. Todo cuadra entre
  vistas con tests que comparan contra cálculo manual sobre el seed.
- **Catálogos.** Productos y orquestador de menú (con la discrepancia de precio entre sucursales),
  meseros con rendimiento, clientes, áreas y canales.
- **Inventario.** Existencias y valuación, movimientos y kardex, conteos físicos, traspasos,
  recetas y consumo teórico, compras, gastos y estado de resultados, proyecciones y sugerido de
  compra. **Todo medido contra el seed**, no contra una operación real.
- **Facturación de punta a punta contra el PAC FALSO**: datos fiscales y CSD, código corto por
  cheque, portal de autofactura, emisión, entrega, tablero, sin ticket y refacturación, global,
  cancelación, folios y conciliación.

**No se debe prometer todavía:**

- **Que lee un SoftRestaurant real.** Los lectores del agente (catálogos, inventario, recetas,
  compras) están escritos y probados con fixtures, pero **nunca han leído una instalación con
  datos**: la SR local está vacía y su login es sysadmin, así que el agente se niega a leer
  (F2-192, F2-193, F1-020b). **El lector de cheques y el de mesas en vivo no existen** (F1-022,
  F1-023, bloqueados por F1-090): hoy las ventas del panel vienen del seed.
- **Que timbra de verdad.** Nada ha tocado el sandbox de Facturama (F2-190).
- **Que manda correos o push de verdad.** Correo y push van contra puertos falsos (F2-191).
- **Que el servicio del agente se instala y se actualiza solo en una PC real.** Probado sólo
  simulado; falta la consola elevada (F1-020b).
- **Que está en producción.** No hay VPS, dominio ni Caddy desplegado (F1-002, F1-003, F1-004).

## Leyenda de estados

| Estado | Qué quiere decir |
|---|---|
| **Construido** | Lógica o vista propia del panel (o del agente), probada con tests. No depende de lo que se lea del POS ni de un servicio externo, y no muestra cifras de venta ni de inventario calculadas. |
| **Contra seed** | Hecho, pero lo que muestra son cifras que **hoy sólo salen del seed**: el agente todavía no manda ventas (F1-022) ni inventario leído de una SR con datos. Los tests cuadran contra cálculo manual sobre el seed; el cuadre con la operación real es de F1-091, F2-192 o F2-193. |
| **Contra puerto falso** | Hecho contra el PAC, el correo o el push FALSO (o con XML/PDF que salen del PAC falso), o contra una **simulación** (administrador de servicios, SQL lento, canal de versiones local). **No es lo mismo que "Construido"**: lo real no se ha tocado. |
| **Supuesto provisional** | Hecho sobre una `DECISION PROVISIONAL (nocturno)` o un supuesto de SR o de Facturama (ver `docs/esquema-sr.md` y su índice de decisiones). |
| **Esperando validación diurna** | Su "Listo cuando" original sólo se mide con el mundo real (F2-190 … F2-194, F1-020b, F1-002). |
| **NO construido** | No existe. La nota dice a dónde fue: una tarea `F3-xxx` (Ronda 3), una decisión `D-xx` para Ricardo, o una Diurna. |

La columna **Dónde** es el punto de entrada del código de esa capacidad (la vista, el servicio o la
clase principal), no la única línea que la implementa. Las tareas `F3-xxx` y las decisiones `D-xx`
están al final de `backlog.md`, en "RONDA 3".

## Hallazgos transversales de la auditoría

- **Siete vistas usan el periodo y la cabecera no les pinta el selector:** `/menu`, `/meseros`,
  `/movimientos`, `/traspasos`, `/recetas`, `/compras`, `/gastos` (no están en
  `VISTAS_CON_PERIODO`, `web/src/filtros/vista.ts`). El periodo sólo se cambia editando la URL.
  Ningún log lo registraba completo → **F3-002**.
- **Revisión visual en navegador real:** sólo F2-203, F2-210, F2-211 y F2-212 se midieron en
  Chrome y a 390 px. Todo lo construido después se verificó con tests, no a ojo → **F3-019**.
- **Cuatro entradas del menú siguen deshabilitadas sin tarea** (`SIN_TAREA` en
  `web/src/layout/menu.ts`): Empresas, Sucursales, Insumos, Grupos de insumos → **D-01**.
- **El agente lee todo dentro del ciclo del heartbeat.** Con SQL o API lentos, el peor caso
  teórico ya ronda 8–9 min sin heartbeat (esquema-sr §11) → **F3-003**.
- **El saldo de folios recorre toda la historia de timbres bajo el candado global** en cada
  reserva; crece sin tope → **F3-004**.
- **Documentación desalineada que se corrigió en esta tarea:** el costo promedio "por almacén"
  (es por insumo y empresa, §9/§10 y la descripción del contrato), la conversión de horas del
  agente (§13 vs §10), la solicitud de cancelación ambigua que "se borra" (§2) y la cuenta del
  servicio "LocalSystem" (§11). Además, 25 decisiones provisionales del código no tenían entrada
  en el esquema: ahora están en §14 y el índice cubre las 164 marcas.

## Salud del repo al cierre

| Revisión | Resultado |
|---|---|
| `npm audit` | **3 altas, que son una sola**: `deepmerge-ts <8` vía `prisma → @prisma/config`, fijada exacta por Prisma (también en la 7.x). `npm audit fix --force` baja `prisma` a 6.12.0 y rompe; un `overrides` no funciona con npm 11. Sólo la usa la CLI de Prisma para fusionar su propia config, en desarrollo. **Aceptada y justificada** en `README.md` ("Notas de dependencias"); se cierra cuando una versión estable de Prisma suba el pin. No se aplicó ningún `audit fix` en esta tarea. |
| Bundle del panel | **346.6 kB gzip, tope 400 kB** (`npm run check:bundle` en `/web`). |
| Tests `/api` | Ver la entrada de F2-250 en `docs/nocturno-log.md` (conteo exacto y cero skips). Se cerraron en esta tarea el rojo local de `prisma/esquema.spec.ts` (FK de `seed:reportes`) y el intermitente de `reportes.e2e` "token alterado" (alteraba el último carácter base64url, que es en parte relleno). |
| Tests `/web` | Ver la entrada del log. Dos tests con espera por defecto fallan **sólo bajo carga concurrente** y pasan en corrida limpia → F3-001. |
| Tests `/agent` | 544/544, 0 omitidos; `dotnet build -c Release` sin advertencias. |
| Skips | Ninguno: búsqueda de `.skip(`, `.only(`, `.todo(`, `xit(`, `skipIf`/`runIf`, `Skip =`, `[Ignore` en los tres carriles, vacía. |
| Contrato OpenAPI | Al día: `openapi.spec.ts` compara el `api/openapi.json` versionado con el que genera el código, y todos los controladores entran (sólo `AppController`, la raíz, está excluido a propósito). Regenerarlo al inicio de F2-250 no dio deriva. |
| `README.md` y `0-INSTALACION.md` | Actualizados en F2-250 para describir el producto que existe al cerrar la ronda. |

## Capacidades por tarea

### Bloque A · Cimientos

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-200** | `npm ci` deja el cliente Prisma generado (postinstall del workspace) | Construido | `api/package.json` | Causa real: cwd raíz del postinstall de @prisma/client, no allowScripts. |
| **F2-200** | Script `seed` agrupado | Construido | `api/package.json` | Hoy encadena 5 seeds (ventas, mesas, alertas, reportes). |
| **F2-200** | `setup:env` copia `.env.example` | Construido | `api/scripts/setup-env.ts` | Además `cargarEnvLocal` (la API no leía `.env`). |
| **F2-200** | Guía PowerShell 5.1 sin `&&` | Construido | `README.md` | README es la fuente; `npm.ps1` bloqueado no se reprodujo. |
| **F2-200** | Test de contrato del postinstall | Construido | `api/scripts/instalacion.spec.ts` | `api/scripts/instalacion.spec.ts`. |
| **F2-200** | `docs/verificacion-arranque.md` con corrida real | Construido | `docs/verificacion-arranque.md` | Corrida en clon limpio. |
| **F2-200** | 3 vulnerabilidades altas | NO construido | `README.md` | `deepmerge-ts` vía prisma; justificado en log F2-200 (ni Prisma 7 lo cierra). → aceptado: sin arreglo estable (ver "Salud del repo") |
| **F2-200** | Migrar a `prisma.config.ts` | NO construido | `README.md` | Rompe carga de `.env` en Prisma 6; log F2-200. → va con la subida a Prisma 7 (README, Notas de dependencias) |
| **F2-201** | Hoy no genera cierres en el futuro; gráfica corta en hora actual | Construido | `api/prisma/seed-ventas.ts` | `OpcionesVentas.ahora` + `datosPorHora(filas, horaTope)`. |
| **F2-201** | 90 días de ventas (1500 cheques) | Construido | `api/prisma/seed-ventas.ts` | — |
| **F2-201** | Catálogo, precio distinto entre sucursales, meseros, clientes, áreas/canales | Construido | `api/prisma/seed-ventas.ts` | Persistidos después por F2-230/145/233. |
| **F2-201** | Insumos, almacenes, existencias bajo mínimo y en cero, pólizas, recetas (2 sin receta), compras y gastos | Construido | `api/prisma/seed-ventas.ts` | Persistidos por F2-120…F2-126. |
| **F2-201** | Determinista e idempotente, < 60 s | Construido | `api/prisma/seed-ventas.ts` | Borra `SEED-%` y recrea (no upsert); 13 s medidos. |
| **F2-201** | "Test por módulo contando filas" | Construido | `api/prisma/seed-ventas.ts` | Primero sobre el universo; cada tarea luego contó filas en base. |
| **F2-202** | `PuertoTimbrado` falso determinista + Facturama | Contra puerto falso | `api/src/adaptadores` | Real sin probar: F2-190. |
| **F2-202** | `PuertoCorreo` falso (tabla `correos_enviados`) + Brevo | Contra puerto falso | `api/src/adaptadores` | Real: F2-191. |
| **F2-202** | `PuertoArchivos` disco con URL firmada | Construido | `api/src/adaptadores` | Volumen/backup reales: F2-191/F1-004. |
| **F2-202** | Arranque aborta con `_IMPL=falso` en producción | Construido | `api/src/adaptadores/config.ts` | Verificado a mano. |
| **F2-202** | Tests de contrato (snapshot) por puerto | Supuesto provisional | `api/src/adaptadores` | Snapshots = supuestos de Facturama/Brevo. |
| **F2-202** | `MODO_DEMO=1`: banda y título "Datos de ejemplo" | Construido | `web/src/sistema/MarcaDemo.tsx` | Vía `GET /sistema`. |
| **F2-203** | Leyenda de formas de pago sin etiquetas repetidas | Construido | `web/src/paginas/inicio/formasPago.ts` | Medido en Chrome a 7 anchos. |
| **F2-203** | Anti-inyección CSV ampliada | Construido | `web/src/csv/csv.ts` | — |
| **F2-203** | Cancelados en Tickets | Construido | `api/src/ventas/tickets.service.ts` | Resuelto en F2-222. |
| **F2-203** | Export "Hoy" en hora pico (corte por recepción) | Supuesto provisional | `api/src/ventas/tickets.service.ts` | Salvedad en esquema-sr §2 "Corte por recepción". |
| **F2-203** | Throttles de login/reset, lint Prisma, `statement_timeout` | Construido | `api/src/auth/throttlers.ts` | Throttle por cuenta NO (log F2-203). → F3-022 |
| **F2-203** | Layout a 390 px | Construido | `web/src/paginas/inicio/Tarjetas.tsx` | Medido en Chrome real; sin test automatizado. → F3-019 |
| **F2-203** | Consola UTF-8 del orquestador | Construido | Orquestador local, fuera del repo (ver F2-203 en `docs/nocturno-log.md`) | — |

### Bloque B · Cascarón

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-210** | Seis secciones con sus entradas | Construido | `web/src/layout/menu.ts` | Se agregaron "Movimientos y kardex" y "Áreas y canales". |
| **F2-210** | Entradas sin módulo deshabilitadas con razón | Construido | `web/src/layout/menu.ts` | Quedan 4 `SIN_TAREA` (ver D-01). → decisión D-01 |
| **F2-210** | Secciones colapsables recordadas por usuario | Construido | `web/src/layout/menu.ts` | localStorage por usuario. |
| **F2-210** | Riel de iconos, teclado, 390 px | Construido | `web/src/layout/menu.ts` | En riel, teclado no ve la razón . → F3-020 |
| **F2-211** | Claro/oscuro/sistema en cabecera | Construido | `web/src/tema/InterruptorTema.tsx` | — |
| **F2-211** | Tokens únicos + lint `tema/sin-colores` | Construido | `web/src/tema` | No detecta colores por nombre. |
| **F2-211** | Contraste 4.5:1 por test sobre la paleta | Construido | `web/src/tema/contraste.ts` | — |
| **F2-211** | Persistencia por usuario | Supuesto provisional | `web/src/tema/tema.ts` | localStorage por navegador, no por cuenta (`tema.ts`). → esquema-sr §14.6 |
| **F2-211** | Sin destello al cargar | NO construido | `web/src/tema` | Necesita hash CSP en Caddy; log F2-211 → F2-250. → F3-023 |
| **F2-212** | Indicador "En vivo · hh:mm · N de M" / "Sin lectura reciente" | Construido | `web/src/layout/OperacionEnVivo.tsx` | Probado con reloj simulado, no con agente real. |
| **F2-212** | Selector único con atajos + rango libre | Construido | `web/src/filtros/SelectorPeriodo.tsx` | — |
| **F2-212** | Periodo y sucursal en la URL, viajan entre vistas | Construido | `web/src/filtros/vista.ts` | 7 vistas con periodo no pintan selector (hallazgo arriba). → F3-002 |
| **F2-212** | Rango invertido explicado y sin llamar a la API | Construido | `web/src/filtros/SelectorPeriodo.tsx` | — |

### Bloque C · Ventas y dirección

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-220** | Hoy vs mismo día semana pasada, a la misma altura | Contra seed | `web/src/paginas/Resumen.tsx` | `alturaAl` por zona de cada sucursal. |
| **F2-220** | Venta en curso, mes vs mes anterior | Contra seed | `web/src/paginas/Resumen.tsx` | — |
| **F2-220** | Mejor/peor sucursal, top 5 con Δ, ticket y comensales | Contra seed | `web/src/paginas/Resumen.tsx` | Top 5 contra top 50 de la base. |
| **F2-220** | Alertas activas | Construido | `web/src/paginas/Resumen.tsx` | Desde F2-224 lee el centro de alertas. |
| **F2-220** | "Sin ventas" y "—" sin base | Construido | `web/src/paginas/Resumen.tsx` | — |
| **F2-220** | Medianoche con zonas distintas | Supuesto provisional | `web/src/paginas/Resumen.tsx` | Δ sesgado 00:00–01:00; log F2-220. → F3-007 |
| **F2-220** | Varias zonas verificadas en vivo | NO construido | `web/src/paginas/Resumen.tsx` | Seed dev con una sola zona; sólo e2e. → F3-019 |
| **F2-140** | Matriz sucursal × venta/tickets/ticket/comensales, A vs B, Δ | Contra seed | `web/src/paginas/Comparativos.tsx` | Cuadra con Inicio (test). |
| **F2-140** | Tasa de facturación | Contra seed | `web/src/paginas/Comparativos.tsx` | Agregada por F2-106 (y CFDI del PAC falso). |
| **F2-140** | Utilidad | Contra seed | `web/src/paginas/Comparativos.tsx` | Agregada por F2-126 (operación). |
| **F2-140** | Ranking y CSV, "—" sin datos | Construido | `web/src/paginas/Comparativos.tsx` | CSV exporta utilidad sobrestimada sin bandera. → F3-020 |
| **F2-140** | Dimensión "empresa" (admin_global) | NO construido | `web/src/paginas/Comparativos.tsx` | Decisión abierta en F2-250 del backlog. → decisión D-03 |
| **F2-221** | Por mesero (venta, cuentas, propina, cancelados, descuentos) | Contra seed | `web/src/paginas/Analisis.tsx` | Por (sucursal, texto del mesero). |
| **F2-221** | Por producto con subidas/caídas | Supuesto provisional | `web/src/paginas/Analisis.tsx` | Renglón de "diferencia" absorbe descuentos; esquema-sr §6. |
| **F2-221** | Mapa de calor hora × día | Contra seed | `web/src/paginas/Analisis.tsx` | — |
| **F2-221** | Por área y canal | Contra seed | `web/src/paginas/Analisis.tsx` | Completado por F2-233 (bloque real). |
| **F2-221** | Tiempo de mesa y rotación | Contra seed | `web/src/paginas/Analisis.tsx` | — |
| **F2-221** | Cortesías visibles aparte | NO construido | `web/src/paginas/Analisis.tsx` | Sin dato del POS; esquema-sr §2 (decisión abierta). → decisión D-10 |
| **F2-222** | Filtros mesero/mesa/forma/importe/canceladas/producto/cliente en URL | Construido | `web/src/paginas/Tickets.tsx` | No filtra "sin mesero"/"sin mesa". → F3-020 |
| **F2-222** | Columnas ordenables | Construido | `web/src/paginas/Tickets.tsx` | Orden de folio: DECISION PROVISIONAL. |
| **F2-222** | CSV de lo filtrado con conteo previo | Construido | `web/src/paginas/Tickets.tsx` | — |
| **F2-222** | Detalle: partidas, pagos, propina, tiempo de mesa | Contra seed | `web/src/paginas/Tickets.tsx` | — |
| **F2-222** | Código de facturación en el detalle | Construido | `web/src/paginas/Tickets.tsx` | Agregado por F2-103 (fila expandible; no hay `GET /ventas/tickets/{id}`). |
| **F2-222** | Hora de la cancelación | NO construido | `web/src/paginas/Tickets.tsx` | Contrato no la trae; esquema-sr §2. → F1-022 + decisión D-10 |
| **F2-222** | Descuentos y cortesías por partida | NO construido | `web/src/paginas/Tickets.tsx` | Sin dato; esquema-sr §2 y §3. → F1-022 + decisión D-10 |
| **F2-223** | Orden y filtro por estado recordados | Construido | `web/src/paginas/Mesas.tsx` | URL + localStorage por usuario. |
| **F2-223** | KPI "Atención requerida" clicable | Construido | `web/src/paginas/Mesas.tsx` | — |
| **F2-223** | Reloj sin repintar la vista | Construido | `web/src/paginas/Mesas.tsx` | 60 fps NO medido; aislamiento de renders sí. → F3-019 |
| **F2-223** | Vista de pared | Construido | `web/src/paginas/Mesas.tsx` | "Legible a 2 m" no verificado a ojo. → F3-019 |
| **F2-223** | Partidas pendientes de imprimir | Supuesto provisional | `web/src/paginas/Mesas.tsx` | `comandaImpresa` inventado; esquema-sr §5, lo llena F1-023. → F1-023 |
| **F2-223** | Vacío honesto con todas desconectadas | Construido | `web/src/paginas/Mesas.tsx` | — |
| **F2-224** | Modelo con apertura/cierre en una fila | Construido | `api/src/alertas` | — |
| **F2-224** | Sin reporte, mesa >60, sin imprimir >30, caída de venta | Supuesto provisional | `api/src/alertas/reglas.ts` | Umbral 30 % y severidades: DECISION PROVISIONAL. |
| **F2-224** | Bajo mínimo / traspaso sin conciliar / actualización fallida | Construido | `api/src/alertas` | Agregadas por F2-121/F2-124/F2-143. |
| **F2-224** | Saldo de folios bajo en la campana | NO construido | `api/src/alertas` | Decisión abierta; nota en F2-250, esquema-sr §2 "Control de folios". → decisión D-02 |
| **F2-224** | Campana = conteo del panel; umbrales por empresa | Construido | `api/src/alertas` | — |
| **F2-224** | Cierre automático con marca de agua | Construido | `api/src/alertas` | Test AC1 fue intermitente (arreglado en F2-122). → F3-001 |
| **F2-141** | Diario y semanal por usuario, cifras = panel | Contra puerto falso | `api/src/reportes` | Correo falso + reloj falso. |
| **F2-141** | Hora en zona de la empresa | Supuesto provisional | `api/src/reportes` | 07:00 fija; zona = la de más sucursales. |
| **F2-141** | Baja sin sesión | Construido | `api/src/reportes` | El test de token alterado era intermitente (~1/16): arreglado en F2-250. |
| **F2-141** | Llega a bandeja real antes de 9:00, sin spam | Esperando validación diurna | `api/src/reportes` | F2-191; sin `List-Unsubscribe`. |
| **F2-141** | Hora configurable por usuario | NO construido | `api/src/reportes` | DECISION PROVISIONAL en `calendario.ts`. → decisión D-13 |

### Bloque D · Catálogos

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-230** | Espejo grupos/productos/meseros/clientes/áreas/canales | Construido | `api/src/ingesta/catalogos-ingesta.controller.ts` | — |
| **F2-230** | Ingesta idempotente por páginas + cierre | Construido | `api/src/ingesta/catalogos-ingesta.controller.ts` | — |
| **F2-230** | Baja sin borrar (`visto_at`) | Supuesto provisional | `api/src/scope/escritura-catalogos.ts` | `total=0` da de baja todo; DECISION PROVISIONAL. |
| **F2-230** | Metadata propia que sobrevive re-sync | Supuesto provisional | `api/src/ingesta/catalogos-ingesta.controller.ts` | Por sucursal (decisión abierta, esquema-sr §6). |
| **F2-230** | Forzado manual | Construido | `web/src/paginas/Productos.tsx` | Botón en `/productos` (no en Administración). |
| **F2-230** | Sync diaria desde el agente | Esperando validación diurna | `agent/src/ArkonAgente/Catalogos/SincronizadorCatalogos.cs` | Lector F2-240; nunca corrió contra SR real (F2-192). |
| **F2-230** | 404 entre empresas | Construido | `api/src/catalogos/catalogos.controller.ts` | — |
| **F2-145** | Precio por sucursal en el espejo | Supuesto provisional | `web/src/paginas/Productos.tsx` | Supuesto: un precio por producto/sucursal, IVA desconocido (§6). |
| **F2-145** | Discrepancia de precio entre sucursales | Contra seed | `web/src/paginas/Productos.tsx` | P009/P021; cruce por clave (DECISION PROVISIONAL). |
| **F2-145** | Vendidos sin catálogo | Supuesto provisional | `web/src/paginas/Productos.tsx` | Cruce por nombre; con el seed sale vacío. |
| **F2-145** | Metadata (foto, descripción, etiquetas) | Supuesto provisional | `web/src/paginas/Productos.tsx` | Por sucursal; decisión abierta. |
| **F2-145** | Validación contra SR real | Esperando validación diurna | `web/src/paginas/Productos.tsx` | F2-192. |
| **F2-145** | Menú digital público / CSV | NO construido | `web/src/paginas/Productos.tsx` | Fuera de ficha. → fuera de ficha, sin tarea |
| **F2-231** | Catálogo y ficha con rendimiento y ranking | Contra seed | `web/src/paginas/Meseros.tsx` | Periodo sin selector en cabecera (hallazgo). → F3-002 |
| **F2-231** | Σ meseros = venta (test) | Contra seed | `web/src/paginas/Meseros.tsx` | — |
| **F2-231** | Mesero dado de baja en periodos pasados | Construido | `web/src/paginas/Meseros.tsx` | — |
| **F2-231** | Cruce cheque ↔ espejo | Supuesto provisional | `web/src/paginas/Meseros.tsx` | Por nombre normalizado; esquema-sr §7, validar F2-192. |
| **F2-231** | Unificar con Análisis › Meseros | NO construido | `web/src/paginas/Meseros.tsx` | → F3-020 |
| **F2-232** | Lista y ficha con visitas, ticket, última visita, top productos | Contra seed | `web/src/paginas/Clientes.tsx` | Cuadra con Tickets filtrado. |
| **F2-232** | Vacío honesto sin clientes | Construido | `web/src/paginas/Clientes.tsx` | Probado a mano (el seed sí trae clientes). |
| **F2-232** | Id del cliente en el cheque | Supuesto provisional | `web/src/paginas/Clientes.tsx` | Ningún agente lo manda (F1-022); esquema-sr §2, F2-192. |
| **F2-232** | Enlace con `ReceptorFrecuente` por RFC | Construido | `web/src/paginas/Clientes.tsx` | Hecho después en F2-100. |
| **F2-232** | CSV sin PII salvo casilla | Construido | `web/src/paginas/Clientes.tsx` | ❓ visor ve contacto: decisión abierta §8. → decisión D-11 |
| **F2-233** | Venta por área y canal con "sin clasificar" | Contra seed | `web/src/paginas/Areas.tsx` | Σ = venta (test). |
| **F2-233** | Mapeo área → canal configurable | Supuesto provisional | `web/src/paginas/Areas.tsx` | Enum fijo y mapeo por sucursal: decisiones abiertas (§8). → decisión D-09 |
| **F2-233** | Área de la cuenta | Supuesto provisional | `web/src/paginas/Areas.tsx` | Ningún agente la manda hoy (F1-022). → F1-022 |
| **F2-233** | Estaciones | NO construido | `web/src/paginas/Areas.tsx` | SR sí las tiene (`dbo.estaciones`); esquema-sr §8, nota F2-192. → F3-024 |

### Bloque E · Inventario

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-120** | Espejo de unidades, grupos, insumos, almacenes, proveedores | Construido | `api/src/catalogos/catalogos.controller.ts` | Supuestos §9 (almacén por sucursal, sin costo). |
| **F2-120** | Lectura desde SR | Esperando validación diurna | `agent/src/ArkonAgente/Catalogos` | F2-241 (ver abajo); validar F2-192. |
| **F2-120** | Forzado espera los once catálogos | Supuesto provisional | `api/src/ingesta/dto/catalogos.dto.ts` | Decisión abierta (nota F2-240). |
| **F2-120** | Presentaciones y productos-receta | NO construido | `api/src/ingesta/dto/catalogos.dto.ts` | ALCANCE; esquema-sr §9. → F3-025 |
| **F2-120** | Vista web de Insumos / Grupos de insumos | NO construido | `api/src/ingesta/dto/catalogos.dto.ts` | Entradas `SIN_TAREA` en `menu.ts`; decide F2-250. → decisión D-01 |
| **F2-121** | KPIs, tabla con semáforo, filtros, búsqueda | Contra seed | `web/src/paginas/Existencias.tsx` | — |
| **F2-121** | Mín/máx editables sin escribir a SR | Construido | `web/src/paginas/Existencias.tsx` | — |
| **F2-121** | Alerta `bajo_minimo` | Construido | `web/src/paginas/Existencias.tsx` | Alerta "sin lectura" abierta sin plazo (F2-193). |
| **F2-121** | Costo promedio y negativas en la valuación | Supuesto provisional | `web/src/paginas/Existencias.tsx` | Redondeo a 2, negativas suman; esquema-sr §10. |
| **F2-121** | Valor cuadra con el reporte de SR | Esperando validación diurna | `web/src/paginas/Existencias.tsx` | F2-193. |
| **F2-121** | CSV | NO construido | `web/src/paginas/Existencias.tsx` | La ficha no lo pedía. → decisión D-14 |
| **F2-122** | Ingesta de pólizas idempotente | Construido | `api/src/ingesta/movimientos-ingesta.service.ts` | — |
| **F2-122** | Línea de tiempo filtrable y detalle de póliza | Contra seed | `web/src/paginas/Movimientos.tsx` | Periodo sin selector en cabecera (hallazgo). → F3-002 |
| **F2-122** | Kardex con saldo corrido y cuadre | Contra seed | `web/src/paginas/Movimientos.tsx` | Tipo traducido y desempate por folio: supuestos §10. |
| **F2-122** | Kardex contra el saldo real | Esperando validación diurna | `web/src/paginas/Movimientos.tsx` | F2-193. |
| **F2-122** | CSV / enlace desde Existencias | NO construido | `web/src/paginas/Movimientos.tsx` | No pedidos. → decisión D-14 |
| **F2-123** | Crear, capturar con guardado parcial, cerrar, cancelar | Construido | `web/src/paginas/Conteos.tsx` | — |
| **F2-123** | Borrador local tras bloqueo/sin red | Construido | `web/src/paginas/Conteos.tsx` | Probado en jsdom; celular real: F2-193. |
| **F2-123** | Reporte de diferencias + CSV | Contra seed | `web/src/paginas/Conteos.tsx` | — |
| **F2-123** | No escribe a SR | Construido | `web/src/paginas/Conteos.tsx` | Test sobre el espejo. |
| **F2-123** | Teórico congelado al crear | Supuesto provisional | `web/src/paginas/Conteos.tsx` | Esquema-sr §10 "Conteos físicos". |
| **F2-123** | Menú exacto de SR en la ayuda | Esperando validación diurna | `web/src/paginas/Conteos.tsx` | Ayuda genérica; F2-193. |
| **F2-124** | Traspaso web enviado → recibido, reporte imprimible | Construido | `web/src/paginas/Traspasos.tsx` | Recibir no permite editar cantidades. |
| **F2-124** | Traspasos leídos de SR | Contra seed | `web/src/paginas/Traspasos.tsx` | Pestaña SR usa periodo sin selector (hallazgo). → F3-002 |
| **F2-124** | Conciliación automática ±1 día | Supuesto provisional | `web/src/paginas/Traspasos.tsx` | Dos pólizas, fecha con hora, misma clave; §10 "Traspasos". |
| **F2-124** | Alerta a las 48 h | Construido | `web/src/paginas/Traspasos.tsx` | `traspaso_sin_conciliar`. |
| **F2-124** | Conciliación contra SR real | Esperando validación diurna | `web/src/paginas/Traspasos.tsx` | F2-193. |
| **F2-125** | Ingesta de recetas | Construido | `api/src/ingesta/recetas-ingesta.service.ts` | — |
| **F2-125** | Consumo teórico vs real con % de variación | Contra seed | `web/src/paginas/Recetas.tsx` | Cruce partida→producto por nombre. |
| **F2-125** | Productos sin receta aparte | Construido | `web/src/paginas/Recetas.tsx` | P020/P021. |
| **F2-125** | Definición de "real" | Supuesto provisional | `web/src/paginas/Recetas.tsx` | ❓ ¿SR descuenta por receta? decisión abierta F2-193, §10. |
| **F2-125** | 3 insumos de control con el piloto | Esperando validación diurna | `web/src/paginas/Recetas.tsx` | F2-193. |
| **F2-125** | Alerta de variación alta | NO construido | `web/src/paginas/Recetas.tsx` | No pedida. → decisión D-14 |
| **F2-126** | Ingesta de compras de SR | Construido | `api/src/ingesta/compras-ingesta.service.ts` | Informativas: no entran a la utilidad. |
| **F2-126** | Captura de gastos por categoría | Construido | `api/src/finanzas/gastos.service.ts` | No idempotente ante doble envío. → F3-017 |
| **F2-126** | Estado de resultados con gráfica y export | Contra seed | `web/src/paginas/Compras.tsx` | Venta neta = Σ subtotal (supuesto §2). |
| **F2-126** | Costo = teórico a costo | Supuesto provisional | `web/src/paginas/Compras.tsx` | Esquema-sr §10 "Compras, gastos y utilidad". |
| **F2-126** | Captura manual de compras | NO construido | `web/src/paginas/Compras.tsx` | ALCANCE; decisión abierta en F2-193. → F2-193 |
| **F2-126** | Cuadre ±1 % con el contador | Esperando validación diurna | `web/src/paginas/Compras.tsx` | F2-193. |
| **F2-127** | Promedio móvil 4 semanas por día de semana | Contra seed | `web/src/paginas/Proyecciones.tsx` | — |
| **F2-127** | Sugerido y orden de compra CSV | Contra seed | `web/src/paginas/Proyecciones.tsx` | Sin redondeo a presentación. |
| **F2-127** | Horizonte ajustable 1–28 | Construido | `web/src/paginas/Proyecciones.tsx` | — |
| **F2-127** | "Sin datos" en vez de 0 | Construido | `web/src/paginas/Proyecciones.tsx` | — |
| **F2-127** | ±15 % en insumo estable | Contra seed | `web/src/paginas/Proyecciones.tsx` | Sólo I063 (casi por construcción); 22/67 de receta. |
| **F2-127** | Demanda si SR no deja pólizas de consumo | Esperando validación diurna | `web/src/paginas/Proyecciones.tsx` | F2-193; `TIPOS_DEMANDA` provisional. |

### Bloque F · Facturación

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-100** | Perfil fiscal con validación | Construido | `web/src/paginas/Facturacion.tsx` | Un emisor por empresa (DECISION PROVISIONAL, §8). |
| **F2-100** | Carga de CSD sin guardar .key ni contraseña | Contra puerto falso | `web/src/paginas/Facturacion.tsx` | Test inspecciona base, log y respuestas. |
| **F2-100** | Vigencia y alerta < 30 días | Construido | `web/src/paginas/Facturacion.tsx` | Calculada en la vista. |
| **F2-100** | Alta del CSD en Facturama sandbox | Esperando validación diurna | `web/src/paginas/Facturacion.tsx` | F2-190. |
| **F2-100** | CFDI de prueba al guardar | NO construido | `web/src/paginas/Facturacion.tsx` | ❓ decisión abierta en F2-190. → F2-190 |
| **F2-100** | `ReceptorFrecuente` ligado a Clientes | Construido | `web/src/paginas/Facturacion.tsx` | — |
| **F2-101** | Código 9 chars, único, reintento ante colisión | Construido | `api/src/facturacion/codigo.ts` | — |
| **F2-101** | Vigencia configurable | Construido | `api/src/facturacion/codigo.ts` | Default fin de mes (validar F2-190). |
| **F2-101** | Endpoint público 10/min sin filtrar datos | Construido | `api/src/facturacion/codigo.ts` | — |
| **F2-101** | Qué es facturable / cancelado | Supuesto provisional | `api/src/facturacion/codigo.ts` | Esquema-sr §2; F2-190. |
| **F2-101** | Backfill de cheques previos | NO construido | `api/src/facturacion/codigo.ts` | Sólo al reenviar. → decisión D-12 |
| **F2-103** | Tres pasos con validación campo por campo | Contra puerto falso | `web/src/paginas/PortalFactura.tsx` | Emite desde F2-104. |
| **F2-103** | Branding por sucursal | Construido | `web/src/paginas/PortalFactura.tsx` | — |
| **F2-103** | Portal acepta códigos de otras sucursales de la empresa | Supuesto provisional | `web/src/paginas/PortalFactura.tsx` | Esquema-sr §2; F2-190. |
| **F2-103** | Re-descarga de un código facturado | NO construido | `web/src/paginas/PortalFactura.tsx` | ❓ decisión (a)/(b) abierta en ficha F2-105. → decisión D-04 |
| **F2-103** | Viewport de celular | Esperando validación diurna | `web/src/paginas/PortalFactura.tsx` | No verificado en navegador; F2-190. |
| **F2-104** | JSON Facturama fijado por test de contrato | Contra puerto falso | `api/src/facturacion/cfdi.service.ts` | Snapshot revisado a mano. |
| **F2-104** | Doble clic no emite dos veces | Construido | `api/src/facturacion/cfdi.service.ts` | Reserva `timbrando` como candado. |
| **F2-104** | Errores del SAT en español | Supuesto provisional | `api/src/facturacion/cfdi.service.ts` | Numeración `CFDI40xxx` supuesta; F2-190. |
| **F2-104** | Base = total, IVA 16 %, tarjeta = 04 | Supuesto provisional | `api/src/facturacion/cfdi.service.ts` | Esquema-sr §2 "La emisión del CFDI". |
| **F2-104** | Timbrado en sandbox | Esperando validación diurna | `api/src/facturacion/cfdi.service.ts` | F2-190. |
| **F2-105** | XML/PDF por `PuertoArchivos`, sobreviven reinicio | Contra puerto falso | `api/src/facturacion/entrega.service.ts` | Volumen real y backup: F2-191/F1-004. |
| **F2-105** | Correo con adjuntos | Contra puerto falso | `api/src/facturacion/entrega.service.ts` | Brevo real: F2-191. |
| **F2-105** | Fallo de correo → reintento; descarga sigue | Contra puerto falso | `api/src/facturacion/entrega.service.ts` | UI en el tablero (F2-106). |
| **F2-105** | Copia al restaurante | NO construido | `api/src/facturacion/entrega.service.ts` | ALCANCE (no hay dónde configurarla). → F3-015 |
| **F2-105** | Re-descarga desde el portal | NO construido | `api/src/facturacion/entrega.service.ts` | ❓ decisión abierta (a)/(b). → decisión D-04 |
| **F2-106** | KPIs, barras por sucursal/mes/hora | Contra puerto falso | `web/src/paginas/facturacion/tablero` | CFDI del seed. |
| **F2-106** | Tabla con búsqueda RFC/UUID/folio y CSV | Construido | `web/src/paginas/facturacion/tablero` | CSV sin columna de origen. → F3-020 |
| **F2-106** | "Por facturar" y correos por reenviar | Construido | `web/src/paginas/facturacion/tablero` | — |
| **F2-106** | Tasa = facturado por emisión / venta por cierre | Supuesto provisional | `web/src/paginas/facturacion/tablero` | Decisión para Ricardo; esquema-sr §2 "El tablero". |
| **F2-107** | Factura sin ticket `origen=manual` | Contra puerto falso | `web/src/paginas/facturacion/emision` | — |
| **F2-107** | Refacturación 04 + cancelación 01 | Contra puerto falso | `web/src/paginas/facturacion/emision` | `Relations` supuesto; F2-190. |
| **F2-107** | Cancelación 01 pendiente no cuenta doble | Supuesto provisional | `web/src/paginas/facturacion/emision` | Esquema-sr §2. |
| **F2-107** | Refacturar CFDI del seed en demo | NO construido | `web/src/paginas/facturacion/emision` | El PAC falso no los conoce (409). → F3-018 |
| **F2-108** | Periodicidad/meses/año por test de contrato | Contra puerto falso | `web/src/paginas/facturacion/global/FacturaGlobal.tsx` | — |
| **F2-108** | Vista previa de la global | Construido | `web/src/paginas/facturacion/global/FacturaGlobal.tsx` | — |
| **F2-108** | Emisión manual y automática | Contra puerto falso | `api/src/facturacion/global.programador.ts` | Timbrado real: F2-190. |
| **F2-108** | Ticket en global no se autofactura, portal lo explica | Construido | `web/src/paginas/facturacion/global/FacturaGlobal.tsx` | — |
| **F2-108** | Espera a que venzan los códigos; global por sucursal | Supuesto provisional | `web/src/paginas/facturacion/global/FacturaGlobal.tsx` | Decisiones para Ricardo; esquema-sr §2. |
| **F2-108** | Quincenal/bimestral | NO construido | `web/src/paginas/facturacion/global/FacturaGlobal.tsx` | No pedidas. → decisión D-12 |
| **F2-109** | Cuatro motivos, 01 exige sustituto | Contra puerto falso | `web/src/paginas/facturacion/emision/DialogoCancelar.tsx` | — |
| **F2-109** | Estados intermedios por sondeo | Supuesto provisional | `web/src/paginas/facturacion/emision/DialogoCancelar.tsx` | `pending` de Facturama supuesto; F2-190. |
| **F2-109** | Efecto en la tasa | Construido | `web/src/paginas/facturacion/emision/DialogoCancelar.tsx` | — |
| **F2-109** | 02/03 sueltan el ticket reusando código | Supuesto provisional | `web/src/paginas/facturacion/emision/DialogoCancelar.tsx` | Decisión para Ricardo; esquema-sr §2. |
| **F2-109** | Acuse y reintento del aviso por correo | NO construido | `web/src/paginas/facturacion/emision/DialogoCancelar.tsx` | ALCANCE (log F2-109). → F3-015 |
| **F2-110** | Saldo 0 bloquea antes del PAC | Construido | `web/src/paginas/facturacion/folios/Folios.tsx` | — |
| **F2-110** | Reporte mensual cuadra con CFDI | Contra puerto falso | `web/src/paginas/facturacion/folios/Folios.tsx` | Cuadre entre tablas propias; los CFDI salen del PAC falso y del seed. |
| **F2-110** | Aviso de umbral y vigencia (correo) | Contra puerto falso | `web/src/paginas/facturacion/folios/Folios.tsx` | Saldo de plataforma: supuesto; F2-190. |
| **F2-110** | `folios_bajo` en la campana | NO construido | `web/src/paginas/facturacion/folios/Folios.tsx` | ❓ nota en F2-250. → decisión D-02 |
| **F2-110** | Costo del FIFO crece sin tope | NO construido | `web/src/paginas/facturacion/folios/Folios.tsx` | Riesgo anotado en log F2-110 para F2-250. → F3-004 |
| **F2-110b** | Reservas colgadas de 4 orígenes: confirmar/liberar | Contra puerto falso | `api/src/facturacion/conciliacion.service.ts` | — |
| **F2-110b** | Vigente cancelado tarde, 01 pendiente, archivos faltantes | Contra puerto falso | `api/src/facturacion/conciliacion.service.ts` | — |
| **F2-110b** | Búsqueda por serie y folio en Facturama | Supuesto provisional | `api/src/facturacion/conciliacion.service.ts` | Ruta supuesta; F2-190. |
| **F2-110b** | Reserva liberada que aparece después / cancelación fuera del sistema | NO construido | `api/src/facturacion/conciliacion.service.ts` | Tres huecos conocidos de la conciliación → decisión D-05 |

### Bloque G · Extras

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-144** | Spike documentado | Construido | `web/src/paginas/Canales.tsx` | `docs/delivery.md`. |
| **F2-144** | Mezcla por canal A vs B, cuadra con el total | Contra seed | `web/src/paginas/Canales.tsx` | Plataformas no sale en el seed. → F3-018 |
| **F2-144** | Ingesta nueva por canal | NO construido | `web/src/paginas/Canales.tsx` | ALCANCE; delivery.md §4. → decisión D-09 |
| **F2-144** | Enum y mapeo por sucursal | Supuesto provisional | `web/src/paginas/Canales.tsx` | ❓ abiertas, delivery.md §5, esquema-sr §8. |
| **F2-144** | Validación con instalación real | Esperando validación diurna | `web/src/paginas/Canales.tsx` | F2-192. |
| **F2-142** | Aviso tras ingesta < 5 s | Construido | `api/src/tiempo-real` | e2e local ~0.3 s. |
| **F2-142** | Degrada a polling | Construido | `api/src/tiempo-real` | — |
| **F2-142** | Mismo JWT, rechaza vencido | Construido | `api/src/tiempo-real` | — |
| **F2-142** | Upgrade detrás de Caddy | Esperando validación diurna | `api/src/tiempo-real` | F1-002. |
| **F2-142** | Refrescar ventas (no sólo mesas); Redis | NO construido | `api/src/tiempo-real` | ALCANCE; `docs/tiempo-real.md`. → F3-013 |
| **F2-146** | Manifest y service worker (armazón sin red) | Construido | `web/pwa-plugin.ts` | Verificado por test y `check:pwa`, no en navegador. |
| **F2-146** | Push con VAPID | Contra puerto falso | `web/pwa-plugin.ts` | `PushFalso` + contrato web-push. |
| **F2-146** | Cada aviso se apaga por separado | Construido | `web/pwa-plugin.ts` | — |
| **F2-146** | Resumen de cierre con cifras en pantalla bloqueada | Supuesto provisional | `web/pwa-plugin.ts` | ❓ decisión abierta (`mensajes.ts`). → decisión D-08 |
| **F2-146** | Instalar y push con app cerrada en dispositivo real | Esperando validación diurna | `web/pwa-plugin.ts` | F2-191. |
| **F2-147** | Landing Lighthouse > 90 | Construido | `web/landing/index.html` | 100/100/100/100 local. |
| **F2-147** | Asistente de alta con llaves y checklist | Construido | `web/src/paginas/AltaGuiada.tsx` | ≈289 s estimado, no persona real. |
| **F2-147** | Contacto por Brevo | Contra puerto falso | `api/src/onboarding` | F2-191 (`CONTACTO_DESTINO`). |
| **F2-147** | Capturas reales y precios | NO construido | `web/landing/index.html` | SVG ilustrativos; "Precio por confirmar" (decisión abierta). → decisión D-07 |
| **F2-147** | Descarga del instalador (`AGENTE_URL_DESCARGA`) | Esperando validación diurna | `web/landing/index.html` | F2-191. |
| **F2-143** | Canal de versiones, URL firmada + SHA-256 | Construido | `api/src/agentes/actualizacion-agente.service.ts` | — |
| **F2-143** | Hash inválido aborta y alerta | Contra puerto falso | `agent/src/ArkonAgente/Actualizacion` | Alerta `actualizacion_fallida`. |
| **F2-143** | Rollout por bandera de sucursal | Construido | `agent/src/ArkonAgente/Actualizacion` | — |
| **F2-143** | Swap por watchdog, rollback, nunca dos versiones | Contra puerto falso | `agent/src/ArkonAgente/Actualizacion` | Administrador de servicios simulado; F1-020b. |
| **F2-143** | Watchdog como LocalSystem | Supuesto provisional | `agent/instalador/funciones-instalador.ps1` | `funciones-instalador.ps1`. |
| **F2-143** | Firma Authenticode | NO construido | `agent/src/ArkonAgente/Actualizacion` | ❓ abierta en F2-191. → F2-191 |

### Bloque H · Agente

| Tarea | Capacidad | Estado | Dónde | Nota / qué falta y en qué tarea |
|---|---|---|---|---|
| **F2-240** | Productos/grupos/precio, meseros, áreas, clientes | Supuesto provisional | `agent/src/ArkonAgente/Catalogos` | Mapeo de metadatos §6–§8; sentido de visible/Estatus/bloqueado supuesto. |
| **F2-240** | Canales | Supuesto provisional | `agent/src/ArkonAgente/Catalogos` | `tiposervicio` vacía; cierra con total=0 (§8). |
| **F2-240** | Estaciones | NO construido | `agent/src/ArkonAgente/Catalogos` | Sin espejo ni contrato; ver F3-024. → F3-024 |
| **F2-240** | Hash: segunda corrida no encola | Construido | `agent/src/ArkonAgente/Catalogos` | Tests con fixtures. |
| **F2-240** | Sonda de permisos de escritura | Construido | `agent/src/ArkonAgente/Diagnostico/VerificacionSql.cs` | `agente test` por tabla. |
| **F2-240** | Flujo contra SR real | Esperando validación diurna | `agent/src/ArkonAgente/Catalogos` | Login sysadmin → no lee; F2-192/F1-020b. |
| **F2-240** | Catálogos fuera del ciclo del heartbeat | NO construido | `agent/src/ArkonAgente/Worker.cs` | Riesgo §11; → F3-003 |
| **F2-241** | Cinco catálogos de inventario (forzado completo) | Supuesto provisional | `agent/src/ArkonAgente/Inventario` | Unidades derivadas de texto; §9. |
| **F2-241** | Existencias cada 30 min | Supuesto provisional | `agent/src/ArkonAgente/Sql/Consultas/sr_existencias.sql` | `costopromedio` por empresa; §10, F2-193. |
| **F2-241** | Nunca transacción de escritura | Construido | `agent/tests/ArkonAgente.Tests/SoloLecturaTests.cs` | Escáner de IL; no ve reflexión. |
| **F2-241** | Timeout que no tumba el ciclo | Contra puerto falso | `agent/src/ArkonAgente/Inventario` | Simulado, nunca SQL lento real. |
| **F2-241** | Tablas con datos reales | Esperando validación diurna | `agent/src/ArkonAgente/Inventario` | SR local vacía; F2-192/F2-193. |
| **F2-241** | Presentaciones y elaborados | NO construido | `agent/src/ArkonAgente/Inventario` | Documentados en §9, sin contrato. → F3-025 |
| **F2-241b** | Movimientos con cursor en SQLite y ventana | Supuesto provisional | `agent/src/ArkonAgente/Inventario` | Agrupación en pólizas y concepto→tipo supuestos; §10. |
| **F2-241b** | Traspaso en dos pólizas | Supuesto provisional | `agent/src/ArkonAgente/Inventario` | Por almacén en la clave. |
| **F2-241b** | Recetas (`costos`) con `renglones: []` al desaparecer | Supuesto provisional | `agent/src/ArkonAgente/Inventario` | Freno puede impedirlo (❓ §10). → decisión D-06 |
| **F2-241b** | Compras con cancelada | Supuesto provisional | `agent/src/ArkonAgente/Inventario` | `fechaaplicacion` no retrocede (supuesto). |
| **F2-241b** | Cursor sobrevive reinicio | Construido | `agent/src/ArkonAgente/Inventario` | Tests. |
| **F2-241b** | Con datos reales / heap grande | Esperando validación diurna | `agent/src/ArkonAgente/Inventario` | F2-192/F2-193; riesgo timeout §11. → F2-192 + decisión D-06 |
| **F2-241b** | Compactar versiones en cola | NO construido | `agent/src/ArkonAgente/Cola/ColaInventario.cs` | Tarea chica anotada en log F2-241b. → F3-011 |

