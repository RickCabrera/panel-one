# Auto-actualización del agente (F2-143)

Cómo una versión nueva del agente llega sola a la PC del restaurante, sin que nadie vaya a
instalarla, y qué la frena. **No toca SoftRestaurant**: cambia el binario del agente (`agente.exe`),
no la base del POS.

## Las piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Canal de versiones | api, tabla `versiones_agente` (plataforma, sin empresa) | Los binarios publicados. **Vigente** = la publicada más reciente sin retirar. |
| Bandera de rollout | api, `sucursales.actualizacion_automatica` | Nace **apagada**. Sólo con ella la sucursal toma la vigente. La prende el admin_global, sucursal por sucursal. |
| Revisor | agente, servicio `ArkonAgente` (`Actualizacion/RevisorActualizacion.cs`) | En cada ciclo pregunta al canal, baja, verifica y deja una **solicitud**. Nunca toca su propio exe. |
| Watchdog | agente, servicio `ArkonAgenteActualizador` (`Actualizacion/Actualizador.cs`) | El "segundo servicio mínimo": detiene el agente, cambia el exe, lo arranca y hace rollback si no se queda corriendo. |
| Reporte y alerta | api, `agente_actualizacion` + regla `actualizacion_fallida` | Lo que pasó con el último intento. Una falla de la vigente abre una alerta. |

## El recorrido de una versión

1. El admin_global publica `agente.exe` en **Administración › Actualizaciones**
   (`POST /agente/versiones?version=X.Y.Z`, cuerpo `application/octet-stream`, hasta 128 MB). El api
   calcula el SHA-256 y el tamaño **él mismo** y guarda el binario por `PuertoArchivos` en
   `agente/<version>/agente.exe`.
2. El agente de una sucursal **con la bandera** pregunta en cada ciclo `GET /agente/version`
   (con su API key) y recibe `{ version, sha256, tamanoBytes, url }`. La `url` es relativa al api y
   va **firmada** por 15 min (HMAC del adaptador de archivos).
3. Si su versión (sin el `+commit`) es **distinta** de la vigente, la baja **sin la API key** (la
   firma es la credencial), con tope de tamaño, calculando el SHA-256 al vuelo. Si el tamaño o el
   SHA no son los del canal: borra lo bajado, reporta `fallida/hash_invalido` y espera el backoff.
   Si cuadran: la deja como `actualizacion\preparado.exe` y escribe `actualizacion\solicitud.json`.
4. El watchdog (cada 30 s) ve la solicitud y:
   1. copia el preparado junto al exe (`agente.exe.nuevo`, en Program Files) y verifica el SHA de
      **esa copia**. Distinto → `hash_invalido`, no toca nada;
   2. detiene `ArkonAgente`, espera `Detenido` (60 s) **y** cero procesos con la ruta exacta de su exe
      (30 s). Si no → `detener`, no reemplaza nada, y no arranca otro encima de un proceso colgado;
   3. `agente.exe` → `agente.exe.anterior`, `agente.exe.nuevo` → `agente.exe`. Error de disco →
      restaura y `reemplazo`;
   4. arranca y exige que se quede corriendo 60 s. Si se cae → lo detiene, deja la versión rota
      como `agente.exe.fallido`, restaura la anterior, la arranca → `arranque` (rollback);
   5. escribe `actualizacion\resultado.json` y borra la solicitud y el preparado.
5. El agente (ya el nuevo, o el viejo si hubo rollback) reporta el resultado
   (`POST /agente/actualizacion`) y lo borra sólo si el api lo guardó. Su heartbeat ya trae la versión
   nueva: **Administración › Actualizaciones** la muestra "Al día".

Retirar la vigente (`POST /agente/versiones/:version/retirar`) hace vigente a la anterior, y las
sucursales con la bandera **regresan** a ella: el agente compara por igualdad, no por "más nueva".

## Garantías y cómo se probaron

| Garantía | Cómo | Test |
|---|---|---|
| El rollout respeta la bandera | Sin bandera, `GET /agente/version` da `disponible: false` | `api/src/agentes/actualizacion-agente.e2e.spec.ts` |
| Hash inválido aborta | El agente descarta y no deja solicitud; el watchdog re-verifica la copia antes de detener nada | `ActualizacionTests` (agente), e2e del api |
| Hash inválido **alerta** | Reporte `fallida` → regla `actualizacion_fallida` (> 1 min de racha por defecto, advertencia) | e2e del api (`evaluarEmpresa`), `evaluador.spec.ts` |
| Nunca dos agentes corriendo | Sólo se arranca con el servicio Detenido **y** cero procesos del exe; el servicio falso cuenta instancias y falla si hay 2 | `ActualizacionTests` (`ServicioFalso`) |
| Un binario roto no se baja en bucle | Backoff por (versión, SHA) en SQLite: 1 h, 2 h, 4 h… hasta 24 h | `ActualizacionTests` |
| Un binario que reporta otra versión no provoca un Stop/Start por ciclo | Un (versión, SHA) ya aplicado no se reintenta nunca; se reporta una vez como `version_distinta` | `ActualizacionTests` |
| Descarga firmada | Firma alterada, vencida, otra versión, retirada o inexistente: el mismo 404 | e2e del api |

