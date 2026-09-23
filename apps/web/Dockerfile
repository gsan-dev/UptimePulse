# Imagen del frontend (Fase 5.4). Contexto de build = raíz del repositorio:
#   docker build -f apps/web/Dockerfile -t uptimepulse-web .
#
# Por defecto la SPA habla con la API en su MISMO origen (/api y /socket.io,
# que nginx reenvía a API_UPSTREAM): la misma imagen sirve para cualquier
# dominio. Solo si API y frontend van en dominios distintos hace falta
# reconstruir con --build-arg VITE_API_URL=https://api.midominio.com.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/mailer/package.json packages/mailer/
COPY packages/notify-channels/package.json packages/notify-channels/
COPY packages/queue/package.json packages/queue/
COPY packages/server-utils/package.json packages/server-utils/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=apps/web --include-workspace-root=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace=apps/web

FROM nginx:1.27-alpine
# La imagen de nginx procesa /etc/nginx/templates/*.template con envsubst
# al arrancar; solo se sustituyen API_UPSTREAM y DNS_RESOLVER (las $variables de nginx quedan).
ENV API_UPSTREAM=api:3000 DNS_RESOLVER=127.0.0.11 NGINX_ENVSUBST_FILTER=^(API_UPSTREAM|DNS_RESOLVER)$
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
