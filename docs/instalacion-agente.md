# Instalar el agente en un restaurante

Esta guía deja el agente de ArkonAgente leyendo SoftRestaurant y reportando al panel.
Está escrita para alguien que **no** es técnico: sigue los pasos en orden y copia los
comandos tal cual.

**Tiempo:** unos 15 minutos.

> ⚠️ Los 15 minutos todavía no se han medido con una persona real en un restaurante. Esa
> prueba es la tarea F1-091. Si algo de esta guía no se entiende o tarda más, anótalo:
> sirve para corregirla.

**Qué hace el agente:** es un servicio de Windows que, cada 30 segundos, **lee** la base
de SoftRestaurant y manda los datos al panel por internet. **Nunca escribe en
SoftRestaurant**: entra con un usuario que sólo puede leer (lo creas en el paso 3). Si el
internet se cae, guarda lo pendiente y lo manda cuando vuelve.

---

## Antes de empezar (2 min)

Necesitas:

- [ ] **La PC donde está el SQL Server de SoftRestaurant.** Casi siempre es la caja
      principal, o la PC "servidor" del restaurante. Instala el agente **en esa misma PC**.
- [ ] **Un usuario de Windows administrador** en esa PC.
- [ ] **La carpeta del agente** (te la da soporte, normalmente como un `.zip`). Adentro
      vienen:
      - `agente.exe`
      - `instalar.ps1`
      - `crear-usuario-lector.ps1`
      - `crear-usuario-lector.sql`
      - `funciones-instalador.ps1`
- [ ] **La dirección del panel**, por ejemplo `https://monitor.ejemplo.com`.
- [ ] **Alguien que pueda entrar al panel como administrador**, para generar la API key de
      la sucursal (paso 1). Puedes ser tú.

**Si te dieron un `.zip`:** clic derecho > **Propiedades** > marca **Desbloquear** >
Aceptar. Después clic derecho > **Extraer todo**, por ejemplo en
`C:\ArkonAgente-instalador`. (Sin desbloquearlo, Windows puede negarse a correr los
scripts.)

## Paso 1 · La API key de la sucursal (2 min)

La API key es la "llave" con la que el agente se identifica ante el panel. Cada sucursal
tiene la suya.

1. Entra al panel con un usuario administrador.
2. Ve a **Administración** > pestaña **Sucursales**.
3. En la fila de la sucursal, clic en **API key del agente** > **Generar key nueva**.
4. **Cópiala** (empieza con `msr_`) y tenla a la mano. **Se muestra una sola vez.** Si la
   pierdes, generas otra; la anterior deja de servir en ese momento.

> No la mandes por WhatsApp ni por correo. Si la tienes que pasar a otra persona, díctala o
> pégala directo en la PC del restaurante.

## Paso 2 · Abrir PowerShell como administrador (1 min)

Todos los comandos de esta guía se escriben aquí.

1. Menú **Inicio** > escribe `PowerShell`.
2. Clic derecho en **Windows PowerShell** > **Ejecutar como administrador** > **Sí**.
3. Ve a la carpeta del agente (cambia la ruta si la extrajiste en otro lado):

   ```powershell
   cd C:\ArkonAgente-instalador
   ```

## Paso 3 · Crear el usuario de solo lectura (4 min)

El agente entra al SQL Server de SoftRestaurant con un usuario propio, `monitor_lector`,
que **sólo puede leer**. Este paso lo crea.

**Primero, elige una contraseña para ese usuario:**

- de **12 a 64** caracteres;
- con al menos una letra y un número;
- sólo **letras sin acento**, **números** y estos símbolos: `- _ . ! @ # * + = ?`
  (sin espacios, sin comillas, sin ñ).

**Anótala en papel**: la vas a escribir otra vez en el paso 4.

