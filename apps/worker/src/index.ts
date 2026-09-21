// IMPORTANTE: primer import a propósito, ver env.ts.
import { env } from "./env.js";
import { createLogger } from "@uptimepulse/shared";
import { pool } from "@uptimepulse/db";
import { createMonitorCheckWorker, createRedisConnection } from "@uptimepulse/queue";
import { processCheckJob } from "./lib/process-check.js";

const logger = createLogger("worker");

const connection = createRedisConnection(env.redisUrl);
const worker = createMonitorCheckWorker(connection, env.region, processCheckJob, env.concurrency);

worker.on("failed", (job, error) => {
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
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
