import { apiFetch } from "./client";
import type { ApiStatusPage, ApiStatusPageMonitor } from "./types";

export interface CreateStatusPageInput {
  slug: string;
  title: string;
  isPublic?: boolean;
  /** Con `displayName` por monitor: el nombre que se enseña en público. */
  monitors: ApiStatusPageMonitor[];
}

export interface UpdateStatusPageInput {
  title?: string;
  isPublic?: boolean;
  /** Reemplaza la lista completa; omitirlo la deja como estaba. */
  monitors?: ApiStatusPageMonitor[];
}

export function listStatusPages(): Promise<ApiStatusPage[]> {
  return apiFetch<ApiStatusPage[]>("/status-pages");
}

/** El listado no trae los monitores de cada página; este detalle sí. */
export function getStatusPage(id: string): Promise<ApiStatusPage> {
  return apiFetch<ApiStatusPage>(`/status-pages/${id}`);
}

export function createStatusPage(input: CreateStatusPageInput): Promise<ApiStatusPage> {
  return apiFetch<ApiStatusPage>("/status-pages", { method: "POST", body: input });
}

export function updateStatusPage(id: string, patch: UpdateStatusPageInput): Promise<ApiStatusPage> {
  return apiFetch<ApiStatusPage>(`/status-pages/${id}`, { method: "PATCH", body: patch });
}

export function deleteStatusPage(id: string): Promise<void> {
  return apiFetch<void>(`/status-pages/${id}`, { method: "DELETE" });
}
