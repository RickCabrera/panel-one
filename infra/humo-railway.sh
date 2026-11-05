#!/usr/bin/env bash
# Prueba de humo de las dos imágenes de Railway (api/Dockerfile y web/Dockerfile), como
# quedarían en producción: NODE_ENV=production, la API SIN puerto público propio y todo
# entrando por el Caddy del web. La corre el job `docker` del CI; en local:
#
#     docker build -f api/Dockerfile -t monitor-api .
#     docker build -f web/Dockerfile -t monitor-web .
#     HUMO_DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/BASE_VACIA infra/humo-railway.sh
#
# La base tiene que ser una VACÍA y desechable: el arranque migra y crea un admin_global.
# Usa la red del host (`--network host`): la API en 127.0.0.1:3000 hace de
# api.railway.internal y el web escucha en 127.0.0.1:8080. El "borde de Railway" lo hace
# curl mandando X-Real-IP.
#
# Comprueba: validación previa, migraciones + admin inicial (y que el 2.º arranque no lo
# toca), /health por el proxy, la SPA con su CSP y HSTS, la landing en /landing/ (308 con
# query, CSP/HSTS, CSS immutable, 404 sin fallback, /landings sigue siendo la SPA), login con la cookie
# Secure/HttpOnly/SameSite=Strict y Path=/api/auth, refresh con esa cookie, un DELETE con
# cuerpo, que el portal sin PAC conectado contesta 503 sin simular, el handshake de
# socket.io bajo /api (polling y upgrade a WebSocket), y el rate limit del login POR IP DEL
# CLIENTE (y que un X-Forwarded-For inventado no lo salta). OJO: aquí X-Real-IP lo manda
# curl; que el borde REAL de Railway lo pise es un SUPUESTO que se prueba en el §6 de
# docs/deploy-railway.md.
set -euo pipefail

DB="${HUMO_DATABASE_URL:?Falta HUMO_DATABASE_URL (una base VACÍA y desechable)}"
API_IMG="${HUMO_API_IMAGEN:-monitor-api}"
WEB_IMG="${HUMO_WEB_IMAGEN:-monitor-web}"
WEB=http://127.0.0.1:8080
EMAIL=humo-admin@monitor.test
# Secretos sintéticos de UNA corrida, generados aquí: no existen fuera de este proceso.
PASSWORD="$(openssl rand -hex 16)"
ACCESS="$(openssl rand -base64 48)"
REFRESH="$(openssl rand -base64 48)"
TMP="$(mktemp -d)"

