#!/bin/sh
# Arranque del servicio api (api/Dockerfile), en este orden y deteniéndose en el primer
# fallo (Railway reintenta según la restart policy de api/railway.json):
#
#   1. `prisma migrate deploy`: aplica las migraciones pendientes. Idempotente y con
#      candado en la base: dos réplicas arrancando a la vez no migran dos veces. NUNCA
#      `migrate dev` ni `db push`, y NUNCA los seeds de demo (se niegan con
#      NODE_ENV=production).
#   2. `admin-inicial`: crea el PRIMER admin_global si vienen ADMIN_INICIAL_EMAIL y
#      ADMIN_INICIAL_PASSWORD y todavía no hay ninguno. Sin ellas, o con uno ya creado,
#      no hace nada (src/prisma/admin-inicial.ts).
#   3. La API, como PID 1 (`exec`): recibe el SIGTERM de Railway al redeployar.
set -eu

cd /app/api
# 0. Antes de tocar la base: el entorno de producción completo y sin rellenos, y TODAS las
#    lecturas de configuración que harían los módulos al arrancar (adaptadores, JWT, el
#    formato de PANEL_URL, trust proxy, /docs, onboarding, admin inicial), juntas en un
#    solo mensaje (src/config/validar-arranque.ts). Un error aquí no llega a migrar nada.
node dist/config/validar-arranque.js
../node_modules/.bin/prisma migrate deploy
node dist/prisma/admin-inicial.js
exec node dist/main.js
