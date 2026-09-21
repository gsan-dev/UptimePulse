import { sql } from "drizzle-orm";
import { db } from "@uptimepulse/db";

export const UPTIME_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type UptimeRange = (typeof UPTIME_RANGES)[number];

const RANGE_TO_INTERVAL: Record<UptimeRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

// Reutilizado por la ruta de incidentes (filtrar por rango, Fase 2.4) para no
// duplicar el mapeo rango → intervalo de Postgres.
export function rangeToInterval(range: UptimeRange): string {
  return RANGE_TO_INTERVAL[range];
}

export interface MonitorMetrics {
  range: UptimeRange;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  uptimePercentage: number | null;
  avgResponseTimeMs: number | null;
  incidentCount: number;
  openIncidentCount: number;
  mttrSeconds: number | null;
}

/**
 * Uptime %/tiempo de respuesta medio se calculan sobre `checks_hourly` (el
 * "continuous aggregate" de la migración 0005), no sobre `checks` en crudo:
 * así un rango de 90 días agrega ~2160 filas (una por hora) en vez de
 * potencialmente millones de checks individuales. Gracias a la "real-time
 * aggregation" de Timescale, la última hora (todavía sin materializar) se
 * incluye igual, con datos exactos.
 */
export async function getMonitorMetrics(monitorId: string, range: UptimeRange): Promise<MonitorMetrics> {
  const interval = RANGE_TO_INTERVAL[range];

  const [checksSummary] = (
    await db.execute(sql`
      SELECT
        coalesce(sum(total_checks), 0)::int AS total_checks,
        coalesce(sum(up_checks), 0)::int AS up_checks,
        coalesce(sum(down_checks), 0)::int AS down_checks
      FROM checks_hourly
      WHERE monitor_id = ${monitorId} AND bucket >= now() - ${interval}::interval
    `)
  ).rows as {
    total_checks: number;
    up_checks: number;
    down_checks: number;
  }[];

  // El tiempo de respuesta medio se calcula sobre `checks` en crudo, no
  // sobre el agregado: el `avg_response_time_ms` de cada bucket solo cubre
  // los checks que tienen tiempo (los "down" por timeout/DNS no), así que
  // ponderarlo por `total_checks` daba una media incorrecta en cuanto el
  // rango cruzaba varios buckets (lo destapó el test de integración de la
  // Fase 5.3: 7 up de 100–160 ms y 3 down → 104 en vez de 130). Es un
  // recorrido de índice (monitor_id, timestamp) acotado por la retención
  // de 90 días de la hypertable, que coincide con el rango máximo.
  const [responseTime] = (
    await db.execute(sql`
      SELECT avg(response_time_ms)::int AS avg_response_time_ms
      FROM checks
      WHERE monitor_id = ${monitorId} AND "timestamp" >= now() - ${interval}::interval
    `)
  ).rows as { avg_response_time_ms: number | null }[];

  const [incidentsSummary] = (
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_incidents,
        count(*) FILTER (WHERE resolved_at IS NULL)::int AS open_incidents,
        avg(extract(epoch FROM (resolved_at - started_at))) FILTER (WHERE resolved_at IS NOT NULL)::int AS mttr_seconds
      FROM incidents
      WHERE monitor_id = ${monitorId} AND started_at >= now() - ${interval}::interval
    `)
  ).rows as {
    resolved_incidents: number;
    open_incidents: number;
    mttr_seconds: number | null;
  }[];

  const totalChecks = checksSummary?.total_checks ?? 0;
  const upChecks = checksSummary?.up_checks ?? 0;
  const downChecks = checksSummary?.down_checks ?? 0;
  const resolvedIncidents = incidentsSummary?.resolved_incidents ?? 0;
  const openIncidents = incidentsSummary?.open_incidents ?? 0;

  return {
    range,
    totalChecks,
    upChecks,
    downChecks,
    uptimePercentage: totalChecks > 0 ? Math.round((upChecks / totalChecks) * 10000) / 100 : null,
    avgResponseTimeMs: responseTime?.avg_response_time_ms ?? null,
    incidentCount: resolvedIncidents + openIncidents,
    openIncidentCount: openIncidents,
    mttrSeconds: incidentsSummary?.mttr_seconds ?? null,
  };
}

export interface TimeseriesPoint {
  bucket: Date;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  avgResponseTimeMs: number | null;
}

/**
 * Serie de puntos (uno por hora) para el gráfico de la Fase 2.4 — a
 * diferencia de `getMonitorMetrics` (que agrega todo el rango en un único
 * número), aquí se devuelve cada bucket por separado. Se usa tanto para el
 * gráfico de la vista de detalle como para las sparklines del dashboard
 * (siempre con range="24h" en ese caso): un único mecanismo de agregación
 * para ambos, en vez de mantener dos consultas parecidas por separado.
 */
export async function getMonitorTimeseries(monitorId: string, range: UptimeRange): Promise<TimeseriesPoint[]> {
  const interval = RANGE_TO_INTERVAL[range];

  // `count(*)` (usado por la vista) llega como bigint y `avg(...)` como
  // numeric — el driver de pg devuelve ambos como *string* en JS para no
  // perder precisión, no como number. Hay que castear explícitamente (igual
  // que ya hace getMonitorMetrics) o el contrato de la API mentiría sobre su
  // propio tipo.
  const result = await db.execute(sql`
    SELECT
      bucket,
      total_checks::int AS total_checks,
      up_checks::int AS up_checks,
      down_checks::int AS down_checks,
      round(avg_response_time_ms)::int AS avg_response_time_ms
    FROM checks_hourly
    WHERE monitor_id = ${monitorId} AND bucket >= now() - ${interval}::interval
    ORDER BY bucket ASC
  `);

  return (
    result.rows as {
      bucket: Date;
      total_checks: number;
      up_checks: number;
      down_checks: number;
      avg_response_time_ms: number | null;
    }[]
  ).map((row) => ({
    bucket: row.bucket,
    totalChecks: row.total_checks,
    upChecks: row.up_checks,
    downChecks: row.down_checks,
    avgResponseTimeMs: row.avg_response_time_ms,
  }));
}

export interface OrganizationSummary {
  avgUptimePercentage: number | null;
  activeIncidents: number;
}

/**
 * Resumen agregado de TODA la organización (no de un monitor), para la
 * cabecera del dashboard (Fase 2.4). El desglose "operativos vs. caídos" no
 * vive aquí: se calcula en el frontend a partir de `lastCheck` de cada
 * monitor, que la API ya devuelve en `GET /monitors` — no hace falta una
 * segunda fuente de verdad para ese dato.
 */
export async function getOrganizationSummary(organizationId: string): Promise<OrganizationSummary> {
  const [uptimeRow] = (
    await db.execute(sql`
      SELECT
        coalesce(sum(ch.up_checks), 0)::int AS up_checks,
        coalesce(sum(ch.total_checks), 0)::int AS total_checks
      FROM checks_hourly ch
      JOIN monitors m ON m.id = ch.monitor_id
      WHERE m.organization_id = ${organizationId} AND ch.bucket >= now() - interval '24 hours'
    `)
  ).rows as { up_checks: number; total_checks: number }[];

  const [incidentsRow] = (
    await db.execute(sql`
      SELECT count(*)::int AS active_incidents
      FROM incidents i
      JOIN monitors m ON m.id = i.monitor_id
      WHERE m.organization_id = ${organizationId} AND i.resolved_at IS NULL
    `)
  ).rows as { active_incidents: number }[];

  const totalChecks = uptimeRow?.total_checks ?? 0;
  return {
    avgUptimePercentage:
      totalChecks > 0 ? Math.round((uptimeRow!.up_checks / totalChecks) * 10000) / 100 : null,
    activeIncidents: incidentsRow?.active_incidents ?? 0,
  };
}

export type DailyStatus = "operational" | "degraded" | "outage" | "no-data";

export interface DailyHistoryPoint {
  date: string; // "YYYY-MM-DD"
  status: DailyStatus;
}

/**
 * Un punto por día (no por hora) para las barras de histórico de la status
 * page pública (Fase 3.3, estilo Stripe/GitHub Status) — agregado sobre
 * `checks_hourly`, igual que el resto de métricas. Un día sin ningún check
 * (monitor pausado, o creado hace menos de `days` días) se marca "no-data",
 * distinto de "operational", para no fingir un historial que no existe.
 */
export async function getMonitorDailyHistory(monitorId: string, days: number): Promise<DailyHistoryPoint[]> {
  const result = await db.execute(sql`
    SELECT
      date_trunc('day', bucket) AS day,
      sum(total_checks)::int AS total_checks,
      sum(up_checks)::int AS up_checks,
      sum(down_checks)::int AS down_checks
    FROM checks_hourly
    WHERE monitor_id = ${monitorId} AND bucket >= now() - make_interval(days => ${days})
    GROUP BY day
  `);

  const byDate = new Map<string, { total: number; up: number; down: number }>();
  for (const row of result.rows as { day: Date | string; total_checks: number; up_checks: number; down_checks: number }[]) {
    // `date_trunc(...)` sobre una columna calculada no siempre vuelve como
    // Date ya parseado (a diferencia de una columna real de la vista, ver
    // getMonitorTimeseries) — `new Date(...)` normaliza los dos casos.
    const key = new Date(row.day).toISOString().slice(0, 10);
    byDate.set(key, { total: row.total_checks, up: row.up_checks, down: row.down_checks });
  }

  const points: DailyHistoryPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const entry = byDate.get(key);

    let status: DailyStatus;
    if (!entry || entry.total === 0) status = "no-data";
    else if (entry.down === 0) status = "operational";
    else if (entry.up === 0) status = "outage";
    else status = "degraded";

    points.push({ date: key, status });
  }
  return points;
}
