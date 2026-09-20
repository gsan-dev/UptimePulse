import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { createLogger } from "@uptimepulse/shared";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { monitorRoutes } from "./routes/monitors.js";
import { monitorCheckQueue } from "./queue.js";

const logger = createLogger("api");

export async function buildServer() {
  // logger: false porque usamos nuestro propio logger JSON (Fase 0.4) en vez
  // del logger pino por defecto de Fastify.
  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(monitorRoutes);

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

  return app;
}
