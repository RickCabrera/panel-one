# Agente ArkonAgente (.NET 8)

Servicio de Windows que corre en la PC del restaurante, lee la base SQL Server de
SoftRestaurant en **solo lectura** y sube los datos al API del monitor con la API key de
la sucursal.

Estado: F1-020 entrega el esqueleto (servicio, configuración, logs y `agente test`). La
lectura de SoftRestaurant, la cola local y el envío llegan en F1-021 / F1-024 / F1-025. El
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

Para quitarlo:

```powershell
sc.exe stop ArkonAgente
sc.exe delete ArkonAgente
```

> **Pendiente de verificar (F1-020b, diurna):** el arranque con Windows y el reinicio tras
> una caída no se han probado con `sc create` real. La sesión que escribió esto no tenía
> consola de administrador.
