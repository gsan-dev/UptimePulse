# Checklist de seguridad (Fase 5.1)

Revisada a mano el 2026-09-21. Cada punto dice dónde está implementado y
cómo se comprobó. Las casillas sin marcar son decisiones conscientes que
quedan documentadas, no olvidos.

## Autenticación y sesiones

- [x] Contraseñas con bcrypt (`apps/api/src/lib/password.ts`); nunca se
      devuelven ni se registran en logs.
- [x] Access token JWT de 15 min en memoria del navegador; refresh token de
      7 días en cookie `httpOnly` + `SameSite=Strict` con `Path=/auth`
      (`routes/auth.ts`). Secretos distintos para cada uno. Atributo `Secure`
      por defecto en producción (`COOKIE_SECURE`; `false` solo para self-hosting
      en HTTP plano).
- [x] En producción la API **no arranca** con secretos de ejemplo
      (`changeme…`) ni de menos de 32 caracteres (`env.ts`, función
      `secret()`). Comprobado: `NODE_ENV=production
      JWT_ACCESS_SECRET=changeme_access_secret` → error al arrancar.
- [x] Login y registro limitados a 10 peticiones/min por IP (`routes/auth.ts`).
      Comprobado: el 11º intento devuelve 429.
- [ ] Revocación de refresh tokens ("cerrar sesión en todos los
      dispositivos"): no implementada; un refresh token filtrado vale hasta 7
      días. Ver TODO.md.
- [ ] Verificación de email y recuperación de contraseña: no implementadas.

## API keys (integraciones)

- [x] Formato `up_<64 hex>`; en la base de datos solo el sha256
      (`lib/api-keys.ts`); la clave completa se muestra una sola vez.
- [x] Scopes `read`/`write` → rol `readonly`/`editor`. Nunca `admin`: una
      clave no puede gestionar miembros, invitaciones ni otras claves
      (`requireUserSession` en `plugins/auth.ts`).
- [x] Revocación inmediata (DELETE borra la fila; la siguiente petición da 401).
- [x] La organización la fija la clave; `X-Organization-Id` se ignora.
- [x] Cuota de peticiones por clave (no por IP) en el rate limit global.

## Autorización

- [x] Todas las rutas de datos pasan por `requireAuth` → `requireOrganization`
      → `requireRole` (`plugins/auth.ts`); las consultas filtran siempre por
      `organization_id`.
- [x] Roles readonly < editor < admin; el último admin no se puede degradar
      ni expulsar (`routes/organizations.ts`).
- [x] Invitaciones con token aleatorio hasheado, 7 días, un solo uso y
      solo aceptables desde el email invitado.

## Anti-SSRF (el riesgo propio de "monitoriza esta URL")

- [x] `packages/server-utils/src/ssrf-guard.ts`: bloquea IPs privadas,
      loopback, link-local (incluida `169.254.169.254`, metadatos cloud),
      IPv6 ULA/loopback e IPv4 mapeadas; resuelve **todas** las direcciones
      del DNS, no solo la primera.
- [x] Se aplica al crear/editar el monitor (API) **y** justo antes de cada
      check (worker), para HTTP, TCP y ping.
- [x] Redirecciones HTTP seguidas a mano (`redirect: "manual"`) y cada salto
      revalidado; máximo 5 saltos; solo `http:`/`https:`
      (`apps/worker/src/lib/http-check.ts`). Comprobado: 302 hacia
      `http://127.0.0.1:3000/health` → "Redirección bloqueada"; 302 hacia
      `file:///etc/passwd` → rechazada; bucle → "Demasiadas redirecciones".
- [x] Target de `ping` restringido a IP o hostname RFC 1123 y ejecutado con
      `execFile` sin shell (`isValidPingTarget`).
- [x] `ALLOW_PRIVATE_MONITOR_TARGETS=true` solo en desarrollo local. **Nunca
      en un despliegue.**

## Abuso y denegación de servicio

- [x] Rate limit global de la API: 300/min por IP o por API key
      (`API_RATE_LIMIT_PER_MINUTE`), contadores en Redis (válido con varias
      instancias). Rutas públicas con límites propios más estrictos
      (`/public/status`, `/invitations/:token`,
      `/auth/username-available`).
- [x] Cuota de checks salientes por host de destino: 60/min sumando todos
      los monitores, usuarios y regiones (`CHECK_MAX_PER_HOST_PER_MINUTE`,
      `apps/worker/src/lib/host-rate-limit.ts`). Por encima, el check se
      salta y se cuenta en `uptimepulse_checks_rate_limited_total`.
      Comprobado con cuota 3: de 6 checks encolados se ejecutaron 3.
- [x] `trustProxy` solo en producción (detrás de un proxy la IP real viene
      en `X-Forwarded-For`; en local confiar en ella permitiría falsearla).
- [ ] Sin límite de tamaño explícito para `headers`/`body` de un monitor
      (Fastify limita el body de la petición a 1 MB por defecto).

## Cabeceras y CORS

- [x] `@fastify/helmet`: `X-Content-Type-Options`, `X-Frame-Options`, HSTS,
      `Referrer-Policy`, etc. Sin CSP en la API (sirve JSON; Swagger UI y Bull
      Board necesitan scripts inline). La CSP del frontend la pone nginx
      (`apps/web/nginx.conf`).
- [x] CORS restringido a `CORS_ORIGINS` (por defecto solo `APP_URL`);
      `"*"` rechazado en producción. Comprobado: `Origin: https://evil.example`
      no recibe `Access-Control-Allow-Origin`.

## Secretos y configuración

- [x] Ningún secreto en el repositorio: JWT, SMTP, `DATABASE_URL`,
      `METRICS_TOKEN`, webhooks de Discord/Slack solo por variables de
      entorno o en la base de datos. `grep` de patrones de claves en
      `apps/` y `packages/`: sin resultados. `.env` en `.gitignore`.
- [x] `.env.example` solo contiene valores de ejemplo (`changeme`), que la
      API rechaza en producción.
- [x] Bull Board (`/admin/queues`) desactivado con `NODE_ENV=production`.
- [x] `/metrics` opcionalmente protegido con `METRICS_TOKEN`.
- [ ] Contraseña de Postgres `changeme` en `docker-compose.yml` por defecto:
      cámbiala en `.env` (`POSTGRES_PASSWORD`) antes de exponer el puerto.

## Dependencias

- [ ] `npm audit` reporta 2 vulnerabilidades en dependencias de desarrollo
      del scaffold (no en código que se ejecute en producción). Revisar
      periódicamente; la CI lo ejecuta con `--audit-level=high` sin bloquear
      el pipeline.

## Cómo reproducir las comprobaciones

```bash
# Cabeceras y CORS
curl -sI http://localhost:3000/health | grep -iE "x-frame|x-content|strict-transport|x-request-id"
curl -sI -H "Origin: https://evil.example" http://localhost:3000/health | grep -i access-control
# Rate limit de login: el 11º da 429
for i in $(seq 11); do curl -s -o /dev/null -w "%{http_code} " -X POST -H "Content-Type: application/json" \
  -d '{"identifier":"x@example.com","password":"x"}' http://localhost:3000/auth/login; done
# Secretos de ejemplo en producción: no arranca
NODE_ENV=production JWT_ACCESS_SECRET=changeme_access_secret npm run dev:api
```
