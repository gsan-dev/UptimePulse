# Despliegue (Fase 5.4)

Dos caminos, los dos con las mismas imágenes Docker (`apps/*/Dockerfile`):

1. **Un servidor con Docker Compose** — el más simple; verificado en local
   con `docker-compose.prod.yml` el 2026-09-21 (migraciones, API, worker con
   `ping` sin root, frontend nginx, registro y checks reales).
2. **Fly.io** — paso a paso, manual. No se ha ejecutado en esta sesión (no
   hay cuenta de Fly): cada comando está tomado de la documentación oficial
   y de las mismas variables que usa el compose.

La CI (`.github/workflows/ci.yml`) construye las tres imágenes en cada PR y,
en `main`, las publica en GHCR como
`ghcr.io/gsan-dev/uptimepulse/{api,worker,web}:latest` y `:<sha>`. Las
opciones de abajo pueden construir localmente o usar esas imágenes.

## Antes de nada: variables y secretos

Todo se configura por variables de entorno (`.env.example` documenta cada
una). Para producción son obligatorias y **no pueden ser las de ejemplo**
(la API se niega a arrancar con `changeme…` o secretos cortos):

```bash
# Genera secretos reales
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_REFRESH_SECRET
```

| Variable | Qué es |
| --- | --- |
| `POSTGRES_PASSWORD` | contraseña de la base (el compose la usa para `DATABASE_URL`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 32 caracteres, distintos entre sí |
| `APP_URL` | URL pública del frontend (enlaces en emails, CORS por defecto) |
| `PUBLIC_API_URL` | URL pública de la API tal y como la ve el navegador (se incrusta en el build del frontend) |
| `CORS_ORIGINS` | orígenes permitidos; vacío = solo `APP_URL` |
| `SMTP_*`, `MAIL_FROM` | un proveedor real (Resend, SES, Postmark…); sin esto no salen alertas por email |
| `CHECK_REGIONS`, `WORKER_REGION` | `local` para un solo worker; ver multi-región abajo |
| `METRICS_TOKEN` | opcional; protege `/metrics` de API y worker |

## Opción 1 — Un servidor con Docker Compose

Requisitos: Docker 24+ con Compose v2, un dominio apuntando al servidor y
un proxy TLS delante (Caddy, Traefik o nginx con certbot; el compose expone
la API en `API_PORT` y el frontend en `WEB_PORT` sin TLS).

```bash
git clone https://github.com/gsan-dev/UptimePulse.git && cd UptimePulse
cp .env.example .env
# Edita .env: POSTGRES_PASSWORD, JWT_*, APP_URL=https://app.midominio.com,
# PUBLIC_API_URL=https://api.midominio.com, SMTP_*, NODE_ENV=production
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # todos "healthy"; "migrate" Exited (0)
curl -s https://api.midominio.com/health            # {"status":"ok","db":"ok","redis":"ok"}
```

Qué arranca: `postgres` (TimescaleDB 2.30.1-pg16, volumen `postgres_data`),
`redis` (AOF, volumen `redis_data`), `migrate` (aplica
`packages/db/migrations` y termina), `api` (:3000), `worker` (:3001 solo
para `/health` y `/metrics`, no publicado) y `web` (nginx, :80 → `WEB_PORT`).

Proxy TLS de ejemplo con Caddy (`/etc/caddy/Caddyfile`):

```
app.midominio.com {
    reverse_proxy localhost:8080
}
api.midominio.com {
    reverse_proxy localhost:3000
}
```

Actualizar: `git pull && docker compose -f docker-compose.prod.yml up -d --build`
(las migraciones nuevas se aplican solas antes de que arranque la API).

Copia de seguridad: `docker compose -f docker-compose.prod.yml exec postgres
pg_dump -U uptimepulse uptimepulse | gzip > backup-$(date +%F).sql.gz`.

Multi-región en un solo compose no tiene sentido (las regiones son
ubicaciones físicas distintas). Para 2+ regiones: `CHECK_REGIONS=eu-west,us-east`
en la API y un `worker` en cada ubicación con su `WORKER_REGION`, todos
contra la misma Postgres/Redis (Redis con TLS/contraseña si cruza internet).

## Opción 2 — Fly.io (manual, paso a paso)

Tres apps de Fly (api, worker, web) + Postgres y Redis gestionados. Se usa
la imagen de GHCR publicada por la CI (o `--dockerfile` para construir).

```bash
# 0. Herramienta y cuenta
curl -L https://fly.io/install.sh | sh && fly auth login
export ORG=personal REGION=mad     # elige tu región Fly más cercana

# 1. Postgres con TimescaleDB. Fly Postgres no trae la extensión: usa
#    Timescale Cloud (plan gratuito) o un Postgres propio con la imagen
#    timescale/timescaledb:2.30.1-pg16 desplegado como app de Fly con volumen.
fly launch --name uptimepulse-db --image timescale/timescaledb:2.30.1-pg16 --no-deploy --org $ORG --region $REGION
fly volumes create pgdata --size 10 --app uptimepulse-db --region $REGION
fly secrets set POSTGRES_USER=uptimepulse POSTGRES_PASSWORD=<pass> POSTGRES_DB=uptimepulse --app uptimepulse-db
# en fly.toml de uptimepulse-db: [mounts] source="pgdata" destination="/var/lib/postgresql/data"; internal_port=5432; sin servicio público
fly deploy --app uptimepulse-db
# DATABASE_URL interna: postgres://uptimepulse:<pass>@uptimepulse-db.internal:5432/uptimepulse

# 2. Redis (Upstash vía Fly)
fly redis create --name uptimepulse-redis --org $ORG --region $REGION --no-replicas
# anota la URL que imprime (redis://default:<pass>@fly-uptimepulse-redis.upstash.io:6379)

# 3. API
fly launch --name uptimepulse-api --image ghcr.io/gsan-dev/uptimepulse/api:latest --no-deploy --org $ORG --region $REGION
fly secrets set --app uptimepulse-api \
  DATABASE_URL='postgres://uptimepulse:<pass>@uptimepulse-db.internal:5432/uptimepulse' \
  REDIS_URL='redis://default:<pass>@fly-uptimepulse-redis.upstash.io:6379' \
  JWT_ACCESS_SECRET=<64hex> JWT_REFRESH_SECRET=<64hex> \
  APP_URL=https://uptimepulse-web.fly.dev CORS_ORIGINS=https://uptimepulse-web.fly.dev \
  SMTP_HOST=smtp.resend.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=resend SMTP_PASS=<api key> \
  MAIL_FROM='UptimePulse <alerts@midominio.com>' CHECK_REGIONS=local
# fly.toml: internal_port = 3000 ; [checks] http path="/health"
fly deploy --app uptimepulse-api
# Migraciones (una vez por versión con migraciones nuevas):
fly ssh console --app uptimepulse-api -C "node /app/node_modules/.bin/tsx /app/packages/db/src/migrate.ts"

# 4. Worker (sin servicio público; el /health interno vale para los checks de Fly)
fly launch --name uptimepulse-worker --image ghcr.io/gsan-dev/uptimepulse/worker:latest --no-deploy --org $ORG --region $REGION
fly secrets set --app uptimepulse-worker DATABASE_URL=… REDIS_URL=… SMTP_HOST=… SMTP_PORT=… SMTP_SECURE=… SMTP_USER=… SMTP_PASS=… MAIL_FROM=… \
  CHECK_REGIONS=local WORKER_REGION=local WORKER_HTTP_PORT=3001
fly deploy --app uptimepulse-worker
# Multi-región: fly scale count 1 --region ams --app uptimepulse-worker-eu (WORKER_REGION=eu-west) y otra app en iad (us-east), CHECK_REGIONS=eu-west,us-east en las dos y en la API.

# 5. Frontend (la URL de la API va en el build: hay que construir con el arg)
fly launch --name uptimepulse-web --dockerfile apps/web/Dockerfile --no-deploy --org $ORG --region $REGION
fly deploy --app uptimepulse-web --build-arg VITE_API_URL=https://uptimepulse-api.fly.dev
```

Comprobación final: `curl https://uptimepulse-api.fly.dev/health`, abrir
`https://uptimepulse-web.fly.dev/register`, crear un monitor y ver
"Operativo"; `fly logs --app uptimepulse-worker` muestra `check registrado`.

## Observabilidad en producción

- `/metrics` en la API (`:3000`) y el worker (`:3001`), formato Prometheus.
  Con `METRICS_TOKEN` definido exigen `Authorization: Bearer <token>`.
- Logs: una línea JSON por evento en stdout (`docker compose logs -f api`,
  `fly logs`), con `requestId` para correlacionar.
- Health: `/health` devuelve 503 si Postgres o Redis no responden; los
  `HEALTHCHECK` de las imágenes lo usan.

## Lo que NO cubre este documento

- TLS automático (lo hace el proxy o Fly).
- Alta disponibilidad de Postgres/Redis (usa servicios gestionados).
- Pasarela de pago: el cambio de plan es simulado (ver ADR Fase 4.3).
