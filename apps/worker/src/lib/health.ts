import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { checks, db, incidents, maintenanceWindows, monitors } from "@uptimepulse/db";
import { quorumFor } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";

const logger = createLogger("worker");

export type MonitorHealth = "up" | "degraded" | "down";

export interface RegionSnapshot {
  region: string;
  status: "up" | "down";
  timestamp: Date;
}

export interface HealthEvaluation {
  /** Estado consolidado antes de este check (null si era el primero). */
  previous: MonitorHealth | null;
  /** Estado consolidado después de este check. */
  current: MonitorHealth;
  /** Regiones cuyo último check es "down". */
  downRegions: string[];
  /** Regiones configuradas que todavía no han hecho ningún check de este monitor. */
  silentRegions: string[];
  quorum: number;
  incidentOpened: boolean;
  incidentClosed: boolean;
  /** Regiones que cumplían el umbral de fallos consecutivos al abrir el incidente. */
  failingRegions: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Último check de cada región configurada (las no configuradas se ignoran aunque tengan checks). */
async function latestCheckPerRegion(tx: Tx, monitorId: string, regions: string[]): Promise<RegionSnapshot[]> {
  const rows = await tx
    .selectDistinctOn([checks.region], {
      region: checks.region,
      status: checks.status,
      timestamp: checks.timestamp,
    })
    .from(checks)
    .where(and(eq(checks.monitorId, monitorId), inArray(checks.region, regions)))
    .orderBy(checks.region, desc(checks.timestamp));
  return rows;
}

/**
 * Para cada región: si sus últimos `threshold` checks del monitor son todos
 * "down", devuelve el timestamp del más antiguo de esa racha (el inicio real
 * de la caída vista desde esa región); si no, null.
 */
async function failureStreakStartPerRegion(
  tx: Tx,
  monitorId: string,
  regions: string[],
  threshold: number
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  for (const region of regions) {
    const recent = await tx
      .select({ status: checks.status, timestamp: checks.timestamp })
      .from(checks)
      .where(and(eq(checks.monitorId, monitorId), eq(checks.region, region)))
      .orderBy(desc(checks.timestamp))
      .limit(threshold);
    if (recent.length >= threshold && recent.every((check) => check.status === "down")) {
      result.set(region, recent[recent.length - 1].timestamp);
    }
  }
  return result;
}

async function isInMaintenanceWindow(tx: Tx, monitorId: string, at: Date): Promise<boolean> {
  const [window] = await tx
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

async function findOpenIncident(tx: Tx, monitorId: string) {
  const [open] = await tx
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, monitorId), isNull(incidents.resolvedAt)))
    .limit(1);
  return open ?? null;
}

function consolidate(downCount: number, quorum: number): MonitorHealth {
  if (downCount >= quorum) return "down";
  if (downCount > 0) return "degraded";
  return "up";
}

/**
 * Motor de estado multi-región (Fase 4.2). Se ejecuta después de guardar
 * cada check, desde cualquier región, y aplica el MISMO quórum a dos
 * preguntas distintas:
 *
 * 1. "¿Qué está pasando ahora mismo?" — el último check de cada región
 *    configurada. Caído si ≥ quórum regiones lo ven caído; degradado si
 *    alguna pero no las suficientes; operativo si ninguna. Es lo que se
 *    guarda en `monitors.consolidated_status` y lo que ven el dashboard, la
 *    status page y el WebSocket.
 * 2. "¿Es esto una caída de verdad?" — una región "está fallando" si sus
 *    últimos N checks son down (N = umbral de incidentes, como en la Fase
 *    2.2). Se abre incidente si ≥ quórum regiones están fallando; se cierra
 *    cuando el estado instantáneo deja de ser "down".
 *
 * Quórum = mayoría estricta de las regiones configuradas (ver quorumFor):
 * con 2 regiones, un fallo en una sola nunca marca el monitor como caído.
 *
 * Todo va dentro de una transacción con `SELECT … FOR UPDATE` sobre la fila
 * del monitor: dos workers (dos regiones) pueden terminar un check del
 * mismo monitor a la vez, y sin el bloqueo ambos leerían el mismo estado
 * previo y podrían abrir dos incidentes o emitir dos transiciones iguales.
 */
export async function evaluateMonitorHealth(input: {
  monitorId: string;
  regions: string[];
  failureThreshold: number;
  checkTimestamp: Date;
  errorMessage: string | null;
}): Promise<HealthEvaluation> {
  const { monitorId, regions, failureThreshold, checkTimestamp, errorMessage } = input;
  const quorum = quorumFor(regions.length);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ consolidatedStatus: monitors.consolidatedStatus })
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .for("update");
    const previous = locked?.consolidatedStatus ?? null;

    const snapshots = await latestCheckPerRegion(tx, monitorId, regions);
    const downRegions = snapshots.filter((s) => s.status === "down").map((s) => s.region);
    const seen = new Set(snapshots.map((s) => s.region));
    const silentRegions = regions.filter((r) => !seen.has(r));
    const current = consolidate(downRegions.length, quorum);

    if (current !== previous) {
      await tx.update(monitors).set({ consolidatedStatus: current }).where(eq(monitors.id, monitorId));
    }

    let incidentOpened = false;
    let incidentClosed = false;
    let failingRegions: string[] = [];

    const open = await findOpenIncident(tx, monitorId);
    if (open) {
      if (current !== "down") {
        await tx.update(incidents).set({ resolvedAt: checkTimestamp }).where(eq(incidents.id, open.id));
        incidentClosed = true;
        logger.warn("incidente cerrado", {
          monitorId,
          incidentId: open.id,
          startedAt: open.startedAt,
          resolvedAt: checkTimestamp,
        });
      }
    } else if (current === "down") {
      const streaks = await failureStreakStartPerRegion(tx, monitorId, regions, failureThreshold);
      failingRegions = [...streaks.keys()].sort();
      if (failingRegions.length >= quorum) {
        if (await isInMaintenanceWindow(tx, monitorId, checkTimestamp)) {
          logger.info("caída con quórum dentro de una ventana de mantenimiento, no se abre incidente", { monitorId });
        } else {
          // El incidente empieza cuando se alcanzó el quórum: el Q-ésimo
          // inicio de racha más antiguo (con 1 región, el inicio de su racha,
          // igual que en la Fase 2.2).
          const starts = [...streaks.values()].sort((a, b) => a.getTime() - b.getTime());
          const startedAt = starts[quorum - 1];
          const causeSummary =
            regions.length > 1
              ? `${errorMessage ?? "Caída"} (visto desde: ${failingRegions.join(", ")})`
              : errorMessage;
          const [incident] = await tx
            .insert(incidents)
            .values({ monitorId, startedAt, causeSummary })
            .returning();
          incidentOpened = true;
          logger.warn("incidente abierto", {
            monitorId,
            incidentId: incident.id,
            startedAt,
            failingRegions,
            quorum,
          });
        }
      }
    }

    return {
      previous,
      current,
      downRegions,
      silentRegions,
      quorum,
      incidentOpened,
      incidentClosed,
      failingRegions,
    };
  });
}
