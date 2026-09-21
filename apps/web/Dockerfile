# Imagen del frontend (Fase 5.4). Contexto de build = raíz del repositorio:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.midominio.com -t uptimepulse-web .
#
# Vite incrusta VITE_API_URL en el bundle en tiempo de build: la URL pública
# de la API es un argumento de build, no una variable en tiempo de ejecución.

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
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace=apps/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
