// IMPORTANTE: primer import a propósito, ver env.ts.
import { env } from "./env.js";
import { createLogger } from "@uptimepulse/shared";
import { pool } from "@uptimepulse/db";
import { createMonitorCheckWorker } from "@uptimepulse/queue";
import { startWorkerHttpServer } from "./http-server.js";
import { processCheckJob } from "./lib/process-check.js";
import { connection, telemetry } from "./runtime.js";

const logger = createLogger("worker");

const httpServer = startWorkerHttpServer();
const worker = createMonitorCheckWorker(connection, env.region, processCheckJob, env.concurrency);

worker.on("failed", (job, error) => {
  telemetry.jobsFailed.inc();
  logger.error("job de check fallido", {
    jobId: job?.id,
    monitorId: job?.data.monitorId,
    error: error.message,
  });
});

logger.info("worker escuchando la cola de checks", {
  region: env.region,
  regions: env.checkRegions,
  quorum: Math.floor(env.checkRegions.length / 2) + 1,
  concurrency: env.concurrency,
  pid: process.pid,
});

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info("apagando worker", { signal });
  await worker.close();
  httpServer.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