fallo() {
  echo "::error::HUMO: $*" >&2
  echo "----- logs api -----" >&2
  docker logs humo-api >&2 2>&1 || true
  echo "----- logs web -----" >&2
  docker logs humo-web >&2 2>&1 || true
  exit 1
}
limpiar() {
  docker rm -f humo-api humo-web >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

# A archivo y luego grep: con `pipefail`, `docker logs | grep -q` falla en cuanto grep
# encuentra y cierra el tubo (SIGPIPE a docker logs), aunque la línea SÍ esté.
en_logs_api() {
  docker logs humo-api >"$TMP/api.log" 2>&1
  grep -q "$1" "$TMP/api.log"
}

arrancar_api() {
  docker rm -f humo-api >/dev/null 2>&1 || true
  docker run -d --name humo-api --network host \
    -e NODE_ENV=production -e PORT=3000 -e DATABASE_URL="$DB" \
    -e JWT_ACCESS_SECRET="$ACCESS" -e JWT_REFRESH_SECRET="$REFRESH" \
    -e PANEL_URL=https://panel-humo.test -e TRUST_PROXY_SALTOS=1 \
    -e PERMITIR_FALSOS_EN_PRODUCCION=PAC_IMPL,CORREO_IMPL,ARCHIVOS_IMPL,PUSH_IMPL \
    -e ADMIN_INICIAL_EMAIL="$EMAIL" -e ADMIN_INICIAL_PASSWORD="$1" \
    "$API_IMG" >/dev/null
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then return 0; fi
    if [ "$(docker inspect -f '{{.State.Running}}' humo-api)" != true ]; then
      fallo "la API se cayó al arrancar"
    fi
    sleep 2
  done
  fallo "la API no respondió /health en 120 s"
}

echo "== 0. Sin secretos la API se niega a arrancar (y no migra)"
if docker run --rm --network host -e NODE_ENV=production -e DATABASE_URL="$DB" "$API_IMG" \
  >"$TMP/sin-secretos.log" 2>&1; then
  fallo "la API arrancó sin JWT_* ni PANEL_URL"
fi
grep -q "JWT_ACCESS_SECRET es obligatoria" "$TMP/sin-secretos.log" \
  || fallo "el mensaje no nombra JWT_ACCESS_SECRET: $(cat "$TMP/sin-secretos.log")"

echo "== 1. API: migraciones + admin inicial"
arrancar_api "$PASSWORD"
en_logs_api "admin_global $EMAIL creado" || fallo "no creó el admin inicial"
en_logs_api "PAC_IMPL=falso en PRODUCCIÓN" || fallo "no avisó del PAC falso"

echo "== 2. Web (Caddy) hacia la API por la 'red privada'"
docker rm -f humo-web >/dev/null 2>&1 || true
docker run -d --name humo-web --network host -e PORT=8080 \
  -e API_INTERNAL_URL=http://127.0.0.1:3000 "$WEB_IMG" >/dev/null
for _ in $(seq 1 30); do
  curl -fsS "$WEB/" >/dev/null 2>&1 && break
  sleep 1
done

echo "== 3. /api/health por el proxy"
salud="$(curl -fsS "$WEB/api/health")" || fallo "/api/health no respondió 200"
[ "$salud" = '{"status":"ok","db":"ok"}' ] || fallo "/api/health respondió $salud"

echo "== 4. La SPA con CSP y HSTS; una ruta de la SPA cae en index.html"
curl -fsS -D "$TMP/spa.h" -o "$TMP/spa.html" "$WEB/ventas"
grep -qi "^content-security-policy: default-src 'self'" "$TMP/spa.h" || fallo "sin CSP"
grep -qi "^strict-transport-security: max-age=31536000" "$TMP/spa.h" || fallo "sin HSTS"
grep -q 'id="root"' "$TMP/spa.html" || fallo "/ventas no sirvió el index.html de la SPA"

echo "== 4b. La landing en /landing/ del dominio del panel (LAND-01)"
# /landing (sin diagonal) -> 308 a /landing/, conservando la query.
codigo="$(curl -sS -o /dev/null -D "$TMP/landing-redir.h" -w '%{http_code}' "$WEB/landing?plan=x")"
[ "$codigo" = 308 ] || fallo "/landing?plan=x respondió $codigo (se esperaba 308)"
destino="$(grep -i '^location:' "$TMP/landing-redir.h" | tr -d '\r' | sed -E 's/^[Ll]ocation: *//')"
case "$destino" in
  */landing/\?plan=x) ;;
  *) fallo "/landing?plan=x redirigió a '$destino' (se esperaba …/landing/?plan=x)" ;;
esac
echo "   /landing?plan=x -> $codigo Location: $destino"
# /landing/ -> 200, con la CSP y el HSTS, y NO es el index.html de la SPA.
codigo="$(curl -sS -D "$TMP/landing.h" -o "$TMP/landing.html" -w '%{http_code}' "$WEB/landing/")"
[ "$codigo" = 200 ] || fallo "/landing/ respondió $codigo (se esperaba 200)"
grep -qi "^content-security-policy: default-src 'self'" "$TMP/landing.h" || fallo "/landing/ sin CSP"
grep -qi "^strict-transport-security: max-age=31536000" "$TMP/landing.h" || fallo "/landing/ sin HSTS"
if grep -q 'id="root"' "$TMP/landing.html"; then
  fallo "/landing/ sirvió el index.html de la SPA (trae id=\"root\")"
