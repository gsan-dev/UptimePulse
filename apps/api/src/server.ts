import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { sql } from "drizzle-orm";
import { db } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { env } from "./env.js";
import { createApiTelemetry } from "./lib/telemetry.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { authRoutes } from "./routes/auth.js";
import { docsRoutes } from "./routes/docs.js";
import { monitorRoutes } from "./routes/monitors.js";
import { notificationChannelRoutes } from "./routes/notification-channels.js";
import { invitationRoutes, organizationRoutes } from "./routes/organizations.js";
import { statusPageRoutes } from "./routes/status-pages.js";
import { publicStatusRoutes } from "./routes/public-status.js";
import { redisConnection, regionQueues } from "./queue.js";
import { attachRealtime } from "./realtime.js";

const logger = createLogger("api");

const REQUEST_ID_HEADER = "x-request-id";
// Un request id externo se acepta solo si tiene pinta de id (así no acaba
// basura arbitraria del cliente en los logs); si no, se genera uno.
const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{8,128}$/;

export async function buildServer() {
  const telemetry = createApiTelemetry();

  const app = Fastify({
    // logger: false porque usamos nuestro propio logger JSON (Fase 0.4) en vez
    // del logger pino por defecto de Fastify.
    logger: false,
    // Correlación de logs (Fase 5.2): cada petición lleva un id que se
    // devuelve en la respuesta y aparece en todas sus líneas de log. Si el
    // cliente (o un proxy) manda X-Request-Id, se respeta.
    genReqId: (req) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      const value = Array.isArray(incoming) ? incoming[0] : incoming;
      return value && REQUEST_ID_REGEX.test(value) ? value : randomUUID();
    },
    // Detrás de un proxy (Fly, Railway, nginx) la IP real viene en
    // X-Forwarded-For; sin esto el rate limit por IP contaría al proxy.
    trustProxy: env.nodeEnv === "production",
  });

  // Cabeceras de seguridad estándar (Fase 5.1). Sin CSP: esta API sirve
  // JSON, no HTML; las dos páginas que sirve (Swagger UI en /docs y Bull
  // Board en desarrollo) necesitan scripts inline, y la CSP del frontend la
  // pone quien sirve el frontend (nginx, ver apps/web/Dockerfile).
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
  await app.register(cookie);
  await app.register(cors, { origin: env.corsOrigins, credentials: true });
  // Límite global por IP (Fase 5.1): protege toda la API de abuso, incluidas
  // las rutas autenticadas. Con API key se cuenta por clave, no por IP (una
  // integración detrás de un NAT no debe agotar la cuota de las demás). Las
  // rutas públicas y login/registro declaran límites más estrictos propios.
  await app.register(rateLimit, {
    global: true,
    max: env.apiRateLimitPerMinute,
    timeWindow: "1 minute",
    // Contadores en Redis, no en memoria: así el límite es el mismo aunque
    // haya varias instancias de la API detrás de un balanceador.
    redis: redisConnection,
    keyGenerator: (request) => {
      const header = request.headers.authorization;
      if (header?.startsWith("Bearer up_")) {
        return `key:${header.slice("Bearer ".length, "Bearer ".length + 20)}`;
      }
      return request.ip;
    },
    // El plugin LANZA lo que devuelve esta función, así que tiene que ser un
    // Error con statusCode para que el error handler responda 429 con el
    // mismo formato { error } del resto de la API.
    errorResponseBuilder: (_request, context) => {
      const error = new Error(
        `Demasiadas peticiones: máximo ${context.max} por ${context.after}. Vuelve a intentarlo en unos segundos.`
      ) as Error & { statusCode: number };
      error.statusCode = context.statusCode;
      return error;
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  // Una línea de log por petición, con el id de correlación, la ruta
  // (plantilla, no URL concreta: no queremos ids de monitores en las
  // etiquetas de Prometheus) y la duración.
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    if (route === "/health" || route === "/metrics") return;
    const durationMs = Math.round(reply.elapsedTime);
    telemetry.httpRequestsTotal.inc({ method: request.method, route, status: String(reply.statusCode) });
    telemetry.httpRequestDuration.observe({ method: request.method, route }, durationMs / 1000);
    logger.info("petición atendida", {
      requestId: request.id,
      method: request.method,
      route,
      url: request.url,
      status: reply.statusCode,
      durationMs,
      ip: request.ip,
      userId: request.user?.id,
      apiKeyId: request.apiKey?.id,
    });
  });

  // Health real (Fase 5.2): comprueba que Postgres y Redis responden, no
  // solo que el proceso está vivo. 503 si falla alguno.
  app.get("/health", { config: { rateLimit: false } }, async (_request, reply) => {
    const checks = { db: "ok", redis: "ok" };
    try {
      await db.execute(sql`select 1`);
    } catch (error) {
      checks.db = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      await redisConnection.ping();
    } catch (error) {
      checks.redis = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const ok = checks.db === "ok" && checks.redis === "ok";
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", ...checks });
  });

  app.get("/metrics", { config: { rateLimit: false } }, async (request, reply) => {
    if (env.metricsToken && request.headers.authorization !== `Bearer ${env.metricsToken}`) {
      return reply.code(401).send({ error: "No autenticado" });
    }
    return reply.type(telemetry.registry.contentType).send(await telemetry.registry.metrics());
  });

  // Antes de registrar las rutas: los plugins hijos copian el error handler
  // del padre al registrarse, así que si se define después no les aplica
  // (los 429/400 de las rutas saldrían con el formato por defecto de Fastify).
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    // Los errores que Fastify ya clasifica (rate limit 429, JSON inválido
    // 400, payload demasiado grande 413…) se devuelven con su código; solo
    // lo inesperado es un 500.
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    logger.error("error no controlado", { requestId: request.id, error: error.message, path: request.url });
    reply.code(500).send({ error: "Error interno del servidor" });
  });

  await app.register(docsRoutes);
  await app.register(authRoutes);
  await app.register(organizationRoutes);
  await app.register(invitationRoutes);
  await app.register(apiKeyRoutes);
  await app.register(monitorRoutes);
  await app.register(notificationChannelRoutes);
  await app.register(statusPageRoutes);
  await app.register(publicStatusRoutes);

  // Panel de administración de la cola (Fase 2.1), solo en desarrollo — es
  // una herramienta para inspeccionar jobs mientras se programa, no algo
  // que deba quedar expuesto sin autenticación en un despliegue real.
  if (env.nodeEnv !== "production") {
    const serverAdapter = new FastifyAdapter();
    createBullBoard({ queues: regionQueues.all().map((queue) => new BullMQAdapter(queue)), serverAdapter });
    serverAdapter.setBasePath("/admin/queues");
    await app.register(serverAdapter.registerPlugin(), { prefix: "/admin/queues" });
    logger.info("Bull Board disponible en /admin/queues (solo desarrollo)");
  }

  // Socket.io se cuelga del http.Server que Fastify crea internamente en
  // cuanto se instancia (no hace falta esperar a listen()) — Fase 2.3.
  attachRealtime(app.server);

  return app;
}
