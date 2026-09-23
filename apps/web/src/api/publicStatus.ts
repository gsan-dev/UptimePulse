// Cliente deliberadamente independiente de api/client.ts: la página pública
// (Fase 3.3) no debe depender de nada relacionado con la sesión (access
// token, refresh, AuthContext) — cualquier visitante sin cuenta la ve.
import { API_BASE } from "./config";

export type PublicMonitorStatus = "up" | "degraded" | "down" | "paused" | "pending";
export type DailyStatus = "operational" | "degraded" | "outage" | "no-data";
export type OverallStatus = "operational" | "degraded" | "outage";

export interface PublicStatusMonitor {
  id: string;
  name: string;
  currentStatus: PublicMonitorStatus;
  uptimePercentage90d: number | null;
  dailyHistory: { date: string; status: DailyStatus }[];
}

export interface PublicStatusPageData {
  title: string;
  overallStatus: OverallStatus;
  monitors: PublicStatusMonitor[];
}

async function fetchPublicStatus(path: string): Promise<PublicStatusPageData> {
  const response = await fetch(`${API_BASE}${path}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data as { error?: string })?.error ?? `Error ${response.status}`);
  }
  return data as PublicStatusPageData;
}

/** /status/<username>/<slug> — la organización personal de ese usuario. */
export function getPublicStatusPage(username: string, slug: string): Promise<PublicStatusPageData> {
  return fetchPublicStatus(
    `/public/status/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
  );
}

/**
 * /status/team/<org-slug>/<slug> — cualquier organización con identificador
 * público, que es la única forma de que una de equipo publique con su propio
 * nombre en vez de con el username de su dueño.
 */
export function getTeamStatusPage(orgSlug: string, slug: string): Promise<PublicStatusPageData> {
  return fetchPublicStatus(
    `/public/status/team/${encodeURIComponent(orgSlug)}/${encodeURIComponent(slug)}`
  );
}