fi
echo "   /landing/ -> $codigo con CSP y HSTS, sin id=\"root\""
# Un CSS de la landing, con la ruta sacada de su HTML: 200 y caché immutable.
css="$(grep -oE 'href="[^"]+\.css"' "$TMP/landing.html" | head -n 1 | sed -E 's/^href="(.*)"$/\1/')"
[ -n "$css" ] || fallo "el HTML de /landing/ no enlaza ningún .css"
case "$css" in
  /*) url_css="$WEB$css" ;;
  ./*) url_css="$WEB/landing/${css#./}" ;;
  *) url_css="$WEB/landing/$css" ;;
esac
codigo="$(curl -sS -o /dev/null -D "$TMP/landing-css.h" -w '%{http_code}' "$url_css")"
[ "$codigo" = 200 ] || fallo "el CSS de la landing ($url_css) respondió $codigo"
grep -qi '^cache-control:.*immutable' "$TMP/landing-css.h" \
  || fallo "el CSS de la landing ($url_css) no trae Cache-Control immutable"
echo "   ${url_css#"$WEB"} -> $codigo immutable"
# Lo que no existe bajo /landing/ es 404 de verdad (sin fallback de SPA).
codigo="$(curl -sS -o /dev/null -w '%{http_code}' "$WEB/landing/no-existe")"
[ "$codigo" = 404 ] || fallo "/landing/no-existe respondió $codigo (se esperaba 404)"
echo "   /landing/no-existe -> $codigo"
# /landings NO es la landing: es una ruta de la SPA y cae en su index.html.
codigo="$(curl -sS -o "$TMP/landings.html" -w '%{http_code}' "$WEB/landings")"
[ "$codigo" = 200 ] || fallo "/landings respondió $codigo (se esperaba 200 de la SPA)"
grep -q 'id="root"' "$TMP/landings.html" || fallo "/landings no sirvió el index.html de la SPA"
echo "   /landings -> $codigo index.html de la SPA"

echo "== 5. Login: cookie Secure, HttpOnly, SameSite=Strict, Path=/api/auth"
codigo="$(curl -sS -o "$TMP/login.json" -D "$TMP/login.h" -w '%{http_code}' \
  -X POST "$WEB/api/auth/login" -H 'Content-Type: application/json' \
  -H 'X-Real-IP: 198.51.100.10' \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
[ "$codigo" = 200 ] || fallo "login respondió $codigo: $(cat "$TMP/login.json")"
grep -q '"accessToken"' "$TMP/login.json" || fallo "login sin accessToken"
cookie="$(grep -i '^set-cookie: monitor_refresh=' "$TMP/login.h" | tr -d '\r')"
for atributo in 'Path=/api/auth' 'HttpOnly' 'Secure' 'SameSite=Strict'; do
  echo "$cookie" | grep -qi "$atributo" || fallo "la cookie de refresh no trae $atributo: $cookie"
done
valor="$(echo "$cookie" | sed -E 's/^[Ss]et-[Cc]ookie: (monitor_refresh=[^;]*).*/\1/')"

echo "== 6. Refresh con esa cookie"
codigo="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEB/api/auth/refresh" \
  -H "Cookie: $valor" -H 'X-Real-IP: 198.51.100.10')"
[ "$codigo" = 200 ] || fallo "refresh respondió $codigo"

echo "== 6b. DELETE con cuerpo por el proxy (baja de un navegador de push)"
token="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).accessToken)' "$TMP/login.json")"
codigo="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
  "$WEB/api/cuenta/notificaciones/dispositivos" -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -H 'X-Real-IP: 198.51.100.10' \
  --data '{"endpoint":"https://fcm.googleapis.com/fcm/send/humo"}')"
