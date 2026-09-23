# Self-hosting de UptimePulse

Todo el sistema corre en un servidor con Docker Compose y **un solo
origen**: el contenedor `web` (nginx) sirve la interfaz y reenvía `/api` y el
WebSocket a la API, así que solo hay que publicar un puerto o un dominio, no
hay CORS que configurar y las imágenes publicadas sirven para cualquier
dominio sin reconstruir. Verificado el 2026-09-22 en local con HTTPS (Caddy)
y con HTTP plano, incluida una restauración de copia de seguridad.

```
Internet ──▶ caddy (:80/:443, TLS automático, opcional)
                └──▶ web (nginx: SPA + /api + /socket.io) ──▶ api (:3000) ──▶ postgres (TimescaleDB)
                                                              │                 redis
                                                              └──▶ worker (checks, alertas)
```

## Requisitos

- Un servidor Linux con Docker 24+ y Compose v2 (1 vCPU / 1 GB bastan para
  decenas de monitores).
- Para HTTPS automático: un dominio apuntando al servidor (registro A/AAAA)
  y los puertos 80 y 443 libres. Sin dominio funciona igual en HTTP dentro
  de una red local.
- Un SMTP real (Resend, Postmark, SES, el de tu proveedor…) si quieres
  alertas por email. Discord, Slack y webhooks no necesitan nada.
- (Opcional) el binario `ping` ya va en la imagen del worker.

## Instalación en 4 pasos

```bash
# 1. Código (solo hacen falta docker-compose.prod.yml, deploy/ y scripts/;
#    las imágenes se descargan de GHCR)
git clone https://github.com/gsan-dev/UptimePulse.git && cd UptimePulse

# 2. Configuración
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ×2 → JWT_ACCESS_SECRET y JWT_REFRESH_SECRET
#    (sin Node: openssl rand -hex 32)
#    Edita .env: POSTGRES_PASSWORD, JWT_*, DOMAIN y APP_URL, SMTP_* (ver tabla)

# 3a. Con dominio y HTTPS automático (Let's Encrypt vía Caddy)
docker compose -f docker-compose.prod.yml --profile tls up -d
# 3b. Sin dominio (red local / detrás de tu propio proxy): HTTP en WEB_PORT (8080)
docker compose -f docker-compose.prod.yml up -d

# 4. Comprobar
docker compose -f docker-compose.prod.yml ps        # todo "healthy"; "migrate" Exited (0)
curl -s https://TU_DOMINIO/api/health               # {"status":"ok","db":"ok","redis":"ok"}
```

Abre `https://TU_DOMINIO/register` (o `http://IP:8080/register`), crea la
primera cuenta (será administradora de su organización) y un monitor: en
segundos verás "Operativo" sin recargar.

### Variables de `.env` que importan para self-hosting

| Variable | Valor |
| --- | --- |
| `POSTGRES_PASSWORD` | contraseña de la base (obligatoria) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 32 caracteres, distintos; la API no arranca en producción con los de ejemplo |
| `DOMAIN` | dominio para Caddy (perfil `tls`), p. ej. `status.midominio.com` |
| `APP_URL` | URL pública tal y como la ve el navegador: `https://status.midominio.com` o `http://192.168.1.10:8080`. Se usa en los enlaces de los emails y como origen CORS por defecto |
| `COOKIE_SECURE` | `true` (defecto) con HTTPS. **`false` si se usa HTTP plano**, si no el navegador descarta la cookie de sesión y se cierra la sesión a los 15 min |
| `WEB_PORT` | puerto HTTP publicado por `web` (8080). Con Caddy delante puedes dejarlo cerrado en el firewall |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | proveedor de email; sin `SMTP_HOST` no salen emails (el resto de alertas funciona) |
| `UPTIMEPULSE_VERSION` | etiqueta de imagen de GHCR (`latest` o un SHA de commit) para fijar versión |
| `METRICS_TOKEN` | opcional; protege `/api/metrics` y el `/metrics` del worker |
| `CHECK_MAX_PER_HOST_PER_MINUTE`, `API_RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE` | límites de protección (60 / 300 / 10) |

Construir las imágenes desde el código en vez de descargarlas:
`docker compose -f docker-compose.prod.yml up -d --build`.

## Operación

**Actualizar a una versión nueva**

```bash
git pull
docker compose -f docker-compose.prod.yml pull        # o --build si construyes tú
docker compose -f docker-compose.prod.yml up -d       # aplica migraciones nuevas antes de arrancar la API
```

**Copias de seguridad** (Postgres/TimescaleDB; Redis solo guarda la cola y
se reconstruye solo al arrancar la API):

```bash
scripts/backup.sh                 # → backups/uptimepulse-<fecha>.sql.gz
scripts/restore.sh backups/uptimepulse-<fecha>.sql.gz   # para API y worker, RECREA la base y los arranca
```

