# UptimePulse — Plataforma de Monitorización de Uptime y Salud de Servicios

> Una alternativa ligera y asequible a Pingdom/Datadog/UptimeRobot, pensada para desarrolladores independientes, freelancers y startups pequeñas que necesitan saber si sus servicios están caídos sin pagar precios de nivel enterprise.

---

## 1. Descripción del proyecto

**UptimePulse** es una aplicación web tipo SaaS que permite a un usuario registrar URLs, APIs o servicios y monitorizarlos de forma continua. El sistema realiza comprobaciones periódicas (HTTP, TCP, SSL), detecta caídas y recuperaciones, calcula métricas de disponibilidad y rendimiento, y notifica al usuario por email, SMS o webhook cuando algo falla.

El proyecto está compuesto por dos partes claramente diferenciadas:

- **Servidor (backend):** API REST + WebSockets, cola de trabajos, workers que ejecutan los checks, base de datos de series temporales y motor de alertas.
- **Cliente (frontend):** dashboard web donde el usuario ve el estado de sus monitores en tiempo real, histórico de disponibilidad, gráficos de latencia y configuración de alertas.

### Problema que resuelve

Los desarrolladores independientes y las startups pequeñas necesitan saber si su web, API o servicio backend está caído, pero las herramientas actuales del mercado:

- Cobran precios pensados para empresas grandes (Datadog, Pingdom).
- Tienen planes gratuitos muy limitados (pocos monitores, intervalos de chequeo largos).
- Incluyen funcionalidades innecesarias para alguien que solo quiere saber "¿está mi web arriba o no?".

UptimePulse ofrece lo esencial —monitorización fiable, alertas rápidas y visibilidad clara— sin la complejidad ni el coste de las plataformas grandes.

### Por qué este proyecto tiene valor como pieza de portfolio

No es un CRUD más. Obliga a diseñar y justificar decisiones de:
- Sistemas distribuidos a pequeña escala (colas de trabajo, workers desacoplados).
- Almacenamiento y agregación de datos de series temporales.
- Comunicación en tiempo real cliente-servidor (WebSockets).
- Lógica de negocio no trivial (detección de incidentes, evitar falsos positivos, cálculo de SLA/uptime %).
- Integraciones externas (email, SMS, webhooks).

---

## 2. Funcionalidades

### 2.1 Gestión de monitores
- Crear, editar, pausar y eliminar monitores.
- Tipos de check soportados: HTTP/HTTPS, TCP (puerto), ping ICMP.
- Configuración por monitor: URL/host, método HTTP, headers personalizados, body (para POST), código de estado esperado, intervalo de chequeo (30s / 1min / 5min / 15min según plan), timeout.
- Etiquetas/proyectos para agrupar monitores (ej. "Producción", "Staging", "API cliente X").

### 2.2 Motor de comprobación (checks)
- Workers independientes que ejecutan los checks según su intervalo configurado.
- Reintentos automáticos antes de marcar un monitor como caído (evita falsos positivos por errores de red puntuales).
- Registro de cada check: timestamp, estado (up/down), tiempo de respuesta, código de estado HTTP, mensaje de error si aplica.
- Verificación de certificados SSL: aviso cuando un certificado está próximo a expirar (30/15/7 días antes).

### 2.3 Gestión de incidentes
- Agrupación automática de checks fallidos consecutivos en un "incidente" (con hora de inicio, hora de resolución y duración).
- Historial de incidentes por monitor, con línea temporal visual.
- Cálculo automático de:
  - % de uptime (día / semana / mes / histórico total).
  - Tiempo medio de respuesta.
  - Tiempo medio de resolución de incidentes (MTTR).

### 2.4 Alertas y notificaciones
- Canales soportados: email, SMS (vía Twilio), webhook genérico, integración directa con Slack/Discord.
- Notificación automática al caer un monitor y al recuperarse.
- Configuración de qué canales se usan para cada monitor (no todos los monitores necesitan SMS, por ejemplo).
- Resumen semanal por email con el estado general de todos los monitores.

### 2.5 Dashboard en tiempo real
- Vista general con el estado de todos los monitores (arriba/abajo/degradado) actualizada por WebSocket sin recargar la página.
- Gráficos de latencia y disponibilidad por monitor, con rangos de tiempo seleccionables (24h / 7d / 30d / 90d).
- Vista de detalle de cada monitor con su historial de checks e incidentes.

### 2.6 Páginas de estado públicas (status pages)
- El usuario puede publicar una página pública (URL tipo `estado.tuempresa.com` o `uptimepulse.app/status/tu-proyecto`) mostrando el estado de los servicios que decida hacer visibles, sin exponer datos sensibles de su cuenta.
- Útil para que una startup muestre transparencia a sus propios clientes.

### 2.7 Cuentas y equipos
- Registro/login con email y contraseña (y opcionalmente OAuth con GitHub/Google).
- Planes con límites distintos (nº de monitores, intervalo mínimo de chequeo, canales de alerta disponibles) — aunque sea un proyecto de portfolio, modelar planes de suscripción es un buen ejercicio de diseño de producto.
- Equipos/organizaciones con roles (admin, editor, solo lectura) — funcionalidad de la fase 2.

---

## 3. Diseño y experiencia de usuario

La estética general debe transmitir **fiabilidad, claridad y calma** — es una herramienta que la gente mira cuando algo puede estar fallando, así que el diseño no debe añadir ruido ni ansiedad innecesaria. Referencias de estilo: Linear, Vercel, Better Stack (antes Better Uptime).

