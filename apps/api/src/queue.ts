import { createMonitorCheckQueue, createRedisConnection } from "@uptimepulse/queue";
import { env } from "./env.js";

// La API es el "productor": programa/reprograma/quita el job de un monitor
// cuando se crea, edita, pausa, reanuda o borra. El "consumidor" (que de
// verdad ejecuta el check) es apps/worker — ver su src/index.ts.
const connection = createRedisConnection(env.redisUrl);

export const monitorCheckQueue = createMonitorCheckQueue(connection);
