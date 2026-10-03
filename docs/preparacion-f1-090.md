# Preparación de F1-090: respaldo, usuario lector y captura

> Lo que hay que dejar listo **antes de sentarse al POS** a capturar los casos de
> `docs/casos-prueba-pos.md`. Tres cosas: el respaldo de la base, el login de solo lectura y
> la sesión de Extended Events.
>
> Instalación: instancia `.\NATIONALSOFT`, base `softrestaurant10` (la empresa "CAFETERIA DEMO"
> vive dentro de esa base; no hay otra), SQL Server 2014 SP1 Express.
>
> **Estado de este documento (2026-10-03): nada de aquí se ha EJECUTADO.** Lo que sí se revisó
> contra esta instancia, sin cambiar nada: la sintaxis del respaldo, la restauración y la sesión
> de Extended Events (`SET PARSEONLY ON`); que los eventos, las acciones y el destino existen en
> el catálogo; y el exportador, leyendo los archivos de las sesiones de fábrica. Los comandos
> cortos de comprobación y de borrado no pasaron ni por eso. La primera corrida real es la tuya:
> por eso la sección 3 trae una prueba de humo antes de abrir el POS.

## Qué cambia cada paso en la PC

Ninguno de los tres pasos de preparación (respaldar, crear el lector, capturar) toca una tabla
de SoftRestaurant. **La restauración es aparte y las reemplaza todas.** Y ninguno es del todo
inocuo:

| Paso | Qué cambia | Dónde | Cómo se deshace |
|---|---|---|---|
| Respaldo (`BACKUP`) | Crea un archivo `.bak` y anota el respaldo en el historial de `msdb` | Disco y `msdb` | Borrar el `.bak` |
| **Restauración (`RESTORE`)** | **Reemplaza la base del POS completa** por la del `.bak` | **`softrestaurant10`** | No se deshace: sólo con otro `.bak` |
| Usuario lector | Crea el login `monitor_lector` (servidor) **y un usuario dentro de `softrestaurant10`** con el rol `db_datareader` | Servidor **y catálogo de la base del POS** | `DROP USER` + `DROP LOGIN` (sección 2) |
| Sesión de Extended Events | Crea un objeto del **servidor** y archivos `.xel` en disco | Servidor y disco | `DROP EVENT SESSION` + borrar los `.xel` (sección 3) |

Dicho claro:

- **La restauración es la única operación de este documento que escribe en la base de SR**, y la
  reemplaza entera. Es tuya y manual: ni el agente ni ningún script del repo la hacen.
- **El usuario lector sí deja algo DENTRO de la base del POS**: un usuario y su membresía en un
  rol. No es una tabla ni un dato de operación, pero vive en `softrestaurant10` y viaja en sus
  respaldos.
- **La sesión de Extended Events no toca la base del POS**, pero sí es un cambio en el SQL
  Server de la PC, y mientras está encendida registra **todo** lo que se ejecute contra
  `softrestaurant10`. Se crea apagada, no arranca sola al reiniciar, y se borra al terminar.

## Orden recomendado

1. Cerrar SoftRestaurant.
2. Respaldo **"antes"** (sección 1): la base tal como está, sin ventas y sin el usuario lector.
3. Crear el usuario lector (sección 2).
4. Crear y arrancar la sesión de Extended Events y hacer la **prueba de humo** (sección 3).
   Si la prueba de humo no sale, no abras el POS: la captura no se puede repetir sin restaurar.
5. Abrir SoftRestaurant y capturar los casos de `docs/casos-prueba-pos.md`, **incluido el B7**
   (leer el Monitor de ventas): lo que consulta el Monitor también se quiere capturado.
6. Revisar que no se perdieron eventos, parar la sesión y exportar (sección 3).
7. Cerrar SoftRestaurant y sacar el respaldo **"después"** (sección 1): la base con las ventas.
8. Borrar la sesión de Extended Events (sección 3).

Todos los comandos son para **PowerShell 5.1**, una línea por comando (sin `&&`). El usuario de
Windows de esta PC es sysadmin del SQL, así que `sqlcmd -E` entra sin contraseña. Sólo la
sección 2 pide consola de administrador.

