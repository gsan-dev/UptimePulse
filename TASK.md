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

### 1.3 Worker simple (checks HTTP)
- [ ] Proceso independiente (`apps/worker`) que cada X segundos consulta monitores activos cuyo próximo check toque.
- [ ] Ejecuta el HTTP request con timeout configurado, guarda el resultado en `checks`.
- [ ] Reintentos antes de marcar como "down" (ej. 2 reintentos con backoff corto) para evitar falsos positivos (README §2.2).
- [ ] Manejo de errores de red distinto de errores de código de estado (timeout vs. 500 vs. DNS failure) — guardarlo en `error_message`.
- **Hecho cuando:** con un monitor de prueba apuntando a una URL real, aparecen filas nuevas en `checks` cada minuto sin intervención manual.

### 1.4 Dashboard básico (frontend)
- [ ] Setup de `apps/web` con React + Vite + TailwindCSS.
- [ ] Página de login/registro.
- [ ] Listado de monitores (polling simple, sin WebSocket todavía) con estado actual y último tiempo de respuesta.
- [ ] Formulario de creación/edición de monitor.
- [ ] Vista de detalle con tabla simple de los últimos checks (sin gráficos aún).
- **Hecho cuando:** desde el navegador puedes loguearte, crear un monitor, y ver que su estado cambia tras un rato (refrescando o con `setInterval` de polling).

### 1.5 Alertas por email (mínimo viable)
- [ ] Integración con Resend/Nodemailer.
- [ ] Al detectar transición up→down o down→up, enviar email al dueño del monitor.
- [ ] Plantilla de email simple (texto plano o HTML mínimo).
- **Hecho cuando:** al parar el servicio de prueba, llega un email; al reanudarlo, llega el email de recuperación.

---

## Fase 2 — Cola de trabajo real, incidentes, tiempo real

### 2.1 Cola de trabajo (Redis + BullMQ)
- [ ] Sustituir el bucle simple del worker por jobs programados en BullMQ (uno por monitor, con `repeat` según su intervalo).
- [ ] Separar "productor" (API que agenda/actualiza jobs cuando se crea/edita/borra un monitor) de "consumidor" (proceso worker que ejecuta el check).
- [ ] Escalar a N workers concurrentes; verificar que no se duplican checks (idempotencia / locks).
- [ ] Dashboard de administración de la cola (Bull Board) en desarrollo.
- **Hecho cuando:** puedes lanzar 2 instancias del worker y los checks se reparten entre ellas sin duplicarse ni perderse.

### 2.2 Motor de incidentes
- [ ] Job/listener que, al ver N checks fallidos consecutivos (configurable, ej. 2), crea un `incident` con `started_at`.
- [ ] Al ver el primer check exitoso tras un incidente abierto, lo cierra con `resolved_at`.
- [ ] Respeta `maintenance_windows`: un check fallido dentro de una ventana de mantenimiento no abre incidente ni dispara alerta.
- [ ] Cálculo de métricas agregadas: % uptime (día/semana/mes/histórico), tiempo medio de respuesta, MTTR — como jobs programados o vistas materializadas de TimescaleDB (continuous aggregates).
- **Hecho cuando:** al simular una caída de 3 checks seguidos se crea un incidente, y al recuperarse se cierra con la duración correcta; el uptime % del monitor refleja ese incidente.

### 2.3 Tiempo real (WebSockets)
- [ ] Servidor Socket.io en la API, autenticado con el mismo JWT.
- [ ] Emitir evento `monitor:status_changed` a los clientes de la organización correspondiente cuando cambia el estado de un monitor.
- [ ] Frontend: sustituir el polling de la Fase 1 por suscripción WebSocket; actualizar UI en vivo.
- [ ] Toast/notificación visual en el dashboard cuando cambia el estado mientras el usuario está mirando (README §3.7).
- **Hecho cuando:** con el dashboard abierto en el navegador, al forzar la caída de un monitor de prueba, la tarjeta cambia de color sin recargar la página.

### 2.4 Dashboard mejorado
- [ ] Sparklines de las últimas 24h por monitor (Recharts).
- [ ] Cabecera con resumen agregado (operativos vs. caídos, uptime medio global, incidentes activos).
- [ ] Selector de rango temporal (24h/7d/30d/90d) en la vista de detalle, con gráfico de línea de tiempo de respuesta y zonas sombreadas en rojo para caídas.
- **Hecho cuando:** la vista de detalle de un monitor con histórico real permite cambiar el rango y el gráfico se actualiza acorde.

---

## Fase 3 — SSL, webhooks/SMS, status pages

### 3.1 Verificación de certificados SSL
- [ ] Job periódico (o parte del check HTTPS) que lee la fecha de expiración del certificado.
- [ ] Alerta a 30/15/7 días de la expiración (README §2.2), evitando reenviar la misma alerta cada día (dedupe).
- **Hecho cuando:** contra un dominio de prueba con certificado próximo a expirar (o mockeado), se genera la alerta correspondiente solo una vez por umbral.

### 3.2 Webhooks y SMS
- [ ] Canal de notificación tipo webhook genérico: POST con payload JSON documentado (evento, monitor, timestamp, estado).
- [ ] Firma del payload (HMAC con secreto por canal) para que el receptor pueda verificar autenticidad.
- [ ] Integración Twilio para SMS.
- [ ] Integración directa Slack/Discord (webhooks de esas plataformas).
- [ ] UI de configuración: matriz "qué monitores notifican por qué canal" (README §3.5).
- **Hecho cuando:** un monitor configurado con webhook + Slack dispara ambos al caer, y el payload del webhook verifica correctamente su firma HMAC.

