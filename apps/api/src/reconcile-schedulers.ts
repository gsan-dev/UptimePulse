import { eq } from "drizzle-orm";
import { db, monitors } from "@uptimepulse/db";
import { upsertMonitorScheduler } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";
import { monitorCheckQueue } from "./queue.js";

const logger = createLogger("api");

/**
 * Al arrancar la API, asegura que todo monitor activo tiene un job
 * programado en la cola — necesario para monitores creados antes de migrar
 * a BullMQ (Fase 2.1), o si Redis se reinició y perdió sus schedulers.
 * `upsertMonitorScheduler` es idempotente (no dispara un check inmediato),
 * así que repetir esto en cada arranque no genera ninguna ráfaga de checks.
 */
export async function reconcileMonitorSchedulers(): Promise<void> {
  const activeMonitors = await db.query.monitors.findMany({ where: eq(monitors.isPaused, false) });
  for (const monitor of activeMonitors) {
    await upsertMonitorScheduler(monitorCheckQueue, monitor.id, monitor.intervalSeconds);
  }
  logger.info("schedulers de monitores reconciliados", { count: activeMonitors.length });
}
