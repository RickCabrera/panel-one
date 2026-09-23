# Agente ArkonAgente (.NET 8)

Servicio de Windows que corre en la PC del restaurante, lee la base SQL Server de
SoftRestaurant en **solo lectura** y sube los datos al API del monitor con la API key de
la sucursal.

Estado: F1-020 entrega el esqueleto (servicio, configuración, logs y `agente test`), F1-021
la detección de la versión de SoftRestaurant, F1-024 la cola local con el envío al API y
F1-025 el heartbeat. La lectura de ventas y mesas (lo que llena la cola) llega en F1-022 /
F1-023. El instalador está en [`instalador/`](instalador/) y la guía para personas no
técnicas en [`docs/instalacion-agente.md`](../docs/instalacion-agente.md) (F1-026).

## Compilar, probar y publicar

```powershell
cd agent
dotnet build --configuration Release
dotnet test  --configuration Release

# Un solo agente.exe self-contained (no hace falta instalar .NET en la PC del restaurante):
dotnet publish src/ArkonAgente -c Release -r win-x64 -o publish
```

`publish/` queda con `agente.exe` (y su `.pdb`, que no hace falta copiar).

### Armar el paquete del instalador

Lo que se le entrega al restaurante es una carpeta (o un `.zip`) con `agente.exe` y los
cuatro archivos de [`instalador/`](instalador/), todos juntos:

```powershell
cd agent
dotnet publish src/ArkonAgente -c Release -r win-x64 -o publish
New-Item -ItemType Directory paquete -Force | Out-Null
Copy-Item publish\agente.exe, instalador\* paquete\
Compress-Archive paquete\* ArkonAgente-instalador.zip -Force
```

| Archivo | Qué es |
|---|---|
| `agente.exe` | El agente. |
| `crear-usuario-lector.ps1` | Paso 3 de la guía: crea el usuario SQL de solo lectura. Pide la contraseña sin mostrarla y corre el `.sql` con `sqlcmd`. |
| `crear-usuario-lector.sql` | El T-SQL. **Sólo otorga `db_datareader`** (lo vigila `InstaladorSqlTests`). |
| `instalar.ps1` | Paso 4: copia el exe, protege la carpeta, escribe `config.json`, registra y arranca el servicio y corre `agente test`. |
| `funciones-instalador.ps1` | Funciones compartidas de los dos scripts (las prueba `InstaladorPs1Tests`). |

Los `.ps1` y el `.sql` van en **UTF-8 con BOM** (PowerShell 5.1 y `sqlcmd` leen un archivo
sin BOM como ANSI y los acentos salen rotos); hay un test que lo vigila.

## Configuración

Carpeta del agente: **`C:\ProgramData\ArkonAgente`**.

