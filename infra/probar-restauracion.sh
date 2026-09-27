#!/usr/bin/env bash
# Simulacro de restauración (F1-004): restaura un dump en un Postgres EFÍMERO y comprueba
# que la base quedó entera. Es el "dump restaurado con éxito en un postgres efímero" del
# "Listo cuando" y el simulacro que se repite cada mes (docs/restore.md).
#
#     bash infra/probar-restauracion.sh                  # el dump más reciente
#     bash infra/probar-restauracion.sh ruta/al.dump     # uno en particular
#
# No toca la base de producción: levanta otro contenedor, sin red, con memoria acotada, y
# lo borra al terminar CON su volumen (si no, quedaría en disco una copia de los datos de
# los clientes). Imprime el conteo de filas de cada tabla, para compararlo con producción.
#
# Variables: BACKUP_DIR (como en backup.sh), PROBAR_IMAGEN (por defecto, la misma imagen
# del servicio postgres en marcha) y PROBAR_MEMORIA (512m).

set -euo pipefail
umask 077
cd "$(dirname "$0")"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
falla() {
  log "ERROR: $*" >&2
  exit 1
}
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

dump="${1:-}"
if [ -z "$dump" ]; then
  dump="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'monitor-*.dump' | sort | tail -n 1)"
  [ -n "$dump" ] || falla "no hay ningún monitor-*.dump en $BACKUP_DIR."
fi
[ -s "$dump" ] || falla "$dump no existe o está vacío."

# La MISMA versión mayor que producción: un dump de Postgres N no siempre se restaura en
# N-1, y si producción sube de versión el simulacro tiene que seguirla solo.
imagen="${PROBAR_IMAGEN:-}"
if [ -z "$imagen" ]; then
  id_postgres="$(docker compose ps -q postgres)"
  [ -n "$id_postgres" ] || falla "el servicio postgres no está corriendo: pasa PROBAR_IMAGEN=postgres:16."
  imagen="$(docker inspect -f '{{.Config.Image}}' "$id_postgres")"
fi

nombre="monitor-simulacro-$(date -u +%s)-$$"
trap 'docker rm -fv "$nombre" >/dev/null 2>&1 || true' EXIT

log "Postgres efímero $nombre ($imagen, ${PROBAR_MEMORIA:-512m}, sin red)"
# La contraseña no se usa (todo va por el socket local con `docker exec`), pero la imagen
# no arranca sin una.
docker run -d --name "$nombre" --network none --memory "${PROBAR_MEMORIA:-512m}" \
  -e POSTGRES_PASSWORD="simulacro-$$-$RANDOM" -e POSTGRES_DB=restaurada "$imagen" >/dev/null

# Por TCP y no por el socket: el entrypoint levanta primero un servidor temporal SÓLO en
# el socket y luego lo reinicia; el puerto abre cuando la inicialización terminó.
for _ in $(seq 1 60); do
  if docker exec "$nombre" pg_isready -q -h 127.0.0.1 -U postgres -d restaurada; then break; fi
  sleep 1
done
docker exec "$nombre" pg_isready -q -h 127.0.0.1 -U postgres -d restaurada ||
  falla "el Postgres efímero no arrancó en 60 s."

log "pg_restore de $dump"
docker exec -i "$nombre" pg_restore --exit-on-error --no-owner --no-privileges \
  -U postgres -d restaurada <"$dump" || falla "la restauración falló."

sql() { docker exec "$nombre" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d restaurada -c "$1"; }

migraciones="$(sql 'SELECT count(*) FROM _prisma_migrations')" ||
  falla "la base restaurada no tiene _prisma_migrations."
[ "$migraciones" -gt 0 ] || falla "_prisma_migrations está vacía."
# Una migración a medias tiene finished_at nulo; una revertida con `migrate resolve
# --rolled-back` también, pero con rolled_back_at: ésa no es un error.
pendientes="$(sql 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
[ "$pendientes" -eq 0 ] || falla "$pendientes migraciones quedaron a medias en el dump."

log "migraciones aplicadas: $migraciones. Filas por tabla:"
sql "SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name" | sed 's/^/  /'

# El tar de archivos del mismo respaldo, si lo hay: que se lea completo.
archivos="${dump%.dump}.archivos.tar.gz"
if [ -f "$archivos" ]; then
  lista="$(mktemp)"
  tar -tzf "$archivos" >"$lista" 2>/dev/null || {
    rm -f "$lista"
    falla "$archivos no se puede leer completo."
  }
  total="$(grep -vc '/$' "$lista" || true)"
  rm -f "$lista"
  log "archivos: $archivos se lee completo ($total archivos)."
fi

log "simulacro OK: $dump se restaura entero."