## 1. Respaldo y restauración

Los `.bak` quedan en la carpeta de respaldos de la instancia, que es donde el servicio del SQL
(`NT AUTHORITY\NETWORKSERVICE`) puede escribir:

```
C:\Program Files (x86)\Microsoft SQL Server\MSSQL12.NATIONALSOFT\MSSQL\Backup
```

Para abrir esa carpeta en el Explorador, Windows pide permiso de administrador. **Los `.bak` no
entran al repo.**

### Sacar el respaldo "antes"

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "BACKUP DATABASE [softrestaurant10] TO DISK = N'softrestaurant10_f1090_antes.bak' WITH COPY_ONLY, INIT, CHECKSUM, NAME = N'F1-090 antes de capturar', STATS = 10;"
```

Y comprobar que el archivo se puede leer completo:

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "RESTORE VERIFYONLY FROM DISK = N'softrestaurant10_f1090_antes.bak' WITH CHECKSUM;"
```

Tiene que decir `The backup set on file 1 is valid.` La base pesa ~13 MB: tarda segundos.

- `COPY_ONLY`: no altera la cadena de respaldos que SR o soporte pudieran llevar.
- `INIT`: si el archivo ya existe, **lo sobrescribe**. Por eso cada respaldo lleva nombre propio.
- `CHECKSUM`: verifica las páginas al respaldar y deja con qué verificar al restaurar.
- Sin `COMPRESSION`: Express 2014 no la soporta.

### Sacar el respaldo "después"

Igual, con otro nombre, al terminar de capturar:

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "BACKUP DATABASE [softrestaurant10] TO DISK = N'softrestaurant10_f1090_despues.bak' WITH COPY_ONLY, INIT, CHECKSUM, NAME = N'F1-090 despues de capturar', STATS = 10;"
```

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "RESTORE VERIFYONLY FROM DISK = N'softrestaurant10_f1090_despues.bak' WITH CHECKSUM;"
```

### Restaurar

> **Esto borra todo lo que haya en la base desde ese respaldo.** Antes de restaurar el "antes",
> asegúrate de tener el "después" verificado, o las ventas capturadas se pierden.
>
> **Sólo para esta base demo.** Restaurar encima de la base de un cliente real no es algo que
> este proyecto haga nunca.

1. Cerrar SoftRestaurant en todas las estaciones y detener el agente si está corriendo.
2. Anotar el estado y el dueño de la base antes de tocarla:

```powershell
sqlcmd -S .\NATIONALSOFT -E -W -Q "SELECT name, state_desc, SUSER_SNAME(owner_sid) AS dueno FROM sys.databases WHERE name = N'softrestaurant10';"
```

3. **Verificar el `.bak` exacto que vas a restaurar, con la base todavía en línea.** Si este
   comando falla (nombre mal escrito, archivo dañado), no sigas: el paso siguiente saca la base
   de línea antes de leer el archivo.

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "RESTORE VERIFYONLY FROM DISK = N'softrestaurant10_f1090_antes.bak' WITH CHECKSUM;"
```

4. Desconectar a todos y restaurar (el mismo nombre de `.bak` que acabas de verificar):

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -d master -Q "ALTER DATABASE [softrestaurant10] SET OFFLINE WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [softrestaurant10] FROM DISK = N'softrestaurant10_f1090_antes.bak' WITH REPLACE, CHECKSUM, STATS = 10;"
```

5. Repetir el comando del paso 2: tiene que decir `ONLINE` y **el mismo dueño** que antes. Si
   el dueño cambió, anótalo y no lo corrijas a ciegas: es un hallazgo para `docs/esquema-sr.md`.

