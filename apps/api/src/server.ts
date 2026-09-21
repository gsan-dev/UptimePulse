import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { createLogger } from "@uptimepulse/shared";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { monitorRoutes } from "./routes/monitors.js";
import { notificationChannelRoutes } from "./routes/notification-channels.js";
import { statusPageRoutes } from "./routes/status-pages.js";
import { publicStatusRoutes } from "./routes/public-status.js";
import { monitorCheckQueue } from "./queue.js";
import { attachRealtime } from "./realtime.js";

const logger = createLogger("api");

export async function buildServer() {
  // logger: false porque usamos nuestro propio logger JSON (Fase 0.4) en vez
  // del logger pino por defecto de Fastify.
  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  // "global: false": por defecto ninguna ruta tiene límite — las rutas
  // autenticadas ya están protegidas por exigir un JWT válido. Solo
  // /public/status/:slug (Fase 3.3) declara su propio límite explícito, por
  // ser el único endpoint alcanzable sin iniciar sesión.
  await app.register(rateLimit, { global: false });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(monitorRoutes);
  await app.register(notificationChannelRoutes);
  await app.register(statusPageRoutes);
  await app.register(publicStatusRoutes);

  // Panel de administración de la cola (Fase 2.1), solo en desarrollo — es
  // una herramienta para inspeccionar jobs mientras se programa, no algo
  // que deba quedar expuesto sin autenticación en un despliegue real.
  if (env.nodeEnv !== "production") {
    const serverAdapter = new FastifyAdapter();
    createBullBoard({ queues: [new BullMQAdapter(monitorCheckQueue)], serverAdapter });
    serverAdapter.setBasePath("/admin/queues");
    await app.register(serverAdapter.registerPlugin(), { prefix: "/admin/queues" });
    logger.info("Bull Board disponible en /admin/queues (solo desarrollo)");
  }

  app.setErrorHandler((error: Error, request, reply) => {
    logger.error("error no controlado", { error: error.message, path: request.url });
    reply.code(500).send({ error: "Error interno del servidor" });
  });

  // Socket.io se cuelga del http.Server que Fastify crea internamente en
  // cuanto se instancia (no hace falta esperar a listen()) — Fase 2.3.
  attachRealtime(app.server);

  return app;
}
