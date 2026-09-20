import { desc, eq } from "drizzle-orm";
import { checks, db, monitors } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { runCheckWithRetries } from "./lib/run-check.js";

const logger = createLogger("worker");

async function getLastCheckTimestamp(monitorId: string): Promise<Date | null> {
  const [last] = await db
    .select({ timestamp: checks.timestamp })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last?.timestamp ?? null;
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
    const lastCheckAt = await getLastCheckTimestamp(monitor.id);
    if (!isDue(lastCheckAt, monitor.intervalSeconds)) continue;

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
  }
}
