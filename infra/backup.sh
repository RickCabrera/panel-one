#!/usr/bin/env bash
# Respaldo nocturno del monitor (F1-004). Lo corre el cron del host del VPS:
#
#     30 9 * * * bash /ruta/a/panel-one/infra/backup.sh >> /var/log/monitor-respaldo.log 2>&1
#
# (el log se crea antes, escribible por ese usuario: docs/restore.md, paso 5)
#
# (09:30 UTC = 03:30 en la Ciudad de México.) Guía completa: docs/restore.md.
#
# Qué hace, en orden, y sale con ≠ 0 en cuanto algo falla:
#   1. `pg_dump -Fc` de la base del servicio `postgres` del compose de esta carpeta (en
#      el VPS, el `infra/.env` de F1-002 lo apunta al stack de producción).
#   2. Lo verifica LEYÉNDOLO COMPLETO (`pg_restore -f /dev/null`) antes de darlo por bueno.
#   3. Si existe el volumen de archivos (XML/PDF de facturas y binarios del agente,
#      F2-191), un tar.gz de él, en sólo lectura.
#   4. Retención local: borra lo de más de BACKUP_RETENCION_DIAS días. Sólo después de un
#      respaldo bueno: un día que falla nunca se lleva los respaldos viejos.
#   5. Si BACKUP_RCLONE_DESTINO está definido, `rclone copy` (nunca `sync`) de lo que hay
#      en la carpeta: también re-sube los días en que la subida falló.
#   6. Si BACKUP_PING_URL está definido, avisa al monitor de latido que todo salió bien.
#
# Variables (del entorno o de `infra/.env`; el entorno gana):
#   BACKUP_DIR               carpeta de los respaldos (por defecto infra/backups; en el VPS,
#                            una ruta FUERA del clon del repo, ver docs/restore.md)
#   BACKUP_RETENCION_DIAS    14
#   BACKUP_RCLONE_DESTINO    p. ej. `respaldos-cifrados:` (un remoto crypt de rclone)
#   BACKUP_VOLUMEN_ARCHIVOS  monitor-sr_archivos (el de docker-compose.prod.yml)
#   BACKUP_PING_URL          URL de latido (healthchecks.io o similar); opcional
#
# Sin `set -x` nunca: no hay secretos aquí, pero el log de cron no es lugar para depurar.

set -euo pipefail
umask 077
cd "$(dirname "$0")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
falla() {
  log "ERROR: $*" >&2
  # Con latido configurado, el aviso de falla llega de inmediato (healthchecks.io y
  # similares aceptan `/fail`), sin esperar a que venza el plazo del latido.
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    curl -fsS -m 10 -o /dev/null "$BACKUP_PING_URL/fail" || true
  fi
  exit 1
}

# El valor de una variable en `infra/.env`, SIN ejecutar el archivo (trae secretos y
# no es un script). La última asignación gana, y se quitan comillas simples o dobles.
leer_env() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
config() {
  local valor="${!1:-}"
  [ -n "$valor" ] || valor="$(leer_env "$1")"
  printf '%s' "${valor:-$2}"
}

BACKUP_DIR="$(config BACKUP_DIR backups)"
BACKUP_RETENCION_DIAS="$(config BACKUP_RETENCION_DIAS 14)"
BACKUP_RCLONE_DESTINO="$(config BACKUP_RCLONE_DESTINO '')"
BACKUP_VOLUMEN_ARCHIVOS="$(config BACKUP_VOLUMEN_ARCHIVOS monitor-sr_archivos)"
BACKUP_PING_URL="$(config BACKUP_PING_URL '')"

case "$BACKUP_RETENCION_DIAS" in
  '' | *[!0-9]*) falla "BACKUP_RETENCION_DIAS=\"$BACKUP_RETENCION_DIAS\" no es un número de días." ;;
esac
[ "$BACKUP_RETENCION_DIAS" -ge 1 ] || falla "BACKUP_RETENCION_DIAS tiene que ser 1 o más."

mkdir -p "$BACKUP_DIR"
# umask no corrige una carpeta que ya existía: los respaldos son ventas y datos
# personales de los clientes.
chmod 700 "$BACKUP_DIR"

# Dos corridas a la vez (un cron que se encima con una manual) no se pisan.
exec 9>"$BACKUP_DIR/.candado"
flock -n 9 || falla "otra corrida del respaldo sigue en curso ($BACKUP_DIR/.candado)."

