import { apiFetch } from "./client";
import type {
  ApiCheck,
  ApiDashboardSummary,
  ApiIncident,
  ApiMaintenanceWindow,
  ApiMonitor,
  ApiMonitorMetrics,
  ApiTimeseriesPoint,
  MonitorType,
  UptimeRange,
  ApiMonitorDetail,
} from "./types";

export interface CreateMonitorInput {
  name: string;
  type: MonitorType;
  target: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number;
  intervalSeconds?: number;
  timeoutMs?: number;
  tags?: string[];
}

// Los campos de HTTP admiten `null` además de un valor: es la forma de
// VACIARLOS (quitar el body, dejar de exigir un status concreto). Omitirlos
// deja el valor anterior intacto; mandar null lo borra.
export type UpdateMonitorInput = Partial<Omit<CreateMonitorInput, "type" | "method" | "headers" | "body" | "expectedStatus">> & {
  method?: string | null;
  headers?: Record<string, string> | null;
  body?: string | null;
  expectedStatus?: number | null;
};

export function listMonitors(): Promise<ApiMonitor[]> {
  return apiFetch<ApiMonitor[]>("/monitors");
}

export function getMonitor(id: string): Promise<ApiMonitorDetail> {
  return apiFetch<ApiMonitorDetail>(`/monitors/${id}`);
}

export function listMonitorChecks(id: string, limit = 20): Promise<ApiCheck[]> {
  return apiFetch<ApiCheck[]>(`/monitors/${id}/checks?limit=${limit}`);
}

export function createMonitor(input: CreateMonitorInput): Promise<ApiMonitor> {
  return apiFetch<ApiMonitor>("/monitors", { method: "POST", body: input });
}

export function updateMonitor(id: string, patch: UpdateMonitorInput): Promise<ApiMonitor> {
  return apiFetch<ApiMonitor>(`/monitors/${id}`, { method: "PATCH", body: patch });
}

export function deleteMonitor(id: string): Promise<void> {
  return apiFetch<void>(`/monitors/${id}`, { method: "DELETE" });
}

export function pauseMonitor(id: string): Promise<ApiMonitor> {
  return apiFetch<ApiMonitor>(`/monitors/${id}/pause`, { method: "POST" });
}

export function resumeMonitor(id: string): Promise<ApiMonitor> {
  return apiFetch<ApiMonitor>(`/monitors/${id}/resume`, { method: "POST" });
}

export function getMonitorMetrics(id: string, range: UptimeRange): Promise<ApiMonitorMetrics> {
  return apiFetch<ApiMonitorMetrics>(`/monitors/${id}/metrics?range=${range}`);
}

export function getMonitorTimeseries(
  id: string,
  range: UptimeRange
): Promise<ApiTimeseriesPoint[]> {
  return apiFetch<ApiTimeseriesPoint[]>(`/monitors/${id}/timeseries?range=${range}`);
}

export function listMonitorIncidents(id: string, range?: UptimeRange): Promise<ApiIncident[]> {
  return apiFetch<ApiIncident[]>(`/monitors/${id}/incidents${range ? `?range=${range}` : ""}`);
}

export function getDashboardSummary(): Promise<ApiDashboardSummary> {
  return apiFetch<ApiDashboardSummary>("/monitors/summary");
}

// --- Ventanas de mantenimiento ---
// Durante una ventana el motor de incidentes del worker no abre incidentes
// ni manda alertas para ese monitor. No hay edición: el backend solo ofrece
// crear y borrar (para este alcance basta con borrar y volver a crear).

export interface CreateMaintenanceWindowInput {
  startsAt: string;
  endsAt: string;
  note?: string;
}

export function listMaintenanceWindows(monitorId: string): Promise<ApiMaintenanceWindow[]> {
  return apiFetch<ApiMaintenanceWindow[]>(`/monitors/${monitorId}/maintenance-windows`);
}

export function createMaintenanceWindow(
  monitorId: string,
  input: CreateMaintenanceWindowInput
): Promise<ApiMaintenanceWindow> {
  return apiFetch<ApiMaintenanceWindow>(`/monitors/${monitorId}/maintenance-windows`, {
    method: "POST",
    body: input,
  });
}

export function deleteMaintenanceWindow(monitorId: string, windowId: string): Promise<void> {
  return apiFetch<void>(`/monitors/${monitorId}/maintenance-windows/${windowId}`, { method: "DELETE" });
}
