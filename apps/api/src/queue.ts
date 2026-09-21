import { createRedisConnection, RegionQueues } from "@uptimepulse/queue";
import { env } from "./env.js";

// La API es el "productor": programa/reprograma/quita el job de un monitor
// cuando se crea, edita, pausa, reanuda o borra — en TODAS las regiones
// configuradas (Fase 4.2: una cola por región). El "consumidor" (que de
// verdad ejecuta el check) es apps/worker, uno o más procesos por región.
const connection = createRedisConnection(env.redisUrl);

export const regionQueues = new RegionQueues(connection, env.checkRegions);
