# TODO — pendientes de las Fases 0 a 4

> Todo lo que quedó sin hacer, a medias o simplificado a propósito en las
> fases ya cerradas (0–6). Cada punto dice de dónde sale (fase / entrada
> del DIARIO) para poder buscar el contexto. Actualizado el 2026-09-22 al
> cerrar la Fase 6: etiquetas, formulario HTTP completo, edición completa del
> monitor, ventanas de mantenimiento, línea temporal de incidentes, uptime
> «histórico total», status pages editables con nombre público y URL propia
> por organización, y cierre de sesión por inactividad.

## 1. Funcionalidad pendiente (cosas que el README promete y no existen)

- [ ] **SMS vía Twilio** (Fase 3.2, README §2.4). Pospuesto por decisión
      explícita: no hay cuenta de Twilio para verificarlo de verdad. El enum
      `channel_type` ya tiene `sms`, pero ni la API ni la UI permiten crear
      ese canal ni el worker sabe enviarlo. Al retomarlo: `packages/notify-channels/src/sms.ts`, zod en
      `routes/notification-channels.ts`, opción en `NotificationChannelsPage`.
- [x] ~~**Checks de tipo `ping` (ICMP)**~~ Hecho el 2026-09-21 invocando el
      `ping` del sistema (ADR en TASK.md). Verificado en Windows y, en 5.4,
      en Linux (contenedor Alpine con `iputils-ping`, usuario `node`).
      macOS sigue sin probar.
- [x] ~~**Stripe real**~~ Ya no aplica: los planes de pago y los límites de
      uso se retiraron el 2026-09-22 (tabla `plans` eliminada en la migración 0014).
- [ ] **OAuth con GitHub/Google** (Fase 1.1, README §2.7). Las columnas
      `oauth_provider`/`oauth_id` existen desde la Fase 0.3; no hay flujo.
- [ ] **Resumen semanal por email** (Fase 1.5, README §2.4). No existe; es un
      job periódico aparte (BullMQ con patrón cron), no ligado a transiciones.
- [x] ~~**Etiquetas/proyectos para agrupar monitores**~~ Hecho el 2026-09-22:
      se escriben como "chips" en el formulario (con sugerencias de las que ya
      existen), se ven en el dashboard y en el detalle, y el dashboard filtra
      por ellas en Y (`lib/tags.ts`, `components/TagFilter.tsx`).
- [x] ~~**Método HTTP, headers personalizados y body en el formulario**~~ Hecho
      el 2026-09-22, en un bloque plegable ("Petición HTTP") que se abre solo
      si el monitor ya trae algo dentro. El body solo aparece para los métodos
      que lo admiten. El detalle enseña además la petición real que se manda.
- [x] ~~**Edición completa del monitor**~~ Hecho el 2026-09-22: alta y edición
      comparten el mismo formulario (`components/MonitorFormFields.tsx`), que es
      lo que impedía que se fueran separando. Solo el tipo queda bloqueado
      (cambiarlo cambiaría el significado del histórico de checks). El PATCH
      acepta `null` para vaciar los campos de HTTP y valida el `target` contra
      el tipo del monitor (antes un target inválido daba un 500).
- [x] ~~**UI de ventanas de mantenimiento**~~ Hecha el 2026-09-22 en el detalle
      del monitor (`components/MaintenanceWindowsSection.tsx`): lista con su
      estado (en curso / programada / terminada) y alta con fechas locales.
      Sigue sin haber edición porque el backend tampoco la ofrece: se borra y
      se vuelve a crear.
- [x] ~~**Línea temporal visual de incidentes**~~ Hecha el 2026-09-22
      (`components/IncidentTimeline.tsx`): una barra que representa el rango
      elegido con un tramo rojo por caída, y debajo la lista con duraciones.
      Es por monitor; la línea temporal de TODOS los monitores a la vez
      (README §2.6) sigue sin existir.
- [x] ~~**Uptime "histórico total"**~~ Hecho el 2026-09-22: rango `all` en la
      API y botón "Todo" en el selector. El uptime % lo cubre entero
      (`checks_hourly` no caduca); el tiempo de respuesta medio se queda en los
      90 días de retención de `checks` en crudo, y la serie temporal pasa a un
      punto por día para no devolver miles de puntos.
- [x] ~~**Status pages: editar la lista de monitores tras crearla**~~ Hecho el
      2026-09-22: cada página tiene "Editar" (título, visibilidad y monitores).
      Al abrirlo se pide el detalle, porque el listado no trae los monitores y
      guardar sin ellos los habría borrado.
