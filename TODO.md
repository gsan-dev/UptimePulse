# TODO — pendientes de las Fases 0 a 4

> Todo lo que quedó sin hacer, a medias o simplificado a propósito en las
> fases ya cerradas (0–4). La Fase 5 no aparece aquí: no ha empezado. Cada
> punto dice de dónde sale (fase / entrada del DIARIO) para poder buscar el
> contexto. Actualizado el 2026-09-21.

## 1. Funcionalidad pendiente (cosas que el README promete y no existen)

- [ ] **SMS vía Twilio** (Fase 3.2, README §2.4). Pospuesto por decisión
      explícita: no hay cuenta de Twilio para verificarlo de verdad. El enum
      `channel_type` ya tiene `sms`, el plan `pro` ya lo lista como permitido,
      pero ni la API ni la UI permiten crear ese canal ni el worker sabe
      enviarlo. Al retomarlo: `packages/notify-channels/src/sms.ts`, zod en
      `routes/notification-channels.ts`, opción en `NotificationChannelsPage`.
- [x] ~~**Checks de tipo `ping` (ICMP)**~~ Hecho el 2026-09-21 invocando el
      `ping` del sistema (ADR en TASK.md). Queda: verificar en Linux/macOS
      (solo probado en Windows) e instalar `iputils-ping` en la imagen del
      worker si se despliega en Alpine/distroless.
- [ ] **Stripe real** (Fase 4.3, README §2.7). El cambio de plan es simulado
      (`POST /organizations/:id/plan`). Los pasos concretos para integrar
      Checkout + webhook están en el ADR "Fase 4.3" de TASK.md. Necesita
      claves de test.
- [ ] **OAuth con GitHub/Google** (Fase 1.1, README §2.7). Las columnas
      `oauth_provider`/`oauth_id` existen desde la Fase 0.3; no hay flujo.
- [ ] **Resumen semanal por email** (Fase 1.5, README §2.4). No existe; es un
      job periódico aparte (BullMQ con patrón cron), no ligado a transiciones.
- [ ] **Etiquetas/proyectos para agrupar monitores** (README §2.1). La columna
      `monitors.tags` existe (jsonb) pero no hay UI ni filtro por etiqueta.
- [ ] **Método HTTP, headers personalizados y body en el formulario** (README
      §2.1). La API y el worker los soportan (`method`, `headers`, `body`);
      `NewMonitorPage` solo pide URL, status esperado, intervalo y timeout.
- [ ] **Edición completa del monitor** (Fase 1.4). El detalle solo permite
      cambiar nombre e intervalo; no `target`, `method`, `headers`, `body`,
      `expectedStatus`, `timeoutMs`, `tags`.
- [ ] **UI de ventanas de mantenimiento** (Fase 2.2). El backend tiene CRUD
      (`/monitors/:id/maintenance-windows`) y el motor de incidentes las
      respeta, pero no hay forma de crearlas desde la interfaz.
- [ ] **Línea temporal visual de incidentes** (README §2.3). Hay lista de
      incidentes y bandas sombreadas en el gráfico de latencia, pero no una
      línea temporal dedicada.
- [ ] **Uptime "histórico total"** (README §2.3). Los rangos son 24h/7d/30d/90d;
      no hay "desde siempre".
- [ ] **Status pages: editar la lista de monitores tras crearla** (Fase 3.3).
      `PATCH /status-pages/:id` existe; falta la UI.
- [ ] **Status pages: `displayName` por monitor** (Fase 3.3). Columna
      `status_page_monitors.display_name` sin UI.
- [ ] **Status pages para organizaciones de equipo** (Fase 4.1). La URL
      pública es `/status/<username>/<slug>` y resuelve a la organización
      *personal* del usuario; una organización creada por invitación no tiene
      URL pública propia. Requiere `organizations.slug` y cambiar la ruta
      (o añadir una segunda).
- [ ] **Alertas por rol** (Fase 4.1). Los emails de caída/recuperación van a
      todos los miembros de la organización, sin filtrar por rol ni permitir
      que un miembro se desuscriba.
- [ ] **API keys** (Fase 0.3). La tabla `api_keys` existe (hash, scopes,
      last_used_at) y no la usa nada: no hay autenticación por API key ni UI
      para generarlas.
- [ ] **Estado "degradado" por latencia** (README §2.5). Hoy "degradado" solo
      significa "alguna región lo ve caído" (Fase 4.2); no existe umbral de
      tiempo de respuesta configurable por monitor.
- [ ] **Página "olvidé mi contraseña" y verificación de email** (Fase 1.4).
- [ ] **Cerrar sesión en todos los dispositivos / revocar refresh tokens**
      (Fase 1.1). No hay tabla de refresh tokens; uno filtrado vale 7 días.

## 2. Deuda técnica y simplificaciones conocidas

- [ ] **Doble check inmediato al crear/reanudar un monitor** (Fase 2.1, visto
      de nuevo en 2.3): `scheduleMonitorCheck` encola un check explícito y el
      job scheduler dispara otro casi a la vez → dos checks y dos eventos
      WebSocket con ~200 ms de diferencia. Cosmético pero ruidoso; ahora con
      multi-región se multiplica por regiones.
- [ ] **Toasts sin agrupar/deduplicar** (Fase 2.3): eventos casi simultáneos
      producen varios toasts iguales.
- [ ] **Refetch excesivo por evento WebSocket** (Fase 2.4): en el detalle,
      cada evento recarga `metrics`, `timeseries` e `incidents` del rango
      además del monitor y los checks (3 peticiones extra por evento).
