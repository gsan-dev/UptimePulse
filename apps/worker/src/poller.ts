import { desc, eq } from "drizzle-orm";
import { checks, db, monitors } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { runCheckWithRetries } from "./lib/run-check.js";
import { notifyTransition } from "./lib/notifications.js";

const logger = createLogger("worker");

interface LastCheck {
  timestamp: Date;
  status: "up" | "down";
}

async function getLastCheck(monitorId: string): Promise<LastCheck | null> {
  const [last] = await db
    .select({ timestamp: checks.timestamp, status: checks.status })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last ?? null;
}

function isDue(lastCheckAt: Date | null, intervalSeconds: number): boolean {
  if (!lastCheckAt) return true;
  const dueAt = lastCheckAt.getTime() + intervalSeconds * 1000;
  return Date.now() >= dueAt;
}

/**
 * Recorre los monitores activos y ejecuta el check de los que ya les toque,
 * según su `intervalSeconds`.
 *
 * Enfoque deliberadamente simple para el MVP: una consulta N+1 (una por
 * monitor) en cada ciclo, en vez de una única query con JOIN LATERAL. Con el
 * límite del plan free (5 monitores) esto es intrascendente en rendimiento;
 * la Fase 2.1 lo sustituye por completo con jobs de BullMQ programados por
 * monitor, que no necesitan "preguntar" quién le toca en cada ciclo.
 */
export async function pollDueMonitors(): Promise<void> {
  const activeMonitors = await db.query.monitors.findMany({ where: eq(monitors.isPaused, false) });

  for (const monitor of activeMonitors) {
    const lastCheck = await getLastCheck(monitor.id);
    if (!isDue(lastCheck?.timestamp ?? null, monitor.intervalSeconds)) continue;

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
}