- [x] ~~**Status pages: `displayName` por monitor**~~ Hecho el 2026-09-22. La
      API acepta `monitors: [{ id, displayName }]` además del antiguo
      `monitorIds`, y el selector de monitores tiene un campo de nombre público
      por cada uno.
- [x] ~~**Status pages para organizaciones de equipo**~~ Hecho el 2026-09-22
      con `organizations.slug` (migración 0015) y una SEGUNDA ruta,
      `/status/team/<org-slug>/<page-slug>`, para no romper los enlaces ya
      compartidos. "team" pasa a estar reservado como nombre de usuario para
      que la ruta no sea ambigua. Un admin lo configura en /team; al
      registrarse, la organización nace con el username como slug.
- [ ] **Alertas por rol** (Fase 4.1). Los emails de caída/recuperación van a
      todos los miembros de la organización, sin filtrar por rol ni permitir
      que un miembro se desuscriba.
- [x] ~~**API keys**~~ Hecho en la Fase 5.1: API + página `/api-keys`.
- [ ] **Estado "degradado" por latencia** (README §2.5). Hoy "degradado" solo
      significa "alguna región lo ve caído" (Fase 4.2); no existe umbral de
      tiempo de respuesta configurable por monitor.
- [ ] **Página "olvidé mi contraseña" y verificación de email** (Fase 1.4).
- [ ] **Cerrar sesión en todos los dispositivos / revocar refresh tokens**
      (Fase 1.1). Sigue sin haber tabla de refresh tokens. Desde el
      2026-09-22 uno filtrado ya no vale 7 días sino la ventana de inactividad
      (`SESSION_IDLE_TIMEOUT_MINUTES`, 15 min), pero quien lo tenga puede irlo
      renovando mientras siga siendo válido: revocar de verdad sigue pendiente.

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
      Sin límite de monitores por organización, empieza a importar.
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
- [x] ~~**`tsconfig` raíz con project references**~~ Hecho en 5.3: `npm run typecheck` recorre los 9 proyectos (sin project references, por paquete).
- [x] ~~**Tag flotante `latest-pg16` de TimescaleDB**~~ Hecho en 5.4: `2.30.1-pg16` en desarrollo, producción y CI.
- [ ] **`npm audit`: 2 vulnerabilidades** (1 moderada, 1 alta) en
      dependencias de desarrollo del scaffold (Fase 0.1). No explotables en
      local; revisar en la Fase 5.1.
- [ ] **Scripts de instalación de `esbuild` sin aprobar** (`npm warn
      allow-scripts`, Fase 0.1). Funciona igualmente; si aparece "esbuild
      binary not found": `npm approve-scripts esbuild`.

## 3. Cosas que hoy son solo de desarrollo y hay que cerrar antes de desplegar

(Se solapan con la Fase 5.1, pero nacen de fases anteriores.)

- [x] ~~**CORS `origin: true`**~~ Hecho en 5.1: `CORS_ORIGINS`.
- [x] ~~**Sin rate limiting en `/auth/login` ni `/auth/register`**~~ Hecho en 5.1: 10/min por IP + límite global.
- [ ] **Bull Board sin autenticación** en `/admin/queues` (Fase 2.1), solo
      bloqueado por `NODE_ENV !== "production"`.
- [ ] **Contraseña `changeme`** de Postgres en `.env.example` (Fase 0.2).
- [ ] **`ALLOW_PRIVATE_MONITOR_TARGETS`** debe seguir en `false` fuera de
      local (se puso en `true` solo durante la verificación de la Fase 4.2 y
      se restauró).

## 4. Pruebas y proceso

- [x] ~~**Playwright no está en el repo.**~~ Hecho en 5.3: `e2e/` con `@playwright/test`. (Los scripts de región/quórum siguen sin suite permanente: ver abajo.)
- [x] ~~**Sin tests unitarios ni de integración**~~ Hecho en 5.3: 104 tests.
- [x] ~~**Sin CI**~~ Hecho en 5.4 (escrita y validada en local; primera ejecución real pendiente del primer push).

## 5. Nuevos pendientes que deja la Fase 5

- [ ] **Ejecutar la CI en GitHub** (5.4): el workflow está validado en local
      pero no ha corrido nunca en Actions; hacer push a `dev` y revisar la
      primera ejecución. Después, activar "Require status checks" (`test`,
      `e2e`) en la protección de rama.
