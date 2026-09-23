# `apps/worker` — ejecutor de checks

Consume la cola BullMQ de **su región** (`monitor-checks--<WORKER_REGION>`),
ejecuta el check (HTTP, TCP o ping ICMP), guarda el resultado en `checks`,
consolida el estado con el resto de regiones (quórum), abre/cierra
incidentes, envía alertas (email, Discord, Slack, webhook firmado) y publica
los cambios de estado en Redis para que la API los reenvíe por WebSocket.

## Arrancar en local

```bash
docker compose up -d && cp .env.example .env && npm install && npm run db:migrate   # una vez
npm run dev:worker                      # región "local" por defecto
curl -s localhost:3001/health           # {"status":"ok","region":"local","db":"ok","redis":"ok"}
curl -s localhost:3001/metrics | grep uptimepulse_checks_total
```

Simular dos regiones en local (la API debe tener `CHECK_REGIONS=eu-west,us-east`):

```bash
CHECK_REGIONS=eu-west,us-east WORKER_REGION=eu-west npm run dev:worker
CHECK_REGIONS=eu-west,us-east WORKER_REGION=us-east npm run dev:worker
```

## Qué hace con cada job (`src/lib/process-check.ts`)

1. Carga el monitor; si no existe o está pausado, ignora el job.
2. Cuota por host de destino (`CHECK_MAX_PER_HOST_PER_MINUTE`, Redis): si el
   host ya recibió su cupo este minuto, salta el check (no se guarda nada).
3. Revalida anti-SSRF y ejecuta el check con hasta 3 intentos
   (`run-check.ts`). HTTP sigue redirecciones a mano revalidando cada
   salto; ping invoca el `ping` del sistema sin shell.
4. Inserta la fila en `checks` (con `region`) y llama a
   `evaluateMonitorHealth` (`health.ts`): último check por región, quórum
   `floor(R/2)+1`, umbral de fallos consecutivos, ventanas de mantenimiento;
   actualiza `monitors.consolidated_status` y abre/cierra incidentes en la
   misma transacción.
5. Si cambió el consolidado, publica `monitor:status_changed` (Redis →
   Socket.io). Si se abrió/cerró un incidente, notifica por los canales del
   monitor y por email a los miembros.
6. Para `https://`, comprueba la caducidad del certificado (`ssl-check.ts`).

## Estructura

```
src/
  index.ts          arranque: worker BullMQ + servidor HTTP (/health, /metrics)
  env.ts            variables (WORKER_REGION debe estar en CHECK_REGIONS)
  runtime.ts        conexión Redis, telemetría y limitador por host compartidos
  http-server.ts    /health y /metrics con node:http
  lib/
    process-check.ts  orquestación de un job
    run-check.ts      anti-SSRF + reintentos
    http-check.ts     fetch con redirecciones manuales y errorKind
    tcp-check.ts      socket TCP
    ping-check.ts     ping del sistema (Windows/Linux/macOS)
    health.ts         quórum multi-región e incidentes
    notifications.ts  email + canales
    ssl-check.ts / ssl-alerts.ts
    host-rate-limit.ts, telemetry.ts, realtime-emitter.ts, types.ts
test/               tests de integración del motor de incidentes
```

## Variables de entorno

`DATABASE_URL`, `REDIS_URL` (obligatorias); `CHECK_REGIONS`, `WORKER_REGION`,
`WORKER_CONCURRENCY` (5), `INCIDENT_FAILURE_THRESHOLD` (2),
`CHECK_MAX_PER_HOST_PER_MINUTE` (60), `WORKER_HTTP_PORT` (3001),
`METRICS_TOKEN`, `SMTP_*`, `MAIL_FROM`, `ALLOW_PRIVATE_MONITOR_TARGETS`
(solo desarrollo).

## Imagen Docker

`docker build -f apps/worker/Dockerfile -t uptimepulse-worker .` Instala
`iputils-ping` (el `ping` de busybox exige root) y corre como usuario `node`.
