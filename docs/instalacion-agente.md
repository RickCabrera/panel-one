# Instalar el agente en un restaurante

Esta guía deja el agente de Yo Controlo (el servicio de Windows **ArkonAgente**) leyendo
SoftRestaurant y reportando al panel. Está escrita para alguien que **no** es técnico.

**Qué hace el agente:** es un servicio de Windows que, cada 30 segundos, **lee** la base de
SoftRestaurant y manda los datos al panel por internet. **Nunca escribe en SoftRestaurant**: entra
con un usuario que sólo puede leer (`monitor_lector`, lo crea el instalador). Si el internet se
cae, guarda lo pendiente y lo manda cuando vuelve.

Hay dos caminos:

- **[Instalación de un clic](#instalación-de-un-clic-unos-5-minutos)** (lo normal): un solo dato,
  el código que da el panel. Unos 5 minutos.
- **[Instalación avanzada](#instalación-avanzada-manual-para-soporte)** (manual, para soporte):
  los scripts de siempre, paso por paso, cuando hace falta controlar cada dato.

> ⚠️ Los tiempos todavía no se han medido con una persona real en un restaurante (tarea F1-091),
> ni el instalador de un clic se ha corrido en una PC de restaurante: sólo en las pruebas
> automáticas. Si algo de esta guía no se entiende o tarda más, anótalo.

---

## Instalación de un clic (unos 5 minutos)

**Necesitas:**

- **La PC donde está el SQL Server de SoftRestaurant** (casi siempre la caja principal o la PC
  "servidor"). El agente se instala **en esa misma PC**, con un usuario de Windows que pueda
  "Ejecutar como administrador".
- **El paquete `Instalar-YoControlo.zip`** (se descarga del enlace del panel, o te lo da soporte).
- **Alguien con el panel abierto como administrador** (puedes ser tú, desde el celular).

### Paso 1 · El código, en el panel (1 min)

1. En el panel: **Administración** › **Sucursales**.
2. En la fila de la sucursal, **Conectar sucursal** › **Generar código**.
3. Sale un código como **`K7P-42X`**, con lo que le queda de vida. **Sirve una sola vez y vence
   en 30 minutos.** Si vence o se pierde, genera otro (el anterior deja de servir).

Generar el código **no** corta al agente si la sucursal ya lo tenía instalado: sigue reportando
hasta que el instalador usa el código.

### Paso 2 · Doble clic en la PC del restaurante (1 min)

1. Extrae el `.zip`: clic derecho › **Extraer todo** › Extraer.
2. Abre la carpeta extraída y da **doble clic en `Instalar-YoControlo`**.
3. Windows pregunta si permites que haga cambios: **Sí**. (Si sale "Windows protegió su PC", es
   porque el archivo vino de internet: **Más información** › **Ejecutar de todas formas**.)

### Paso 3 · Escribir el código (3 min)

Cuando diga **`Código de enlace:`**, escribe el del paso 1 (da igual con o sin guión, en
mayúsculas o minúsculas) y Enter. El instalador hace el resto solo:

1. encuentra el SQL Server y la base de SoftRestaurant;
2. revisa (sólo leyendo) que pueda crear el usuario de solo lectura;
3. cambia el código por la "llave" de la sucursal (la API key: nunca la ves ni la copias);
4. crea `monitor_lector` con una contraseña aleatoria que nadie tiene que saber;
5. instala los dos servicios (**ArkonAgente** y su **ArkonAgenteActualizador**) y los arranca;
6. prueba las dos conexiones.

Al final sale un recuadro **verde** con **`LISTO: la sucursal quedó conectada`**. En el panel,
**Administración** › **Agentes**, la sucursal dice **Conectado** en menos de un minuto.

**Sólo te pregunta algo más si:**

| Pregunta | Por qué | Qué hacer |
|---|---|---|
| "¿Cuál es el de SoftRestaurant?" / "¿Cuál es la de esta sucursal?" | Hay más de un SQL Server o más de una base de SoftRestaurant en la PC | Escribe el número de la que usa SoftRestaurant en esta sucursal. Si no sabes, llama a soporte. |
| "Contraseña de 'sa'" | Tu usuario de Windows no es administrador de ese SQL Server | La tiene el soporte de SoftRestaurant. **Sólo se usa para crear el usuario de solo lectura y no se guarda en ningún lado.** El agente nunca usa `sa`. |
| "Dirección del panel" | El paquete no trae la dirección | La del panel, con `https://`. Pide a soporte un paquete que ya la traiga. |

### Si sale un recuadro rojo

El recuadro dice qué pasó y qué hacer. Los casos más comunes:

| Mensaje | Qué cambió | Qué hacer |
|---|---|---|
| "El código no sirve: está mal escrito, ya se usó o ya venció" | Nada | Te deja escribir otro (hasta 3 veces). Genera uno nuevo en el panel. |
| "No pude llegar al panel" | Nada | La PC no tiene internet o un firewall bloquea el panel. Ver el [checklist de red](#checklist-de-firewall-y-red). |
| "Demasiados intentos" | Nada | Espera unos minutos (el panel limita los intentos para que nadie adivine códigos). |
| "No encontré un SQL Server funcionando en esta PC" | Nada | No es la PC del SQL Server de SoftRestaurant. |
| "Este SQL Server sólo acepta usuarios de Windows" | Nada (ni se usó el código) | **No lo cambies tú**: cambiarlo reinicia el SQL de SoftRestaurant y la caja deja de cobrar. Llama a soporte. |
| "… no puede crear usuarios en ese SQL Server" | Nada (ni se usó el código) | Hace falta la contraseña de `sa` o de otro administrador del SQL. Llama a soporte. |
| "No se pudo crear el usuario de solo lectura" (con un mensaje `ALTO`) | El código sí se usó | Alguien ya creó `monitor_lector` con más permisos de los debidos. Llama a soporte. Si el agente ya estaba instalado, siguió funcionando con la llave nueva. |
| "El agente quedó instalado, pero falla una conexión" | Quedó instalado | La línea `[FALLA]` de arriba dice cuál y qué revisar. El agente reintenta solo cada minuto. |
| "El servicio de Windows del agente no arrancó" | Quedó instalado | Llama a soporte con una foto de la ventana. |

**Volver a correrlo siempre es seguro**, también sobre una instalación que ya funcionaba: genera
otro código y repite los pasos 2 y 3. Conserva lo que el agente no había mandado (`cola.db`) y sus
logs; pone una API key y una contraseña nuevas.

### Para soporte: qué hace por dentro

- `Instalar-YoControlo.cmd` se eleva (UAC) y corre `archivos\instalar-un-clic.ps1` con
  `-ExecutionPolicy Bypass`. Acepta el código como argumento:
  `Instalar-YoControlo.cmd K7P-42X`. El `.ps1` también acepta `-ApiUrl`, `-Servidor`, `-Base`,
  `-UsuarioAdmin` y `-CuentaServicio` (ver su cabecera).
- **El orden importa**: todo lo que se puede revisar sin cambiar nada (SQL Server, base, permisos
  con `HAS_PERMS_BY_NAME`, modo mixto) se revisa **antes** de gastar el código. Un código
  equivocado no cambia nada.
- Canjea el código en `POST {apiUrl}/agente/enlace` y recibe una API key **nueva** (la anterior
  de la sucursal deja de servir en ese momento) y, si el despliegue la define
  (`API_URL_PUBLICA`), la URL de la API para el `config.json`.
- Crea o actualiza `monitor_lector` con el mismo `crear-usuario-lector.sql` del modo manual
  (**sólo `db_datareader`**), con una contraseña aleatoria de 32 caracteres (letras, números y
  `- _ . ! @ # * + = ?`; cumple la política de Windows). Va a `sqlcmd` por variable de entorno,
  nunca en la línea de comando. La de `sa`, si se pidió, va en `SQLCMDPASSWORD` de ese proceso y
  se borra en cuanto se crea el lector.
- Escribe `config.json` y llama a `instalar.ps1` (el del modo manual) con la config ya armada:
  protege `C:\ProgramData\ArkonAgente` **antes** de escribirla, registra los servicios y corre
  `agente test`. Si el servicio no arranca con la cuenta virtual, reintenta solo con
  `LocalSystem` y lo dice en el resultado.
- Si al reinstalar falla el paso del lector **después** de usar el código, deja en el agente que
  ya estaba la API key nueva con sus datos de SQL de antes, para que siga reportando.
- Códigos de salida: 0 listo; 1 instalado pero falla una conexión; 2 `config.json` inválido;
  3 no se pudo.

---

## Instalación avanzada (manual, para soporte)

El camino de siempre, con cada dato a mano. Sirve para depurar, para instalar el agente en otra PC
de la red, o si el de un clic no aplica. Usa los mismos archivos del paquete, que están en la
carpeta **`archivos`** del `.zip`.

**Tiempo:** unos 15 minutos.

### Antes de empezar (2 min)

Necesitas:

- [ ] **La PC donde está el SQL Server de SoftRestaurant** y un usuario de Windows administrador.
- [ ] **La carpeta `archivos` del paquete** (`agente.exe`, `instalar.ps1`,
      `crear-usuario-lector.ps1`, `crear-usuario-lector.sql`, `funciones-instalador.ps1`).
- [ ] **La dirección del panel**, por ejemplo `https://monitor.ejemplo.com`.
- [ ] **Alguien que pueda entrar al panel como administrador**, para generar la API key de
      la sucursal (paso 1).

**Si te dieron un `.zip`:** clic derecho > **Propiedades** > marca **Desbloquear** >
Aceptar. Después clic derecho > **Extraer todo**, por ejemplo en `C:\Instalar-YoControlo`.

### Paso 1 · La API key de la sucursal (2 min)

1. En el panel: **Administración** > pestaña **Sucursales**.
2. En la fila de la sucursal, **API key del agente** > **Generar key nueva**.
3. **Cópiala** (empieza con `msr_`). **Se muestra una sola vez.** Si la pierdes, generas otra; la
   anterior deja de servir en ese momento.

> No la mandes por WhatsApp ni por correo. Si la tienes que pasar a otra persona, díctala o
> pégala directo en la PC del restaurante.

### Paso 2 · Abrir PowerShell como administrador (1 min)

1. Menú **Inicio** > escribe `PowerShell`.
2. Clic derecho en **Windows PowerShell** > **Ejecutar como administrador** > **Sí**.
3. Ve a la carpeta `archivos` del paquete:

   ```powershell
   cd C:\Instalar-YoControlo\archivos
   ```

### Paso 3 · Crear el usuario de solo lectura (4 min)

**Primero, elige una contraseña para `monitor_lector`:** de **12 a 64** caracteres, con al menos
una letra y un número, y sólo **letras sin acento**, **números** y `- _ . ! @ # * + = ?` (sin
espacios, sin comillas, sin ñ). **Anótala en papel**: la vas a escribir otra vez en el paso 4.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\crear-usuario-lector.ps1
```

Te pregunta el servidor SQL (si hay uno solo lo propone: Enter), la base de SoftRestaurant (si hay
una sola `softrestaurant...` la propone: Enter) y la contraseña, dos veces (no se ve al escribir).
Tiene que terminar con **`LISTO: monitor_lector sólo puede leer la base de SoftRestaurant.`**

| Mensaje | Qué hacer |
|---|---|
| `Login failed`, `permission denied` o `No se pudo entrar al SQL Server` | Tu usuario de Windows no es administrador de ese SQL Server. Corre otra vez con `-UsuarioAdmin sa` al final: pide la contraseña de `sa` sin mostrarla. **`sa` sólo se usa aquí, nunca en el agente.** |
| `ALTO: este SQL Server solo acepta usuarios de Windows` | No se cambió nada. Cambiarlo reinicia el SQL de SoftRestaurant: **llama a soporte.** |
| `ALTO: el login monitor_lector ya existe y tiene permisos de servidor`, `... con mas permisos que leer` o `... es el DUENO de esta base` | No se cambió nada. Hay que quitarle permisos antes de seguir: llama a soporte. |
| `No encontré sqlcmd.exe` | El mensaje trae la alternativa con SQL Server Management Studio. |
| `The password does not meet the operating system policy requirements` | Corre otra vez con una más larga y con mayúsculas, minúsculas, números y un símbolo. |

**Si ya existía** (`se le CAMBIO la contrasena`): en el paso 4 agrega `-ReemplazarConfig` para
escribirla también en el agente.

### Paso 4 · Instalar el agente (4 min)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1
```

| Pregunta | Qué escribir |
|---|---|
| Dirección del panel | La del panel, con `https://` |
| API key de la sucursal | La del paso 1. Pégala con clic derecho: no se ve, es normal. |
| Servidor SQL de SoftRestaurant | El mismo del paso 3 |
| Base de SoftRestaurant | La misma del paso 3 |
| Usuario SQL de solo lectura | Enter (`monitor_lector`) |
| Contraseña de monitor_lector | La del paso 3 |

**No escribas la API key ni la contraseña en la línea del comando**: el script las pide sin
mostrarlas, para que no queden en el historial de PowerShell.

Copia el agente a `C:\Program Files\ArkonAgente`, guarda la configuración en
`C:\ProgramData\ArkonAgente` (sólo la abren los administradores), registra y arranca los servicios
**ArkonAgente** y **ArkonAgenteActualizador** (éste sólo instala versiones nuevas si en el panel se
encendió la actualización automática de la sucursal: `docs/actualizacion-agente.md`) y prueba las
dos conexiones.

### Paso 5 · Leer el resultado (1 min)

```text
[OK]    Configuración: C:\ProgramData\ArkonAgente\config.json
[OK]    SQL Server (SoftRestaurant): ...
[OK]    API del monitor: API key válida: sucursal 'Centro' (...)

Resultado: OK. Las dos conexiones funcionan.

LISTO: el agente quedó instalado y reportando.
```

Si algo dice **`[FALLA]`**, la línea de abajo (`Qué hacer:`) dice qué revisar:

| Falla | Causa probable | Qué hacer |
|---|---|---|
| SQL: `Login failed` / error 18456 | La contraseña de `monitor_lector` no es la del paso 3 | `.\instalar.ps1 -ReemplazarConfig` y escríbela bien |
| SQL: `No se pudo llegar al servidor SQL` / error 53 o 258 | El nombre del servidor está mal escrito | `-ReemplazarConfig` con el servidor del paso 3 |
| SQL: `el usuario tiene permisos de escritura` | El usuario tiene más permisos que leer | **No lo dejes así.** Llama a soporte |
| SQL: `no existe la base` / error 4060 | El nombre de la base está mal | `-ReemplazarConfig` con la base del paso 3 |
| API: `401` / key incorrecta | La key está mal pegada, o se generó otra después | Genera una key nueva (paso 1) y `-ReemplazarConfig` |
| API: DNS, red, timeout o TLS | La PC no llega al panel por internet | Revisa el [checklist de firewall](#checklist-de-firewall-y-red) |
| `config.json tiene errores` | Algún dato con formato inválido | `-ReemplazarConfig` |

**Aunque el diagnóstico falle, el servicio queda instalado** y vuelve a intentar solo cada
minuto. Si el script dice **`El servicio no arrancó`** o **`se detuvo después de arrancar`**, corre
otra vez agregando `-CuentaServicio LocalSystem` y avisa a soporte.

### Paso 6 · Confirmar en el panel (1 min)

**Administración** > pestaña **Agentes**: en menos de un minuto la sucursal dice **Conectado**.

---

## Checklist de firewall y red

El agente sólo necesita **salir** a internet por HTTPS. No abre ningún puerto de entrada.

- [ ] **Salida HTTPS (puerto 443) al dominio del panel.** Si el restaurante tiene un firewall,
      un proxy o un filtro web, pide que lo permitan.
- [ ] **El antivirus no bloquea** `C:\Program Files\ArkonAgente\agente.exe` (ni
      `Instalar-YoControlo.cmd` mientras instalas). Si lo pone en cuarentena, agrégalo como
      excepción.
- [ ] **Nada de puertos de entrada.** No hay que abrir nada hacia la PC del restaurante.
- [ ] **SQL Server:** con el agente en la misma PC que el SQL Server (lo recomendado) no hay que
      abrir ningún puerto. Sólo si el agente va en **otra** PC de la red (instalación avanzada):
      TCP 1433 (o el puerto de la instancia) y UDP 1434 (SQL Browser) **dentro de la red local**,
      nunca hacia internet.
- [ ] **La hora de la PC es correcta** (zona horaria y sincronización automática). Con la hora
      muy desfasada, HTTPS falla.

## Actualizar el agente

Si la sucursal tiene la **actualización automática** encendida (Administración ›
Actualizaciones), no hace falta nada: el agente toma solo la versión que se publique.

A mano: con la carpeta `archivos` de la versión nueva, en PowerShell como administrador,
`powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1`. Detiene el servicio, cambia
el `agente.exe` y lo vuelve a arrancar; **conserva** la configuración y la cola. (También sirve
volver a correr el de un clic con un código nuevo: además rota la key y la contraseña.)

## Desinstalar

En PowerShell como administrador:

```powershell
sc.exe stop ArkonAgenteActualizador
sc.exe delete ArkonAgenteActualizador
sc.exe stop ArkonAgente
sc.exe delete ArkonAgente
```

(Escribe `sc.exe`, no `sc`: en PowerShell `sc` es otro comando.)

Después puedes borrar `C:\Program Files\ArkonAgente`. **No borres
`C:\ProgramData\ArkonAgente\cola.db`** si el agente estuvo sin internet: ahí puede haber ventas
que todavía no llegaron al panel. Pregunta a soporte antes.

El usuario `monitor_lector` se queda en el SQL Server. Sólo puede leer, así que no estorba; si
quieres quitarlo, pídelo a soporte.

## Qué NO hacer

- **No le des al agente el usuario `sa`** ni ningún usuario administrador del SQL Server. Sólo
  `monitor_lector`. (El de un clic puede pedir la contraseña de `sa` para **crear** el lector, pero
  no la guarda ni el agente la usa.)
- **No le des más permisos a `monitor_lector`.** Si el diagnóstico dice que "puede escribir", es
  un problema, no una ventaja.
- **No cambies el modo de autenticación ni reinicies el SQL Server** de SoftRestaurant durante el
  servicio: la caja deja de cobrar.
- **No borres `cola.db`** (ver "Desinstalar").
- **No copies `config.json` a otra PC ni lo mandes por correo:** trae la API key y la contraseña.
- **No mandes el código de enlace por un grupo de WhatsApp.** Dura 30 minutos y sirve una vez,
  pero mientras tanto vale lo mismo que la API key.

## Si algo sale mal

- **El log del agente:** `C:\ProgramData\ArkonAgente\logs\agente-AAAAMMDD.log` (uno por día).
  Para abrirlo hace falta ser administrador.
- **Volver a probar las conexiones** sin reinstalar:

  ```powershell
  & "C:\Program Files\ArkonAgente\agente.exe" test
  ```

- **Estado del servicio:** `sc.exe query ArkonAgente` (tiene que decir `RUNNING`).
- Detalle técnico (qué revisa cada cosa, la cola, el heartbeat, cómo se arma el paquete):
  `agent/README.md`.
