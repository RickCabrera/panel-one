# Imagen de Caddy de producción (F1-002): el Caddyfile, los snippets de F1-092 y los
# estáticos ya construidos del panel (`web/dist`) y de la landing (`web/dist-landing`).
# El contexto es la RAÍZ del repo:
#
#     docker build -f infra/caddy/Dockerfile --build-arg URL_PANEL=https://app.DOMINIO/login .
#
# Los estáticos van DENTRO de la imagen (no montados): un despliegue es "esta imagen",
# y un rollback es la imagen anterior, con su panel y su landing de ese momento.

FROM node:22.23.3-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
# Sin scripts: la imagen trae npm 10, que ignora el `allowScripts` de la raíz. El build
# no necesita ninguno (los binarios nativos de vite/tailwind llegan como dependencias
# opcionales por plataforma, ya en el lockfile para musl).
RUN npm ci --workspace @monitor/web --ignore-scripts --no-audit --no-fund
COPY web/ web/
# A dónde lleva "Entrar al panel" desde la landing (vite.landing.config.ts). Sin `VITE_`:
# no entra a ningún bundle. Obligatoria: una landing construida con el `/login` por
# defecto manda al panel del dominio raíz, que aquí no existe (vive en `app.`).
ARG URL_PANEL
RUN test -n "$URL_PANEL" || (echo "Falta --build-arg URL_PANEL (https://app.DOMINIO/login)" >&2; exit 1)
ENV URL_PANEL=$URL_PANEL
RUN npm run build --workspace @monitor/web

# La versión con la que se probaron los snippets de F1-092.
FROM caddy:2.11.4-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY infra/caddy/seguridad.caddy /etc/caddy/seguridad.caddy
COPY --from=web /app/web/dist /srv/web
COPY --from=web /app/web/dist-landing /srv/landing
