# Agente ArkonAgente (.NET 8)

Servicio de Windows que corre en la PC del restaurante, lee la base SQL Server de
SoftRestaurant en **solo lectura** y sube los datos al API del monitor con la API key de
la sucursal.

Estado: F1-020 entrega el esqueleto (servicio, configuración, logs y `agente test`), F1-021
la detección de la versión de SoftRestaurant y F1-024 la cola local con el envío al API. La
lectura de ventas y mesas (lo que llena la cola) llega en F1-022 / F1-023, y el heartbeat en
F1-025: **hasta entonces la cola siempre está vacía** y el envío no manda nada. El
instalador (`instalar.ps1`) y la guía para personas no técnicas son F1-026.

## Compilar, probar y publicar

```powershell
cd agent
dotnet build --configuration Release
dotnet test  --configuration Release

# Un solo agente.exe self-contained (no hace falta instalar .NET en la PC del restaurante):
dotnet publish src/ArkonAgente -c Release -r win-x64 -o publish
```

`publish/` queda con `agente.exe` (y su `.pdb`, que no hace falta copiar).

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
  "intervaloSegundos": 30
}
```

- `apiUrl`: URL **base** del API, con `https://` (con `http://` sólo se acepta `localhost`,
  para desarrollo). Si el API vive bajo un prefijo, va incluido (`https://x.com/api`).
- `apiKey`: la que da el panel en Administración → Sucursales → rotar key. Se muestra una
  sola vez.
- `connectionString`: cadena de SQL Server hacia la base de SoftRestaurant, con un usuario
  **de solo lectura** (sólo el rol `db_datareader`). Con autenticación SQL (`User ID` /
  `Password`), no de Windows: el servicio corre como LocalSystem, y con
  `Integrated Security=True` entraría a SQL Server como `NT AUTHORITY\SYSTEM`, que en los
  SQL Express viejos suele ser sysadmin. `TrustServerCertificate=True` es lo normal en un
  SQL Express local con certificado autofirmado (ver `docs/esquema-sr.md` §11).
  El agente agrega por su cuenta `Application Name=ArkonAgente` (para verlo en
  `sp_who2`) y un `Connect Timeout` de 5 s si no se puso uno (tope: 15 s).
- `intervaloSegundos`: opcional, 30 por defecto, entre 5 y 3600.

El archivo acepta comentarios `//` y comas finales. En JSON las barras invertidas se
escriben dobles: `.\\SQLEXPRESS`.

Para desarrollo, la variable de entorno `ARKON_AGENTE_DIR` cambia la carpeta.

### Permisos de la carpeta

`config.json` trae la API key y el password de SQL. Deja la carpeta sólo para SYSTEM y
Administradores (consola de administrador):

```powershell
mkdir C:\ProgramData\ArkonAgente
icacls C:\ProgramData\ArkonAgente /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
icacls C:\ProgramData\ArkonAgente /inheritance:r
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
  INSERT/UPDATE/DELETE/ALTER sobre el esquema `dbo`), sale **FALLA** aunque la conexión
  funcione. Límite: un permiso concedido sobre una tabla suelta no se detecta.
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

Consola **de administrador**. Supone el exe copiado en `C:\Program Files\ArkonAgente\`.
Ojo: en `sc` el espacio después de `=` es obligatorio.

```powershell
sc.exe create ArkonAgente binPath= "\"C:\Program Files\ArkonAgente\agente.exe\"" start= delayed-auto DisplayName= "ArkonAgente (monitor SoftRestaurant)"
sc.exe description ArkonAgente "Lee SoftRestaurant en solo lectura y reporta al monitor."

# Si el proceso se cae, el administrador de servicios lo levanta al minuto (tres veces;
# el contador se reinicia cada 24 h). failureflag 1: también si se detiene con error.
sc.exe failure ArkonAgente reset= 86400 actions= restart/60000/restart/60000/restart/60000
sc.exe failureflag ArkonAgente 1

sc.exe start ArkonAgente
sc.exe query ArkonAgente
```

- `start= delayed-auto`: arranca con Windows, un poco después de los servicios críticos,
  para que el SQL Server de SoftRestaurant ya esté arriba.
- Corre como **LocalSystem** (el default de `sc create`). La cuenta virtual
  `NT SERVICE\ArkonAgente` con ACLs propias queda para F1-026.
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

> **Pendiente de verificar (F1-020b, diurna):** el arranque con Windows y el reinicio tras
> una caída no se han probado con `sc create` real. La sesión que escribió esto no tenía
> consola de administrador.

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
