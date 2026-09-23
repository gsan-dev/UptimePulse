import type {
  Check,
  CheckStatus,
  Incident,
  MaintenanceWindow,
  Monitor,
  MonitorType,
  NotificationChannel,
  PublicUser,
  Serialized,
  StatusPage,
} from "@uptimepulse/shared";

// Los tipos "Api*" son la forma REAL en la que llegan los datos por HTTP
// (ver Serialized<T> en packages/shared): fechas como string, bigint como
// string. Nunca uses Monitor/Check/PublicUser directamente en el frontend.
export type ApiUser = Serialized<PublicUser>;
export type ApiCheck = Serialized<Check>;
export type ApiIncident = Serialized<Incident>;
export type ApiMaintenanceWindow = Serialized<MaintenanceWindow>;
export type ApiNotificationChannel = Serialized<NotificationChannel>;

export interface ApiMonitorLastCheck {
  status: CheckStatus;
  responseTimeMs: number | null;
  timestamp: string;
}

// lastCheck no es una columna de "monitors": lo añade apps/api al vuelo
// (ver withLastCheck en routes/monitors.ts) a partir del último check.
export type ApiMonitor = Serialized<Monitor> & { lastCheck: ApiMonitorLastCheck | null };

// Fase 4.2: último check de cada región configurada (solo en GET /monitors/:id).
// status null = esa región todavía no ha comprobado este monitor.
export interface ApiRegionSnapshot {
  region: string;
  status: CheckStatus | null;
  responseTimeMs: number | null;
  timestamp: string | null;
}
export type ApiMonitorDetail = ApiMonitor & { regions: ApiRegionSnapshot[] };

// "all" = histórico total (sin ventana). Refleja UPTIME_RANGES de
// apps/api/src/lib/metrics.ts.
export type UptimeRange = "24h" | "7d" | "30d" | "90d" | "all";

// Refleja MonitorMetrics de apps/api/src/lib/metrics.ts (Fase 2.2/2.4).
export interface ApiMonitorMetrics {
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

// Un punto por hora (bucket de checks_hourly) — usado tanto por el gráfico
// de la vista de detalle como por las sparklines del dashboard.
export interface ApiTimeseriesPoint {
  bucket: string;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  avgResponseTimeMs: number | null;
}

export interface ApiDashboardSummary {
  avgUptimePercentage: number | null;
  activeIncidents: number;
  sparklines: Record<string, ApiTimeseriesPoint[]>;
}

// Un monitor dentro de una status page: su id y, opcionalmente, el nombre
// con el que se le quiere enseñar en público (columna
// status_page_monitors.display_name). null = usar el nombre del monitor.
export interface ApiStatusPageMonitor {
  id: string;
  displayName?: string | null;
}

// `monitors`/`monitorIds` no son columnas de "status_pages": las añade
// apps/api al vuelo a partir de status_page_monitors (igual que lastCheck en
// ApiMonitor) — solo en POST/PATCH/GET de una página concreta, no en el
// listado.
export type ApiStatusPage = Serialized<StatusPage> & {
  monitors?: ApiStatusPageMonitor[];
  monitorIds?: string[];
};

export type { MonitorType, CheckStatus };
