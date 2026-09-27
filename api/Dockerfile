# Imagen de la API (F1-002). El contexto es la RAÍZ del repo, por los workspaces y
# el lockfile único:
#
#     docker build -f api/Dockerfile --target api .
#
# El compose de producción (infra/docker-compose.prod.yml) la construye solo. Etapas:
#   build     — deps completas, cliente de Prisma generado (para musl) y `nest build`.
#   migrar    — la misma con el CLI de Prisma, que es devDependency: corre
#               `prisma migrate deploy` (servicio `migrar` del compose) y termina.
#   prod-deps — sólo las dependencias de producción.
#   api       — la que corre: prod-deps + dist + el cliente generado.
#
# Los `npm ci` van con `--ignore-scripts`: la imagen trae npm 10, que ignora el
# `allowScripts` de la raíz y correría TODOS los postinstall. El único que hace falta
# es `prisma generate`, y se corre explícito, como en el CI.
#
# NUNCA entra `api/.env`: `cargarEnvLocal()` lo leería al arrancar y rellenaría lo
# que el compose no mande (nota de F2-200). Lo impide el `.dockerignore` de la raíz.

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

FROM build AS migrar
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace @monitor/api --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS api
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build --chown=node:node /app/api/dist /app/api/dist
# El volumen `archivos` (ARCHIVOS_IMPL=disco) se monta aquí. Un volumen nombrado nuevo
# hereda el dueño de este directorio: sin el chown nace de root y la primera factura
# o binario del agente da EACCES.
RUN mkdir -p /datos/archivos && chown node:node /datos/archivos
USER node
WORKDIR /app/api
EXPOSE 3000
# La señal que mira Docker es la misma que mira UptimeRobot: `GET /health` (API + base).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
