import { Emitter } from "@socket.io/redis-emitter";
import { createRedisConnection } from "@uptimepulse/queue";
import { env } from "../env.js";

// El worker no abre sockets (eso vive en apps/api) — este Emitter publica en
// el mismo canal Redis que escucha el adaptador de Socket.io de la API
// (ver apps/api/src/realtime.ts), que reenvía el evento a los navegadores
// conectados. Conexión de Redis dedicada, separada de la del Worker de
// BullMQ, para no interferir con sus comandos bloqueantes.
const redisClient = createRedisConnection(env.redisUrl);
const emitter = new Emitter(redisClient);

export interface MonitorStatusChangedPayload {
  monitorId: string;
  name: string;
  // Fase 4.2: es el estado CONSOLIDADO entre regiones (puede ser
  // "degraded"), no el resultado crudo del último check.
  status: "up" | "degraded" | "down";
  previousStatus: "up" | "degraded" | "down" | null;
  /** Regiones que ven el monitor caído ahora mismo. */
  downRegions: string[];
  region: string;
  responseTimeMs: number | null;
  timestamp: string;
}

export function emitMonitorStatusChanged(organizationId: string, payload: MonitorStatusChangedPayload): void {
  emitter.to(`org:${organizationId}`).emit("monitor:status_changed", payload);
}
