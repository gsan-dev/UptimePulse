# TASK.md — Plan de implementación de UptimePulse

> Desglose accionable del [readme.md](readme.md) para construir el proyecto de forma incremental.
> Cada tarea es un checkbox. Márcalas conforme avances (`- [ ]` → `- [x]`).
> Las fases siguen el roadmap del README, con una **Fase 0** añadida (cimientos que el README da por hechos) y una **Fase 5** añadida (seguridad, calidad y lanzamiento, transversal a todo lo demás).

---

## Cómo usar este documento

- Trabaja fase por fase, en orden. No saltes a WebSockets (Fase 2) sin tener el worker simple de la Fase 1 guardando datos reales.
- Cada tarea grande incluye una nota de **"Hecho cuando..."** para que sepas cuándo darla por cerrada sin ambigüedad.
- Las tareas marcadas **(diseño)** requieren tomar una decisión y anotarla (en un `ADR/` o al final de este archivo) antes de picar código — son las decisiones que dan valor de portfolio.

---

## Fase 0 — Cimientos del proyecto

Antes de tocar lógica de negocio, monta el esqueleto para que cada pieza posterior tenga dónde vivir.

### 0.1 Estructura del monorepo ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Crear estructura de carpetas según README §6 (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`).
- [x] Elegir gestor de monorepo: ~~pnpm workspaces~~ **npm workspaces** (cambio de decisión: `corepack`/pnpm requería permisos de admin en Windows; npm workspaces cubre lo mismo sin esa fricción — detalle en el diario).
- [x] Inicializar `git init`, `.gitignore` (node_modules, .env, dist, coverage).
- [x] `package.json` raíz con scripts comunes (`dev:api`, `dev:worker`, `dev:web`, `build`, `lint`, `test`).
- [x] Configurar TypeScript compartido (`tsconfig.base.json`) y ESLint/Prettier a nivel de repo.
- **Hecho cuando:** `npm install` en la raíz resuelve las tres apps sin errores y cada una tiene un `dev` script que arranca (aunque sea un "Hello world"). **Verificado.**

### 0.2 Docker Compose para desarrollo ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] `docker-compose.yml` con: PostgreSQL (+ TimescaleDB), Redis.
- [x] Variables de entorno vía `.env` (con `.env.example` versionado, nunca el `.env` real).
- [x] Volúmenes persistentes para no perder datos al reiniciar contenedores.
- **Hecho cuando:** `docker compose up -d` deja Postgres y Redis accesibles desde el host. **Verificado:** ambos contenedores en estado `healthy`, extensión `timescaledb` (v2.30.1) instalable, Redis responde `PONG`, volúmenes `uptimepulse_postgres_data` y `uptimepulse_redis_data` creados.

### 0.3 (diseño) Modelo de datos inicial ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Diseñar el ERD antes de escribir migraciones. Entidades mínimas:
  - `users` (id, email, password_hash, created_at, oauth_provider, oauth_id)
  - `organizations` (id, name, plan_id) — aunque no haya equipos hasta fase 4, crea el concepto desde ya para no reescribir FKs luego.
  - `organization_members` (user_id, organization_id, role)
  - `monitors` (id, org_id, name, type[http/tcp/ping], target, method, headers, body, expected_status, interval_seconds, timeout_ms, is_paused, tags)
  - `checks` (id, monitor_id, timestamp, status[up/down], response_time_ms, http_status, error_message) — **candidata a hypertable de TimescaleDB**.
  - `incidents` (id, monitor_id, started_at, resolved_at, cause_summary)
  - `notification_channels` (id, org_id, type[email/sms/webhook/slack/discord], config_json)
  - `monitor_notification_channels` (monitor_id, channel_id) — tabla puente para la matriz de alertas.
  - `status_pages` (id, org_id, slug, title, is_public)
  - `status_page_monitors` (status_page_id, monitor_id, display_name)
  - `maintenance_windows` (id, monitor_id, starts_at, ends_at, note) — **añadido respecto al README, ver nota de mejora #3**.
  - `api_keys` (id, org_id, key_hash, scopes, last_used_at)
  - `plans` (id, name, max_monitors, min_interval_seconds, allowed_channels)
