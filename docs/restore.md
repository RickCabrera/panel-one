# Respaldos, restauración y monitoreo (F1-004)

Qué se respalda, cómo se programa, cómo se restaura y cómo se sabe que la instancia está
viva. Los scripts viven en `infra/`; la prueba de extremo a extremo con Docker real corre en
el CI (job "Respaldo y restauración", `infra/pruebas/backup.test.sh`).

## Qué se respalda (y qué no)

`infra/backup.sh`, una vez al día:

| Qué | Archivo | Notas |
|---|---|---|
| La base del monitor | `monitor-AAAAMMDD-HHMMSSZ.dump` | `pg_dump -Fc`, verificado leyéndolo completo antes de darlo por bueno. |
| El volumen `archivos` | `monitor-AAAAMMDD-HHMMSSZ.archivos.tar.gz` | XML y PDF de las facturas (hay que conservarlos por ley fiscal) y los binarios del agente. **Obligatorio** si el compose lo declara (producción, F1-002): si el volumen `BACKUP_VOLUMEN_ARCHIVOS` no existe, el respaldo falla antes de empezar. En desarrollo, sólo si existe. |

**El dump NO basta para levantar el sistema.** Sin el `infra/.env` de producción no hay
secretos JWT, ni `ARCHIVOS_SECRETO` (los enlaces de descarga), ni las llaves VAPID (que no se
rotan: sin ellas se pierden todas las suscripciones push), ni las credenciales del PAC y de
Brevo. **Una copia del `infra/.env` va al gestor de contraseñas del equipo**, no a rclone ni al
repo. Tampoco se respaldan los certificados de Caddy: se vuelven a emitir solos.

Los respaldos traen ventas, correos y `password_hash` de usuarios, suscripciones push y RFC y
correo de los clientes de los restaurantes (datos personales bajo la LFPDPPP). Se tratan como
producción: carpeta `700`, archivos `600`, y el remoto **cifrado** (abajo).

## Instalar en el VPS

1. **La carpeta de respaldos, fuera del clon del repo** (un `git clean` de un despliegue futuro
   se la llevaría): `sudo mkdir -p /var/backups/monitor && sudo chown $USER /var/backups/monitor`
   y en `infra/.env`:
   ```sh
   BACKUP_DIR=/var/backups/monitor
   BACKUP_RETENCION_DIAS=14
   ```
2. **rclone con remoto cifrado.** `sudo apt-get install -y rclone`, `rclone config`:
   - un remoto del proveedor (B2, S3, R2…) con una llave **sin permiso de borrar** (a `copy` no le
     hace falta) **y el bucket con versionado u object lock**: sin eso, subir otra vez un archivo
     con el mismo nombre lo sobrescribe, que es lo mismo que borrarlo. Las dos cosas juntas son
     las que impiden que alguien que entre al VPS se lleve los respaldos;
   - encima, un remoto `crypt` (p. ej. `respaldos-cifrados:` apuntando a `b2:monitor-respaldos`).
     **La frase del crypt se guarda también fuera del VPS** (gestor de contraseñas): perder el VPS
     sin ella deja los respaldos imposibles de abrir;
   - `chmod 600 ~/.config/rclone/rclone.conf`;
   - en `infra/.env`: `BACKUP_RCLONE_DESTINO=respaldos-cifrados:`;
   - en el proveedor, una regla de ciclo de vida que borre lo de más de N días, con **N mayor que
     `BACKUP_RETENCION_DIAS`** (el script usa `rclone copy`, nunca `sync`: el remoto no borra
     nada por su cuenta, y re-sube los días en que la subida falló).
3. **Latido (opcional, recomendado).** Un respaldo que deja de correr no lo nota nadie. Con un
   monitor de latido (healthchecks.io o similar) que avise si no recibe el ping en 25 h:
   `BACKUP_PING_URL=https://hc-ping.com/<uuid>`. El script sólo lo llama si todo salió bien.
4. **El reloj del VPS en UTC** (`timedatectl`; si no, `sudo timedatectl set-timezone UTC`).
5. **El cron**, del usuario que corre Docker (tener acceso a Docker equivale a ser root: no
   darle ese acceso a nadie más). Primero **el log, escribible por ese usuario**: si no, la
   redirección del cron falla antes de lanzar el script y no se entera nadie.
   ```sh
   sudo install -o "$USER" -g "$USER" -m 640 /dev/null /var/log/monitor-respaldo.log
   ```
   Y `crontab -e`:
   ```cron
   30 9 * * * bash /ruta/a/panel-one/infra/backup.sh >> /var/log/monitor-respaldo.log 2>&1
   ```
   09:30 UTC = 03:30 en la Ciudad de México (UTC-6 todo el año desde 2022). Con `bash` delante
   el cron no depende del bit de ejecución del archivo.
6. **logrotate** para `/var/log/monitor-respaldo.log` (semanal, 8 copias), con
   `create 640 <usuario> <grupo>` (o `copytruncate`) para que el archivo nuevo siga siendo
   escribible por el cron. El log no trae secretos ni datos: sólo rutas y resultados.
7. **Correrlo una vez a mano** y revisar `ls -l /var/backups/monitor` y el remoto
   (`rclone ls respaldos-cifrados:`).

Las variables `BACKUP_*` del `infra/.env` también le llegan a la API por el `env_file` del
compose de producción. No las usa y no son secretas (el `rclone.conf` sí lo es, y no está ahí).

## Simulacro de restauración (cada mes, y el "Listo cuando" de F1-004)

