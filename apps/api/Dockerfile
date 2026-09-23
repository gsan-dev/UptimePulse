# Imagen de la API (Fase 5.4). Contexto de build = raíz del repositorio:
#   docker build -f apps/api/Dockerfile -t uptimepulse-api .
#
# El código TypeScript se ejecuta con tsx (transpilación al vuelo con
# esbuild) en vez de compilarse con tsc: los paquetes del monorepo se
# consumen como fuente ("main": "./src/index.ts") y una build por paquete
# no aporta nada aquí salvo complejidad (ver ADR "Fase 5.4" en TASK.md).

# --- deps: solo dependencias de producción de la API y sus paquetes ---
FROM node:22-alpine AS deps
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
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root=false --ignore-scripts && mkdir -p apps/api/node_modules

# --- runtime ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY docs/openapi.yaml ./docs/openapi.yaml
RUN chown -R node:node /app
USER node
EXPOSE 3000
# El puerto se resuelve en tiempo de EJECUCIÓN a partir de PORT, no se fija
# al construir: así la misma imagen vale aunque el compose la arranque en
# otro puerto. (HEALTHCHECK en forma shell, que es la que expande variables;
# en forma exec — ["wget", …] — el ${PORT} llegaría literal.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1
WORKDIR /app/apps/api
CMD ["node", "../../node_modules/.bin/tsx", "src/index.ts"]
