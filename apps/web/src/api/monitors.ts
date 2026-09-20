import { apiFetch } from "./client";
import type { ApiCheck, ApiMonitor, MonitorType } from "./types";

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

export type UpdateMonitorInput = Partial<Omit<CreateMonitorInput, "type">>;

export function listMonitors(): Promise<ApiMonitor[]> {
  return apiFetch<ApiMonitor[]>("/monitors");
}

export function getMonitor(id: string): Promise<ApiMonitor> {
  return apiFetch<ApiMonitor>(`/monitors/${id}`);
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