Luego corre:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\crear-usuario-lector.ps1
```

El script te pregunta:

1. **Servidor SQL.** Si en la PC hay uno solo, ya lo propone (por ejemplo
   `.\NATIONALSOFT`): presiona Enter.
2. **Base de SoftRestaurant.** Te muestra las bases que hay. Si hay una sola que se llama
   `softrestaurant...` la propone: presiona Enter. Si no, escribe el nombre de la base de
   SoftRestaurant.
3. **La contraseña**, dos veces. No se ve al escribir: es normal.

Tiene que terminar con **`LISTO: monitor_lector sólo puede leer la base de
SoftRestaurant.`**

Si en cambio sale:

| Mensaje | Qué hacer |
|---|---|
| `Login failed`, `permission denied` o `No se pudo entrar al SQL Server` | Tu usuario de Windows no es administrador de ese SQL Server. Si sabes la contraseña de `sa` (suele tenerla el soporte de SoftRestaurant), corre otra vez con `-UsuarioAdmin sa` al final del comando. El script te pide la contraseña de `sa` sin mostrarla. **`sa` sólo se usa aquí, nunca en el agente.** |
| `ALTO: este SQL Server solo acepta usuarios de Windows` | No se cambió nada. Para cambiar eso hay que reiniciar el SQL Server de SoftRestaurant, y la caja deja de funcionar mientras tanto. **No lo hagas tú:** llama a soporte. |
| `ALTO: el login monitor_lector ya existe y tiene permisos de servidor`, `ALTO: ... con mas permisos que leer` o `... es el DUENO de esta base` | Alguien ya creó ese usuario con más permisos de los debidos. No se cambió nada. Llama a soporte: hay que quitárselos antes de seguir. |
| `No encontré sqlcmd.exe` | El mensaje trae la alternativa con SQL Server Management Studio. Si no la tienes, llama a soporte. |
| `The password does not meet the operating system policy requirements` | Windows pide una contraseña más fuerte. Corre otra vez con una más larga y con mayúsculas, minúsculas, números y un símbolo. |

**Si ya existía** (`se le CAMBIO la contrasena`): el usuario sólo podía leer y se le puso
la contraseña nueva. Si el agente ya estaba instalado, en el paso 4 agrega
`-ReemplazarConfig` para escribirla también en el agente.

## Paso 4 · Instalar el agente (4 min)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1
```

Te pregunta, uno por uno:

| Pregunta | Qué escribir |
|---|---|
| Dirección del panel | La del panel, con `https://` |
| API key de la sucursal | La del paso 1. Pégala con clic derecho: no se ve, es normal. |
| Servidor SQL de SoftRestaurant | El mismo del paso 3 (Enter si ya lo propone) |
| Base de SoftRestaurant | La misma del paso 3 |
| Usuario SQL de solo lectura | Enter (`monitor_lector`) |
| Contraseña de monitor_lector | La del paso 3 |

**No escribas la API key ni la contraseña en la línea del comando.** El script las pide
sin mostrarlas, para que no queden guardadas en el historial de PowerShell.

El script copia el agente a `C:\Program Files\ArkonAgente`, guarda la configuración en
`C:\ProgramData\ArkonAgente` (una carpeta que sólo pueden abrir los administradores),
registra el servicio **ArkonAgente**, lo arranca y al final prueba las dos conexiones.
También registra un segundo servicio pequeño, **ArkonAgenteActualizador**: es el que instala
solo las versiones nuevas del agente, pero sólo si en el panel se encendió la actualización
automática de esa sucursal (ver `docs/actualizacion-agente.md`).

## Paso 5 · Leer el resultado (1 min)

Al final sale un diagnóstico como éste:

```text
[OK]    Configuración: C:\ProgramData\ArkonAgente\config.json
[OK]    SQL Server (SoftRestaurant): ...
[OK]    API del monitor: API key válida: sucursal 'Centro' (...)

Resultado: OK. Las dos conexiones funcionan.

LISTO: el agente quedó instalado y reportando.
```

**Si dice `Resultado: OK` y termina en `LISTO`**, sigue al paso 6.

Si algo dice **`[FALLA]`**, la línea de abajo (`Qué hacer:`) dice qué revisar. Los casos
más comunes:

| Falla | Causa probable | Qué hacer |
|---|---|---|
| SQL: `Login failed` / error 18456 | La contraseña de `monitor_lector` no es la del paso 3 | `.\instalar.ps1 -ReemplazarConfig` y escríbela bien |
| SQL: `No se pudo llegar al servidor SQL` / error 53 o 258 | El nombre del servidor está mal escrito | `-ReemplazarConfig` con el servidor del paso 3 |
| SQL: `el usuario tiene permisos de escritura` | El usuario tiene más permisos que leer (no es el del paso 3, o alguien se los dio) | **No lo dejes así.** Llama a soporte |
| SQL: `no existe la base` / error 4060 | El nombre de la base está mal | `-ReemplazarConfig` con la base del paso 3 |
| API: `401` / key incorrecta | La key está mal pegada, o se generó otra después | Genera una key nueva (paso 1) y `-ReemplazarConfig` |
| API: DNS, red, timeout o TLS | La PC no llega al panel por internet | Revisa el [checklist de firewall](#checklist-de-firewall-y-red) |
| `config.json tiene errores` | Algún dato con formato inválido | `-ReemplazarConfig` |

Para volver a escribir los datos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1 -ReemplazarConfig
```

**Aunque el diagnóstico falle, el servicio queda instalado** y vuelve a intentar solo cada
minuto: en cuanto corriges el dato, empieza a reportar sin reiniciar nada.

Si el script dice **`El servicio no arrancó`** o **`se detuvo después de arrancar`**,
corre otra vez agregando `-CuentaServicio LocalSystem` y avisa a soporte que hizo falta.

## Paso 6 · Confirmar en el panel (1 min)

En el panel: **Administración** > pestaña **Agentes**. En menos de un minuto la sucursal
tiene que decir **Conectado**, con la versión de SoftRestaurant y "última lectura" hace unos
segundos.

**Listo.** El agente arranca solo con Windows y se levanta solo si se cae.

---

## Checklist de firewall y red

El agente sólo necesita **salir** a internet por HTTPS. No abre ningún puerto de entrada.

- [ ] **Salida HTTPS (puerto 443) al dominio del panel** (el de la dirección del paso 4).
      Si el restaurante tiene un firewall, un proxy o un filtro web, pide que lo permitan.
- [ ] **El antivirus no bloquea** `C:\Program Files\ArkonAgente\agente.exe`. Si lo pone en
      cuarentena, agrégalo como excepción.
- [ ] **Nada de puertos de entrada.** No hay que abrir nada hacia la PC del restaurante.
- [ ] **SQL Server:** con el agente en la misma PC que el SQL Server (lo recomendado) no
      hay que abrir ningún puerto. Sólo si el agente va en **otra** PC de la red: TCP 1433
      (o el puerto de la instancia) y UDP 1434 (SQL Browser) **dentro de la red local**,
      nunca hacia internet.
- [ ] **La hora de la PC es correcta** (zona horaria y sincronización automática). Con la
      hora muy desfasada, HTTPS falla.

## Actualizar el agente

Con la carpeta de la versión nueva, en PowerShell como administrador:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1
```

Detiene el servicio, cambia el `agente.exe` y lo vuelve a arrancar. **Conserva** la
configuración y la cola: lo que no se había mandado se manda después.

Si la sucursal tiene la **actualización automática** encendida (Administración ›
Actualizaciones, en el panel), no hace falta: el agente toma solo la versión que se publique.
El script sigue sirviendo para actualizar el propio actualizador.

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
`C:\ProgramData\ArkonAgente\cola.db`** si el agente estuvo sin internet: ahí puede haber
ventas que todavía no llegaron al panel. Pregunta a soporte antes.

El usuario `monitor_lector` se queda en el SQL Server. Sólo puede leer, así que no estorba;
si quieres quitarlo, pídelo a soporte.

## Qué NO hacer

- **No le des al agente el usuario `sa`** ni ningún usuario administrador del SQL Server.
  Sólo `monitor_lector`.
- **No le des más permisos a `monitor_lector`.** Si el diagnóstico dice que "puede
  escribir", es un problema, no una ventaja.
- **No cambies el modo de autenticación ni reinicies el SQL Server** de SoftRestaurant
  durante el servicio: la caja deja de cobrar.
- **No borres `cola.db`** (ver "Desinstalar").
- **No copies `config.json` a otra PC ni lo mandes por correo:** trae la API key y la
  contraseña.

## Si algo sale mal

- **El log del agente:** `C:\ProgramData\ArkonAgente\logs\agente-AAAAMMDD.log` (uno por
  día). Para abrirlo hace falta ser administrador.
- **Volver a probar las conexiones** sin reinstalar:

  ```powershell
  & "C:\Program Files\ArkonAgente\agente.exe" test
  ```

- **Estado del servicio:** `sc.exe query ArkonAgente` (tiene que decir `RUNNING`).
- Detalle técnico (qué revisa cada cosa, la cola, el heartbeat): `agent/README.md`.