"Nunca dos versiones" se refiere al **servicio `ArkonAgente`**. El watchdog es otra copia del exe
(la de la instalación) y sigue corriendo con su versión: no lee ventas ni habla con el api.

**Punta a punta** (`Punta_a_punta_*` en `ActualizacionTests`): canal local + binario de prueba +
revisor real + watchdog real sobre archivos temporales, con el administrador de servicios simulado.
Con el administrador de servicios de verdad, en Windows y con elevación, **no se ha corrido**: es
F1-020b (diurna).

## Cuánto tarda

Con el intervalo por defecto (30 s): el agente revisa en ≤ 30 s, la descarga depende de la red
(~70 MB), el watchdog la toma en ≤ 30 s, detener ≤ 60 s, estabilidad 60 s. Unos **3 min más la
descarga**, muy dentro de la hora de la ficha. **Con `intervaloSegundos` cerca de 3600 la cota de
1 h NO se cumple** (la revisión va con el ciclo del agente). Ya hay un aviso al cargar config con
intervalos > 30 s (F1-061).

## Archivos de intercambio

En `C:\ProgramData\ArkonAgente\actualizacion\` (la carpeta protegida de F1-026):

| Archivo | Lo escribe | Lo lee |
|---|---|---|
| `preparado.exe.descarga` | agente (descarga en curso) | nadie |
| `preparado.exe` | agente (ya verificado) | watchdog |
| `solicitud.json` `{version, sha256, tamanoBytes}` | agente | watchdog |
| `resultado.json` `{resultado, version, sha256, motivo, detalle}` | watchdog | agente |
| `estado.db` (SQLite: fallas, backoff, aplicadas) | agente | agente |

Los **nombres son fijos**: el watchdog nunca toma una ruta de la solicitud, rechaza enlaces (reparse
points: symlinks, junctions) en la carpeta, la solicitud y el preparado, y valida la versión
(`X.Y.Z`), el SHA (64 hex) y el tamaño (≤ 128 MB) antes de hacer nada.

## Seguridad: lo que protege y lo que NO

- **El SHA-256 es de integridad, no de autenticidad.** El api lo calcula al publicar y el agente lo
  compara: un binario cortado, cambiado en el camino o en disco no se instala. Pero el watchdog
  corre como **LocalSystem** y la cuenta del agente (`NT SERVICE\ArkonAgente`) puede escribir la
  carpeta de intercambio: quien controle esa cuenta puede hacer que el watchdog instale un exe
  cualquiera **como binario del servicio del agente** (que corre con la cuenta del agente, no como
  SYSTEM). Es un salto de privilegio acotado a esa cuenta. **Decisión abierta (F2-191):** firmar
  el exe con Authenticode y que el watchdog verifique la firma antes de instalar.
- La descarga no manda la API key y sólo acepta `https` (o `http` a la propia máquina).
- Publicar, retirar y la bandera son sólo del admin_global (403 por ruta para los demás, como el
  control de folios de F2-110).

## Límites conocidos

- **Memoria del api al publicar**: el cuerpo (hasta 128 MB) llega entero a un Buffer
  (`express.raw`, montado SÓLO en `/agente/versiones`). Es una petición del admin_global, no del
  público. La descarga sí va en streaming (`PuertoArchivos.abrirLectura`).
- El almacenamiento real del binario es el de `ARCHIVOS_IMPL=disco` (F2-191): la misma carpeta y el
  mismo secreto de firma que los CFDI.
- El watchdog no se auto-actualiza: se actualiza al correr otra vez `instalar.ps1`.

## Decisiones provisionales (nocturno)

- Watchdog como LocalSystem (`funciones-instalador.ps1`, `Get-ArgumentosScActualizador`).
- Un proceso `agente` que no se puede inspeccionar cuenta como corriendo (`ProcesosSistema`): lo
  conservador es no arrancar otro encima.
- Alerta `actualizacion_fallida`: advertencia, 1 min por defecto, rango 1–1440 (`alertas/reglas.ts`).