Si el `RESTORE` falla a medias, la base se queda `OFFLINE` o `RESTORING` y SoftRestaurant no
abre. Si quedó `OFFLINE` (el `RESTORE` ni empezó), se regresa tal como estaba con:

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -d master -Q "ALTER DATABASE [softrestaurant10] SET ONLINE;"
```

Si quedó `RESTORING`, hay que repetir el `RESTORE` con un `.bak` bueno.

**Después de restaurar el "antes", el usuario `monitor_lector` ya no existe en la base** (ese
respaldo es de antes de crearlo). El login del servidor sigue ahí. Se arregla volviendo a
correr el script de la sección 2: vuelve a crear el usuario y te pide la contraseña otra vez.
Restaurar el "después" no tiene ese problema, porque el usuario viaja dentro del respaldo.
**Salvo que entre medias hayas borrado y recreado el login** (sección 2, "Borrarlo"): el login
nuevo tiene otro identificador, el usuario restaurado queda huérfano y el script se detiene con
"ALTO ... no pertenece al login". Remedio: el `DROP USER` de la sección 2 y volver a correr el
script.

## 2. Login SQL de solo lectura

El script ya existe: `agent\instalador\crear-usuario-lector.ps1`, que corre
`crear-usuario-lector.sql`. **Sirve tal cual**, con estas salvedades.

Lo que hace bien y no hay que tocar:

- Crea el login `monitor_lector` y su usuario en la base, y lo agrega **sólo** a
  `db_datareader`. Ningún otro rol, ningún `GRANT`.
- Se detiene sin cambiar nada si el servidor es "sólo Windows", si la base es de sistema, o si
  `monitor_lector` ya existe con más permisos que leer.
- Pide la contraseña sin mostrarla y la pasa por variable de entorno: no queda en el historial.
- Volver a correrlo es seguro: repone la contraseña y recrea lo que falte.
- Funciona con el `sqlcmd` de esta PC (12.0, en el PATH): lee el `.sql` con BOM y toma las
  variables de entorno. Comprobado con un `PRINT`.

Lo que hay que saber:

- **Nunca se ha ejecutado.** Los tests revisan qué otorga el `.sql`, no que corra contra un SQL
  Server. Esta va a ser la primera vez.
- **Exige consola de ADMINISTRADOR**, aunque en esta PC tu usuario ya es sysadmin del SQL sin
  elevar. Sin "Ejecutar como administrador" sale con código 3 antes de hacer nada.
- **Corre desde el repo**: no hace falta armar el paquete del agente, porque los tres archivos
  que necesita están juntos en `agent\instalador`.
- Al terminar dice "Sigue con el paso 4 de la guía: .\instalar.ps1". **Para F1-090 ignóralo**:
  no hay que instalar el servicio todavía.
- Reglas de la contraseña: 12 a 64 caracteres, con al menos una letra y un número; sólo letras
  sin acento, números y los símbolos `-_.!@#*+=?`. Además el login se crea con
  `CHECK_POLICY = ON`, así que también aplica la política de contraseñas de Windows. Anótala
  fuera del repo.
- **No trae cómo borrar el usuario.** Está abajo.

### Crearlo

En PowerShell **como administrador**:

```powershell
cd C:\Users\Admin\Desktop\panel-one\agent\instalador
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\crear-usuario-lector.ps1 -Servidor .\NATIONALSOFT -Base softrestaurant10
```

Tiene que terminar con `LISTO: monitor_lector sólo puede leer la base de SoftRestaurant.`

### Comprobar que sólo puede leer

Entra con el usuario nuevo (te pide la contraseña sin mostrarla) y pregunta sus permisos:

```powershell
sqlcmd -S .\NATIONALSOFT -U monitor_lector -d softrestaurant10 -W -Q "SELECT SUSER_SNAME() AS quien, IS_SRVROLEMEMBER('sysadmin') AS es_sysadmin, IS_MEMBER('db_datareader') AS lee, IS_MEMBER('db_datawriter') AS escribe, IS_MEMBER('db_owner') AS es_dueno, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS puede_insert, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS puede_alter;"
```

Lo esperado: `quien = monitor_lector`, `lee = 1` y **todo lo demás en 0**. La revisión completa
es la del agente (`agente test`), que además mira permisos tabla por tabla; F1-090 la corre por
primera vez con este usuario.

### Borrarlo (sólo si hay que deshacerlo, y sólo en esta base demo)

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -d softrestaurant10 -Q "IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'monitor_lector') DROP USER [monitor_lector];"
```

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -d master -Q "IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'monitor_lector') DROP LOGIN [monitor_lector];"
```