sello="$(date -u +%Y%m%d-%H%M%SZ)"
dump="$BACKUP_DIR/monitor-$sello.dump"
archivos="$BACKUP_DIR/monitor-$sello.archivos.tar.gz"
trap 'rm -f "$dump.parcial" "$archivos.parcial"' EXIT

id_postgres="$(docker compose ps -q postgres)"
[ -n "$id_postgres" ] || falla "el servicio postgres no está corriendo (docker compose ps)."

# El volumen de archivos: si el compose lo declara (producción, F1-002), es
# OBLIGATORIO: un nombre que no coincida dejaría los XML fiscales sin respaldo en
# silencio. Se revisa ANTES del dump. Si no lo declara (desarrollo), se respalda sólo si
# existe.
if docker compose config --volumes | grep -qx archivos &&
  ! docker volume inspect "$BACKUP_VOLUMEN_ARCHIVOS" >/dev/null 2>&1; then
  falla "el compose declara el volumen archivos pero no existe $BACKUP_VOLUMEN_ARCHIVOS (revisa BACKUP_VOLUMEN_ARCHIVOS)."
fi

# 1. El dump. Usuario y base salen del entorno del propio contenedor (las POSTGRES_* con
# que se creó); por el socket local no pide contraseña.
log "pg_dump → $dump"
docker compose exec -T postgres sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  >"$dump.parcial" || falla "pg_dump falló."
[ -s "$dump.parcial" ] || falla "pg_dump dejó un archivo vacío."

# 2. Leerlo completo, datos incluidos (`--list` sólo leería el índice).
log "verificando el dump (pg_restore completo a /dev/null)"
docker compose exec -T postgres pg_restore -f /dev/null <"$dump.parcial" ||
  falla "el dump no se puede leer completo: se descarta."
mv "$dump.parcial" "$dump"

# 3. El volumen de archivos (se revisó arriba si es obligatorio).
if docker volume inspect "$BACKUP_VOLUMEN_ARCHIVOS" >/dev/null 2>&1; then
  imagen="$(docker inspect -f '{{.Config.Image}}' "$id_postgres")"
  log "archivos: volumen $BACKUP_VOLUMEN_ARCHIVOS → $archivos"
  docker run --rm --network none -v "$BACKUP_VOLUMEN_ARCHIVOS:/datos:ro" "$imagen" \
    tar -C /datos -czf - . >"$archivos.parcial" || falla "el tar del volumen de archivos falló."
  gzip -t "$archivos.parcial" || falla "el tar.gz de archivos está corrupto: se descarta."
  mv "$archivos.parcial" "$archivos"
else
  log "archivos: no existe el volumen $BACKUP_VOLUMEN_ARCHIVOS; no se respalda (normal en desarrollo)."
fi

# 4. Retención. `-mtime +N` cuenta días completos redondeando hacia abajo: con +(N-1) se
# borra lo que tiene N días o más, y se conservan exactamente N días.
log "retención: se borra lo de $BACKUP_RETENCION_DIAS días o más"
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'monitor-*.dump' -o -name 'monitor-*.archivos.tar.gz' -o -name 'monitor-*.parcial' \) \
  -mtime +"$((BACKUP_RETENCION_DIAS - 1))" -print -delete | sed 's/^/  borrado: /'

# 5. El remoto. `copy` y no `sync`: `sync` borraría allá lo que la retención local quitó,
# y el remoto es justo la copia que tiene que sobrevivir a eso (su retención la pone el
# proveedor, y tiene que ser MÁS larga que la local).
if [ -n "$BACKUP_RCLONE_DESTINO" ]; then
  log "rclone copy → $BACKUP_RCLONE_DESTINO"
  rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_DESTINO" \
    --include 'monitor-*.dump' --include 'monitor-*.archivos.tar.gz' \
    --max-age "${BACKUP_RETENCION_DIAS}d" ||
    falla "rclone falló; el respaldo local de hoy sí quedó: $dump"
else
  log "remoto: BACKUP_RCLONE_DESTINO no está definido; el respaldo sólo queda en este disco."
fi

# 6. El latido: sin él, un respaldo que deja de correr no lo nota nadie.
if [ -n "$BACKUP_PING_URL" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$BACKUP_PING_URL" ||
    log "aviso: el latido a BACKUP_PING_URL falló (el respaldo sí se hizo)."
fi

log "listo: $dump"
