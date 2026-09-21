import { apiFetch } from "./client";
import type { ApiStatusPage } from "./types";

export interface CreateStatusPageInput {
  slug: string;
  title: string;
  isPublic?: boolean;
  monitorIds: string[];
}

export function listStatusPages(): Promise<ApiStatusPage[]> {
  return apiFetch<ApiStatusPage[]>("/status-pages");
}

export function createStatusPage(input: CreateStatusPageInput): Promise<ApiStatusPage> {
  return apiFetch<ApiStatusPage>("/status-pages", { method: "POST", body: input });
}

export function deleteStatusPage(id: string): Promise<void> {
  return apiFetch<void>(`/status-pages/${id}`, { method: "DELETE" });
}