El `DROP LOGIN` falla si el agente está conectado con ese usuario: detén el agente primero.

## 3. Sesión de Extended Events

Captura cada sentencia que se ejecute con `softrestaurant10` como base de la conexión: lo que
manda SoftRestaurant al abrir una mesa, cobrar, cancelar o hacer el corte, y lo que consulta su
Monitor de ventas. De ahí sale qué tablas y columnas se escriben en cada caso.

Registra cuatro eventos, todos filtrados a `softrestaurant10`:

| Evento | Qué trae |
|---|---|
| `sql_batch_completed` | El lote completo tal como lo mandó la aplicación |
| `rpc_completed` | Las llamadas preparadas, **con los valores de los parámetros** |
| `sql_statement_completed` | Cada sentencia suelta de un lote |
| `sp_statement_completed` | Cada sentencia dentro de procedimientos **y de triggers** |

Los archivos `.xel` quedan en la carpeta de logs de la instancia (hasta 10 archivos de 50 MB;
al llenarse se recicla el más viejo):

```
C:\Program Files (x86)\Microsoft SQL Server\MSSQL12.NATIONALSOFT\MSSQL\Log
```

### Crear la sesión (queda apagada)

```powershell
$crear = @'
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'f1090_captura')
BEGIN
    RAISERROR(N'La sesion f1090_captura ya existe. Borrala primero o usala como esta.', 16, 1);
    RETURN;
END
CREATE EVENT SESSION [f1090_captura] ON SERVER
ADD EVENT sqlserver.sql_batch_completed (
    ACTION (package0.event_sequence, sqlserver.session_id, sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.server_principal_name)
    WHERE (sqlserver.database_name = N'softrestaurant10')),
ADD EVENT sqlserver.rpc_completed (
    ACTION (package0.event_sequence, sqlserver.session_id, sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.server_principal_name)
    WHERE (sqlserver.database_name = N'softrestaurant10')),
ADD EVENT sqlserver.sql_statement_completed (
    ACTION (package0.event_sequence, sqlserver.session_id, sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.server_principal_name)
    WHERE (sqlserver.database_name = N'softrestaurant10')),
ADD EVENT sqlserver.sp_statement_completed (
    ACTION (package0.event_sequence, sqlserver.session_id, sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.server_principal_name)
    WHERE (sqlserver.database_name = N'softrestaurant10'))
ADD TARGET package0.event_file (
    SET filename = N'f1090_captura.xel', max_file_size = (50), max_rollover_files = (10))
WITH (MAX_MEMORY = 4096 KB, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,
      MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = OFF);
'@
sqlcmd -S .\NATIONALSOFT -E -b -Q $crear
```

- `STARTUP_STATE = OFF`: si el SQL Server se reinicia, la sesión **no** arranca sola.
- `ALLOW_SINGLE_EVENT_LOSS`: si el servidor va apurado, pierde un evento antes que frenar al POS.
  Por eso antes de parar se revisa cuántos se perdieron (más abajo).
- Si ya hay archivos `f1090_captura_*.xel` de un intento anterior en la carpeta de logs,
  **bórralos antes de arrancar**: el exportador lee todos los que encuentre y mezclaría las
  dos capturas.

### Arrancarla