| Archivo | Qué es |
|---|---|
| `config.json` | La configuración. **Trae secretos** (API key y password de SQL): nunca va al repo. |
| `logs\agente-AAAAMMDD.log` | Log diario (Serilog). Se guardan 14 días; los más viejos se borran solos. |
| `cola.db` (+ `cola.db-wal`, `cola.db-shm`) | La cola local (SQLite): lo que falta mandar al API. Ver [Cola local y envío](#cola-local-y-envío-f1-024). |

Plantilla: [`infra/config.example.json`](../infra/config.example.json).

```json
{
  "apiUrl": "https://monitor.ejemplo.com",
  "apiKey": "msr_...",
  "connectionString": "Server=.\\SQLEXPRESS;Database=...;User ID=monitor_lector;Password=...;TrustServerCertificate=True",
  "intervaloSegundos": 30,
  "horaSincronizacionCatalogos": "04:00"
}
```

- `apiUrl`: URL **base** del API, con `https://` (con `http://` sólo se acepta `localhost`,
  para desarrollo). Si el API vive bajo un prefijo, va incluido (`https://x.com/api`).
- `apiKey`: la que da el panel en Administración → Sucursales → rotar key. Se muestra una
  sola vez.
- `connectionString`: cadena de SQL Server hacia la base de SoftRestaurant, con un usuario
  **de solo lectura** (sólo el rol `db_datareader`). Con autenticación SQL (`User ID` /
  `Password`), no de Windows: con `Integrated Security=True` el servicio entraría a SQL
  Server con la cuenta del servicio, y si se instaló como LocalSystem, como
  `NT AUTHORITY\SYSTEM`, que en los SQL Express viejos suele ser sysadmin. `TrustServerCertificate=True` es lo normal en un
  SQL Express local con certificado autofirmado (ver `docs/esquema-sr.md` §11).
  El agente agrega por su cuenta `Application Name=ArkonAgente` (para verlo en
  `sp_who2`) y un `Connect Timeout` de 5 s si no se puso uno (tope: 15 s).
- `intervaloSegundos`: opcional, 30 por defecto, entre 5 y 3600.
- `horaSincronizacionCatalogos`: opcional, `"04:00"` por defecto. Hora (24 h, `"HH:mm"`) de la
  sincronización diaria de catálogos (F2-240), **en el reloj de esta PC**, no en la zona de la
  sucursal del panel.

El archivo acepta comentarios `//` y comas finales. En JSON las barras invertidas se
escriben dobles: `.\\SQLEXPRESS`.

Para desarrollo, la variable de entorno `ARKON_AGENTE_DIR` cambia la carpeta.

### Permisos de la carpeta

`config.json` trae la API key y el password de SQL. La carpeta queda sólo para SYSTEM,
Administradores y la cuenta del servicio (Modificar: lee el config, escribe logs y cola).
`instalar.ps1` lo hace solo; a mano, en una consola de administrador:

```powershell
mkdir C:\ProgramData\ArkonAgente
icacls C:\ProgramData\ArkonAgente /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
icacls C:\ProgramData\ArkonAgente /inheritance:r
# Ya creado el servicio (su SID sólo existe desde entonces):
icacls C:\ProgramData\ArkonAgente /grant "NT SERVICE\ArkonAgente:(OI)(CI)M"
```

Van por SID y no por nombre (`S-1-5-18` = SYSTEM, `S-1-5-32-544` = Administradores),
porque en un Windows en español el grupo se llama "Administradores" y `Administrators`
fallaría. Y en dos pasos a propósito: primero se dan los permisos y después se corta la
herencia. Si el primero falla, la carpeta no se queda sin dueño.

Por eso `agente test` se corre desde una consola de administrador.

## `agente test`

Valida la configuración y **las dos conexiones**, siempre las dos aunque la primera falle,
y dice cuál falla:

```text
> agente.exe test
Diagnóstico del agente ArkonAgente

[OK]    Configuración: C:\ProgramData\ArkonAgente\config.json
[FALLA] SQL Server (SoftRestaurant): No se pudo llegar al servidor SQL (servidor=.\SQLEXPRESS, base=..., usuario=monitor_lector; error 53).
        Qué hacer: Revisa el nombre del servidor e instancia ...
[OK]    API del monitor: API key válida: sucursal 'Centro' (...), zona horaria America/Mexico_City.

Resultado: FALLA la conexión a SQL Server (SoftRestaurant). La otra funciona.
```

- **SQL Server**: abre la conexión y corre `Sql/Consultas/diagnostico.sql`, que sólo lee
  funciones de sistema (versión, base, login, roles y permisos). No toca ninguna tabla de
  SoftRestaurant. Si el usuario **puede escribir** (sysadmin, db_owner, db_datawriter,
  db_ddladmin, permiso INSERT/UPDATE/DELETE/ALTER/CREATE TABLE sobre la base, o
  INSERT/UPDATE/DELETE/ALTER sobre el esquema `dbo` o sobre alguna de las tablas que lee el
  agente), sale **FALLA** aunque la conexión funcione. Límite: un permiso concedido sobre una
  tabla que el agente NO lee no se detecta.
- **API**: `GET {apiUrl}/agente/yo` con el header `X-Api-Key`. Un 401 significa key
  incorrecta o rotada, o sucursal o empresa inactiva (el API no distingue a propósito).

`agente.exe test --config RUTA` prueba otro archivo.

| Código de salida | Significado |
|---|---|
| 0 | Configuración válida y las dos conexiones funcionan. |
| 1 | Falla al menos una conexión (o el usuario SQL puede escribir). |
| 2 | La configuración es inválida; no se probó ninguna conexión. |
| 64 | Comando no reconocido. |

## Instalar como servicio de Windows

**Lo normal es `instalar.ps1`** (guía: [`docs/instalacion-agente.md`](../docs/instalacion-agente.md)).
Corre exactamente estos comandos, más la carpeta y el `config.json`. Lo que sigue es la
referencia para hacerlo a mano o para depurar.

Consola **de administrador**. Supone el exe copiado en `C:\Program Files\ArkonAgente\`.
Ojo: en `sc.exe` el espacio después de `=` es obligatorio, y en PowerShell hay que escribir
`sc.exe`: `sc` a secas es `Set-Content`.

```powershell
sc.exe create ArkonAgente binPath= "\"C:\Program Files\ArkonAgente\agente.exe\"" start= delayed-auto DisplayName= "ArkonAgente (monitor SoftRestaurant)" obj= "NT SERVICE\ArkonAgente"
sc.exe description ArkonAgente "Lee SoftRestaurant en solo lectura y reporta al monitor."
sc.exe sidtype ArkonAgente unrestricted

# Si el proceso se cae, el administrador de servicios lo levanta al minuto (tres veces;
# el contador se reinicia cada 24 h). failureflag 1: también si se detiene con error.
sc.exe failure ArkonAgente reset= 86400 actions= restart/60000/restart/60000/restart/60000
sc.exe failureflag ArkonAgente 1

sc.exe start ArkonAgente
sc.exe query ArkonAgente
```

- `start= delayed-auto`: arranca con Windows, un poco después de los servicios críticos,
  para que el SQL Server de SoftRestaurant ya esté arriba.
- Corre como la **cuenta virtual `NT SERVICE\ArkonAgente`** (F1-026): sin contraseña, sin
  permisos fuera de su carpeta de datos y del exe. Al SQL Server entra con el usuario SQL de
  `config.json`, no con la cuenta de Windows, y para salir a internet no necesita más.
  `DECISION PROVISIONAL (nocturno)`: **nunca se ha corrido como servicio** (F1-020b). Si con
  ella no arranca, `instalar.ps1 -CuentaServicio LocalSystem` (o `obj= LocalSystem`).
- `sidtype unrestricted` pone el SID del servicio en su token: es a quien se le da permiso
  sobre `C:\ProgramData\ArkonAgente`.
- **Una falla interna no prevista mata el proceso con código 1** (queda como `Critical` en
  el log), para que `sc failure` lo levante. Sin eso, .NET 8 detendría el servicio "limpio"
  y Windows no lo reiniciaría.
- **Con `config.json` inválido el servicio no se cae**: registra el error en el log y vuelve
  a leer el archivo cada minuto. En cuanto se corrige, sigue solo, sin reiniciar nada.
- Al arrancar deja en el log el mismo diagnóstico de `agente test`.
- Después **detecta la versión de SoftRestaurant** y elige con qué la va a leer (ver abajo).

Para quitarlo:

```powershell
sc.exe stop ArkonAgente
sc.exe delete ArkonAgente
```

> **Pendiente de verificar (F1-020b, diurna):** nada de esta sección ni de `instalar.ps1`
> se ha corrido con elevación: ni `sc.exe create`, ni el `icacls`, ni la cuenta virtual,
> ni el arranque con Windows, ni el reinicio tras una caída. Las sesiones que lo
> escribieron no tenían consola de administrador. Tampoco se ha ejecutado nunca
> `crear-usuario-lector.sql`.

## Detección de la versión de SoftRestaurant (F1-021)

Al arrancar, y en cada ciclo mientras no lo logre, el servicio corre dos consultas de
**solo lectura** (`WITH (NOLOCK)`, timeout de 5 s):

1. `Sql/Consultas/sr_estructura.sql`: sólo vistas de catálogo. Revisa si en `dbo` existen
   `parametros2` con la columna `versiondb` y las tablas de cuentas (`cheques`, `cheqdet`,
   `chequespagos`, `tempcheques`, `tempcheqdet`).
2. `Sql/Consultas/sr_version.sql`: lee `dbo.parametros2.versiondb`, y sólo si existe.

Qué deja en el log:

| Caso | Nivel | Mensaje (resumido) |
|---|---|---|
| Versión 10 | Information | `SoftRestaurant versión 10.021800 detectado; se lee con SrV11Reader.` |
| Versión 11 | Information + Warning | lo mismo, más "no se ha validado contra una instalación real" |
| Otra versión, base equivocada, tablas faltantes | Error | la causa, y "el agente no leerá ventas hasta resolverlo" |
| No se pudo consultar (servidor apagado, certificado, credenciales) | Warning | la causa y qué hacer |

- **Nunca tumba el servicio.** Reintenta en cada ciclo y registra cada mensaje distinto
  una sola vez.
- **Con el reader elegido ya no vuelve a detectar.** Si se actualiza SoftRestaurant,
  reinicia el servicio.
- La versión y el último error quedan en `EstadoSoftRestaurant`. Ahí los toma el heartbeat
  (F1-025).
- Qué se sabe de cada versión, y qué es sólo supuesto: `docs/esquema-sr.md` §1.

## Cola local y envío (F1-024)

Todo lo que el agente manda al API pasa primero por `cola.db`, un SQLite en la carpeta del
agente. Es el **estado propio del agente**: nunca se escribe nada en la base de
SoftRestaurant.

Tabla `eventos`:

| Columna | Qué es |
|---|---|
| `id` | Autoincremental. Es el orden FIFO y el `id` del evento en el lote. |
| `tipo` | `cheque`, `snapshot` o `heartbeat`. |
| `clave` | El `folioSr` en los cheques; nulo en los demás. |
| `payload` | El `datos` del contrato de `POST /ingesta/eventos`, en JSON. |
| `creado_at`, `enviado_at`, `rechazado_at` | UTC, texto de ancho fijo. |
| `intentos` | Envíos fallidos. |
| `motivo_rechazo` | Por qué el API lo rechazó para siempre. |

Cada ciclo (`intervaloSegundos`) el servicio:

1. **Purga** lo enviado o rechazado hace más de 7 días. Un pendiente nunca se purga.
2. **Manda lo pendiente** a `POST {apiUrl}/ingesta/eventos`, en lotes de hasta 100 eventos,
   en orden de llegada, con el body en **gzip** y el header `X-Api-Key`. Manda como máximo
   `min(intervaloSegundos, 20)` lotes por ciclo, así que nunca pasa de 60 peticiones por
   minuto (el API permite 120 por sucursal).

Qué garantiza:

- **Nada sale de la cola sin que el API lo confirme.** Es "al menos una vez": si el API
  guardó un lote y la respuesta se perdió, se reenvía, y el API lo deja igual (upsert por
  folio).
- **Sólo el último pendiente cuenta** para el snapshot de mesas, para el heartbeat y para
  cada `folioSr`. Encolar uno nuevo borra el pendiente anterior en la misma transacción.
  Así la cola no crece por snapshots durante un corte, y un reintento de una versión vieja
  de un cheque no puede pisar a la nueva.
- **Red caída, timeout, 5xx, 401, 429, 400 o respuesta ilegible:** no se descarta nada.
  Se vuelve a intentar con espera creciente: 30 s, 1, 2, 4, 8 min y luego cada 10 min.
  Queda un `Error` en el log, una vez por cada falla distinta, y un `Information` cuando se
  restablece. Al reiniciar el servicio se intenta de inmediato.
- **Un 400 que no se va** (un proxy, un API de otra versión) detiene la cola sin perder
  nada. Se reintenta cada 10 min para siempre: revisa el log y `apiUrl`.
- **Rechazo definitivo** (`reintentable: false` del API, o un evento que ni solo cabe en
  los 5 MB): sale de la cola con `rechazado_at` y su motivo, y queda un `Error` en el log.
  **Un cheque rechazado es una venta que falta en el panel.** Se guarda 7 días.

Para mirarla sin tocar nada (con el servicio corriendo también funciona):

```powershell
sqlite3 -readonly "C:\ProgramData\ArkonAgente\cola.db" "SELECT tipo, COUNT(*) FROM eventos WHERE enviado_at IS NULL AND rechazado_at IS NULL GROUP BY tipo;"
sqlite3 -readonly "C:\ProgramData\ArkonAgente\cola.db" "SELECT id, tipo, clave, motivo_rechazo FROM eventos WHERE rechazado_at IS NOT NULL;"
```

- **Borrar `cola.db` pierde lo que no se había mandado.** Hazlo sólo con el servicio
  detenido y si el archivo está dañado.
- **Si `cola.db` está dañado o el disco está lleno**, el servicio registra un `Critical`,
  termina con código 1 y `sc failure` lo levanta, en ciclo. Para salir: detén el servicio,
  mueve `cola.db*` a otro lado (no lo borres: puede tener cheques sin mandar) y arráncalo.
  Se crea una cola nueva y vacía.
- El SQLite nativo (`e_sqlite3`) va dentro de `agente.exe` al publicar en un solo archivo.
  No hay DLL que copiar.

## Heartbeat y auto-diagnóstico (F1-025)

En **cada ciclo**, el servicio hace tres cosas, en este orden:

1. **Consulta SoftRestaurant.** Mientras no haya versión detectada, detecta (F1-021). Con el
   reader elegido, corre la **sonda** `sr_sondeo.sql`: una fila de `dbo.parametros2`, con
   `WITH (NOLOCK)` y el timeout corto. Mide cuánto tarda la consulta (sin contar el abrir la
   conexión).
2. **Encola un heartbeat.** Siempre, pase lo que pase en el paso 1. Una excepción ahí no corta
   el ciclo: queda en el log (`Error`, una vez por tipo) y en el heartbeat.
3. **Vacía la cola** hacia el API (F1-024). El heartbeat viaja en el mismo lote: no suma
   peticiones.

Así sale **un lote por ciclo aunque no haya ventas**, que es lo que el panel lee como
"conectado" (F1-061: más de 90 s sin lote = "Desconectado").

Qué lleva el heartbeat:

| Campo | De dónde sale |
|---|---|
| `versionAgente` | La versión del exe, con el commit recortado (`1.0.0+1a99dc7`). |
| `versionSr` | La versión leída de SR (`10.021800`); también si no se soporta (`12.000000`). Null si no se pudo leer. |
| `ultimaLecturaAt` | La última vez que la **sonda** respondió (UTC). No avanza si falla. |
| `latenciaQueryMs` | Lo que tardó la sonda de este ciclo; null si falló o todavía no hay reader. |
| `tamanoCola` | Pendientes en `cola.db` **sin contar el heartbeat** (se colapsa y viaja en el lote que lo reporta). |
| `ultimoError` | Ver abajo; null si todo está bien. |

> ⚠️ **"Última lectura" hoy es la sonda, no una lectura de ventas.** El agente todavía no lee
> cheques (F1-022/F1-023, bloqueadas por F1-090). Que el panel diga "última lectura hace 10 s"
> quiere decir que la base de SR contesta, **no que las ventas estén llegando**. Cuando F1-022
> lea cheques, su lectura reemplaza a la sonda (`DECISION PROVISIONAL (nocturno)` en
> `SondeoSr.cs`).

`ultimoError` junta hasta tres partes, separadas por ` | `, en este orden (cada una de hasta
600 caracteres; el total, hasta 2000):

1. **Rechazos definitivos** que siguen en `cola.db` (7 días): cuántos, cuántos son cheques
   (ventas que faltan en el panel) y el último, con folio y motivo.
2. **El envío al API:** la falla vigente ("falla desde … (N intentos): …") o, hasta una hora
   después de recuperarse, la última caída ("falló de … a …: …"). Durante la caída no llega
   ningún heartbeat; al reconectar, ésta es la forma de ver qué pasó.
3. **SoftRestaurant:** el error de la detección o, con reader, el de la sonda.

Nunca lleva la API key, la contraseña ni la cadena de conexión: los mensajes de SQL salen de
`VerificacionSql.ClasificarError` y los de una excepción, sólo con el tipo.

**`intervaloSegundos` mayor a 30** da un aviso al cargar la config: el panel marca
"desconectado" a los 90 s fijos, así que con un intervalo mayor la sucursal sale
desconectada en falso entre ciclo y ciclo (decisión abierta, ver la ficha de F1-061 en
`backlog.md`).

## Catálogos (F2-240)

El agente manda al panel seis catálogos del POS por el contrato de F2-230
(`POST {apiUrl}/ingesta/catalogos` y `/cierre`): **grupos, productos (con grupo, precio y estado),
meseros, áreas, canales (tipos de servicio) y clientes**. Qué tabla y columna de SoftRestaurant es
cada campo está en `docs/esquema-sr.md` §6–§8. Los cinco de inventario son de F2-241.

- **Cuándo.** La primera vez que arranca con SoftRestaurant detectado; después, una vez al día a
  partir de `horaSincronizacionCatalogos`; y cuando un admin pulsa "Pedir sincronización" en el
  panel (el agente lo pregunta a lo más cada minuto y atiende cada petición una vez). El panel la
  seguirá mostrando "pendiente" hasta que existan los lectores de inventario: es lo esperado.
- **Sólo lo que cambió.** Cada catálogo leído se compara (SHA-256) con lo último que se mandó: sin
  cambios, no se encola nada. El forzado del panel manda todo.
- **Sólo con usuario de solo lectura.** Antes de leer corre `diagnostico.sql`; si el usuario SQL
  puede escribir (o no se pudo confirmar) **no lee catálogos** y lo dice en el log. Con un login
  sysadmin, como el de una PC de desarrollo, los catálogos no se sincronizan.
- **No frena lo demás.** Corre después del heartbeat y del envío de cada ciclo, con su propia cola
  (tablas `catalogo_*` en el mismo `cola.db`) y su propia espera ante fallas. Un rechazo definitivo
  del API (400, 409, 413, 500) descarta esa sincronización y el catálogo se vuelve a leer completo
  a los 15 min.
- **Datos personales.** Las páginas de clientes (nombre, teléfono, correo, RFC) quedan en `cola.db`
  hasta 7 días, en esta misma PC. El log nunca escribe esos valores: de un rechazo sólo el índice,
  el id del POS y el motivo que da el API.

En el log, por catálogo:

```text
Catálogos: 'productos' leído en SoftRestaurant: 217 registro(s) (217 fila(s)) en 41 ms; encolado en 1 página(s) más su cierre (sincronización 6f0c…).
Catálogos: 'grupos' leído en SoftRestaurant: 14 registro(s) (14 fila(s)) en 3 ms; sin cambios, no se encola nada.
Catálogos: 'productos' sincronizado en el panel: 217 activos, 0 dados de baja.
```

## Auto-actualización (F2-143)

El diseño completo, las garantías y los límites están en
[`docs/actualizacion-agente.md`](../docs/actualizacion-agente.md). Lo que hay que saber aquí:

- **Dos servicios, un exe.** `ArkonAgente` (este agente) y `ArkonAgenteActualizador`, que es el
  mismo `agente.exe` copiado en `C:\Program Files\ArkonAgente\actualizador\` y arrancado como
  `agente.exe actualizador`. `instalar.ps1` registra los dos. El actualizador corre como
  **LocalSystem** (tiene que detener y arrancar al agente y escribir en Program Files):
  `DECISION PROVISIONAL (nocturno)`, sin verificar con elevación (F1-020b).
- **Sólo con la bandera.** El agente pregunta en cada ciclo `GET {apiUrl}/agente/version`; sin la
  actualización automática encendida para su sucursal (Administración › Actualizaciones), el api
  contesta `disponible: false` y no pasa nada.
- **El agente nunca toca su exe.** Baja el binario (sin la API key), verifica tamaño y SHA-256 y
  deja `C:\ProgramData\ArkonAgente\actualizacion\solicitud.json`. El actualizador lo re-verifica,
  detiene el servicio, espera a que no quede ningún proceso del exe, cambia el archivo
  (`agente.exe.anterior` queda de respaldo), lo arranca y, si no se queda corriendo 60 s, regresa
  a la anterior.
- **Logs.** El agente escribe la auto-actualización en su log normal; el actualizador en
  `logs\actualizador-AAAAMMDD.log`.
- **Versión.** La que se publica tiene que ser la del exe: su `AssemblyInformationalVersion` sin
  el `+commit` (`1.4.0` para `1.4.0+1a99dc7`). Si no coincide, el agente la instala una vez, ve
  que sigue "distinto" y la reporta como `version_distinta` sin reintentarla.

Para ver en qué va, sin tocar nada:

```powershell
Get-ChildItem C:\ProgramData\ArkonAgente\actualizacion
Get-Content C:\ProgramData\ArkonAgente\actualizacion\resultado.json   # si existe: lo último que hizo el actualizador
sc.exe query ArkonAgenteActualizador
```
