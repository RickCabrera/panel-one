#!/usr/bin/env bash
# Prueba de extremo a extremo de backup.sh y probar-restauracion.sh (F1-004), con Docker
# de verdad. La corre el job "Respaldo y restauración" del CI; a mano, desde la raíz del
# repo en una máquina de DESARROLLO con Docker, rclone, python3 y el `npm ci` hecho (nunca
# en el VPS):
#
#     bash infra/pruebas/backup.test.sh
#
# Levanta el Postgres del compose de desarrollo en un proyecto propio (no toca el tuyo), le
# aplica las migraciones de Prisma, mete filas sintéticas y comprueba: el dump, su
# restauración con las mismas filas, el tar del volumen de archivos, la retención (el borde
# de los 14 días), el remoto de rclone (un directorio local), los permisos, el latido, el
# candado, que un respaldo que falla A MEDIA ESCRITURA no deja parciales ni borra los viejos,
# y que los simulacros con un dump o un tar corruptos fallan por su motivo. Lo borra todo.

set -euo pipefail
raiz="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$raiz/infra"

tmp="$(mktemp -d)"
export COMPOSE_PROJECT_NAME=monitor-sr-prueba-respaldo
# Credenciales del Postgres de la prueba: el entorno le gana al `infra/.env` de quien la
# corra, y así la URL de las migraciones de abajo siempre cuadra.
export POSTGRES_USER=monitor POSTGRES_PASSWORD=monitor POSTGRES_DB=monitor POSTGRES_PORT=55432
export BACKUP_DIR="$tmp/respaldos"
export BACKUP_RCLONE_DESTINO="$tmp/remoto"
export BACKUP_VOLUMEN_ARCHIVOS=monitor-sr-prueba-respaldo_archivos
export RCLONE_CONFIG="$tmp/rclone.conf"
: >"$RCLONE_CONFIG"
# El latido va a un servidor local que registra cada petición. No hay archivo `latido`: el
# 404 hace fallar el `curl -f`, y eso además prueba que un latido fallido no tumba el
# respaldo.
puerto_latido=58765
mkdir -p "$tmp/latido"
python3 -m http.server "$puerto_latido" --bind 127.0.0.1 --directory "$tmp/latido" \
  >"$tmp/latido.log" 2>&1 &
pid_latido=$!
export BACKUP_PING_URL="http://127.0.0.1:$puerto_latido/latido"
# El compose de desarrollo fija `container_name`: sin quitarlo, esta prueba chocaría con el
# Postgres de desarrollo de quien la corra a mano.
cat >"$tmp/sin-nombre.yml" <<'YAML'
services:
  postgres:
    container_name: !reset null
YAML
# Como el de producción: declara el volumen `archivos` (lo vuelve obligatorio en backup.sh).
cat >"$tmp/con-archivos.yml" <<'YAML'
volumes:
  archivos:
YAML
export COMPOSE_PATH_SEPARATOR=:
export COMPOSE_FILE="docker-compose.yml:$tmp/sin-nombre.yml"