- [x] Decidir política de **retención de datos** (mejora #4): **decisión tomada e implementada** — checks en crudo 90 días (`add_retention_policy` de TimescaleDB ya activa sobre la hypertable `checks`); los rollups horarios/diarios permanentes se añadirán como *continuous aggregates* en la Fase 2.2, antes de que la política de retención empiece a borrar datos reales (en desarrollo, con datos de prueba, no hay urgencia).
- [x] Herramienta de migraciones: **Drizzle ORM + drizzle-kit** (no Prisma — ver justificación en el diario: Prisma no modela bien las hypertables/políticas de Timescale; Drizzle permite migraciones SQL "custom" intercaladas con las generadas automáticamente).
- **Hecho cuando:** existe un diagrama (aunque sea en Markdown/Mermaid) y las migraciones iniciales corren limpias sobre el Postgres del docker-compose. **Verificado:** 13 tablas creadas, `checks` convertida en hypertable, política de retención de 90 días activa, prueba de inserción/borrado en cascada vía el cliente Drizzle exitosa.

### 0.4 Convenciones de código compartidas ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] `packages/shared`: tipos TS de dominio (Monitor, Check, Incident, etc.) usados tanto por API, worker y web. **Implementado como tipos derivados de `packages/db` vía `InferSelectModel`** (una sola fuente de verdad: el esquema real de la BD), no como copias escritas a mano.
- [x] Definir formato de logging estructurado (JSON) reutilizable entre API y worker (mejora #6, ver Fase 5). Implementado en `packages/shared/src/logger.ts` (`createLogger(service)`), usado ya en `apps/api` y `apps/worker`.
- **Hecho cuando:** un cambio en un tipo de `shared` se refleja con autocompletado en `apps/api` y `apps/web` sin duplicar la definición. **Verificado:** `apps/api` usa `Monitor` real con todos sus campos; `apps/web` importa el mismo tipo con `import type` y Vite lo borra por completo del bundle (comprobado inspeccionando el JS servido, cero referencias a `@uptimepulse/shared`/`pg`/`drizzle-orm` en tiempo de ejecución del navegador).

---

## 🎉 Fase 0 completa (Cimientos del proyecto)

Con 0.1, 0.2, 0.3 y 0.4 cerrados, el proyecto tiene: monorepo funcional, infraestructura de datos local (Postgres+TimescaleDB, Redis), esquema de base de datos real con migraciones versionadas, tipos compartidos con una sola fuente de verdad, y logging estructurado. **Siguiente:** Fase 1 (MVP) — empieza por 1.1 (Autenticación), que es la primera pieza que escribe código de negocio real sobre las tablas `users`/`organizations`/`organization_members` ya creadas.

---

## Fase 1 — MVP

Objetivo: un usuario se registra, crea un monitor HTTP, un worker lo comprueba cada minuto, y ve el resultado en un dashboard básico. Alertas por email si cae.

### 1.1 Autenticación ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Registro/login con email + contraseña (hash con **bcryptjs**, ver ADR — no `bcrypt`/`argon2` nativos).
- [x] Emisión de JWT (access token corto de 15 min + refresh token de 7 días en cookie httpOnly). Ver ADR en TASK.md.
- [x] Middleware de autenticación en la API (`requireAuth`, preHandler de Fastify).
- [x] Endpoint `GET /me`.
- **Hecho cuando:** puedes registrar un usuario, iniciar sesión, y llamar a un endpoint protegido con el token. **Verificado con peticiones HTTP reales:** registro, `/me` sin token (401), `/me` con token (200), registro duplicado (409), login con contraseña incorrecta (401), refresh vía cookie, logout limpia la cookie. También verificado que el registro crea automáticamente una organización personal con el usuario como `admin`.

### 1.2 CRUD de monitores (API) ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] `POST /monitors`, `GET /monitors`, `GET /monitors/:id`, `PATCH /monitors/:id`, `DELETE /monitors/:id`.
- [x] `POST /monitors/:id/pause` / `/resume`.
- [x] Validación de input (zod): URL bien formada (por tipo de monitor, con `z.discriminatedUnion`), intervalo dentro de los límites del plan. Se sembró un plan "free" por defecto (migración `0003_seed_default_plan.sql`) para que este límite tuviera algo real que comprobar.
- [x] **Validación anti-SSRF (mejora #1, crítica):** implementada en `lib/ssrf-guard.ts`. Resuelve el hostname por DNS y rechaza IPs privadas/loopback/link-local, salvo `ALLOW_PRIVATE_MONITOR_TARGETS=true` en `.env` (modo desarrollo explícito).
- **Hecho cuando:** puedes crear/editar/pausar/borrar un monitor vía API y un intento de monitorizar `http://localhost` o `http://169.254.169.254` es rechazado con un error claro. **Verificado con 19 pruebas HTTP reales**, incluyendo: creación válida, bloqueo de `localhost`/`169.254.169.254`/IP privada literal/dominio TCP privado, bloqueo por **resolución DNS real** (`localtest.me` → `127.0.0.1`, no solo coincidencia de texto), límite de intervalo mínimo del plan, límite máximo de 5 monitores, aislamiento entre organizaciones (usuario B no puede ver ni listar monitores de A, 404 sin filtrar datos), y ciclo de vida completo (crear/leer/listar/editar/pausar/reanudar/borrar).

### 1.3 Worker simple (checks HTTP) ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Proceso independiente (`apps/worker`) que cada X segundos consulta monitores activos cuyo próximo check toque. Implementado también para **TCP**, no solo HTTP. El tipo **`ping` (ICMP)** quedó pendiente en su día y se completó el 2026-09-21 invocando el `ping` del sistema (ver ADR abajo): verificado con 1.1.1.1 → `up` con la latencia real del echo (19 ms), 198.51.100.1 → `down` "Sin respuesta ICMP en 3000ms" con incidente abierto, y desde el formulario en Chromium.
- [x] Ejecuta el request con timeout configurado, guarda el resultado en `checks`.
- [x] Reintentos antes de marcar como "down" (hasta 3 intentos con 1s de espera) para evitar falsos positivos (README §2.2).
- [x] Manejo de errores de red distinto de errores de código de estado (timeout vs. status inesperado vs. DNS failure vs. conexión rechazada) — guardado en `error_message` con un mensaje distinto para cada caso.
- [x] **Cierra el pendiente de la Fase 1.2:** la comprobación anti-SSRF se revalida justo antes de cada check real (no solo al crear/editar el monitor), moviendo `ssrf-guard.ts`/`target.ts` a un paquete nuevo `packages/server-utils` compartido entre `api` y `worker`.
- **Hecho cuando:** con un monitor de prueba apuntando a una URL real, aparecen filas nuevas en `checks` sin intervención manual. **Verificado con 5 monitores de prueba** (HTTP éxito, HTTP con status inesperado y reintentos, dominio DNS irresoluble bloqueado por el guardián anti-SSRF, TCP éxito, TCP con timeout y reintentos) y comprobando en la BD que la cadencia respeta el `interval_seconds` de cada monitor (un monitor de 15s se repitió 3 veces en el tiempo que uno de 300s no se repitió ni una).

### 1.4 Dashboard básico (frontend) ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Setup de `apps/web` con React + Vite + TailwindCSS (v4, vía `@tailwindcss/vite`) + React Router.
- [x] Página de login/registro, con sesión persistida entre recargas (refresh token en cookie httpOnly, access token en memoria).
- [x] Listado de monitores (polling cada 10s) con estado actual (badge de color) y último tiempo de respuesta.
- [x] Formulario de creación de monitor (campos por tipo: HTTP/TCP/ping) y edición inline (nombre/intervalo) en la vista de detalle.
- [x] Vista de detalle con tabla de los últimos checks (fecha, estado, tiempo de respuesta, mensaje de error).
- **Hecho cuando:** desde el navegador puedes loguearte, crear un monitor, y ver que su estado cambia tras un rato. **Verificado sin poder usar un navegador real** (no había herramienta de automatización disponible en la sesión): `tsc`, `vite build` de producción, y sobre todo probando con `curl` el contrato exacto que consume el frontend (registro → login → `GET /monitors` con el nuevo campo `lastCheck` → crear monitor → el worker genera un check real → `GET /monitors/:id/checks` con el `id` bigint ya convertido a string) y las cabeceras CORS con credenciales. La API y el frontend quedaron corriendo al terminar la fase para que el usuario hiciera la comprobación visual final él mismo.

### 1.5 Alertas por email (mínimo viable) ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Integración con **Nodemailer** (no Resend, ver ADR) + **Mailpit** como servidor SMTP de pruebas en desarrollo (nuevo servicio en `docker-compose.yml`).
- [x] Al detectar transición up→down o down→up, envía email a todos los miembros de la organización del monitor. Sin duplicados: si el estado se mantiene igual entre checks consecutivos, no reenvía.
- [x] Plantilla de email simple, texto plano + HTML mínimo (`packages/mailer/src/templates.ts`), con escapado de HTML para evitar inyección desde el nombre/target del monitor (ambos son input de usuario).
- **Hecho cuando:** al parar el servicio de prueba, llega un email; al reanudarlo, llega el email de recuperación. **Verificado de extremo a extremo:** monitor de prueba con target forzado a fallar (404) → email de caída recibido en Mailpit (confirmado vía su API JSON, asunto y cuerpo correctos) → target restaurado → email de recuperación recibido → exactamente 2 correos en total pese a que hubo un check "down" repetido de por medio (sin spam de notificaciones para el mismo estado).

---

## 🎉 Fase 1 completa (MVP)

Con 1.1 a 1.5 cerrados, UptimePulse ya es un producto usable de principio a fin: registro/login, CRUD de monitores con protección anti-SSRF, un worker que los comprueba de verdad (HTTP y TCP, con reintentos), un dashboard real en el navegador, y alertas por email cuando algo cambia de estado. Todo verificado con pruebas reales (HTTP, DB, email), no solo "debería funcionar". **Siguiente:** Fase 2 (cola de trabajo real con BullMQ, motor de incidentes, tiempo real por WebSocket) — la parte que sustituye los enfoques deliberadamente simples del MVP (el bucle de sondeo N+1 del worker, el polling de 10s del frontend) por la arquitectura de sistemas distribuidos que le da valor de portfolio al proyecto.

---

## Fase 2 — Cola de trabajo real, incidentes, tiempo real

### 2.1 Cola de trabajo (Redis + BullMQ) ✅ (2026-09-20, ver [DIARIO.md](DIARIO.md))
- [x] Sustituido el bucle simple del worker por **Job Schedulers de BullMQ** (uno por monitor, vía `upsertJobScheduler` con `every: intervalSeconds * 1000` — la API moderna de BullMQ para "repeat", no la antigua basada en claves de repetición).
- [x] Separado productor (`apps/api`, agenda/reprograma/quita el job al crear/editar el intervalo/pausar/reanudar/borrar un monitor) de consumidor (`apps/worker`, un `Worker` de BullMQ que solo procesa jobs de la cola `monitor-checks`).
- [x] Verificado con **2 instancias reales del worker corriendo a la vez**: los checks se repartieron entre ambas sin duplicarse ni perderse.
- [x] Bull Board montado en `/admin/queues` (solo cuando `NODE_ENV !== "production"`).
- **Hecho cuando:** puedes lanzar 2 instancias del worker y los checks se reparten entre ellas sin duplicarse ni perderse. **Verificado con datos reales:** 5 monitores de prueba con intervalo de 15s, 2 workers (PIDs distintos en los logs) repartiéndose los jobs; consulta SQL final: `COUNT(*) = COUNT(DISTINCT timestamp)` para cada monitor (cero duplicados). También verificado que pausar/reanudar/borrar vía la API quita/añade el *job scheduler* correspondiente (confirmado con el contador `jobSchedulerCount` de Bull Board bajando y subiendo exactamente como se esperaba), y que la reconciliación al arrancar la API recupera los monitores creados antes de esta migración.

### 2.2 Motor de incidentes ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Job/listener que, al ver N checks fallidos consecutivos (configurable vía `INCIDENT_FAILURE_THRESHOLD`, por defecto 2), crea un `incident` con `started_at` = el timestamp del *primer* check fallido de la racha (no el que cruza el umbral, para que la duración sea exacta).
- [x] Al ver el primer check exitoso tras un incidente abierto, lo cierra con `resolved_at`.
- [x] Respeta `maintenance_windows`: un check fallido dentro de una ventana de mantenimiento no abre incidente ni dispara alerta.
- [x] Cálculo de métricas agregadas: % uptime, tiempo medio de respuesta y MTTR sobre rangos 24h/7d/30d/90d, vía un *continuous aggregate* de TimescaleDB (`checks_hourly`, migración 0005) con política de refresco automática cada 30 min.
- [x] **Cambio de diseño respecto a la Fase 1.5:** las notificaciones por email ahora se disparan al abrir/cerrar un *incidente* (tras cruzar el umbral), no en cada check "down" suelto — evita alertar por un bache de red puntual. Verificado: 10 checks "down" seguidos → exactamente 1 email de caída + 1 de recuperación (antes habría sido 1 por cada transición cruda).
- **Hecho cuando:** al simular una caída de 2 checks seguidos se crea un incidente, y al recuperarse se cierra con la duración correcta; el uptime % del monitor refleja ese incidente. **Verificado con datos reales de extremo a extremo:** monitor de prueba contra un endpoint que siempre falla → tras 2 checks "down" se abrió el incidente con `started_at` = el primer check fallido (no el segundo) → email de caída recibido en Mailpit → target corregido a un endpoint que responde 200 → al siguiente check el incidente se cerró con `resolved_at` correcto → `resolved_at - started_at` = 268s, **idéntico** al `mttrSeconds` devuelto por `GET /monitors/:id/metrics` → email de recuperación recibido (solo 2 emails en total pese a 10 checks "down" de por medio). Un segundo monitor de prueba con una ventana de mantenimiento activa acumuló 3 checks "down" sin abrir ningún incidente, confirmando el respeto de `maintenance_windows`. `GET /monitors/:id/metrics?range=24h` devolvió `uptimePercentage: 9.09` (1 up / 11 checks) tras el ciclo completo. Nuevos endpoints: `GET/POST /monitors/:id/maintenance-windows`, `DELETE .../:windowId`, `GET /monitors/:id/incidents`, `GET /monitors/:id/metrics?range=`.

### 2.3 Tiempo real (WebSockets) ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Servidor Socket.io en la API, autenticado con el mismo JWT de acceso (mandado en el `auth` del handshake, no en un header).
- [x] Emitir evento `monitor:status_changed` a los clientes de la organización correspondiente cuando cambia el estado de un monitor — vía Redis (`@socket.io/redis-emitter` en el worker → `@socket.io/redis-adapter` en la API), porque quien detecta el cambio (el worker) no es quien tiene los sockets abiertos (la API).
- [x] Frontend: sustituido el polling de 10s de la Fase 1 (Dashboard y detalle de monitor) por suscripción WebSocket (`RealtimeContext`); los datos se refrescan cuando llega un evento real, no a intervalo fijo.
- [x] Toast visual (`ToastProvider`) cuando cambia el estado de un monitor mientras el dashboard/detalle está abierto.
- **Hecho cuando:** con el dashboard abierto en el navegador, al forzar la caída de un monitor de prueba, la tarjeta cambia de color sin recargar la página. **Verificado con un cliente WebSocket real** (no simulado): un script Node con `socket.io-client` se autenticó con un JWT real, se conectó a la API, y recibió el evento `monitor:status_changed` (`up`→`down` y `down`→`up`) en tiempo real al forzar una transición real en un monitor de prueba vía la API — sin ningún sondeo de por medio. **Aislamiento por organización verificado:** un segundo socket autenticado con un usuario de una organización distinta, conectado al mismo tiempo, no recibió ningún evento de un monitor ajeno. La UI (Dashboard y detalle) se comprobó por `tsc --noEmit` + `vite build`, igual que en la Fase 1.4, dado que esta sesión no dispone de un navegador real.

### 2.4 Dashboard mejorado ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Sparklines de las últimas 24h por monitor (Recharts), coloreadas en rojo si hubo algún check "down" en ese rango.
- [x] Cabecera con resumen agregado (operativos vs. caídos, pausados, uptime medio global de 24h, incidentes activos).
- [x] Selector de rango temporal (24h/7d/30d/90d) en la vista de detalle, con gráfico de línea de tiempo de respuesta y zonas sombreadas en rojo para cada incidente que se solapa con el rango visible.
- **Hecho cuando:** la vista de detalle de un monitor con histórico real permite cambiar el rango y el gráfico se actualiza acorde. **Verificado con datos reales de extremo a extremo (API):** monitor de prueba llevado de up→down→up vía `PATCH` real; `GET /monitors/:id/timeseries?range=24h` reflejó el bucket horario con `totalChecks/upChecks/downChecks` correctos; `GET /monitors/:id/incidents?range=24h` devolvió el incidente abierto por el motor de la Fase 2.2; `GET /monitors/summary` reflejó `avgUptimePercentage: 33.33` y `activeIncidents: 1` mientras estuvo caído, y `GET /monitors/:id/metrics` tras la recuperación coincidió exactamente (`uptimePercentage: 50`, `incidentCount: 1`, `openIncidentCount: 0`). **Bug real encontrado y corregido durante esta verificación:** `getMonitorTimeseries` devolvía `totalChecks`/`avgResponseTimeMs` como *strings* (`"2"`, `"882.5000000000000000"`) en vez de números — el driver de `pg` no castea `bigint`/`numeric` a `number` por defecto; corregido casteando explícitamente en el SQL (`::int`, `round(...)::int`), igual que ya hacía `getMonitorMetrics`. Frontend comprobado con `tsc --noEmit` + `vite build` (bundle sin referencias a `pg`/`drizzle-orm`, mismo chequeo que en fases anteriores) — sin navegador real disponible en esta sesión.

---

## 🎉 Fase 2 completa (arquitectura de sistemas distribuidos)

Con 2.1 a 2.4 cerrados, UptimePulse pasó de los enfoques deliberadamente simples del MVP (Fase 1) a una arquitectura real: cola de trabajo distribuida con BullMQ (checks repartidos entre N instancias del worker sin duplicarse), un motor de incidentes que distingue señal de ruido (N caídas consecutivas, ventanas de mantenimiento, métricas de uptime/MTTR vía continuous aggregates de TimescaleDB), tiempo real de verdad por WebSocket (worker → Redis → API → navegador, con aislamiento por organización), y un dashboard que aprovecha todo lo anterior (sparklines, cabecera agregada, gráfico con rango temporal y caídas resaltadas). Cada pieza se verificó con datos e interacciones reales — dos workers concurrentes, un cliente WebSocket real, incidentes abiertos/cerrados con MTTR exacto — no solo "debería funcionar". **Siguiente:** Fase 3 (SSL, webhooks/SMS/Slack/Discord, status pages públicas).

---

## Fase 3 — SSL, webhooks/SMS, status pages

### 3.1 Verificación de certificados SSL ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Comprobación como parte del check HTTP (no un job periódico aparte): tras cada check de un monitor `https://`, una conexión TLS dedicada (`node:tls`, `rejectUnauthorized: false`) lee `valid_to` del certificado del peer.
- [x] Alerta a 30/15/7 días de la expiración, evitando reenviar la misma alerta cada día (dedupe vía `monitors.sslLastAlertedThresholdDays`, reseteado a null en cuanto el certificado cambia).
- **Hecho cuando:** contra un dominio de prueba con certificado próximo a expirar, se genera la alerta correspondiente solo una vez por umbral. **Verificado contra un certificado real y deliberadamente caducado** (`expired.badssl.com`, servicio público diseñado exactamente para este tipo de pruebas — nada mockeado): `getCertificateExpiry` devolvió su fecha de caducidad real (`2015-04-12`); la primera comprobación clasificó correctamente `-4180 días` en el umbral "7" y disparó la alerta (email real recibido en Mailpit + webhook con firma HMAC válida + Discord); una segunda comprobación inmediata con el mismo certificado **no generó una alerta duplicada** (sin nuevo email/webhook/Discord). También verificado que un dominio con certificado sano (`httpbin.org`) devuelve su fecha real de expiración (2027) sin disparar ninguna alerta.

### 3.2 Webhooks y SMS ✅ parcial (2026-09-21, ver [DIARIO.md](DIARIO.md)) — SMS pospuesto
- [x] Canal de notificación tipo webhook genérico: `POST` con payload JSON documentado (`event`, `title`, `description`, `fields`, `timestamp`).
- [x] Firma del payload (HMAC-SHA256 con secreto por canal, header `X-UptimePulse-Signature: sha256=<hex>`) para que el receptor pueda verificar autenticidad.
- [ ] Integración Twilio para SMS — **pospuesto deliberadamente**: sin una cuenta real de Twilio no se puede verificar de extremo a extremo con el mismo rigor que el resto del proyecto; decisión explícita del usuario, ver ADR.
- [x] Integración directa Slack/Discord (webhooks de esas plataformas).
- [x] UI de configuración: página `/channels` (crear/listar/borrar canales + botón "Probar conexión") + por monitor, checkboxes para activar/desactivar cada canal (`/monitors/:id`, sección "Canales de notificación") — la "matriz" del README §3.5.
- **Hecho cuando:** un monitor configurado con webhook + Discord dispara ambos al caer, y el payload del webhook verifica correctamente su firma HMAC. **Verificado con servicios reales, no mocks:** un webhook de Discord real (proporcionado por el usuario) recibió tanto el mensaje de prueba ("Probar conexión") como las alertas reales de caída/recuperación — confirmado con el `message id` que la propia API de Discord devuelve al crear cada mensaje (`?wait=true`), no solo un 200 genérico. En paralelo, un receptor HTTP local propio verificó independientemente la firma HMAC de cada payload del canal "webhook genérico" (recalculando el HMAC con el mismo secreto y comparándolo byte a byte) — válida en los 4 eventos recibidos (prueba, caída, recuperación, alerta SSL). El guard anti-SSRF (Fase 1.2) también protege la creación de canales: una URL de webhook apuntando a `localhost` fue rechazada con 422 antes de intentar guardarla.

### 3.3 Status pages públicas ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Modelo ya creado en Fase 0 (`status_pages`, `status_page_monitors`) — sin migración nueva, solo empezar a usarlo.
- [x] **(ADR)** Enrutado: ruta bajo el dominio propio (`/status/:slug`), no subdominio — ver ADR completo en TASK.md. **Actualizado 2026-09-21:** la ruta pasó a `/status/:username/:slug` (espacio de nombres por usuario, ver ADR al final).
- [x] Endpoint público (sin auth) que sirve el estado agregado de los monitores marcados como visibles (`GET /public/status/:slug`, **desde 2026-09-21 `GET /public/status/:username/:slug`**), sin exponer `target` ni ningún otro dato de la cuenta.
- [x] Frontend: layout completamente distinto (`PublicStatusPage.tsx`, sin sidebar ni cabecera de sesión), con banner de estado general y barras de histórico de 90 días por servicio (estilo Stripe/GitHub Status), agregadas sobre `checks_hourly` día a día.
- [x] Rate limiting de este endpoint público (`@fastify/rate-limit`, 30 peticiones/minuto, el único endpoint de toda la API sin JWT).
- **Hecho cuando:** una URL pública muestra el estado de los monitores seleccionados sin requerir login y sin exponer datos de otros monitores de la cuenta. **Verificado con peticiones HTTP reales sin ningún header de autenticación:** `GET /public/status/:slug` devolvió el título, estado general y el histórico de 90 días del monitor incluido — confirmado que la respuesta **no contiene el campo `target`** (grep sobre el JSON). Una página con `isPublic: false` no es accesible por esta ruta (filtrada en la propia consulta SQL). Un slug inexistente devuelve 404. El límite de 30 peticiones/minuto se disparó de verdad tras una ráfaga de 35 peticiones seguidas (las últimas 8 devolvieron 429), confirmado con las cabeceras `X-RateLimit-*` de la respuesta.

---

## 🎉 Fase 3 completa (SSL, webhooks/Discord/Slack, status pages) — SMS pendiente

Con 3.1 a 3.3 cerrados, UptimePulse alerta de certificados SSL a punto de caducar (30/15/7 días, sin duplicados), permite a cada usuario conectar sus propios canales de Discord/Slack/webhook genérico (con prueba de conexión real y firma HMAC verificable), y publica el estado de los monitores que elija en una URL pública sin necesidad de cuenta. Todo verificado contra servicios reales cuando fue posible: un webhook de Discord real proporcionado por el usuario, un certificado real y deliberadamente caducado (`expired.badssl.com`) para probar el mecanismo de alertas SSL, y un receptor HTTP local para verificar la firma HMAC byte a byte. **Pendiente explícito:** SMS vía Twilio, pospuesto por decisión consciente del usuario al no disponer de una cuenta real para verificarlo con el mismo rigor que el resto — el hueco queda documentado, no simulado. **Siguiente:** Fase 4 (equipos/roles, checks multi-región, planes de suscripción).

---

## Fase 4 — Equipos, multi-región, planes

### 4.1 Equipos y roles ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Invitar miembros a una organización por email. **Verificado:** el admin invita desde `/team`; el email sale de verdad por SMTP (Mailpit) con un enlace `/invitations/<token>`; el invitado sin cuenta lo abre, se registra con el email prefijado, vuelve solo a la invitación y la acepta. Token de un solo uso, hasheado en BD, caduca a los 7 días; solo lo puede aceptar una sesión con el mismo email.
- [x] Roles: admin, editor, solo lectura — aplicar en middleware de autorización de cada endpoint. **Verificado:** `requireOrganization` + `requireRole` en `apps/api/src/plugins/auth.ts`; todas las rutas de escritura de monitores, canales, ventanas y status pages exigen `editor`; miembros/invitaciones exigen `admin`. Organización activa vía cabecera `X-Organization-Id` (y en el handshake del WebSocket), con selector en la cabecera del dashboard.
- **Hecho cuando:** un usuario con rol "solo lectura" puede ver monitores pero recibe 403 al intentar editarlos. **Verificado contra la API (22/22):** readonly `GET /monitors` → 200, `POST /monitors` → 403 "Tu rol en esta organización es de solo lectura", `POST /notification-channels` → 403, cambiar roles → 403; promovido a editor → `POST /monitors` 201 pero invitar → 403; el único admin no puede degradarse ni salir (409); expulsado → 403; `X-Organization-Id` de una organización ajena → 403; aislamiento entre organizaciones comprobado. **Y en Chromium real (12/12):** el flujo completo de invitación por email, la UI de solo lectura (sin botones de crear/borrar, aviso visible), cambio de organización en el selector (persistente al recargar), promoción a editor reflejada en la UI, expulsión.

### 4.2 Checks multi-región ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Decidir arquitectura antes de implementar. **Decidido:** workers en distintas regiones contra la misma base de datos central y el mismo Redis; **una cola BullMQ por región** (`monitor-checks--<región>`), un job scheduler por (monitor, región); cada worker consume solo la cola de su `WORKER_REGION`. Ver ADR abajo.
- [x] Documentar la decisión de quorum/consenso en un ADR. **Ver "Fase 4.2" en el registro de decisiones:** quórum = mayoría estricta `floor(R/2)+1`, aplicado a dos preguntas distintas (estado instantáneo y apertura de incidente), evaluado en transacción con `SELECT … FOR UPDATE`.
- [x] Etiquetar cada check con la región de origen (`checks.region`). **Verificado:** migración 0011; los checks de la prueba quedaron guardados como `{"eu-west":7,"us-east":7}`; el servidor vigilado recibió `User-Agent: UptimePulse/1.0 (+region=eu-west)` y `(+region=us-east)`.
- [x] UI: mostrar desde qué región(es) se detectó la caída. **Verificado en Chromium:** bloque "Estado por región (quórum: 2 de 2)" en el detalle, columna "Región" en últimos checks, badge ámbar "Degradado" en detalle y dashboard, toast "degradado 🟡 (caído desde us-east)" en vivo; el incidente y el email dicen "(visto desde: eu-west, us-east)".
- **Hecho cuando:** con al menos 2 regiones simuladas, un fallo en una sola región no marca el monitor como caído si la otra región lo ve operativo. **Verificado con DOS procesos worker reales** (`WORKER_REGION=eu-west` y `us-east`, `CHECK_REGIONS=eu-west,us-east`) contra un servidor local que falla solo para la región del User-Agent (12/12): ambas OK → `up`; **us-east falla 2 veces seguidas y eu-west no → `degraded`, SIN incidente**; las dos fallan → `down` al instante pero sin incidente hasta que eu-west acumula 2 fallos → incidente "(visto desde: eu-west, us-east)"; recuperación → `up` e incidente cerrado; eventos WebSocket exactamente `up→degraded[us-east] · degraded→down · down→up` (uno por cambio consolidado, no por check); emails 🔴/🟢 en Mailpit.

### 4.3 Planes de suscripción ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md)) — Stripe simulado
- [x] Modelo `plans` ya creado en Fase 0; aplicar límites reales (nº monitores, intervalo mínimo, canales disponibles) al crear/editar monitores y canales. **Verificado contra la API:** en free, intervalo 60 s → 422; el 6º monitor → 422 (`limit.current=5`); canal Discord → 422 "no incluye canales de tipo discord (permite: email)"; los tres errores llevan un objeto `limit` estructurado además del mensaje. Segundo plan `pro` (50 monitores, 60 s, todos los canales, 9 €/mes) en la migración 0012.
- [x] (diseño) Stripe real vs. simulado. **Decidido: simulado** (`POST /organizations/:id/plan`, solo admin) — ver ADR abajo. Reglas que sí se aplican aunque no haya pago: no se puede bajar a un plan cuyo límite de monitores ya se supera (409 explicando cuántos borrar); los canales existentes se conservan al bajar (solo se bloquea crear nuevos).
- [x] Página de precios conectada a los planes reales del backend. **Verificado en Chromium:** `/pricing` sin sesión lista los planes de `GET /plans` con precio y límites; con sesión marca "Tu plan actual", muestra "usa 5 de 5 monitores" y el admin cambia de plan con el diálogo propio; la cabecera pasa de "Plan: free" a "Plan: pro".
- **Hecho cuando:** un usuario en plan Free no puede crear un monitor por encima de su límite ni bajar el intervalo por debajo del mínimo permitido; el error se lo dice explícitamente. **Verificado (API 15/15, Chromium 7/7):** el 6º monitor y el intervalo de 60 s dan 422 con el mensaje exacto del plan; en la UI el error aparece en el formulario con el enlace "Ver planes"; tras cambiar a pro el mismo monitor se crea (201) y con 60 s.

---

## 🎉 Fase 4 completa (equipos/roles, multi-región con quórum, planes) — Stripe simulado, SMS sigue pendiente

---

## Fase 5 — Seguridad, calidad y lanzamiento (transversal)

Estas tareas no aparecían como fase propia en el README pero son necesarias antes de considerar el proyecto "terminado" o presentable en portfolio.

### 5.1 Seguridad ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Rate limiting en la API pública (por IP y por API key). **Global 300/min** (`API_RATE_LIMIT_PER_MINUTE`) con contadores en Redis; con API key se cuenta por clave, no por IP. Login/registro 10/min por IP (pendiente desde la Fase 1.1). **Verificado:** el 11º login → 429; la petición nº 296 con una API key → 429 mientras el JWT desde la misma IP sigue en 200.
- [x] Rate limiting de checks salientes por host de destino: 60/min por host sumando monitores, usuarios y regiones (`CHECK_MAX_PER_HOST_PER_MINUTE`, contador en Redis, `apps/worker/src/lib/host-rate-limit.ts`). Por encima, el check se salta (no cuenta como down) y se mide en `uptimepulse_checks_rate_limited_total`. **Verificado con cuota 3:** 6 checks encolados contra example.com → 3 ejecutados, 5 saltados (contando los 2 de la creación).
- [x] Anti-SSRF en TCP (ya estaba: `extractHostname` + revalidación antes de cada check) y **en redirecciones HTTP**: el worker sigue los 3xx a mano (`redirect: "manual"`), revalida cada salto, máximo 5, solo http/https. **Verificado:** 302 → `http://127.0.0.1:3000/health` bloqueada ("Redirección bloqueada…", errorKind `ssrf`); 302 → `file:///etc/passwd` rechazada; bucle → "Demasiadas redirecciones"; `http://github.com` (301 → https) sigue dando up.
- [x] API keys: `up_<64 hex>`, sha256 en BD, scopes `read`/`write` (→ rol readonly/editor, nunca admin), revocación inmediata, `last_used_at`, máximo 20 por organización; rutas `GET/POST/DELETE /organizations/:id/api-keys` (solo admin con sesión). **Verificado (API):** clave read lista monitores y no puede crear (403); clave write crea (201) pero no puede ver organizaciones, `/me` ni gestionar claves (403); `X-Organization-Id` se ignora; clave inexistente/revocada → 401.
- [x] Helmet (sin CSP: la API sirve JSON; la CSP del frontend la pone nginx) y CORS restringido a `CORS_ORIGINS` (por defecto `APP_URL`; `*` rechazado en producción). **Verificado:** `Origin: https://evil.example` no recibe `Access-Control-Allow-Origin`.
- [x] Secretos solo por entorno: `grep` de patrones de claves en `apps/` y `packages/` sin resultados; la API **se niega a arrancar en producción** con secretos `changeme…` o de menos de 32 caracteres (verificado). Twilio/Stripe no existen (SMS y Stripe siguen sin integrar).
- **Hecho cuando:** existe una checklist de seguridad revisada manualmente y sin secretos hardcodeados en el código fuente. **[docs/SECURITY.md](docs/SECURITY.md)**, con lo que está hecho, lo que se decidió no hacer y cómo reproducir cada comprobación.

### 5.2 Observabilidad del propio sistema ✅ (2026-09-21, ver [DIARIO.md](DIARIO.md))
- [x] Logging estructurado JSON (ya existía desde la Fase 0.4) **con request id**: `X-Request-Id` (se respeta el del cliente si tiene forma de id, si no se genera) devuelto en cada respuesta y presente en la línea de log por petición (`método, ruta-plantilla, status, durationMs, ip, userId/apiKeyId`) y en los errores 500. **Verificado:** una petición con `x-request-id: obs-test-…` aparece en el log de la API con ese id.
- [x] Métricas Prometheus (`prom-client`): API en `/metrics` (`uptimepulse_api_http_requests_total{method,route,status}`, histograma de duración, métricas de proceso); worker en `/metrics` de su propio servidor HTTP (`WORKER_HTTP_PORT`, 3001): `uptimepulse_checks_total{type,status,error_kind}`, `uptimepulse_check_duration_seconds`, `uptimepulse_checks_rate_limited_total`, `uptimepulse_checks_skipped_total`, `uptimepulse_jobs_failed_total`, `uptimepulse_incidents_total{action}`, `uptimepulse_queue_jobs{state}`. Opcionalmente protegidas con `METRICS_TOKEN`.
- [x] `/health` real en API y worker: comprueban Postgres (`select 1`) y Redis (`ping`), 503 si falla alguno.
- **Hecho cuando:** puedes ver cuántos checks se han ejecutado en la última hora y cuántos han fallado por timeout vs. error de conexión. **Verificado:** nuevo campo `errorKind` en cada check (`timeout|dns|connection|tls|unexpected_status|redirect|ssrf|invalid_target|other`) en el log JSON y como etiqueta `error_kind`; tras 5 monitores de prueba, `/metrics` del worker subió `{http,up}`, `{tcp,down,timeout}`, `{http,down,unexpected_status}` y `{ping,up}` por separado. Consulta PromQL: `increase(uptimepulse_checks_total{status="down"}[1h]) by (error_kind)`.

### 5.3 Testing ✅ (2026-09-22, ver [DIARIO.md](DIARIO.md))
- [x] Unit tests (Vitest, proyecto `unit`, 87 tests en 8 archivos): anti-SSRF (`ssrf-guard.test.ts`, con `dns.lookup` simulado: 15 IPs privadas, públicas, rebinding, sin resolver), targets de ping, reglas de username, regiones/quórum/nombres de cola, firma HMAC del webhook (contra un receptor HTTP real), parseo de la salida de `ping` (Windows/Linux reales), redirecciones y clasificación de errores del check HTTP (fetch simulado), check TCP con sockets reales. `npm run test:unit` en ~1 s.
- [x] Integration tests (proyecto `integration`, 17 tests en 4 archivos) contra una base **`uptimepulse_test`** que se crea y migra sola (`test/global-setup.ts`) y la base 1 de Redis: auth (registro, duplicados, login por email/username, refresh por cookie, `/me`, request id), monitores (job scheduler creado/borrado, anti-SSRF 422, ping inválido 400, límites del plan y subida a pro, aislamiento por organización y rol readonly, **uptime % y latencia media sobre `checks_hourly`** con 7 up/3 down → 70 % y 130 ms), API keys (scopes, revocación, cabecera ignorada), status pages públicas (404 idéntico, slug por organización, privadas), y el **motor de incidentes** `evaluateMonitorHealth` (1 región: incidente al 2º fallo con `startedAt` del primero y cierre al recuperar; 2 regiones: degradado sin incidente → caído con ambas → cierre al recuperar una; región silenciosa; ventana de mantenimiento). `npm run test:integration` en ~25 s.
- [x] E2E con Playwright (`e2e/critical-flow.spec.ts`, Chromium real, diálogos nativos descartados): registro con comprobación de username → crear monitor → "Operativo" por WebSocket sin recargar → detalle con latencia → status page pública sin sesión → borrado con el diálogo propio → limpieza por API; `e2e/global-teardown.ts` borra el usuario. `npm run test:e2e` en ~7 s reutilizando los procesos locales; en CI los arranca `playwright.config.ts`.
- **Hecho cuando:** `npm test` corre en CI y cubre al menos el cálculo de uptime, la detección de incidentes y la validación anti-SSRF. **`npm test` = 104 tests (unit + integración) verdes en local; un test roto a propósito hace salir con código 1 (comprobado); la CI ejecuta `npm test` y `npm run test:e2e` con TimescaleDB/Redis/Mailpit como servicios.**

### 5.4 CI/CD ✅ (2026-09-22, ver [DIARIO.md](DIARIO.md)) — CI escrita y validada en local; no ejecutada en GitHub todavía
- [x] `.github/workflows/ci.yml`: jobs `quality` (lint, `npm run typecheck` de los 9 proyectos TS, `vite build`, `npm audit` informativo), `test` (`npm test` con servicios TimescaleDB 2.30.1-pg16, Redis 7, Mailpit), `e2e` (Playwright con chromium, informe como artefacto si falla) y `docker` (matriz api/worker/web con `build-push-action`, caché de GHA; push a GHCR solo en `main`). Cada comando de la CI se ejecutó en local con éxito; el YAML se validó con js-yaml. **No se ha hecho push, así que no hay una ejecución real en GitHub Actions que enseñar.**
- [x] Dockerfiles para API, worker y web (`apps/*/Dockerfile`, contexto raíz, multi-stage, usuario `node`, `HEALTHCHECK`; el worker instala `iputils-ping`; la web es nginx con SPA fallback y CSP). `docker-compose.prod.yml` con `migrate` como servicio previo a la API. **Verificado:** las 3 imágenes construyen (568/374/74 MB) y el stack completo arrancó en local con puertos alternativos: migraciones aplicadas, `/health` de API y worker `ok`, registro, monitores http y **ping ejecutado dentro del contenedor Linux como usuario `node`** (15 ms), Bull Board ausente con `NODE_ENV=production`, `/docs` 200, HSTS, y login + dashboard "Operativo" desde el nginx en Chromium. Stack, volúmenes e imágenes de prueba borrados después.
- [x] Despliegue: [docs/DEPLOY.md](docs/DEPLOY.md) — Opción 1 (un servidor con `docker-compose.prod.yml` + Caddy, la verificada) y Opción 2 (Fly.io paso a paso, manual, **no ejecutada**: sin cuenta).
- **Hecho cuando:** un PR con un test roto falla en CI antes de poder mergear. **Comprobado en local que `npm test` devuelve exit 1 con un test roto (y por tanto el job `test` falla); el bloqueo del merge requiere marcar `test` y `e2e` como checks obligatorios en la protección de rama de GitHub (paso manual en la web de GitHub, no automatizable desde el repo).**

### 5.5 Documentación final ✅ (2026-09-22, ver [DIARIO.md](DIARIO.md))
- [x] `README.md` de cada app: [apps/api](apps/api/README.md), [apps/worker](apps/worker/README.md), [apps/web](apps/web/README.md) con arranque, estructura, variables y comprobaciones.
- [x] OpenAPI 3.0 escrita a mano en [docs/openapi.yaml](docs/openapi.yaml) (39 rutas, esquemas, errores, rate limits) servida por la propia API en `/docs` (Swagger UI) y `/docs/json`; validada con `redocly lint` (0 errores; `redocly.yaml` desactiva la regla de `operationId`). Verificado en Chromium (captura `docs/screenshots/api-docs.png`).
- [x] README raíz actualizado: estado del proyecto, **5 capturas reales** (dashboard, detalle, status page, planes, Swagger) tomadas con Playwright sobre un usuario de demostración borrado después, arranque en 5 comandos, stack real, roadmap con las 5 fases, estructura de carpetas real, enlaces a SECURITY/DEPLOY/TODO.
- [x] Extra: página **API keys** en la web (`/api-keys`, solo admin) con creación (clave mostrada una vez + copiar), listado por prefijo y revocación con el diálogo propio. Verificado en Chromium (4/4).
- **Hecho cuando:** alguien ajeno al proyecto puede clonar el repo, seguir el README y levantar todo el stack en local sin preguntarte nada. **Los 5 comandos del README son exactamente los que se han usado en esta sesión; `.env.example` funciona sin editar en desarrollo.**

---

## 🎉 Fase 5 completa — el plan de TASK.md está cerrado (pendientes conscientes en TODO.md)

## Registro de decisiones de diseño (ADR ligero)

Usa esta sección para anotar brevemente las decisiones marcadas como **(diseño)** arriba, con fecha y motivo. Ejemplo de formato:

```
### 2026-XX-XX — Autenticación: JWT vs. sesiones
Decisión: JWT access token (15 min) + refresh token en cookie httpOnly.
Motivo: permite escalar la API horizontalmente sin sticky sessions; el worker
no necesita validar sesiones, solo el API gateway.
```

(Añade aquí cada decisión conforme la tomes.)

### 2026-09-20 — Framework HTTP de la API: Fastify
Decisión: Fastify en vez de Express.
Motivo: mejor rendimiento, validación de esquemas más integrada, tipado TS
de primera clase. Encaja con el resto del stack (Drizzle, Zod) sin fricción.

### 2026-09-20 — Autenticación: JWT vs. sesiones
Decisión: JWT access token (15 min, en el body de la respuesta) + refresh
token (7 días, en cookie httpOnly/SameSite=Strict).
Motivo: permite escalar la API horizontalmente sin sticky sessions; el
worker no necesita validar sesiones, solo el API gateway. El access token
corto limita la ventana de riesgo si se filtra; el refresh token nunca lo
toca JavaScript del navegador (mitiga robo por XSS). No se implementa
todavía revocación de refresh tokens (tabla `refresh_tokens` con estado) —
para el MVP basta con la caducidad de 7 días; revisar en Fase 5 (seguridad)
si hace falta revocación activa (ej. "cerrar sesión en todos los dispositivos").

### 2026-09-20 — Hash de contraseñas: bcryptjs en vez de bcrypt/argon2 nativos
Decisión: `bcryptjs` (implementación 100% JavaScript), no `bcrypt` ni
`argon2` (ambos requieren compilar bindings nativos).
Motivo: esta máquina de desarrollo ya dio problemas de permisos con
compilación nativa/postinstall scripts (ver incidente de `pnpm`/`corepack`
y los avisos de `esbuild` en la Fase 0.1). `bcryptjs` elimina ese riesgo por
completo a cambio de ser algo más lento — irrelevante en la práctica para
el volumen de registros/logins de este proyecto. OWASP recomienda Argon2id
como primera opción; si en algún momento se despliega a un entorno donde la
compilación nativa no sea un problema, migrar a `argon2` es un cambio
aislado a `apps/api/src/lib/password.ts`, sin tocar el resto del código.

### 2026-09-20 — Cola de trabajo: paquete nuevo `packages/queue`, Job Schedulers de BullMQ (no la API antigua de "repeat")
Decisión: `packages/queue` centraliza toda la interacción con BullMQ/Redis
(nombre de la cola, forma del payload del job, cómo programar/quitar el job
de un monitor), usado tanto por `apps/api` (productor) como `apps/worker`
(consumidor) — mismo patrón que `packages/server-utils` y `packages/mailer`.

Dentro de BullMQ, se usa `upsertJobScheduler`/`removeJobScheduler` (la API
de "Job Schedulers", más reciente) en vez del mecanismo antiguo de
"repeatable jobs" con claves de repetición manuales — permite actualizar el
intervalo de un monitor existente con una sola llamada idempotente, sin
tener que buscar y borrar el job antiguo a mano primero.

**Detalle importante:** BullMQ con `every` no ejecuta el primer job hasta
que pasa el intervalo completo (la opción `immediately` solo funciona con
patrones cron). Para no perder el "se comprueba nada más crearlo" de la
Fase 1.3, `scheduleMonitorCheck()` además encola un check inmediato aparte
con `queue.add()`. La reconciliación al arrancar la API usa la variante sin
ese extra (`upsertMonitorScheduler`) para no disparar una ráfaga de checks
en cada reinicio del proceso.

### 2026-09-20 — Alertas por email: Nodemailer + Mailpit, no Resend
Decisión: `Nodemailer` (librería) apuntando a `Mailpit` (servidor SMTP de
pruebas en Docker) en desarrollo.
Motivo: Resend requiere una cuenta y una API key reales — no tiene sentido
pedirle al usuario que cree una cuenta en un servicio externo solo para
poder probar un email de alerta en local. Mailpit captura los correos sin
salir a internet y expone una API JSON (`localhost:8025/api/v1/messages`)
que permite **comprobar de verdad** que un email llegó, con qué asunto y a
quién — en vez de solo confiar en que el código "debería" enviarlo. Migrar a
un proveedor real en producción (Resend, SES, un SMTP de pago) es cambiar
las variables `SMTP_*` del `.env`, no tocar código: `packages/mailer` recibe
su configuración como parámetro, no la lee de `process.env` ella misma.

### 2026-09-20 — CRUD de monitores: una organización "primaria" por usuario, no selector de organización
Decisión: `getPrimaryOrganizationId(userId)` usa la primera (única, por ahora)
membresía del usuario, en vez de pedir un `organizationId` explícito en cada
petición.
Motivo: hasta la Fase 4 (equipos), el registro crea exactamente una
organización por usuario, así que no hay ambigüedad todavía. Es una
simplificación deliberada y temporal: cuando un usuario pueda pertenecer a
varias organizaciones, esta función deberá sustituirse por un mecanismo
explícito (header `X-Organization-Id`, o parámetro), elegido activamente en
el frontend — no adivinado. Está documentado en el propio código
(`apps/api/src/lib/organizations.ts`) para que no se olvide.

### 2026-09-20 — `packages/db`: paquete nuevo no contemplado en el README original
Decisión: crear `packages/db` para el esquema Drizzle + cliente de Postgres,
separado de `packages/shared`.
Motivo: `apps/web` no debe arrastrar el driver `pg` en su bundle. Ver
detalle completo en DIARIO.md, entrada de la Fase 0.3.

### 2026-09-21 — Notificaciones por email: ligadas al incidente, no al check crudo
Decisión: a partir de la Fase 2.2, `notifyTransition()` se llama solo cuando
el motor de incidentes abre o cierra un `incident` (tras cruzar el umbral de
N checks fallidos consecutivos), no en cada transición cruda `up<->down` de
un check individual como en la Fase 1.5.
Motivo: con la notificación ligada al check crudo, un solo bache de red
puntual ya disparaba un email de caída (y otro de recuperación 15-30s
después) — ruido, no señal. Ligarla al incidente real es además lo que hace
que `maintenance_windows` funcione de verdad como "no dispares alerta": si
la notificación siguiera mirando el check crudo, una ventana de
mantenimiento podría evitar el *incidente* pero no la *alerta*. Verificado:
10 checks "down" consecutivos → exactamente 1 email de caída (al abrir el
incidente) + 1 de recuperación (al cerrarlo), no 1 por cada check.

### 2026-09-21 — Métricas de uptime/MTTR: continuous aggregate de TimescaleDB, no agregación sobre `checks` en crudo
Decisión: `checks_hourly` (migración 0005), un *continuous aggregate* que
guarda por monitor y hora: total de checks, checks "up"/"down" y tiempo de
respuesta medio. `GET /monitors/:id/metrics` agrega sobre esa vista, nunca
sobre `checks` fila a fila.
Motivo: `checks` en crudo solo retiene 90 días (política de retención de la
Fase 0.3) y puede acumular millones de filas; un rango de 90 días son
~2160 buckets horarios en `checks_hourly` frente a potencialmente millones
de checks individuales. Al no estar sujeto a la retención, sirve además como
histórico permanente para métricas a largo plazo.
**Lección aprendida verificando esto en vivo:** se asumió que la
"real-time aggregation" de Timescale (que combina los buckets ya
materializados con los checks recién insertados que el job de refresco
todavía no ha procesado) viene activada por defecto en un continuous
aggregate — no es así en esta versión: `materialized_only` es `TRUE` por
defecto. Con eso, `GET /monitors/:id/metrics` devolvía `totalChecks: 0` para
un monitor con checks reales, porque el primer refresco automático (cada 30
min) todavía no había materializado nada. Corregido con una migración de
seguimiento (`0006_checks_hourly_realtime_aggregation.sql`,
`ALTER MATERIALIZED VIEW ... SET (timescaledb.materialized_only = false)`)
en vez de reescribir la 0005 ya aplicada — no se edita una migración que ya
corrió contra la base de datos real (drizzle guarda un hash de su contenido
en `__drizzle_migrations`; editarla habría hecho que intentara reaplicarla).
Verificado tras el fix: `mttrSeconds` calculado por la vista coincidió
exactamente (268s) con `resolved_at - started_at` del incidente real.

### 2026-09-21 — Ventanas de mantenimiento: CRUD mínimo añadido ad-hoc
Decisión: añadir `GET/POST /monitors/:id/maintenance-windows` y
`DELETE .../:windowId` aunque no estaban listados explícitamente en el
checklist de la Fase 2.2.
Motivo: la tabla `maintenance_windows` ya existía en el esquema desde la
Fase 0.3, pero no había ninguna forma de crear una — sin un CRUD mínimo era
imposible verificar de verdad que el motor de incidentes las respeta. Sin
edición (`PATCH`) deliberadamente: para el alcance actual basta con borrar y
volver a crear si hay que ajustar una ventana.

### 2026-09-21 — Tiempo real: Socket.io + Redis (adapter en la API, emitter en el worker), no un segundo servidor WS
Decisión: `socket.io` en `apps/api` con `@socket.io/redis-adapter`, y
`@socket.io/redis-emitter` (mismo canal Redis) en `apps/worker` para publicar
eventos sin abrir sockets él mismo.
Motivo: quien detecta un cambio de estado es el worker (Fase 2.1: proceso
separado de la API, puede haber varias instancias), pero los navegadores
solo tienen conexión WebSocket abierta con la API. Sin un canal intermedio,
el worker no tiene forma de "avisar" a la API. Ya se paga el coste de tener
Redis en la infraestructura (BullMQ, Fase 2.1) — reutilizarlo para pub/sub de
eventos en vivo es más simple que montar un segundo mecanismo (un endpoint
HTTP interno worker→api, por ejemplo) y es exactamente el patrón que
`@socket.io/redis-adapter`/`-emitter` existen para resolver. Autenticación
del socket con el mismo JWT de acceso de la Fase 1.1 (mandado en
`socket.handshake.auth.token`, no en un header — el navegador no puede
mandar headers custom en el handshake WebSocket), uniendo cada conexión a
una sala `org:<organizationId>` para el aislamiento entre organizaciones.
**Decisión secundaria:** el evento `monitor:status_changed` se dispara por
cada transición cruda `up<->down` de un check individual, **no** por el
umbral de incidentes de la Fase 2.2 — son preguntas distintas ("¿qué está
pasando ahora mismo, para pintar la tarjeta del dashboard?" vs. "¿es esto
una caída de verdad, para alertar?"). Verificado con un cliente
`socket.io-client` real (no un mock): recibió el evento en tiempo real al
forzar una transición, y un segundo socket de otra organización, conectado
a la vez, no recibió nada de un monitor ajeno.

### 2026-09-21 — Dashboard mejorado: un único endpoint de resumen, no N llamadas por monitor
Decisión: `GET /monitors/summary` calcula el uptime medio global y los
incidentes activos de la organización con dos consultas agregadas (`JOIN`
entre `monitors` e `checks_hourly`/`incidents`), y añade una sparkline de
24h por monitor reutilizando `getMonitorTimeseries` (la misma función que
alimenta el gráfico de la vista de detalle) en un `Promise.all`.
Motivo: el desglose "operativos vs. caídos vs. pausados" de la cabecera NO
se calcula en el backend — se deriva en el frontend a partir de `lastCheck`,
que `GET /monitors` ya devuelve desde la Fase 1.3. Solo el uptime medio *de
verdad* agregado (que cruza varios monitores) necesita una consulta nueva.
Para las sparklines, generar N llamadas (una por monitor) desde el
frontend habría sido más simple de escribir, pero con el plan "free"
limitado a 5 monitores el coste de un `Promise.all` en el propio backend es
insignificante y evita N round-trips HTTP desde el navegador por cada carga
del dashboard.
**Bug real encontrado verificando esto:** `getMonitorTimeseries` devolvía
`totalChecks`/`avgResponseTimeMs` como *strings* de Postgres (`bigint` y
`numeric` no se convierten a `number` en JS por el driver `pg`), rompiendo
el contrato de tipos de la API sin que TypeScript pudiera detectarlo (el
`as` sobre `result.rows` "miente" con seguridad si el cast no es real).
Corregido casteando explícitamente en el SQL (`::int`, `round(...)::int`).
Lección: cualquier función nueva que use `db.execute(sql\`...\`)` con
`count`/`sum`/`avg` debe castear en la propia consulta, no fiarse del tipo
que le pongamos al resultado en TypeScript — ya había pasado (y se había
corregido) en `getMonitorMetrics` durante la Fase 2.2, pero no se generalizó
la lección hasta que volvió a fallar aquí.

### 2026-09-21 — SMS (Twilio) pospuesto por decisión explícita del usuario
Decisión: el enum `channel_type` conserva `"sms"` (Fase 0.3) y la UI de
canales no lo ofrece todavía como opción creable; no se ha escrito código de
integración con Twilio en esta fase.
Motivo: preguntado directamente, el usuario no tenía una cuenta real de
Twilio para esta sesión. El estándar de todo este proyecto es verificar cada
pieza con una interacción real (un email de verdad en Mailpit, un mensaje de
verdad en Discord, un certificado de verdad caducado) — escribir la
integración sin poder probarla contra una cuenta real habría roto ese
estándar sin decirlo. Mejor dejarlo pendiente, documentado como tal, que
fingir una cobertura que no existe. Retomar en cuanto haya credenciales:
Account SID + Auth Token + número de origen, mismo patrón de configuración
por parámetro que `packages/mailer`/`packages/notify-channels` (nunca leer
`process.env` dentro del paquete).

### 2026-09-21 — Canales de notificación: paquete nuevo `packages/notify-channels`, compartido por API y worker
Decisión: la lógica de envío a Discord/Slack/webhook genérico (incluida la
firma HMAC) vive en un paquete nuevo, no directamente en `apps/worker`.
Motivo: el botón "Probar conexión" vive en la API (Fase 3.2, para que el
usuario pueda validar un canal sin esperar a una caída real), pero el envío
real ante una caída lo dispara el worker. Sin un paquete compartido, habría
dos implementaciones de "cómo mando un mensaje a Discord" que podrían
divergir con el tiempo — con una sola, "probar" prueba literalmente el mismo
código que se usa en producción, no una simulación aparte. Mismo patrón ya
establecido con `packages/mailer` (Fase 1.5) y `packages/queue` (Fase 2.1):
cada concern transversal nuevo, su propio paquete enfocado.

### 2026-09-21 — Notificaciones por canal: mensaje único renderizado una vez, no una plantilla por canal
Decisión: `ChannelMessage` (`{ title, description, tone, fields }`) se
construye una sola vez en `apps/worker/src/lib/notifications.ts` y cada
sender (Discord/Slack/webhook) lo traduce a su propio formato — un embed con
color para Discord, texto con emoji para Slack, JSON firmado para el
webhook genérico.
Motivo: sin este paso intermedio, "cómo describo una caída de monitor"
habría que escribirlo tres veces (una por canal) y mantenerlas sincronizadas
a mano. Con un mensaje genérico, añadir un canal nuevo en el futuro (Fase
4+) solo exige un sender nuevo que sepa traducir `ChannelMessage`, no tocar
la lógica de negocio que decide qué decir y cuándo.

### 2026-09-21 — Status pages: ruta bajo el dominio propio, no subdominio
Decisión: `/status/:slug` (ruta de React Router en `apps/web`), no un
subdominio como `estado.tuempresa.com`.
Motivo: un subdominio por status page (o uno genérico con routing por
`Host`) exige gestión de DNS/certificados que el usuario de este proyecto no
tiene por qué operar para un portfolio — la ruta bajo el propio dominio
funciona igual de bien para demostrar la funcionalidad (endpoint público sin
auth, aislamiento de datos, rate limiting) sin esa complejidad operativa.
Queda anotado como mejora futura si este proyecto se desplegara de verdad
con dominios propios por cliente.

### 2026-09-21 — Status page pública: nunca expone el `target` del monitor
Decisión: `GET /public/status/:slug` devuelve `id`, `name`
(o `displayName` si se configuró uno) y el estado derivado — nunca
`target`.
Motivo: una status page es, por definición, un endpoint sin autenticación
alcanzable por cualquiera con el slug. El nombre de un monitor ("API",
"Base de datos") es información que tiene sentido compartir; su `target`
real (una URL, un `host:puerto`) es un detalle de infraestructura interna
que no aporta nada a quien solo quiere saber "¿está caído o no?" y sí podría
ayudar a un atacante a mapear la infraestructura del usuario. Verificado
explícitamente (no solo por diseño): la respuesta real no contiene la
palabra `target`.

### 2026-09-21 — Bug corregido: no se podían borrar canales (ni nada sin cuerpo) desde el navegador
**Reportado por el usuario:** "cuando creo un canal para los webhooks, luego no puedo eliminarlos".

**Causa raíz:** `apps/web/src/api/client.ts` (`rawFetch`, Fase 1.1) ponía
`Content-Type: application/json` en **toda** petición, tuviera cuerpo o no.
Fastify rechaza con `400 FST_ERR_CTP_EMPTY_JSON_BODY` cualquier petición que
declare ese `Content-Type` con el cuerpo vacío. Esto afectaba a **toda**
petición sin cuerpo de la aplicación, no solo a borrar canales: `DELETE
/monitors/:id`, `POST /monitors/:id/pause|resume`, `DELETE
/notification-channels/:id`, `POST/DELETE
/monitors/:id/notification-channels/:channelId`, `DELETE /status-pages/:id`,
e incluso **`POST /auth/refresh`** (el mecanismo que mantiene la sesión
iniciada tras 15 minutos, cuando caduca el access token). El fallo llegaba
como una excepción sin capturar en varios `handleDelete`/`handleTogglePause`
del frontend (sin `try/catch`), así que no se veía ningún error — el botón
"Borrar" simplemente no hacía nada visible.

**Cómo se encontró:** reproducido primero contra la API con `curl`
replicando exactamente las cabeceras que manda un `fetch()` real del
navegador (`-H "Content-Type: application/json"` en un `DELETE` sin `-d`),
en vez de confiar en que "la ruta funciona" con una petición `curl` normal
(que, al no forzar ese header, nunca disparaba el bug). **Lección de proceso
para el resto del proyecto:** verificar un endpoint con `curl` sin más no es
lo mismo que verificar que el *frontend* lo usa correctamente — hay que
replicar la forma exacta en que el cliente real construye la petición
(cabeceras incluidas), no solo que el servidor responde bien a una petición
"limpia". Esto explica por qué ninguna de las verificaciones de las Fases
1-3 detectó este bug: todas usaban `curl` sin forzar ese header de más.

**Corrección:** `rawFetch` ahora solo pone `Content-Type: application/json`
cuando `options.body !== undefined`. Verificado con una petición `fetch()`
real (Node, mismo motor que usa el navegador) reproduciendo exactamente lo
que el cliente corregido envía: `DELETE /notification-channels/:id` →
`204`; `POST /auth/refresh` sin cookie → `401 "No hay refresh token"` (el
error de negocio correcto, ya no el `400` de transporte). También se
añadió manejo de errores visible (`try/catch` + mensaje en pantalla) a los
`handleDelete`/`handleTogglePause` de `MonitorDetailPage`,
`NotificationChannelsPage`, `StatusPagesPage` y `MonitorChannelsSection`,
que antes fallaban en silencio — así, si algo vuelve a fallar en el futuro,
se verá en la UI en vez de parecer que "no hace nada".

### 2026-09-21 — Bug corregido (2ª causa, la de verdad): el botón "Borrar" no hacía nada porque `confirm()` no funciona en todos los entornos
**Reportado por el usuario:** "me sigue ocurriendo el mismo problema" — tras
corregir el `Content-Type` (entrada anterior), borrar un canal **seguía** sin
hacer nada en su navegador.

**Por qué la corrección anterior no bastó:** era real y necesaria (afectaba a
`/auth/refresh` y a todas las peticiones sin cuerpo), pero no era *esta*
causa. Había dos bugs distintos con el mismo síntoma, y arreglar el primero
dejó el segundo intacto.

**Causa raíz:** los tres borrados del frontend empezaban con
`if (!confirm("¿Borrar…?")) return;`. `window.confirm` es un diálogo **del
navegador**, y hay entornos habituales donde no se muestra y devuelve `false`
sin avisar: el navegador integrado de VS Code (Simple Browser) y otras
webviews, Chrome cuando el usuario marca "impedir que esta página cree más
diálogos", iframes con `sandbox` sin `allow-modals`, y pestañas en segundo
plano de algunos navegadores. En esos casos la función salía en la primera
línea: no se llegaba a llamar a la API, no había error, no había nada en
consola. Exactamente el síntoma descrito ("no hace nada").

**Cómo se encontró (y por qué no antes):** las verificaciones previas eran
todas a nivel de API (`curl`/`fetch`), que nunca pasan por la UI. Esta vez se
instaló Playwright y se condujo un **Chromium real** contra la app de
desarrollo, con los diálogos nativos bloqueados (comportamiento por defecto de
Playwright, que es justo el del entorno del usuario). Mecanismo demostrado
aisladamente: en ese navegador `window.confirm()` devuelve `false`, y el viejo
`handleDelete` "salió sin hacer nada / ¿llegó a llamar a la API?: false".

**Corrección:**
- Nuevo `apps/web/src/context/ConfirmContext.tsx`: diálogo de confirmación
  propio, renderizado dentro de la app (`useConfirm()` devuelve una promesa
  `boolean`). Funciona en cualquier entorno y es accesible por teclado.
- Sustituido `confirm()` por `useConfirm()` en `NotificationChannelsPage`,
  `StatusPagesPage` y `MonitorDetailPage`; los botones de borrar muestran
  ahora "Borrando…" mientras la petición está en vuelo.
- Regla de ESLint `no-restricted-globals` para `confirm`/`alert`/`prompt` en
  `apps/web` (verificada: falla con el mensaje correcto), para que el patrón
  no vuelva a colarse.
- De paso, corregido `pattern="[a-z0-9-]+"` → `pattern="[a-z0-9\-]+"` en
  `StatusPagesPage`: Chrome compila `pattern` con la flag `v`, donde un `-`
  suelto al final de una clase de caracteres es un error de sintaxis, así que
  el navegador **descartaba el patrón entero** y el slug no se validaba.
  Detectado por el error de consola que capturó la prueba con navegador real.

**Verificación (Chromium real, diálogos nativos bloqueados, 12/12 OK):**
registro + login · crear canal · crear monitor · abrir detalle · activar canal
en el monitor (POST sin cuerpo, comprobado tras recargar) · desactivar canal
(DELETE sin cuerpo, comprobado tras recargar) · pausar · reanudar · crear
status page · borrar status page · borrar monitor · borrar canal. Sin ningún
intento de abrir un `confirm()` nativo, sin errores de consola y sin ninguna
respuesta HTTP >= 400 (salvo el `401` esperado de `/auth/refresh` al cargar
sin sesión). `tsc --noEmit`, `eslint` y `vite build` limpios. Datos de prueba
eliminados (5 usuarios y 5 organizaciones de test, más su monitor y canal,
estos últimos borrados vía API para no dejar job schedulers huérfanos en
BullMQ); los datos reales del usuario quedaron intactos.

**Lección de proceso (amplía la de la entrada anterior):** verificar la API no
es verificar la aplicación. Un flujo que el usuario dispara desde la interfaz
solo queda verificado si se ejecuta **en un navegador real**, porque hay fallos
que viven enteros en el lado del cliente y son invisibles desde `curl`. A
partir de aquí, cualquier funcionalidad con interfaz se comprueba también con
Playwright, no solo con peticiones a la API.

### 2026-09-21 — Status pages con espacio de nombres por usuario (`/status/:username/:slug`) y registro completo
**Pedido por el usuario:** que los slugs de las status pages sean independientes
por usuario (dos usuarios pueden tener el mismo slug y cada uno lo ve en su
propia ruta, `/status/gdev/status` y `/status/gsan/status`), y que el registro
pida más información.

**Decisiones:**
- **Username como espacio de nombres, no un id cifrado.** El usuario lo
  proponía como alternativa; se descartó porque una URL con un id opaco no
  es legible ni memorable, y el objetivo de una status page es compartirla.
  El username es público por definición (aparece en la URL), así que no se
  filtra nada que no se fuera a mostrar igualmente.
- **Nueva columna `users.username`** (única, minúsculas, `[a-z0-9]` con
  guiones internos, 3–30 caracteres, lista corta de nombres reservados) y
  `users.full_name`. Las reglas viven en `packages/shared/src/username.ts`
  y las usan **a la vez** la API (validación real, zod `superRefine`) y el
  formulario (aviso inmediato) — una sola fuente de verdad, imposible que el
  navegador acepte lo que la API rechaza.
- **Migración 0008 con backfill:** los usuarios que ya existían reciben el
  username derivado de la parte local de su email (`gdev@outlook.es` →
  `gdev`), con sufijo numérico si chocara. Por eso existe `PATCH /me` y la
  página `/profile`: quien no eligió su username puede cambiarlo. El
  formulario avisa de que cambiarlo cambia la URL de todas sus status pages
  (los enlaces antiguos dejan de funcionar; no se guardan redirecciones —
  decisión consciente para no complicar el modelo por ahora).
- **Unicidad del slug: `UNIQUE (organization_id, slug)`** en vez de global.
  La resolución pública es username → usuario → **organización principal**
  (misma simplificación que `getPrimaryOrganizationId`) → página. **Aviso
  para la Fase 4.1 (equipos):** cuando un usuario pueda estar en varias
  organizaciones, el espacio de nombres tendrá que moverse a la organización
  (un `organizations.slug`) o la ruta deberá decidir qué organización del
  usuario mostrar. Está anotado en el propio código.
- **Ruta antigua `/public/status/:slug` eliminada**, no mantenida en
  paralelo: con slugs repetibles entre usuarios ya no identifica una página
  de forma única, así que sería ambigua. Los enlaces antiguos (`/status/status`)
  dejan de funcionar; la única página existente pasa a `/status/gdev/status`.
- **Username inexistente y slug inexistente responden el mismo 404** para que
  la ruta pública no sirva para enumerar qué usernames existen. El endpoint
  `GET /auth/username-available` sí lo revela (es su función, como en
  cualquier formulario de registro), y por eso lleva su propio rate limit
  (60/min) como único otro endpoint sin JWT que consulta la base de datos.
- **Login por email o username** (`identifier` en vez de `email`): si el
  username es la identidad pública del usuario, es natural poder entrar con
  él.
- **Formulario de registro:** nombre completo, username (con `@` delante,
  comprobación de disponibilidad en vivo con 400 ms de retardo y vista previa
  de la URL resultante), email, contraseña + confirmación, nombre de la
  organización (opcional; por defecto "Organización de <nombre>"). El botón se
  deshabilita mientras el username sea inválido/ocupado o las contraseñas no
  coincidan. Si la comprobación en vivo falla (red, rate limit) el formulario
  **no** se bloquea: la API vuelve a validar al enviar.

**Verificación (Chromium real vía Playwright, 14/14 OK, sin diálogos nativos
ni errores inesperados):** username con espacios deshabilita el botón ·
username `gdev` (ocupado) avisa · contraseñas distintas avisan · registro
completo de A desde la UI · A crea la página `status` (el mismo slug que ya
tiene gdev) · `/status/<A>/status` la sirve · registro de B en otra sesión ·
B crea `status` también · B no puede repetir su propio slug (409 con mensaje
visible) · **las tres páginas `status` (gdev, A, B) sirven cada una su
contenido** · login con username en sesión nueva · A cambia su username en
`/profile` y el enlace de su status page cambia · A no puede coger el
username de B (409 visible) · URL nueva de A funciona y la antigua da 404.
Además, contra la API directamente: ruta antigua → 404; usuario desconocido
y "mismo slug en otro usuario" → 404 idénticos. `tsc` (api, web, worker),
`eslint` y `vite build` limpios. Migración aplicada con `db:migrate`;
backfill comprobado en SQL (`gdev`, `gsanchezdom`). Datos de prueba
eliminados; los tres usuarios reales (incluida la cuenta `@gsan-dev` que el
usuario creó con el formulario nuevo mientras se verificaba) intactos.

### 2026-09-21 — Fase 4.1: equipos y roles (organización activa, invitaciones, middleware de roles)
**Contexto:** hasta aquí cada usuario tenía exactamente una organización y
todas las rutas la resolvían implícitamente con `getPrimaryOrganizationId`.
Con equipos un usuario puede estar en varias, con roles distintos en cada una.

**Decisiones:**
- **Organización activa por cabecera (`X-Organization-Id`), no en el JWT ni
  en la URL.** En el JWT obligaría a reemitir el token al cambiar de
  organización (y el refresh de 7 días arrastraría la antigua); en la URL
  (`/orgs/:id/monitors`) habría que reescribir todas las rutas y enlaces
  existentes. La cabecera la pone el cliente HTTP en un único sitio
  (`client.ts`) y el WebSocket la manda en el handshake; sin cabecera se usa
  la personal, así que todo lo anterior sigue funcionando sin cambios.
- **"Personal" = `organizations.owner_user_id`, no "la membresía más
  antigua".** El primer intento usaba la más antigua y la verificación lo
  tumbó: al aceptar una invitación a una organización creada antes que la
  propia, esa pasaba a ser la "personal" y el usuario creaba monitores en la
  equivocada sin cabecera. Migración 0010 añade la columna con backfill (cada
  organización previa tenía un único miembro admin: su dueño).
- **Jerarquía de roles lineal** (readonly < editor < admin) aplicada con un
  único `requireRole(min)` por ruta, en vez de una matriz permiso-por-acción:
  tres roles no justifican un sistema de permisos granular, y el middleware
  deja explícito en cada ruta qué exige.
- **Invitaciones con token aleatorio hasheado (sha256) en BD**, 7 días de
  caducidad, un solo uso, y aceptación solo con sesión cuyo email coincide.
  El enlace del email no basta por sí solo para entrar con otra cuenta. Una
  invitación pendiente al mismo email se reemplaza, no se acumula. Si el
  email no se puede enviar, la invitación se borra y se devuelve 502 (no
  queda una fila "fantasma" que el admin cree enviada).
- **`GET /invitations/:token` es público** (el invitado puede no tener
  cuenta) y solo revela organización, rol y email destino; con rate limit.
- **Una organización nunca se queda sin admin** (409 al degradar o quitar al
  último).
- **Cambiar de organización recarga la página** (`window.location.assign`)
  en vez de re-renderizar: garantiza que ningún componente, lista o socket
  conserva datos de la organización anterior. Más tosco, más seguro.
- **La UI oculta lo que el rol no permite** (botones de crear/borrar, formularios),
  pero la autorización real vive solo en la API: ocultar es cortesía, no seguridad.
- **Pendiente anotado:** las organizaciones de equipo no tienen URL pública
  propia; `/status/<username>/<slug>` sigue resolviendo a la organización
  personal del usuario. Requeriría `organizations.slug` (ver Fase 4.2/4.3 o
  posterior). Las alertas por email siguen yendo a todos los miembros,
  independientemente del rol.

**Verificación:** ver checklist de 4.1 arriba (22 comprobaciones contra la
API con el email real leído de Mailpit; 12 en Chromium real). `tsc` en
api/web, `eslint`, `vite build` limpios. Datos de prueba eliminados; datos
reales intactos.

### 2026-09-21 — Fase 4.2: checks multi-región y quórum
**Pregunta de diseño:** con workers en varias regiones, ¿cómo se decide que un
monitor está caído cuando una región falla y otra no?

**Arquitectura elegida: una cola por región, misma base de datos.**
- Alternativas descartadas: (a) *una sola cola y que cada worker etiquete
  el check con su región* — no garantiza que cada región compruebe cada
  monitor (el worker más rápido se llevaría todos los jobs) ni permite
  saber qué región "calla"; (b) *un job por monitor con fan-out interno a
  N regiones por HTTP* — obliga a que los workers se expongan entre sí y
  añade un punto único de fallo. Con una cola por región
  (`monitor-checks--<región>`; BullMQ prohíbe `:` en nombres de cola) cada
  worker solo ve trabajo de su región y la API programa cada monitor en
  todas (`RegionQueues`). Con `CHECK_REGIONS=local` (por defecto) el sistema
  es idéntico al anterior.
- Regiones retiradas de la configuración: la API guarda en Redis el set de
  regiones conocidas y al arrancar hace `obliterate()` de las colas que ya no
  están; si no, sus job schedulers seguirían encolando checks sin consumidor.
  Lo mismo con la cola anterior a esta fase (`monitor-checks` a secas).
  **Verificado:** al volver a `local` la API registró "colas de regiones
  retiradas eliminadas: eu-west, us-east" y en Redis solo quedó
  `monitor-checks--local`.

**Quórum: mayoría estricta, `Q = floor(R/2)+1`.** R=1 → 1 (comportamiento de
siempre), R=2 → 2, R=3 → 2, R=5 → 3. Se aplica el MISMO quórum a dos
preguntas que conviene no mezclar (ya se separaron en la Fase 2.2):
1. **Estado instantáneo** (`monitors.consolidated_status`: up | degraded |
   down): último check de cada región configurada. `down` si ≥Q regiones lo
   ven caído, `degraded` si alguna pero <Q, `up` si ninguna. Es lo que ven
   dashboard, detalle, status page y el evento WebSocket, que ahora se emite
   **por cambio consolidado** y no por cada check crudo (con dos regiones,
   cada check crudo de una región que discrepa produciría ruido).
2. **Incidente:** una región "está fallando" si sus últimos N checks son
   down (N = `INCIDENT_FAILURE_THRESHOLD`, como antes). Se abre incidente si
   ≥Q regiones están fallando; `started_at` = el Q-ésimo inicio de racha
   más antiguo (el instante en que se alcanzó el quórum); `cause_summary`
   lista las regiones. Se cierra cuando el estado instantáneo deja de ser
   `down`.
- **Por qué mayoría y no "cualquiera" ni "todas":** "cualquiera" convierte
  un problema de red local de una región en una alerta (justo lo que la
  multi-región quiere evitar); "todas" hace que una región muerta oculte
  una caída real para siempre. La mayoría tolera `floor((R-1)/2)` regiones
  rotas o mintiendo. Con R=2 coincide con "todas" — es el precio de tener
  solo dos; con tres regiones se obtiene tolerancia a una.
- **Solo cuentan regiones configuradas.** Una región con checks antiguos
  pero ya no en `CHECK_REGIONS` no participa (ni en el quórum ni en la UI).
  Una región configurada que todavía no ha comprobado el monitor no cuenta
  como caída (no hay evidencia) — se expone como `silentRegions`.
- **Serialización con `SELECT … FOR UPDATE`** sobre la fila del monitor:
  dos workers (dos regiones) pueden terminar un check del mismo monitor a
  la vez; sin bloqueo ambos leerían el mismo estado previo y podrían abrir
  dos incidentes o emitir dos transiciones idénticas.
- **User-Agent con región** (`UptimePulse/1.0 (+region=<r>)`, salvo que el
  usuario configure el suyo): lo que hace cualquier monitorizador serio y,
  de paso, lo que permitió verificar el quórum sin infraestructura real (un
  servidor local que falla solo para una región).

**Consecuencias:** el uptime % y los gráficos agregan checks de todas las
regiones (un monitor con 2 regiones tiene el doble de checks por intervalo;
es lo esperado). `checks_hourly` no distingue región (pendiente si algún día
se quiere uptime por región). El histórico previo se marcó `region='local'`
y el consolidado se rellenó desde el último check (migración 0011).

### 2026-09-21 — Fase 4.3: planes — Stripe simulado, no integrado
**Decisión:** el cambio de plan es un endpoint directo (`POST
/organizations/:id/plan`, solo admin) sin pasarela de pago, en vez de una
integración real de Stripe.

**Por qué:** la regla del proyecto es que nada se da por hecho sin haberlo
ejecutado de verdad, y una integración de Stripe (Checkout + webhook
`checkout.session.completed` + firma del webhook) no se puede verificar sin
claves de una cuenta de Stripe en modo test, que no existen en esta sesión.
Integrarla "a ciegas" produciría exactamente el tipo de código "debería
funcionar" que se ha evitado en todas las fases. Aun así, lo que sí importa
del dominio se aplica ya: límites reales por plan en la API (no solo en la
UI), bloqueo de rebajas con exceso de monitores, conservación de canales al
bajar, y una página de precios que lee los planes del backend.

**Cómo encajaría Stripe cuando haya claves (para quien lo retome):**
1. `plans.stripe_price_id` (columna nueva) y `organizations.stripe_customer_id`.
2. `POST /organizations/:id/plan` pasa a crear una Checkout Session
   (`mode: "subscription"`, `line_items: [{ price: plan.stripe_price_id }]`,
   `client_reference_id: organizationId`) y devuelve su `url`; la página de
   precios redirige ahí en vez de aplicar el cambio.
3. `POST /webhooks/stripe` (sin JWT, verificando `Stripe-Signature` con el
   secret del endpoint) aplica el cambio de plan en
   `checkout.session.completed` y lo revierte a free en
   `customer.subscription.deleted`. Es el webhook, no el cliente, quien
   cambia `organizations.plan_id`.
4. El endpoint actual se conserva solo para `free` (bajar) y para
   desarrollo (`NODE_ENV !== "production"`), así la simulación sigue
   sirviendo para probar los límites sin tarjeta.

**Otras decisiones de 4.3:**
- Los errores de límite devuelven, además del mensaje, un objeto `limit`
  (`kind`, `plan`, `max`/`minIntervalSeconds`/`allowed`, `current`) para que
  el frontend distinga "límite del plan" de "error de validación" y enlace
  a `/pricing` sin analizar el texto.
- `free` conserva exactamente los valores de la Fase 0.3 (5 monitores,
  5 min, solo email); `pro` = 50 / 1 min / todos los canales / 9 €/mes.
  Cifras de portfolio, no de negocio. `price_cents_monthly` en céntimos
  para evitar decimales.
- La página de precios ordena por precio y no tiene ningún dato
  hardcodeado: cambiar un límite en `plans` cambia la página.
- Se eliminó el plan `free-manual` que quedaba de la verificación manual de
  la Fase 1.2 (documentada en DIARIO.md); ninguna organización lo usaba.

### 2026-09-21 — Checks `ping`: se invoca el `ping` del sistema, no ICMP nativo
**Decisión:** el worker ejecuta el binario `ping` del sistema operativo
(`execFile`, sin shell) con un único echo y el timeout del monitor, y decide
`up`/`down` parseando la salida, no por el exit code.

**Por qué:** un echo ICMP desde Node necesita sockets raw (root/CAP_NET_RAW
en Linux, administrador en Windows) o una dependencia nativa que compilar
en cada plataforma; el binario `ping` ya es setuid/privilegiado donde hace
falta y existe en cualquier imagen base. El exit code no sirve: en Windows
un "Host de destino inaccesible" enviado por el propio router devuelve 0,
igual que "error en la transmisión" cuando no hay ruta IPv6. Solo una
respuesta de echo real trae `TTL=` (IPv4) o `time=`/`tiempo=` (Windows no
imprime TTL en IPv6), así que ese es el criterio de `up`; la latencia que
se guarda es la que imprime `ping`, no la del proceso.

**Seguridad:** como el target del usuario acaba siendo un argumento de un
proceso, `isValidPingTarget` (en `packages/server-utils`) solo admite una IP
(v4/v6, `net.isIP`) o un hostname RFC 1123 y rechaza todo lo que empiece por
`-`; lo aplican la API al crear/editar (400) y el worker justo antes de
ejecutar (defensa en profundidad). Sin shell no hay expansión de `;`, `|`
ni comillas. El anti-SSRF de siempre sigue delante (127.0.0.1 → 422).

**Plataformas:** `-n 1 -w <ms>` en Windows, `-c 1 -W <s>` en Linux (segundos
enteros, redondeando hacia arriba), `-c 1 -W <ms>` en macOS. Mensajes de
error normalizados (DNS, inalcanzable, sin respuesta) a partir de la salida
en inglés y en español. Verificado solo en Windows en esta sesión; Linux y
macOS por la documentación de sus `ping` (queda anotado en TODO.md).

### 2026-09-21 — Fase 5.1: API keys, cuota por host y redirecciones
**API keys como "usuario de organización", no como usuario personal.** Una
clave fija la organización y equivale a un rol (`read` → readonly, `write`
→ editor), nunca admin: lo que administra personas (miembros, plan,
invitaciones, otras claves) exige sesión de una persona
(`requireUserSession`). Así una clave filtrada en un CI no puede invitar a
nadie ni cambiar el plan. Revocar = borrar la fila (sin `revoked_at`): más
simple, y la auditoría de "quién la creó" ya está en `created_by_user_id`
y en el log JSON.

**Cuota por host en el worker, no en la API.** Limitar "monitores por host
por organización" en la API no protege al destino de varios usuarios
distintos ni de varias regiones; la cuota tiene que contarse donde se
ejecutan los checks y de forma global (Redis, ventana fija de 60 s). Un
check saltado no se guarda: no es información sobre el monitor.

**Redirecciones a mano.** `fetch` con `redirect: "follow"` haría la
petición interna antes de que nadie la comprobara; con `manual` cada salto
pasa por el mismo anti-SSRF que el target original. Coste: ~30 líneas y
reproducir la semántica 301/302/303/307/308 de método y body.

**Rate limit con contadores en Redis** (no en memoria) para que el límite
sea el mismo con varias instancias de la API. El `errorResponseBuilder` de
`@fastify/rate-limit` debe devolver un `Error` con `statusCode` (el plugin
lo lanza); y el `setErrorHandler` global debe registrarse **antes** que las
rutas, porque los plugins hijos lo copian al registrarse — hasta ahora los
errores dentro de las rutas no pasaban por él (bug latente desde la Fase 1.1
que apareció al probar el 429 por ruta).

### 2026-09-21 — Fase 5.2: prom-client con registro propio y `errorKind`
Registro propio de `prom-client` por proceso (no el global) para que los
tests de integración puedan construir varios servidores sin "metric already
registered". El worker expone `/health` y `/metrics` con `node:http` a
secas: dos rutas no justifican Fastify en un consumidor de cola. La
clasificación del error (`errorKind`) se añade al resultado del check y no
a la tabla `checks`: sirve para métricas y logs, y el mensaje en español
sigue siendo lo que ve el usuario.

### 2026-09-22 — Fase 5.3: dos proyectos de Vitest y una base de datos de test
**Unit e integración separados** (`vitest.config.ts`, `projects`): los
unitarios corren en 1 s sin servicios; los de integración usan la API real
(`buildServer()` + `app.inject()`, sin puerto) contra **`uptimepulse_test`**,
creada y migrada por `test/global-setup.ts` con las mismas migraciones de
producción, y la base 1 de Redis (limpiada al empezar y al terminar). Nunca
tocan la base de desarrollo. Motivo: el cálculo de uptime vive en SQL
(`checks_hourly`) y el motor de incidentes en una transacción con
`FOR UPDATE`/`DISTINCT ON`: probarlos con mocks no probaría nada.

**E2E en `e2e/` con `@playwright/test`** en vez de los scripts sueltos de
sesiones anteriores: `playwright.config.ts` reutiliza los procesos locales
y en CI los arranca. Chromium se instala en la caché estándar de Playwright
(`npx playwright install chromium`), no en el repo.

`AUTH_RATE_LIMIT_PER_MINUTE` se hizo configurable porque los tests de
integración (todos desde 127.0.0.1) chocaban con el límite de 10/min.

### 2026-09-22 — Fase 5.4: tsx en producción, un `migrate` como servicio
**Las imágenes ejecutan TypeScript con tsx**, no un build de tsc: los
paquetes del monorepo se consumen como fuente (`"main": "./src/index.ts"`),
y compilar cada uno (con `project references`, `exports` dobles y rutas
`.js`) añadiría complejidad sin beneficio medible para este tamaño. Coste:
tsx (esbuild) pasa a `dependencies` de api y worker y la imagen es más
grande de lo que sería con `dist/`. Si algún día importa el arranque en
frío, es un cambio aislado en los Dockerfiles.

**Migraciones como servicio `migrate`** (`service_completed_successfully`)
en vez de en el entrypoint de la API: con varias réplicas de la API, solo
una debe migrar.

**CI sin ejecutar en GitHub**: no se ha hecho push desde esta sesión. Todo
lo que la CI ejecuta (`npm run lint`, `npm run typecheck`, `vite build`,
`npm test`, `npm run test:e2e`, `docker build`) se ejecutó en local con
éxito; el YAML está validado. La primera ejecución real puede destapar
diferencias de entorno (p. ej. tiempos de arranque de los servicios).

**TimescaleDB fijada** a `2.30.1-pg16` (la versión que había en el
contenedor de desarrollo) en compose de desarrollo, producción y CI.

### 2026-09-22 — Fase 5.5: OpenAPI a mano
Las rutas validan con zod y no con esquemas JSON de Fastify, así que
`@fastify/swagger` no puede generar nada útil: `docs/openapi.yaml` se
escribe a mano y se sirve en modo estático. El riesgo es que se desvíe del
código; lo mitiga `redocly lint` en local y que los tests de integración
cubren las mismas rutas. Migrar a `fastify-type-provider-zod` para generar
la especificación desde los esquemas queda en TODO.md.