- [ ] **Bundle de `apps/web` > 500 KB** (Fase 2.4, aviso de Vite). Sin
      code-splitting; Recharts es el mayor peso. Primer sitio a mirar si el
      rendimiento de carga importa.
- [ ] **`checks_hourly` no distingue región** (Fase 4.2): uptime % y gráficos
      agregan todas las regiones; no hay uptime por región.
- [ ] **Región con worker caído no cuenta como "down"** (Fase 4.2, conservador
      por diseño): con 2 regiones, si una se calla no se puede declarar caída
      hasta que vuelva. Con 3 regiones se tolera una. Valorar un timeout de
      "región silenciosa" que la excluya del cómputo de R.
- [ ] **Ventana de mantenimiento a mitad de una racha de fallos** (Fase 2.2):
      los fallos anteriores a la ventana siguen contando para el umbral al
      terminar (la racha no se reinicia).
- [ ] **Sin paginación en `GET /monitors` ni en checks/incidentes** (Fase 1.2).
      Con el plan `pro` (50 monitores) y multi-región empieza a importar.
- [ ] **Sin límite de tamaño para `headers`/`body` de un monitor** (Fase 1.2).
- [ ] **Concurrencia del worker solo por instancia** (Fase 2.1):
      `WORKER_CONCURRENCY` no limita el total del sistema.
- [ ] **Sin comando de mantenimiento para schedulers huérfanos** (Fase 2.1).
      El reconcile de arranque crea los que faltan y borra colas de regiones
      retiradas, pero no borra schedulers de monitores que ya no existen (se
      hizo a mano con un script puntual, y otra vez al vaciar usuarios el
      2026-09-21).
- [ ] **Sparklines y gráfico de 24h con resolución horaria** (Fase 2.4): 24
      puntos; no se ven checks individuales.
- [ ] **Sin redirección al cambiar de username** (status pages por usuario,
      2026-09-21): los enlaces antiguos dejan de funcionar (decisión
      consciente; el perfil lo avisa).
- [ ] **Texto "caduca en -4180 días"** para certificados ya caducados (Fase
      3.1). Cosmético.
- [ ] **Auditoría de `handleX` sin `try/catch`** (bug del 2026-09-21): se
      corrigieron los borrados/pausas; no se revisó exhaustivamente el resto
      de componentes en busca de errores que se traguen en silencio.
- [ ] **`tsconfig` raíz con project references** (Fase 0.3): el type-check se
      hace paquete por paquete (`tsc --noEmit -p apps/api`, `-p apps/web`,
      `-p apps/worker`…).
- [ ] **Tag flotante `latest-pg16` de TimescaleDB** en docker-compose (Fase
      0.2): fijar versión exacta antes de desplegar.
- [ ] **`npm audit`: 2 vulnerabilidades** (1 moderada, 1 alta) en
      dependencias de desarrollo del scaffold (Fase 0.1). No explotables en
      local; revisar en la Fase 5.1.
- [ ] **Scripts de instalación de `esbuild` sin aprobar** (`npm warn
      allow-scripts`, Fase 0.1). Funciona igualmente; si aparece "esbuild
      binary not found": `npm approve-scripts esbuild`.

## 3. Cosas que hoy son solo de desarrollo y hay que cerrar antes de desplegar

(Se solapan con la Fase 5.1, pero nacen de fases anteriores.)

- [ ] **CORS `origin: true`** (Fase 1.1): restringir a los dominios reales.
- [ ] **Sin rate limiting en `/auth/login` ni `/auth/register`** (Fase 1.1):
      solo lo tienen `/public/status`, `/auth/username-available`,
      `/invitations/:token` y `/plans`.
- [ ] **Bull Board sin autenticación** en `/admin/queues` (Fase 2.1), solo
      bloqueado por `NODE_ENV !== "production"`.
- [ ] **Contraseña `changeme`** de Postgres en `.env.example` (Fase 0.2).
- [ ] **`ALLOW_PRIVATE_MONITOR_TARGETS`** debe seguir en `false` fuera de
      local (se puso en `true` solo durante la verificación de la Fase 4.2 y
      se restauró).

## 4. Pruebas y proceso

- [ ] **Playwright no está en el repo.** Toda la verificación en navegador
      real (Fases 3–4 y los dos bugs del 2026-09-21) se hizo con scripts en
      el directorio temporal de la sesión (`ui-*.mjs`, `multiregion-test.mjs`,
      `api-*-test.mjs`), que no se conservan. Añadir Playwright como
      `devDependency` y convertir esos scripts en una suite e2e permanente
      (Fase 5.3), incluyendo el servidor `region-target.mjs` que falla según
      la región del User-Agent.
- [ ] **Sin tests unitarios ni de integración** de ningún tipo todavía
      (Fase 5.3): el motor de quórum (`apps/worker/src/lib/health.ts`), las
      reglas de username (`packages/shared/src/username.ts`) y la firma HMAC
      de webhooks son los candidatos más claros.
- [ ] **Sin CI** (Fase 5.4): `tsc`, `eslint` y `vite build` se ejecutan a
      mano.

## 5. Datos y estado actual del entorno

- La base de datos se vació por completo el 2026-09-21 a petición del
  usuario (0 usuarios/organizaciones/monitores); solo quedan los planes
  `free` y `pro` y las migraciones 0000–0012 aplicadas.
- Los cambios de las Fases 3.3-bis (status pages por usuario) y 4 completas
  están **sin commit** (último commit: `FASE 3 COMPLETA`).