### 3.3 Status pages públicas
- [ ] Modelo ya creado en Fase 0 (`status_pages`, `status_page_monitors`).
- [ ADR ] (diseño) decidir enrutado: subdominio propio (`estado.tuempresa.com`, requiere gestión de dominios/DNS del usuario) vs. ruta bajo el dominio propio (`uptimepulse.app/status/slug`) — empezar por la segunda opción (mucho más simple) y dejar la primera como mejora futura.
- [ ] Endpoint público (sin auth) que sirve el estado agregado de los monitores marcados como visibles.
- [ ] Frontend: layout completamente distinto (sin sidebar), con indicador general y barras de histórico de 90 días por servicio (estilo Stripe/GitHub Status).
- [ ] Rate limiting de este endpoint público (es accesible por cualquiera, sin login).
- **Hecho cuando:** una URL pública muestra el estado de los monitores seleccionados sin requerir login y sin exponer datos de otros monitores de la cuenta.

---

## Fase 4 — Equipos, multi-región, planes

### 4.1 Equipos y roles
- [ ] Invitar miembros a una organización por email.
- [ ] Roles: admin, editor, solo lectura — aplicar en middleware de autorización de cada endpoint.
- **Hecho cuando:** un usuario con rol "solo lectura" puede ver monitores pero recibe 403 al intentar editarlos.

### 4.2 (diseño) Checks multi-región
- [ ] Decidir arquitectura antes de implementar: ¿workers desplegados en distintas regiones que reportan a la misma DB central? ¿Cómo se decide "down" cuando una región falla y otra no (quorum, ej. 2 de 3 regiones deben fallar)?
- [ ] Documentar la decisión de quorum/consenso en un ADR — esta es la pieza más "sistemas distribuidos" del proyecto y la que más justifica su valor de portfolio.
- [ ] Etiquetar cada check con la región de origen (`checks.region`).
- [ ] UI: mostrar desde qué región(es) se detectó la caída.
- **Hecho cuando:** con al menos 2 regiones simuladas (pueden ser 2 procesos worker con distinta env var de región, sin infra real multi-datacenter), un fallo en una sola región no marca el monitor como caído si la otra región lo ve operativo.

### 4.3 Planes de suscripción
- [ ] Modelo `plans` ya creado en Fase 0; aplicar límites reales (nº monitores, intervalo mínimo, canales disponibles) al crear/editar monitores y canales.
- [ ] (diseño) decidir si se integra Stripe de verdad (checkout + webhooks de facturación) o se simula el estado de plan manualmente — para portfolio, una integración real de Stripe en modo test suma valor.
- [ ] Página de precios conectada a los planes reales del backend (no solo estática, README §3.1).
- **Hecho cuando:** un usuario en plan Free no puede crear un monitor por encima de su límite ni bajar el intervalo por debajo del mínimo permitido; el error se lo dice explícitamente.

---

## Fase 5 — Seguridad, calidad y lanzamiento (transversal)

Estas tareas no aparecían como fase propia en el README pero son necesarias antes de considerar el proyecto "terminado" o presentable en portfolio.

### 5.1 Seguridad
- [ ] Rate limiting en la API pública (por IP y por API key) — evita abuso.
- [ ] Rate limiting de checks salientes por host de destino — evita que el propio UptimePulse actúe como herramienta de DDoS si un usuario configura muchos monitores agresivos contra el mismo target.
- [ ] Revisión anti-SSRF también en TCP checks (no solo HTTP) y en redirecciones HTTP (una URL pública puede redirigir a una IP interna).
- [ ] Gestión de API keys: hash al guardar, scopes, revocación.
- [ ] Cabeceras de seguridad estándar (Helmet), CORS restringido a los orígenes reales del frontend.
- [ ] Secrets (JWT secret, claves Twilio/Stripe/Resend) solo vía variables de entorno, nunca en el repo.
- **Hecho cuando:** existe una checklist de seguridad revisada manualmente y sin secretos hardcodeados en el código fuente.

### 5.2 Observabilidad del propio sistema
- [ ] Logging estructurado (JSON) en API y worker, con correlación de request ID.
- [ ] Métricas básicas (Prometheus/OpenTelemetry): jobs procesados, latencia de checks, tamaño de cola, errores por tipo.
- [ ] Health-check endpoint propio (`/health`) para API y worker.
- **Hecho cuando:** puedes ver en logs/métricas cuántos checks se han ejecutado en la última hora y cuántos han fallado por timeout vs. error de conexión.

### 5.3 Testing
- [ ] Unit tests de lógica de negocio pura (cálculo de uptime %, detección de incidentes, validación anti-SSRF) — Vitest/Jest.
- [ ] Integration tests de la API contra una DB de test (Testcontainers o DB dedicada).
- [ ] E2E básico del flujo crítico (registro → crear monitor → ver estado) con Playwright.
- **Hecho cuando:** `pnpm test` corre en CI y cubre al menos el cálculo de uptime, la detección de incidentes y la validación anti-SSRF.

### 5.4 CI/CD
- [ ] Pipeline (GitHub Actions) que en cada PR corre lint + tests + build de las 3 apps.
- [ ] Build de imágenes Docker para API y worker.
- [ ] Despliegue (Fly.io/Railway) automatizado desde `main`, o manual documentado paso a paso.
- **Hecho cuando:** un PR con un test roto falla en CI antes de poder mergear.

### 5.5 Documentación final
- [ ] `README.md` de cada app (`apps/api`, `apps/worker`, `apps/web`) con instrucciones de arranque local.
- [ ] Documentación de la API (OpenAPI/Swagger o similar).
- [ ] Actualizar el README raíz con capturas reales del dashboard terminado (README §3.1 ya lo pide para la landing).
- **Hecho cuando:** alguien ajeno al proyecto puede clonar el repo, seguir el README y levantar todo el stack en local sin preguntarte nada.

---

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
