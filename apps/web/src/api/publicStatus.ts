// Cliente deliberadamente independiente de api/client.ts: la página pública
// (Fase 3.3) no debe depender de nada relacionado con la sesión (access
// token, refresh, AuthContext) — cualquier visitante sin cuenta la ve.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

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

export async function getPublicStatusPage(username: string, slug: string): Promise<PublicStatusPageData> {
  const response = await fetch(
    `${API_BASE}/public/status/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data as { error?: string })?.error ?? `Error ${response.status}`);
  }
  return data as PublicStatusPageData;
}
