# Imagen del servicio "web" en Railway (docs/deploy-railway.md): el panel (SPA) y la
# landing, servidos por Caddy, que además pasa /api (y el socket del tiempo real) a la
# API por la red privada. El contexto es la RAÍZ del repo, por el lockfile único:
#
#     docker build -f web/Dockerfile -t monitor-web .
#
# Los estáticos van DENTRO de la imagen: un deploy es "esta imagen", y un rollback en
# Railway es redeployar la anterior, con su panel y su landing de ese momento.

FROM node:22.23.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm valida TODOS los workspaces que declara la raíz, aunque sólo se instale uno.
COPY api/package.json api/
COPY web/package.json web/
# Sin scripts: npm 10 ignora el `allowScripts` de la raíz y correría todos los
# postinstall. El build no necesita ninguno (los binarios nativos de vite/tailwind
# llegan como dependencias opcionales por plataforma, ya en el lockfile para musl).
RUN npm ci --workspace @monitor/web --ignore-scripts --no-audit --no-fund
COPY web/ web/
# A dónde lleva "Entrar al panel" desde la landing (vite.landing.config.ts). Sin
# `VITE_`: no entra a ningún bundle. Por defecto `/login` (mismo origen). Si la landing
# vive en otro dominio (LANDING_HOST), pon la URL completa del panel, p. ej.
# https://app.midominio.mx/login. Railway pasa como build arg la variable del servicio
# que se llame igual.
ARG URL_PANEL=/login
ENV URL_PANEL=$URL_PANEL
RUN npm run build --workspace @monitor/web

# La versión con la que se probaron los snippets de F1-092.
FROM caddy:2.11.4-alpine
COPY infra/caddy/Caddyfile.railway /etc/caddy/Caddyfile
COPY infra/caddy/seguridad.caddy /etc/caddy/seguridad.caddy
COPY web/docker-entrypoint.sh /usr/local/bin/web-entrypoint
COPY --from=build /app/web/dist /srv/web
COPY --from=build /app/web/dist-landing /srv/landing
# Sin root. Con `admin off` y `auto_https off` Caddy no escribe certificados ni config,
# pero igual quiere sus carpetas XDG: van a /tmp, que es del contenedor.
ENV XDG_CONFIG_HOME=/tmp/caddy/config XDG_DATA_HOME=/tmp/caddy/data
RUN chmod 0755 /usr/local/bin/web-entrypoint \
  && API_INTERNAL_URL=http://api.invalid:3000 PORT=8080 \
     caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/web-entrypoint"]
