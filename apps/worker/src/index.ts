// IMPORTANTE: primer import a propósito, ver env.ts.
import { env } from "./env.js";
import { createLogger } from "@uptimepulse/shared";
import { pool } from "@uptimepulse/db";
import { pollDueMonitors } from "./poller.js";

const logger = createLogger("worker");

logger.info("worker arrancado", { pollIntervalMs: env.pollIntervalMs });

let stopping = false;

async function tick(): Promise<void> {
  try {
    await pollDueMonitors();
  } catch (error) {
    logger.error("error en el ciclo de sondeo", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!stopping) {
    setTimeout(tick, env.pollIntervalMs);
  }
}

void tick();

async function shutdown(signal: string): Promise<void> {
  logger.info("apagando worker", { signal });
  stopping = true;
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
