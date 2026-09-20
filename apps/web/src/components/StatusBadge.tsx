import type { ApiMonitor } from "../api/types";

export type DisplayStatus = "up" | "down" | "paused" | "pending";

// Paleta de estados del README §3: verde=operativo, rojo=caído,
// gris=pausado/sin datos. "degraded" (ámbar) queda para cuando exista
// lógica de umbral de latencia (fuera del alcance de esta fase).
const STYLES: Record<DisplayStatus, { label: string; dot: string; text: string }> = {
  up: { label: "Operativo", dot: "bg-emerald-500", text: "text-emerald-400" },
  down: { label: "Caído", dot: "bg-red-500", text: "text-red-400" },
  paused: { label: "Pausado", dot: "bg-gray-500", text: "text-gray-400" },
  pending: { label: "Sin datos", dot: "bg-gray-600", text: "text-gray-500" },
};

/** El estado a mostrar no es una columna de la BD: se deriva de isPaused + el último check (ver packages/shared, MonitorStatus). */
export function monitorDisplayStatus(monitor: Pick<ApiMonitor, "isPaused" | "lastCheck">): DisplayStatus {
  if (monitor.isPaused) return "paused";
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
