// Objetos compartidos por todo el proceso worker (conexión a Redis,
// telemetría, límite por host). Módulo aparte para que process-check.ts los
// pueda importar sin depender del punto de entrada (index.ts).
import { createRedisConnection } from "@uptimepulse/queue";
import { env } from "./env.js";
import { createHostRateLimiter } from "./lib/host-rate-limit.js";
import { createWorkerTelemetry } from "./lib/telemetry.js";

export const connection = createRedisConnection(env.redisUrl);
export const telemetry = createWorkerTelemetry(env.region);
export const hostRateLimiter = createHostRateLimiter(connection, env.maxChecksPerHostPerMinute);