Justo antes de abrir SoftRestaurant. Anota la hora en `docs/casos-prueba-pos.md`.

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "ALTER EVENT SESSION [f1090_captura] ON SERVER STATE = START;"
```

### Ver si está corriendo

Si devuelve una fila, está encendida. Si no devuelve nada, está apagada (o no existe).

```powershell
sqlcmd -S .\NATIONALSOFT -E -W -Q "SELECT name, create_time FROM sys.dm_xe_sessions WHERE name = N'f1090_captura';"
```

### Prueba de humo (antes de abrir SoftRestaurant)

Con la sesión recién arrancada, lanza una consulta inofensiva contra la base:

```powershell
sqlcmd -S .\NATIONALSOFT -E -d softrestaurant10 -Q "SELECT 'prueba de humo f1090' AS marca;"
```

Espera unos 10 segundos y corre el exportador de más abajo (lee los archivos con la sesión
encendida). En el CSV tiene que aparecer esa sentencia, con `aplicacion = SQLCMD` y una
`hora_local` que coincida con el reloj de la PC. Si el CSV sale vacío, la hora no cuadra o el
exportador da error, **no abras el POS**: para y borra la sesión, y se revisa primero.

De paso mira la columna `objeto` de las filas `sp_statement_completed`, si hay alguna: que
traiga el nombre del procedimiento o del trigger es un **supuesto** que nadie ha visto en esta
versión.

### Revisar que no se perdieron eventos (antes de pararla)

Después del caso B7 y **antes** de parar, porque al parar la fila desaparece:

```powershell
sqlcmd -S .\NATIONALSOFT -E -W -Q "SELECT name, dropped_event_count, dropped_buffer_count FROM sys.dm_xe_sessions WHERE name = N'f1090_captura';"
```

Los dos contadores tienen que estar en 0. Si no, anótalo en la hoja de casos: hay sentencias
que no quedaron en la captura. Mira también cuántos `f1090_captura_*.xel` hay en la carpeta de
logs: si son 10, se recicló el más viejo y **los primeros casos ya no están**.

### Pararla

Al terminar el caso B7 (leer el Monitor de ventas), no antes. Parar la sesión vacía a disco lo
que quedara en memoria.

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "ALTER EVENT SESSION [f1090_captura] ON SERVER STATE = STOP;"
```

### Exportar lo capturado a CSV

Funciona con la sesión encendida o parada. Deja un CSV en `C:\f1090`, **fuera del repo**. Las
horas salen en la hora local de la PC (el `.xel` las guarda en UTC), para cruzarlas contra la
hoja de casos.

```powershell
$consulta = @'
DECLARE @ruta nvarchar(4000) = REPLACE(CAST(SERVERPROPERTY('ErrorLogFileName') AS nvarchar(4000)), N'ERRORLOG', N'f1090_captura*.xel');
DECLARE @desfase int = DATEDIFF(MINUTE, GETUTCDATE(), GETDATE());
SELECT
    x.d.value('(/event/action[@name="event_sequence"]/value)[1]', 'bigint') AS secuencia,
    CONVERT(varchar(23), DATEADD(MINUTE, @desfase, x.d.value('(/event/@timestamp)[1]', 'datetime2(3)')), 121) AS hora_local,
    x.d.value('(/event/@name)[1]', 'varchar(60)') AS evento,
    x.d.value('(/event/action[@name="session_id"]/value)[1]', 'int') AS spid,
    x.d.value('(/event/action[@name="client_app_name"]/value)[1]', 'nvarchar(256)') AS aplicacion,
    x.d.value('(/event/action[@name="client_hostname"]/value)[1]', 'nvarchar(256)') AS equipo,
    x.d.value('(/event/action[@name="server_principal_name"]/value)[1]', 'nvarchar(256)') AS login,
    x.d.value('(/event/data[@name="row_count"]/value)[1]', 'bigint') AS filas,
    x.d.value('(/event/data[@name="writes"]/value)[1]', 'bigint') AS escrituras,
    x.d.value('(/event/data[@name="nest_level"]/value)[1]', 'int') AS nivel,
    COALESCE(NULLIF(x.d.value('(/event/data[@name="object_name"]/value)[1]', 'nvarchar(256)'), N''),
             OBJECT_NAME(x.d.value('(/event/data[@name="object_id"]/value)[1]', 'int'), DB_ID(N'softrestaurant10'))) AS objeto,
    COALESCE(x.d.value('(/event/data[@name="statement"]/value)[1]', 'nvarchar(max)'),
             x.d.value('(/event/data[@name="batch_text"]/value)[1]', 'nvarchar(max)')) AS texto
FROM (SELECT CAST(f.event_data AS xml) AS d
      FROM sys.fn_xe_file_target_read_file(@ruta, NULL, NULL, NULL) AS f) AS x
ORDER BY secuencia;
'@
New-Item -ItemType Directory -Force -Path C:\f1090 | Out-Null
$salida = 'C:\f1090\captura-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.csv'
$cn = New-Object System.Data.SqlClient.SqlConnection 'Server=.\NATIONALSOFT;Database=master;Integrated Security=True;Application Name=f1090-exportar'
$cmd = $cn.CreateCommand()
$cmd.CommandText = $consulta
$cmd.CommandTimeout = 600
$tabla = New-Object System.Data.DataTable
$cn.Open()
try { $tabla.Load($cmd.ExecuteReader()) } finally { $cn.Close() }
$tabla | Select-Object secuencia, hora_local, evento, spid, aplicacion, equipo, login, filas, escrituras, nivel, objeto, texto | Export-Csv -Path $salida -NoTypeInformation -Encoding UTF8
"$($tabla.Rows.Count) eventos en $salida"
```

