import http from "node:http";
import { sql } from "drizzle-orm";
import { db } from "@uptimepulse/db";
import { createMonitorCheckQueue } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";
import { env } from "./env.js";
import { connection, telemetry } from "./runtime.js";

const logger = createLogger("worker");

/**
 * Servidor HTTP mínimo del worker (Fase 5.2): /health (Postgres + Redis) y
 * /metrics (Prometheus). Sin framework: dos rutas no justifican Fastify en
 * un proceso cuyo trabajo es consumir una cola.
 */
export function startWorkerHttpServer(): http.Server {
  const queue = createMonitorCheckQueue(connection, env.region);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/health") {
        const checks = { db: "ok", redis: "ok" };
        try {
          await db.execute(sql`select 1`);
        } catch (error) {
          checks.db = `error: ${error instanceof Error ? error.message : String(error)}`;
        }
        try {
          await connection.ping();
        } catch (error) {
          checks.redis = `error: ${error instanceof Error ? error.message : String(error)}`;
        }
        const ok = checks.db === "ok" && checks.redis === "ok";
        res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: ok ? "ok" : "degraded", region: env.region, ...checks }));
        return;
      }
      if (url.pathname === "/metrics") {
        if (env.metricsToken && req.headers.authorization !== `Bearer ${env.metricsToken}`) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "No autenticado" }));
          return;
        }
        await telemetry.refreshQueueGauge(queue);
        res.writeHead(200, { "content-type": telemetry.registry.contentType });
        res.end(await telemetry.registry.metrics());
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "No encontrado" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.listen(env.httpPort, "0.0.0.0", () => {
    logger.info("servidor HTTP del worker escuchando", {
      port: env.httpPort,
      endpoints: ["/health", "/metrics"],
    });
  });
  return server;
}
