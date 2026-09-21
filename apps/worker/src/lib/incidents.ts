import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { checks, db, incidents, maintenanceWindows } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";

const logger = createLogger("worker");

export interface IncidentTransition {
  opened: boolean;
  closed: boolean;
}

async function isInMaintenanceWindow(monitorId: string, at: Date): Promise<boolean> {
  const [window] = await db
    .select({ id: maintenanceWindows.id })
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.monitorId, monitorId),
        lte(maintenanceWindows.startsAt, at),
        gte(maintenanceWindows.endsAt, at)
      )
    )
    .limit(1);
  return Boolean(window);
}

async function findOpenIncident(monitorId: string) {
  const [open] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, monitorId), isNull(incidents.resolvedAt)))
    .limit(1);
  return open ?? null;
}

/**
 * Cuenta si los últimos `threshold` checks del monitor (el recién insertado
 * incluido) están todos "down". Se consulta `checks` en vez de llevar un
 * contador en memoria porque el worker es un proceso sin estado que puede
 * tener varias instancias a la vez (Fase 2.1): la única fuente de verdad
 * compartida es la base de datos.
 */
async function reachedFailureThreshold(monitorId: string, threshold: number): Promise<Date | null> {
  const recent = await db
    .select({ status: checks.status, timestamp: checks.timestamp })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(threshold);

  if (recent.length < threshold || recent.some((check) => check.status !== "down")) {
    return null;
  }
  // El más antiguo de la racha es el inicio real de la caída, no el momento
  // en que se cruzó el umbral — así la duración del incidente es correcta.
  return recent[recent.length - 1].timestamp;
}

/**
 * Actualiza el estado de incidentes de un monitor a partir de un check recién
 * guardado. Devuelve qué transición ocurrió (si abrió o cerró un incidente)
 * para que quien llama decida si hay que notificar — las notificaciones ya
 * no se disparan por cada check "down" suelto (Fase 1.5), sino por cada
 * incidente real, que es lo que evita alertar por un único check ruidoso.
 */
export async function updateIncidentState(
  monitorId: string,
  status: "up" | "down",
  errorMessage: string | null,
  checkTimestamp: Date,
  failureThreshold: number
): Promise<IncidentTransition> {
  if (status === "up") {
    const open = await findOpenIncident(monitorId);
    if (!open) {
      return { opened: false, closed: false };
    }
    await db.update(incidents).set({ resolvedAt: checkTimestamp }).where(eq(incidents.id, open.id));
    logger.warn("incidente cerrado", {
      monitorId,
      incidentId: open.id,
      startedAt: open.startedAt,
      resolvedAt: checkTimestamp,
    });
    return { opened: false, closed: true };
  }

  // status === "down"
  const alreadyOpen = await findOpenIncident(monitorId);
  if (alreadyOpen) {
    return { opened: false, closed: false };
  }

  if (await isInMaintenanceWindow(monitorId, checkTimestamp)) {
    logger.info("check fallido dentro de una ventana de mantenimiento, no se abre incidente", { monitorId });
    return { opened: false, closed: false };
  }

  const startedAt = await reachedFailureThreshold(monitorId, failureThreshold);
  if (!startedAt) {
    return { opened: false, closed: false };
  }

  const [incident] = await db
    .insert(incidents)
    .values({ monitorId, startedAt, causeSummary: errorMessage })
    .returning();
  logger.warn("incidente abierto", { monitorId, incidentId: incident.id, startedAt, causeSummary: errorMessage });
  return { opened: true, closed: false };
}