Cómo leer el CSV:

- `hora_local` se cruza contra la columna "Hora" de la hoja de casos. Por eso los 2 minutos
  entre caso y caso.
- `aplicacion` separa lo que mandó SoftRestaurant de lo demás (`SQLCMD`, el agente).
- `secuencia` es el orden real en que ocurrieron los eventos; `hora_local` sólo llega al
  milisegundo.
- Las sentencias que dicen qué tabla se toca en cada caso se buscan **por el `texto`**: que
  contenga `INSERT`, `UPDATE` o `DELETE` (no "que empiece con": una llamada preparada llega como
  `exec sp_executesql N'INSERT ...'`). **`escrituras` no sirve para eso**: son páginas escritas
  a disco, y un `INSERT` chico suele dar 0. `filas` en `rpc_completed` son filas devueltas, no
  afectadas.
- `objeto` debería traer el nombre del procedimiento o del **trigger** cuando la sentencia corre
  dentro de uno, y `nivel` qué tan anidada va. ⚠️ **SUPUESTO**: en SQL 2014 el evento puede
  traer el nombre vacío; el exportador lo resuelve entonces por `object_id`. Se confirma en la
  prueba de humo o con el primer caso que dispare un trigger.
- La misma operación puede salir dos o tres veces (el lote, la llamada y cada sentencia). Es a
  propósito: `rpc_completed` trae los valores de los parámetros y `sp_statement_completed` no.

Se puede exportar más de una vez. Lo que no cabe en el CSV (planes, lecturas, duración) sigue
en los `.xel` mientras no se borren.

### Borrar la sesión al terminar

```powershell
sqlcmd -S .\NATIONALSOFT -E -b -Q "IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'f1090_captura') DROP EVENT SESSION [f1090_captura] ON SERVER;"
```

Comprobar que sólo quedan las dos de fábrica (`system_health` y `AlwaysOn_health`):

```powershell
sqlcmd -S .\NATIONALSOFT -E -W -Q "SELECT name FROM sys.server_event_sessions;"
```

`DROP EVENT SESSION` **no borra los archivos**. Los `f1090_captura_*.xel` siguen en la carpeta
de logs de la instancia hasta que se borren a mano (pide permiso de administrador). Bórralos
sólo cuando el CSV esté exportado y revisado.

### Precauciones

- **La captura contiene todo lo que SR ejecute**, incluidos textos de sentencias con datos. En
  esta base demo no hay nada de un cliente. **En la instalación de un cliente real, ni los
  `.xel` ni el CSV salen de su PC sin su permiso, y nunca entran al repo.**
- **No dejarla encendida** más allá de la sesión de captura: registra cada sentencia, y un POS
  ejecuta miles por minuto.
- Las lecturas del agente y las de `sqlcmd` contra `softrestaurant10` también quedan
  registradas. Se filtran por `aplicacion` al leer el CSV.

## Qué va a `docs/esquema-sr.md`

Todo lo que salga de esta captura (tablas y columnas de cheques, pagos, cancelaciones,
cortesías, turnos, folios) se documenta en `docs/esquema-sr.md` dentro de F1-090, con la
sentencia capturada como evidencia. Este documento sólo deja la herramienta lista.

También se actualiza ahí, en §11, lo que hoy dice que el script del usuario lector "nunca se ha
ejecutado" y sus supuestos (que el administrador de Windows es sysadmin, que con
`db_datareader` alcanza): en cuanto lo corras, dejan de ser supuestos o dejan de ser ciertos.