limpiar() {
  kill "$pid_latido" 2>/dev/null || true
  docker compose down -v >/dev/null 2>&1 || true
  docker volume rm -f "$BACKUP_VOLUMEN_ARCHIVOS" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap limpiar EXIT

fallos=0
ok() { printf '  ok    %s\n' "$1"; }
mal() {
  printf '  MAL   %s\n' "$1"
  fallos=$((fallos + 1))
}
revisar() { # revisar "descripción" comando...
  local desc="$1"
  shift
  if "$@"; then ok "$desc"; else mal "$desc"; fi
}
# falla_por "descripción" "mensaje esperado" comando...: el comando sale con ≠ 0 Y su
# salida trae el mensaje. Fallar por cualquier otro motivo no cuenta.
falla_por() {
  local desc="$1" mensaje="$2" salida
  shift 2
  salida="$("$@" 2>&1)" && {
    mal "$desc (salió con 0)"
    return
  }
  if grep -qF -- "$mensaje" <<<"$salida"; then ok "$desc"; else
    mal "$desc (falló, pero no por \"$mensaje\")"
    printf '%s\n' "$salida" | sed 's/^/        /'
  fi
}
dumps() { find "$BACKUP_DIR" -maxdepth 1 -type f -name 'monitor-*.dump' | sort; }
parciales() { find "$BACKUP_DIR" -maxdepth 1 -name '*.parcial' | grep -c . || true; }
psql_en() { # psql_en base "sql"
  docker compose exec -T postgres sh -c 'psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$0" -c "$1"' "$1" "$2"
}
latidos() { grep -c "\"GET /latido$1 " "$tmp/latido.log" || true; }

echo "== preparar: Postgres de desarrollo, migraciones y datos sintéticos"
docker compose up -d --wait postgres
(cd "$raiz/api" && DATABASE_URL="postgresql://monitor:monitor@localhost:$POSTGRES_PORT/monitor" npx prisma migrate deploy)
psql_en monitor "CREATE TABLE prueba_respaldo (id int PRIMARY KEY, texto text NOT NULL);
                 INSERT INTO prueba_respaldo SELECT g, 'fila ' || g || ' — ñandú' FROM generate_series(1, 2500) g;"
docker volume create "$BACKUP_VOLUMEN_ARCHIVOS" >/dev/null
docker run --rm -v "$BACKUP_VOLUMEN_ARCHIVOS:/datos" postgres:16 \
  sh -c 'mkdir -p /datos/cfdi && echo "<cfdi/>" >/datos/cfdi/uno.xml && echo pdf >/datos/cfdi/uno.pdf'

# Respaldos "viejos" para la retención: uno de 20 días (se va), uno de 13 (se queda) y uno
# en el borde exacto de 14 días (se va: se conservan 14 días, no 15).
mkdir -p "$BACKUP_DIR"
viejo="$BACKUP_DIR/monitor-20000101-000000Z.dump"
reciente="$BACKUP_DIR/monitor-20000102-000000Z.dump"
borde="$BACKUP_DIR/monitor-20000103-000000Z.dump"
parcial_viejo="$BACKUP_DIR/monitor-20000104-000000Z.dump.parcial"
echo x >"$viejo" && touch -d '20 days ago' "$viejo"
echo x >"$reciente" && touch -d '13 days ago' "$reciente"
echo x >"$borde" && touch -d '14 days ago 1 minute ago' "$borde"
echo x >"$parcial_viejo" && touch -d '20 days ago' "$parcial_viejo"

echo "== backup.sh (camino feliz)"
revisar "backup.sh sale con 0" bash ./backup.sh
nuevo="$(dumps | grep -v '/monitor-2000' | tail -n 1 || true)"
revisar "dejó un dump nuevo" test -s "$nuevo"
revisar "y su tar.gz de archivos" test -s "${nuevo%.dump}.archivos.tar.gz"
revisar "el tar trae los dos archivos del volumen" \
  sh -c "tar -tzf '${nuevo%.dump}.archivos.tar.gz' | grep -q 'cfdi/uno.xml' && tar -tzf '${nuevo%.dump}.archivos.tar.gz' | grep -q 'cfdi/uno.pdf'"
revisar "no dejó parciales" test "$(parciales)" = 0
revisar "retención: se fue el de 20 días" test ! -e "$viejo"
revisar "retención: se fue el del borde de 14 días" test ! -e "$borde"
revisar "retención: se quedó el de 13 días" test -e "$reciente"
revisar "retención: se fue el parcial viejo" test ! -e "$parcial_viejo"
revisar "carpeta 700" test "$(stat -c %a "$BACKUP_DIR")" = 700
revisar "dump 600" test "$(stat -c %a "$nuevo")" = 600
revisar "rclone: el dump llegó al remoto" test -s "$BACKUP_RCLONE_DESTINO/$(basename "$nuevo")"
revisar "rclone: el tar de archivos también" \
  test -s "$BACKUP_RCLONE_DESTINO/$(basename "${nuevo%.dump}.archivos.tar.gz")"
revisar "latido: salió una vez, y no el de falla" test "$(latidos '')/$(latidos /fail)" = 1/0

echo "== probar-restauracion.sh sobre ese dump"
salida="$tmp/simulacro.txt"
volumenes_antes="$(docker volume ls -q | sort)"
revisar "el simulacro sale con 0" sh -c "bash ./probar-restauracion.sh '$nuevo' >'$salida' 2>&1"
cat "$salida"
revisar "la restauración trae las 2500 filas sintéticas" grep -q '^  prueba_respaldo 2500$' "$salida"
esperadas="$(psql_en monitor 'SELECT count(*) FROM _prisma_migrations')"
revisar "y las mismas $esperadas migraciones" grep -q "migraciones aplicadas: $esperadas\." "$salida"
revisar "y leyó el tar de archivos (2 archivos)" grep -q '(2 archivos)' "$salida"
revisar "el simulacro no dejó contenedores" sh -c "! docker ps -a --format '{{.Names}}' | grep -q monitor-simulacro"
revisar "ni volúmenes del simulacro (docker rm -v)" \
  test "$(docker volume ls -q | sort)" = "$volumenes_antes"

echo "== simulacros que tienen que fallar, y por su motivo"
echo 'esto no es un dump' >"$tmp/corrupto.dump"
falla_por "un dump corrupto no se restaura" "la restauración falló" \
  bash ./probar-restauracion.sh "$tmp/corrupto.dump"
mkdir -p "$tmp/copia"
cp "$nuevo" "$tmp/copia/monitor-20990101-000000Z.dump"
echo 'esto no es un tar.gz' >"$tmp/copia/monitor-20990101-000000Z.archivos.tar.gz"
falla_por "un tar de archivos corrupto junto a un dump bueno" "no se puede leer completo" \
  bash ./probar-restauracion.sh "$tmp/copia/monitor-20990101-000000Z.dump"

echo "== el candado: dos corridas a la vez"
exec 8>"$BACKUP_DIR/.candado"
flock 8
falla_por "con el candado tomado, backup.sh no corre" "otra corrida del respaldo sigue en curso" \
  bash ./backup.sh
flock -u 8
exec 8>&-

echo "== el volumen de archivos declarado pero ausente"
falla_por "si el compose declara archivos y el volumen no existe, backup.sh falla" \
  "el compose declara el volumen archivos" \
  env COMPOSE_FILE="docker-compose.yml:$tmp/sin-nombre.yml:$tmp/con-archivos.yml" \
  BACKUP_VOLUMEN_ARCHIVOS=monitor-sr-no-existe_archivos bash ./backup.sh

echo "== un respaldo que falla A MEDIA ESCRITURA no deja parciales ni borra los viejos"
viejo2="$BACKUP_DIR/monitor-20000105-000000Z.dump"
echo x >"$viejo2" && touch -d '20 days ago' "$viejo2"
antes="$(dumps | wc -l)"
fail_antes="$(latidos /fail)"
# Con la base renombrada, `pg_dump` falla DESPUÉS de que la redirección ya creó el
# `.parcial`: así se ejerce la limpieza del trap, no sólo la salida temprana.
psql_en postgres 'ALTER DATABASE monitor RENAME TO monitor_escondida'
falla_por "pg_dump falla y backup.sh lo dice" "pg_dump falló" bash ./backup.sh
psql_en postgres 'ALTER DATABASE monitor_escondida RENAME TO monitor'
revisar "no apareció ningún dump nuevo" test "$(dumps | wc -l)" = "$antes"
revisar "no quedó ningún parcial" test "$(parciales)" = 0
revisar "el viejo de 20 días sigue ahí" test -e "$viejo2"
revisar "latido: salió el de falla" test "$(latidos /fail)" = "$((fail_antes + 1))"

echo "== con Postgres detenido"
docker compose stop postgres >/dev/null
falla_por "backup.sh falla y dice por qué" "el servicio postgres no está corriendo" bash ./backup.sh
revisar "el viejo de 20 días sigue ahí" test -e "$viejo2"

echo
if [ "$fallos" -gt 0 ]; then
  echo "$fallos comprobaciones fallaron."
  exit 1
fi
echo "Todas las comprobaciones pasaron."