```sh
bash infra/probar-restauracion.sh                 # el dump más reciente de BACKUP_DIR
bash infra/probar-restauracion.sh /ruta/al.dump   # uno en particular (p. ej. bajado del remoto)
```

Levanta un Postgres **efímero** de la misma imagen que producción, sin red y con 512 MB de tope
(`PROBAR_MEMORIA`), restaura el dump con `--exit-on-error`, comprueba que `_prisma_migrations`
esté completa, imprime las filas de cada tabla y lo borra todo al terminar (el contenedor **y su
volumen**). Compara esas filas con producción:

```sh
cd infra && docker compose exec postgres psql -U "$USUARIO" -d "$BASE" -c 'SELECT count(*) FROM <tabla>'
```

En un VPS chico, córrelo lejos de la hora pico: son dos Postgres en la misma memoria.

Para uno bajado del remoto: `rclone copy respaldos-cifrados:monitor-AAAAMMDD-HHMMSSZ.dump /tmp/`
y pasárselo al script.

## Restaurar en producción (el día malo)

Con calma y por pasos. Todo desde `infra/` en el VPS.

1. **Probar primero el dump** con el simulacro de arriba. Si no restaura ahí, no restaura en
   producción.
2. **Detener lo que escribe:** `docker compose stop api caddy` (el agente de cada sucursal guarda
   en su cola local mientras tanto y reenvía al volver; la ingesta es idempotente).
3. **Un respaldo de lo que hay ahora**, por si acaso: `bash backup.sh` (o, si la base no
   responde, anotarlo y seguir).
4. **Restaurar en una base NUEVA y cambiarla por la actual.** No se cambia `POSTGRES_DB`, para no
   tener que recrear el contenedor:
   ```sh
   docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" restaurada'
   docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d restaurada' < /var/backups/monitor/monitor-AAAAMMDD-HHMMSSZ.dump
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO rota; ALTER DATABASE restaurada RENAME TO \"$POSTGRES_DB\";"'
   ```
   (Alternativa sobre la misma base: `pg_restore --clean --if-exists --single-transaction`, que si
   falla a la mitad no deja la base a medias.) **Sin `-j`**: el dump sale por una tubería y no
   trae los desplazamientos de sus datos, así que la restauración en paralelo puede fallar
   ("could not find block ID"); la secuencial funciona.
5. **Los archivos**, si también se perdieron:
   ```sh
   docker run --rm -v monitor-sr_archivos:/datos -i postgres:16 tar -C /datos -xzf - < /var/backups/monitor/monitor-AAAAMMDD-HHMMSSZ.archivos.tar.gz
   ```
   y `chown` al usuario `node` (uid 1000): `docker run --rm -v monitor-sr_archivos:/datos postgres:16 chown -R 1000:1000 /datos`.
6. `docker compose up -d` (la etapa `migrar` aplica lo que falte si el dump es de antes de una
   migración), `curl https://api.DOMINIO/health`, entrar al panel y revisar las ventas del día.
7. Cuando todo esté bien, borrar la vieja: `DROP DATABASE rota`.

Lo que se pierde: lo escrito entre el último respaldo y la caída. Las ventas no, porque cada
agente las vuelve a mandar desde SoftRestaurant; sí lo capturado a mano en el panel (usuarios,
configuración, facturas emitidas en ese lapso: éstas siguen en Facturama y la conciliación de
F2-110b las recupera).

## Monitoreo de disponibilidad

Dos monitores HTTP(s) cada 5 minutos, con aviso por correo:

| Monitor | URL | Condición |
|---|---|---|
| API y base | `https://api.DOMINIO/health` | 200 **y** la palabra clave `"db":"ok"` |
| Panel | `https://app.DOMINIO` | 200 |

`/health` con `"db":"ok"` llega con F1-002 (PR #77): hasta que esté desplegado, el primer
monitor no tiene contra qué medir.

**Prueba (el "Listo cuando"):** `docker compose stop api`, esperar **más de un intervalo**
(>5 min), confirmar que llega el correo, `docker compose start api` y que llega el de
recuperación.

## Lista de verificación en el VPS

1. `bash infra/backup.sh` a mano: dump y tar.gz en `BACKUP_DIR` con permisos `600`, y los dos en
   el remoto cifrado.
2. `bash infra/probar-restauracion.sh`: "simulacro OK", con filas parecidas a las de producción.
3. Bajar ese dump **del remoto** a otra máquina y restaurarlo ahí también (prueba el crypt y la
   frase guardada fuera del VPS).
4. Al día siguiente: la corrida del cron está en el log y el latido llegó.
5. UptimeRobot (o el que se elija): la prueba de tirar la API de arriba.

## Decisiones abiertas

1. **El servicio de monitoreo.** Según sus términos, el plan gratis de UptimeRobot es sólo para
   uso personal y no comercial ([términos](https://uptimerobot.com/terms/),
   [ayuda](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan);
   confirmarlo al contratar), y esto es un producto con clientes de pago: plan de paga
   (el más chico alcanza para dos monitores) u otro servicio. También: **qué correo recibe los
   avisos**.
2. **El proveedor del remoto** (B2, S3, R2…), su cuenta y su retención (más larga que 14 días).
3. **El latido del respaldo** (`BACKUP_PING_URL`): con qué servicio, o aceptar por escrito que un
   respaldo que deja de correr se nota hasta el simulacro mensual.
4. **La hora del cron** (propuesta: 03:30 CDMX, lejos del cierre de los restaurantes).
