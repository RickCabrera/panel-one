# Imagen del servicio "api" en Railway (docs/deploy-railway.md). El contexto es la RAÍZ
# del repo, por los workspaces y el lockfile único:
#
#     docker build -f api/Dockerfile -t monitor-api .
#
# Etapas:
#   build     deps completas, cliente de Prisma generado (para musl) y `nest build`.
#   prod-deps sólo las dependencias de producción (el CLI `prisma` es una de ellas: el
#             arranque corre `prisma migrate deploy`), con sus motores ya descargados.
#   final     prod-deps + dist + el cliente generado, sin root.
#
# Los `npm ci` van con `--ignore-scripts`: la imagen trae npm 10, que ignora el
# `allowScripts` de la raíz y correría TODOS los postinstall (telemetría incluida). Los
# únicos que hacen falta son los de Prisma, y se corren explícitos.
#
# NUNCA entra `api/.env`: `cargarEnvLocal()` lo leería al arrancar y rellenaría lo que
# Railway no mande (nota de F2-200). Lo impide el `.dockerignore` de la raíz.

FROM node:22.23.3-alpine AS base
# Prisma elige su motor por la libssl del sistema; alpine no la trae.
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
# npm valida TODOS los workspaces que declara la raíz, aunque sólo se instale uno.
COPY web/package.json web/
RUN npm ci --workspace @monitor/api --ignore-scripts --no-audit --no-fund
COPY api/ api/
WORKDIR /app/api
RUN npx prisma generate && npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
# `npm rebuild @prisma/engines` baja los motores de Prisma (el schema-engine de
# `migrate deploy`) AHORA, en el build: si no, el CLI los bajaría en cada arranque.
RUN npm ci --workspace @monitor/api --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm rebuild @prisma/engines --foreground-scripts \
  && npm cache clean --force

FROM base AS final
ENV NODE_ENV=production
# Sin telemetría ni avisos de actualización del CLI de Prisma en cada arranque.
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build --chown=node:node /app/api/dist /app/api/dist
# `migrate deploy` lee el esquema y las migraciones.
COPY --from=build --chown=node:node /app/api/prisma/schema.prisma /app/api/prisma/schema.prisma
COPY --from=build --chown=node:node /app/api/prisma/migrations /app/api/prisma/migrations
COPY --chown=node:node api/docker-entrypoint.sh /app/api/docker-entrypoint.sh
# Si se conecta ARCHIVOS_IMPL=disco, el volumen de Railway se monta aquí (ARCHIVOS_RAIZ).
RUN chmod 0755 /app/api/docker-entrypoint.sh \
  && mkdir -p /datos/archivos && chown node:node /datos/archivos
USER node
WORKDIR /app/api
EXPOSE 3000
CMD ["/app/api/docker-entrypoint.sh"]
