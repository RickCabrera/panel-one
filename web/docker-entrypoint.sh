#!/bin/sh
# Arranque del servicio web (web/Dockerfile). Sin API_INTERNAL_URL Caddy arrancaría con
# un `reverse_proxy` vacío y cada /api respondería 502: mejor no arrancar y decir por qué.
set -eu

if [ -z "${API_INTERNAL_URL:-}" ]; then
  echo "web: falta API_INTERNAL_URL (p. ej. http://api.railway.internal:3000 o, en Railway, http://\${{api.RAILWAY_PRIVATE_DOMAIN}}:\${{api.PORT}})." >&2
  exit 1
fi
case "$API_INTERNAL_URL" in
  http://*|https://*) ;;
  *)
    echo "web: API_INTERNAL_URL tiene que empezar con http:// (la red privada de Railway no lleva TLS)." >&2
    exit 1
    ;;
esac
export PORT="${PORT:-8080}"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