`restore.sh` sigue el procedimiento oficial de TimescaleDB
(`timescaledb_pre_restore` → volcado → `timescaledb_post_restore`), por eso
recrea la base en vez de restaurar encima. Verificado: tras restaurar,
usuarios, checks, hypertable y agregado continuo vuelven y el worker sigue
escribiendo. Programa `backup.sh` con cron y copia `backups/` fuera del
servidor. Si levantaste el stack con `-p`, exporta `COMPOSE_PROJECT_NAME`.

**Logs y salud**

```bash
docker compose -f docker-compose.prod.yml logs -f api worker   # una línea JSON por evento, con requestId
curl -s https://TU_DOMINIO/api/health                          # 503 si Postgres o Redis no responden
curl -s https://TU_DOMINIO/api/metrics                         # Prometheus (API); el worker expone el suyo en la red interna (worker:3001)
```

**Multi-región.** Las regiones son ubicaciones distintas: `CHECK_REGIONS=eu-west,us-east`
en la API y un `worker` en cada sitio con su `WORKER_REGION`, todos contra la
misma Postgres/Redis (Redis con contraseña y TLS si cruza internet; el
compose de un solo servidor no lo cubre).

**Tu propio proxy en vez de Caddy.** Reenvía a `web` (`WEB_PORT`) con
soporte de WebSocket (`Upgrade`/`Connection`) y las cabeceras
`X-Forwarded-For` y `X-Forwarded-Proto`; deja `COOKIE_SECURE=true` si
terminas TLS ahí.

**Exponer la API en otro dominio** (no necesario): reconstruye `web` con
`--build-arg VITE_API_URL=https://api.midominio.com`, publica el puerto de
`api` y pon `CORS_ORIGINS`.

## Fly.io (alternativa gestionada, manual)

No se ha ejecutado en esta sesión (sin cuenta de Fly); los comandos siguen la
documentación oficial y las mismas variables del compose.

```bash
curl -L https://fly.io/install.sh | sh && fly auth login
export ORG=personal REGION=mad

# Postgres con TimescaleDB (Fly Postgres no trae la extensión): Timescale
# Cloud o la imagen timescale/timescaledb:2.30.1-pg16 como app con volumen.
fly launch --name uptimepulse-db --image timescale/timescaledb:2.30.1-pg16 --no-deploy --org $ORG --region $REGION
fly volumes create pgdata --size 10 --app uptimepulse-db --region $REGION
fly secrets set POSTGRES_USER=uptimepulse POSTGRES_PASSWORD=<pass> POSTGRES_DB=uptimepulse --app uptimepulse-db
fly deploy --app uptimepulse-db      # fly.toml: [mounts] pgdata → /var/lib/postgresql/data, internal_port 5432, sin servicio público

fly redis create --name uptimepulse-redis --org $ORG --region $REGION --no-replicas

# API (interna) y worker: mismas variables que el compose
fly launch --name uptimepulse-api --image ghcr.io/gsan-dev/uptimepulse/api:latest --no-deploy --org $ORG --region $REGION
fly secrets set --app uptimepulse-api DATABASE_URL=… REDIS_URL=… JWT_ACCESS_SECRET=… JWT_REFRESH_SECRET=… APP_URL=https://uptimepulse-web.fly.dev SMTP_HOST=… SMTP_PORT=… SMTP_SECURE=… SMTP_USER=… SMTP_PASS=… MAIL_FROM=… CHECK_REGIONS=local
fly deploy --app uptimepulse-api     # fly.toml: internal_port 3000, sin servicio público (se llega por la red privada)
fly ssh console --app uptimepulse-api -C "node /app/node_modules/.bin/tsx /app/packages/db/src/migrate.ts"

fly launch --name uptimepulse-worker --image ghcr.io/gsan-dev/uptimepulse/worker:latest --no-deploy --org $ORG --region $REGION
fly secrets set --app uptimepulse-worker DATABASE_URL=… REDIS_URL=… SMTP_… CHECK_REGIONS=local WORKER_REGION=local
fly deploy --app uptimepulse-worker

# Web (pública): la misma imagen; apunta al nombre interno de la API y al DNS de Fly
fly launch --name uptimepulse-web --image ghcr.io/gsan-dev/uptimepulse/web:latest --no-deploy --org $ORG --region $REGION
fly secrets set --app uptimepulse-web API_UPSTREAM=uptimepulse-api.internal:3000 DNS_RESOLVER='[fdaa::3]'
fly deploy --app uptimepulse-web     # fly.toml: internal_port 80, servicio https en 443
```

## Lo que NO cubre este documento

- Alta disponibilidad de Postgres/Redis (usa servicios gestionados).
- SMS: no hay integración con Twilio.
