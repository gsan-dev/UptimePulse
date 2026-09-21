import { eq } from "drizzle-orm";
import { db, monitors } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { regionQueues } from "./queue.js";

const logger = createLogger("api");

/**
 * Al arrancar la API, asegura que todo monitor activo tiene un job
 * programado en la cola de CADA región configurada — necesario para
 * monitores creados antes de migrar a BullMQ (Fase 2.1), si Redis se
 * reinició y perdió sus schedulers, o si se añadió una región nueva a
 * CHECK_REGIONS (Fase 4.2). `upsertMonitorScheduler` es idempotente (no
 * dispara un check inmediato), así que repetir esto en cada arranque no
 * genera ninguna ráfaga de checks.
 *
 * También limpia lo que ya no debe existir: la cola anterior a la Fase 4.2
 * ("monitor-checks" sin región) y las colas de regiones retiradas de la
 * configuración, cuyos schedulers seguirían encolando jobs sin consumidor.
 */
export async function reconcileMonitorSchedulers(): Promise<void> {
  if (await regionQueues.removeLegacyQueue()) {
    logger.info("cola antigua 'monitor-checks' (sin región) eliminada");
  }
  const stale = await regionQueues.removeQueuesForUnknownRegions();
  if (stale.length > 0) {
    logger.info("colas de regiones retiradas eliminadas", { regions: stale });
  }
  await regionQueues.rememberRegions();

  const activeMonitors = await db.query.monitors.findMany({ where: eq(monitors.isPaused, false) });
  for (const monitor of activeMonitors) {
    await regionQueues.upsertMonitorScheduler(monitor.id, monitor.intervalSeconds);
  }
  logger.info("schedulers de monitores reconciliados", {
    count: activeMonitors.length,
    regions: regionQueues.regions,
  });
}
