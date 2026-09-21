# `apps/api` — API REST + WebSocket

Fastify 5 + Drizzle (Postgres/TimescaleDB) + BullMQ (Redis) + Socket.io.
Es el único proceso que habla con el navegador: autentica, expone el CRUD
de monitores/canales/status pages/equipos/planes, programa los checks en
la cola (uno por región) y reenvía por WebSocket los cambios de estado que
publica el worker.

## Arrancar en local

```bash
# desde la raíz del repo
docker compose up -d            # Postgres (TimescaleDB), Redis, Mailpit
cp .env.example .env            # una vez
npm install                     # una vez
npm run db:migrate              # aplica packages/db/migrations
npm run dev:api                 # http://localhost:3000 (tsx watch)
curl -s localhost:3000/health   # {"status":"ok","db":"ok","redis":"ok"}
```

Al arrancar reconcilia los job schedulers de BullMQ con los monitores de la
base (`src/reconcile-schedulers.ts`): crea los que falten y borra las colas
de regiones retiradas de `CHECK_REGIONS`.

## Rutas útiles

| Ruta | Qué es |
| --- | --- |
| `/docs` | Swagger UI con `docs/openapi.yaml` |
| `/health` | 200 si Postgres y Redis responden, 503 si no |
| `/metrics` | Prometheus (peticiones por ruta/status, duración, proceso) |
| `/admin/queues` | Bull Board, **solo con `NODE_ENV != production`** |

## Estructura

```
src/
  index.ts              arranque: env → reconcile → buildServer → listen
  env.ts                variables de entorno (valida secretos en producción)
  server.ts             Fastify: helmet, CORS, rate limit, request id, rutas
  realtime.ts           Socket.io + adaptador Redis (sala org:<id>)
  queue.ts              RegionQueues (productor de jobs)
  plugins/auth.ts       requireAuth (JWT o API key), requireOrganization, requireRole, requireUserSession
  lib/                  api-keys, organizations (roles), plans (límites), metrics (uptime), tokens, password, telemetry
  routes/               auth, organizations (+invitaciones), api-keys, plans, monitors, notification-channels, status-pages, public-status, docs
test/                   tests de integración (vitest, app.inject contra uptimepulse_test)
```

## Variables de entorno

Las de `.env.example`. Obligatorias: `DATABASE_URL`, `REDIS_URL`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. En producción los secretos no
pueden ser los de ejemplo ni tener menos de 32 caracteres. Opcionales con
valor por defecto: `PORT` (3000), `APP_URL`, `CORS_ORIGINS`,
`API_RATE_LIMIT_PER_MINUTE` (300), `AUTH_RATE_LIMIT_PER_MINUTE` (10),
`CHECK_REGIONS` (local), `METRICS_TOKEN`, `SMTP_*`, `MAIL_FROM`.

## Comprobar

```bash
npx tsc --noEmit -p apps/api
npx eslint apps/api/src
npm run test:integration       # necesita docker compose arrancado
```

## Imagen Docker

`docker build -f apps/api/Dockerfile -t uptimepulse-api .` (contexto = raíz).
Ejecuta `tsx src/index.ts` como usuario `node`; las migraciones se aplican
con `node node_modules/.bin/tsx packages/db/src/migrate.ts` (ver
`docker-compose.prod.yml`, servicio `migrate`).
