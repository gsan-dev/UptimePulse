import type { Check, CheckStatus, Monitor, MonitorType, PublicUser, Serialized } from "@uptimepulse/shared";

// Los tipos "Api*" son la forma REAL en la que llegan los datos por HTTP
// (ver Serialized<T> en packages/shared): fechas como string, bigint como
// string. Nunca uses Monitor/Check/PublicUser directamente en el frontend.
export type ApiUser = Serialized<PublicUser>;
export type ApiCheck = Serialized<Check>;

export interface ApiMonitorLastCheck {
  status: CheckStatus;
  responseTimeMs: number | null;
  timestamp: string;
}

// lastCheck no es una columna de "monitors": lo añade apps/api al vuelo
// (ver withLastCheck en routes/monitors.ts) a partir del último check.
export type ApiMonitor = Serialized<Monitor> & { lastCheck: ApiMonitorLastCheck | null };

export type { MonitorType, CheckStatus };
