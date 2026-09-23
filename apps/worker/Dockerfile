# Imagen del worker (Fase 5.4). Contexto de build = raíz del repositorio:
#   docker build -f apps/worker/Dockerfile -t uptimepulse-worker .
#
# El código TypeScript se ejecuta con tsx (transpilación al vuelo con
# esbuild) en vez de compilarse con tsc: los paquetes del monorepo se
# consumen como fuente ("main": "./src/index.ts") y una build por paquete
# no aporta nada aquí salvo complejidad (ver ADR "Fase 5.4" en TASK.md).

# --- deps: solo dependencias de producción del worker y sus paquetes ---
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
RUN npm ci --omit=dev --workspace=apps/worker --include-workspace-root=false --ignore-scripts && mkdir -p apps/worker/node_modules

# --- runtime ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# Los checks "ping" invocan el binario ping del sistema. El de busybox exige
# root; el de iputils lleva la capability cap_net_raw en el fichero y
# funciona con el usuario "node".
RUN apk add --no-cache iputils-ping && chown -R node:node /app
USER node
EXPOSE 3001
# Igual que en la API: el puerto se resuelve en tiempo de ejecución a partir
# de WORKER_HTTP_PORT, no se fija al construir la imagen.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${WORKER_HTTP_PORT:-3001}/health" || exit 1
WORKDIR /app/apps/worker
CMD ["node", "../../node_modules/.bin/tsx", "src/index.ts"]
