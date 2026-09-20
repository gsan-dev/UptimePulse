export type MonitorType = "http" | "tcp" | "ping";

export type MonitorStatus = "up" | "down" | "degraded" | "paused";

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  intervalSeconds: number;
  timeoutMs: number;
  isPaused: boolean;
}