### Paleta y tono visual
- Fondo oscuro por defecto (modo claro como alternativa), con acentos de color reservados exclusivamente para estados:
  - Verde: operativo.
  - Ámbar: degradado/lento.
  - Rojo: caído.
  - Gris: pausado/sin datos.
- Tipografía sans-serif limpia (Inter o similar), con buena jerarquía entre números grandes (métricas) y texto de apoyo.
- Uso generoso de espacio en blanco (o "negro", en modo oscuro) — evitar dashboards sobrecargados.

### 3.1 Página de aterrizaje (landing, pública)
- Hero claro: titular de una frase explicando el problema ("Entérate antes que tus usuarios de que algo se ha caído"), subtítulo, CTA de registro.
- Sección de captura de pantalla del dashboard real (no ilustraciones genéricas).
- Sección de características (3-4 columnas: monitorización HTTP, alertas multicanal, status pages, tiempo real).
- Tabla de precios simple (Free / Pro / Team).
- Footer minimalista.

### 3.2 Dashboard principal (vista general, autenticado)
- Barra lateral fija con navegación: Monitores, Incidentes, Status Pages, Alertas, Ajustes.
- Cabecera con resumen agregado: nº de monitores operativos vs caídos, uptime medio global, incidentes activos (destacado en rojo si hay alguno).
- Listado de monitores en formato de tarjetas o tabla compacta, cada uno mostrando:
  - Nombre y URL.
  - Indicador de estado (punto de color + texto).
  - Mini-gráfico de las últimas 24h (sparkline).
  - Tiempo de respuesta actual.
  - Uptime % del período seleccionado.
- Todo debe actualizarse en vivo (WebSocket) — un monitor que cae debe reflejarse sin recargar.

### 3.3 Vista de detalle de un monitor
- Cabecera con nombre, URL, estado actual grande y claro.
- Selector de rango temporal (24h / 7d / 30d / 90d).
- Gráfico principal de tiempo de respuesta a lo largo del tiempo (línea), con zonas sombreadas en rojo donde hubo caídas.
- Tabla/lista de incidentes recientes (inicio, duración, resolución).
- Panel lateral con configuración del monitor (editable in-line).

### 3.4 Página de incidentes
- Línea temporal cronológica de todos los incidentes de todos los monitores.
- Filtro por monitor, por rango de fechas, por estado (resuelto/activo).

### 3.5 Configuración de alertas
- Lista de canales configurados (email, SMS, webhook) con posibilidad de añadir nuevos.
- Matriz simple: qué monitores notifican por qué canal.

### 3.6 Status page pública
- Diseño completamente distinto (sin sidebar ni UI de gestión): una página limpia, de una sola columna, mostrando el nombre del proyecto, un indicador general ("Todos los sistemas operativos" en verde, o detalle de qué falla), y una lista de servicios con su estado e histórico de los últimos 90 días en forma de barras (como GitHub Status o Stripe Status).

### 3.7 Componentes reutilizables a diseñar
- Badge de estado (up/down/degraded/paused).
- Sparkline de latencia.
- Gráfico de barras de uptime histórico (estilo "calendario de disponibilidad").
- Toast/notificación en tiempo real cuando cambia el estado de un monitor mientras el usuario está viendo el dashboard.

---

## 4. Arquitectura técnica (resumen)

```
Cliente (React) ──REST/WebSocket──► API Server ──► PostgreSQL (+ TimescaleDB)
                                         │
                                         ▼
                                  Cola (Redis/BullMQ)
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                          Worker 1              Worker N
                       (ejecuta checks)     (ejecuta checks)
                                         │
                                         ▼
                               Servicio de alertas
                          (email / SMS / webhook)
```

**Stack sugerido:**
- Backend: Node.js (Express/Fastify) o Python (FastAPI)
- Cola: Redis + BullMQ (o Celery + Redis)
- Base de datos: PostgreSQL + extensión TimescaleDB
- Frontend: React + TailwindCSS + Recharts
- Tiempo real: WebSockets (Socket.io)
- Alertas: Nodemailer/Resend (email), Twilio (SMS), fetch a webhooks
- Infraestructura: Docker Compose en desarrollo, despliegue en VPS o Fly.io/Railway

---

## 5. Roadmap por fases

| Fase | Contenido |
|---|---|
| **Fase 1 — MVP** | Auth, CRUD de monitores, worker simple con checks HTTP, dashboard básico, alertas por email |
| **Fase 2** | Cola de trabajo real (Redis/BullMQ), lógica de incidentes, WebSockets para tiempo real |
| **Fase 3** | SSL check, webhooks/SMS, status pages públicas |
| **Fase 4** | Equipos/roles, checks multi-región, planes de suscripción con límites |

---

## 6. Estructura de carpetas propuesta

```
uptimepulse/
├── apps/
│   ├── api/            # Servidor REST + WebSocket
│   ├── worker/         # Proceso de checks (independiente del API)
│   └── web/            # Cliente React
├── packages/
│   └── shared/         # Tipos e interfaces compartidas (TS)
├── docker-compose.yml
└── README.md
```

---

## 7. Próximos pasos

1. Definir el esquema de base de datos (migraciones).
2. Levantar el esqueleto del backend (API + auth).
3. Construir el worker más simple posible (un ping cada minuto guardado en DB).
4. Conectar un dashboard mínimo que lea esos datos.
5. Iterar añadiendo cola de trabajo, tiempo real y alertas.