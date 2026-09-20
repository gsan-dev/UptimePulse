import { desc, eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { checks, db, monitors } from "@uptimepulse/db";
import type { MonitorCheckJobData } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";
import { runCheckWithRetries } from "./run-check.js";
import { notifyTransition } from "./notifications.js";

const logger = createLogger("worker");

interface LastCheck {
  status: "up" | "down";
}

async function getLastCheck(monitorId: string): Promise<LastCheck | null> {
  const [last] = await db
    .select({ status: checks.status })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last ?? null;
}

/**
 * Procesa un job de la cola: ejecuta el check de un monitor y guarda el
 * resultado. Si el monitor ya no existe (se borró) o está pausado (se
 * pausó justo después de que se encolara este job), no hace nada — no es
 * un fallo, solo una carrera normal entre la API (que agenda/quita jobs) y
 * la cola (que puede tener uno ya en vuelo).
 */
export async function processCheckJob(job: Job<MonitorCheckJobData>): Promise<void> {
  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, job.data.monitorId) });
  if (!monitor || monitor.isPaused) {
    return;
  }

  const lastCheck = await getLastCheck(monitor.id);

  const outcome = await runCheckWithRetries({
    id: monitor.id,
    type: monitor.type,
    target: monitor.target,
    method: monitor.method,
    headers: monitor.headers,
    body: monitor.body,
    expectedStatus: monitor.expectedStatus,
    timeoutMs: monitor.timeoutMs,
  });

  await db.insert(checks).values({
    monitorId: monitor.id,
    status: outcome.status,
    responseTimeMs: outcome.responseTimeMs,
    httpStatus: outcome.httpStatus,
    errorMessage: outcome.errorMessage,
  });

  logger.info("check registrado", {
    monitorId: monitor.id,
    name: monitor.name,
    status: outcome.status,
    responseTimeMs: outcome.responseTimeMs,
    errorMessage: outcome.errorMessage,
    pid: process.pid,
  });

  // Transición real (up->down o down->up), no el primer check de la vida
  // del monitor (no hay "anterior" con el que compararlo todavía).
  if (lastCheck && lastCheck.status !== outcome.status) {
    try {
      await notifyTransition(
        { id: monitor.id, name: monitor.name, target: monitor.target, organizationId: monitor.organizationId },
        outcome
      );
    } catch (error) {
      logger.error("no se pudo enviar la notificación de cambio de estado", {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