- [ ] **OpenAPI manual** (5.5): `docs/openapi.yaml` no se genera del
      código; al añadir/cambiar rutas hay que editarla. Alternativa:
      `fastify-type-provider-zod` + `@fastify/swagger` dinámico.
- [ ] **Sin cobertura de tests** (5.3): añadir `@vitest/coverage-v8` y un
      umbral en CI.
- [ ] **E2E incompleto** (5.3): con la Fase 6 son dos flujos
      (`critical-flow` y `monitor-and-status-pages`), pero equipos, canales y
      multi-región siguen solo con tests de API/integración, y el escenario de
      quórum con dos workers reales (`multiregion-test.mjs`, Fase 4.2) sigue
      sin suite permanente.
- [ ] **Prometheus/Grafana no incluidos** (5.2): las métricas se exponen
      pero nadie las recoge; un `prometheus.yml` con dos targets bastaría.
- [ ] **Cuota por host con ventana fija** (5.1): permite hasta 2× el límite
      a caballo de dos ventanas.
- [ ] **Fly.io documentado pero no ejecutado** (5.4).
- [ ] **Imágenes con tsx** (5.4): 568 MB la API; una build con `tsc` y
      `dist/` la reduciría bastante.

## 5 bis. Nuevos pendientes que deja la Fase 6

- [ ] **Sin orden en los monitores de una status page**:
      `status_page_monitors` no tiene columna de posición, así que la página
      pública los enseña en el orden que devuelva Postgres. Si importa,
      hace falta una columna `position` y arrastrar en la UI.
- [ ] **Etiquetas sin renombrar ni borrar en bloque**: viven en el `jsonb` de
      cada monitor, así que cambiar "produccion" por "producción" hay que
      hacerlo monitor a monitor. Las sugerencias del formulario reducen el
      problema pero no lo quitan.
- [ ] **Filtro por etiqueta solo en el cliente**: `GET /monitors` no acepta
      `?tag=`; con muchos monitores (y cuando haya paginación) habrá que
      moverlo al servidor.
- [ ] **Ventanas de mantenimiento sin editar ni repetir**: solo crear y
      borrar, y siempre de una vez (no hay "todos los martes a las 3").
- [ ] **E2E sin cubrir el cierre por inactividad**: el resto de la Fase 6 sí
      tiene suite (`e2e/monitor-and-status-pages.spec.ts`), pero la caducidad
      de la sesión se verificó a mano arrancando la API con
      `SESSION_IDLE_TIMEOUT_MINUTES=1`; como test permanente tardaría minutos,
      haría falta poder acortar la ventana desde el propio test.
- [ ] **La pila de Docker y el desarrollo en local no conviven**: desde que
      `docker compose up` levanta también API, worker y web, sus puertos
      (`API_PORT`, `WORKER_HTTP_PORT`) chocan con `npm run dev:api` /
      `dev:worker`. Hay que elegir: o el stack entero, o
      `docker compose up postgres redis mailpit` + los procesos en la
      máquina. Se podría resolver con un perfil de Compose o con puertos
      distintos por defecto para cada modo.
- [ ] **`npm test` / `npm run test:e2e` con el stack de Docker levantado**:
      los tests de integración usan la base `uptimepulse_test` del mismo
      Postgres (funciona), pero los E2E esperan la API en `API_PORT` servida
      por `npm run dev:api`, así que con el stack arriba atacan la API del
      contenedor sin querer. `e2e-docker/` es el que sí está pensado para el
      stack (`playwright.docker.config.ts`).
- [ ] **Sesión: sin aviso previo a caducar**. A los 15 minutos la sesión se
      cierra sin avisar antes ("te quedan 60 s, ¿sigues ahí?"), y una segunda
      pestaña abierta no se entera hasta su propio tick (15 s). Un canal
      `BroadcastChannel` entre pestañas lo arreglaría.

## 6. Datos y estado actual del entorno

- La base de datos se vació por completo el 2026-09-21 a petición del
  usuario; la tabla `plans` desapareció el 2026-09-22 (migración 0014).
- La Fase 6 está **sin commit**; el último commit es `self-host`.
- La migración 0015 (`organizations.slug`) está aplicada en la base de
  desarrollo y en `uptimepulse_test`.
- Existe la base `uptimepulse_test` (la crean los tests de integración).
