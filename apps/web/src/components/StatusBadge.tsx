import type { ApiMonitor } from "../api/types";

export type DisplayStatus = "up" | "degraded" | "down" | "paused" | "pending";

// Paleta de estados del README §3: verde=operativo, ámbar=degradado (Fase
// 4.2: alguna región lo ve caído pero no las suficientes para el quórum),
// rojo=caído, gris=pausado/sin datos.
const STYLES: Record<DisplayStatus, { label: string; dot: string; text: string }> = {
  up: { label: "Operativo", dot: "bg-emerald-500", text: "text-emerald-400" },
  degraded: { label: "Degradado", dot: "bg-amber-500", text: "text-amber-400" },
  down: { label: "Caído", dot: "bg-red-500", text: "text-red-400" },
  paused: { label: "Pausado", dot: "bg-gray-500", text: "text-gray-400" },
  pending: { label: "Sin datos", dot: "bg-gray-600", text: "text-gray-500" },
};

/**
 * Estado a mostrar: pausado manda; si no, el estado consolidado entre
 * regiones que mantiene el worker (Fase 4.2). `lastCheck` se conserva como
 * respaldo para monitores anteriores a la migración 0011 sin consolidado.
 */
export function monitorDisplayStatus(
  monitor: Pick<ApiMonitor, "isPaused" | "lastCheck" | "consolidatedStatus">
): DisplayStatus {
  if (monitor.isPaused) return "paused";
  if (monitor.consolidatedStatus) return monitor.consolidatedStatus;
  if (!monitor.lastCheck) return "pending";
  return monitor.lastCheck.status;
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const style = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${style.text}`}>
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