# 404 = el cuerpo llegó (ese navegador no está registrado); 400 = el proxy perdió el cuerpo.
[ "$codigo" = 404 ] || fallo "DELETE con cuerpo respondió $codigo (se esperaba 404)"
codigo="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
  "$WEB/api/cuenta/notificaciones/dispositivos" -H "Authorization: Bearer $token" \
  -H 'X-Real-IP: 198.51.100.10')"
[ "$codigo" = 400 ] || fallo "DELETE sin cuerpo respondió $codigo (se esperaba 400)"

echo "== 6c. Sin PAC conectado, el portal NO simula: 503 con el mensaje claro"
codigo="$(curl -sS -o "$TMP/portal.json" -w '%{http_code}' -X POST \
  "$WEB/api/facturacion/portal/humo/facturas" -H 'Content-Type: application/json' \
  -H 'X-Real-IP: 198.51.100.30' --data '{}')"
[ "$codigo" = 503 ] || fallo "el portal respondió $codigo (se esperaba 503)"
grep -q 'La facturación no está conectada todavía' "$TMP/portal.json" \
  || fallo "el 503 del portal no trae el mensaje: $(cat "$TMP/portal.json")"

echo "== 7. socket.io bajo /api: handshake (polling) y upgrade a WebSocket"
curl -fsS -o "$TMP/sio.txt" "$WEB/api/socket.io/?EIO=4&transport=polling" && grep -q '^0{"sid"' "$TMP/sio.txt" \
  || fallo "el handshake de socket.io no llegó a la API"
# El WebSocket nativo de Node 22: el paquete "open" de engine.io (`0{"sid"…`) sólo llega
# si Caddy subió la conexión y la pasó a la API sin el prefijo.
node -e '
  const ws = new WebSocket("ws://127.0.0.1:8080/api/socket.io/?EIO=4&transport=websocket");
  const t = setTimeout(() => { console.error("sin respuesta en 5 s"); process.exit(1); }, 5000);
  ws.onmessage = (e) => {
    if (String(e.data).startsWith("0{")) { clearTimeout(t); ws.close(); process.exit(0); }
  };
  ws.onerror = () => { console.error("el WebSocket falló"); process.exit(1); };
' || fallo "el upgrade a WebSocket por /api/socket.io no llegó a la API"

echo "== 8. Rate limit del login por IP DEL CLIENTE (5/min)"
intento() {
  curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEB/api/auth/login" \
    -H 'Content-Type: application/json' "$@" \
    --data '{"email":"nadie@monitor.test","password":"incorrecta-123"}'
}
for i in 1 2 3 4 5; do
  c="$(intento -H 'X-Real-IP: 203.0.113.1' -H "X-Forwarded-For: 10.9.9.$i")"
  [ "$c" = 401 ] || fallo "intento $i de 203.0.113.1 respondió $c (se esperaba 401)"
done
c="$(intento -H 'X-Real-IP: 203.0.113.1' -H 'X-Forwarded-For: 10.9.9.99')"
[ "$c" = 429 ] || fallo "el 6.º intento de la misma IP respondió $c: un X-Forwarded-For inventado saltó el límite"
c="$(intento -H 'X-Real-IP: 203.0.113.2')"
[ "$c" = 401 ] || fallo "otra IP de cliente respondió $c: todos comparten la IP del proxy"

echo "== 9. Segundo arranque: migrate deploy idempotente y el admin NO se toca"
arrancar_api "otra-contrasena-$(openssl rand -hex 8)"
en_logs_api "ya hay un admin_global activo" || fallo "el 2.º arranque no reconoció al admin"
codigo="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEB/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-Real-IP: 198.51.100.20' \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
[ "$codigo" = 200 ] || fallo "tras el 2.º arranque la contraseña original ya no entra ($codigo)"

echo "HUMO OK: api + web listas para Railway."
