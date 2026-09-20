import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { createLogger } from "@uptimepulse/shared";
import { authRoutes } from "./routes/auth.js";

const logger = createLogger("api");

export async function buildServer() {
  // logger: false porque usamos nuestro propio logger JSON (Fase 0.4) en vez
  // del logger pino por defecto de Fastify.
  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);

  app.setErrorHandler((error: Error, request, reply) => {
    logger.error("error no controlado", { error: error.message, path: request.url });
    reply.code(500).send({ error: "Error interno del servidor" });
  });

  return app;
}
