import { Redis } from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";

export const MONITOR_CHECK_QUEUE_NAME = "monitor-checks";
export const MONITOR_CHECK_JOB_NAME = "check";

export interface MonitorCheckJobData {
  monitorId: string;
}

export type MonitorCheckQueue = Queue<MonitorCheckJobData>;
export type MonitorCheckWorker = Worker<MonitorCheckJobData>;

/**
 * BullMQ exige `maxRetriesPerRequest: null` en la conexión que usan sus
 * bloqueos internos (Worker, QueueEvents). Se usa la misma opción también
 * para la Queue del lado productor, para no mantener dos formas distintas
 * de crear la conexión.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createMonitorCheckQueue(connection: Redis): MonitorCheckQueue {
  return new Queue<MonitorCheckJobData>(MONITOR_CHECK_QUEUE_NAME, { connection });
}

export function createMonitorCheckWorker(
  connection: Redis,
  processor: Processor<MonitorCheckJobData>,
  concurrency: number
): MonitorCheckWorker {
  return new Worker<MonitorCheckJobData>(MONITOR_CHECK_QUEUE_NAME, processor, { connection, concurrency });
}

function schedulerIdForMonitor(monitorId: string): string {
  return `monitor:${monitorId}`;
}

/**
 * Crea o actualiza el "job scheduler" del monitor (un id estable, uno por
 * monitor). Llamar a esto dos veces con un `intervalSeconds` distinto
 * simplemente actualiza el intervalo, no crea un duplicado — por eso es
 * seguro llamarlo también en cada arranque de la API como reconciliación
 * (ver `reconcileMonitorSchedulers` en apps/api), sin que eso dispare nada
 * adicional.
 */
export async function upsertMonitorScheduler(
  queue: MonitorCheckQueue,
  monitorId: string,
  intervalSeconds: number
): Promise<void> {
  await queue.upsertJobScheduler(
    schedulerIdForMonitor(monitorId),
    { every: intervalSeconds * 1000 },
    { name: MONITOR_CHECK_JOB_NAME, data: { monitorId } }
  );
}

/** Encola un check de un monitor para ejecutarse ya, sin esperar a su próximo ciclo programado. */
export async function enqueueImmediateCheck(queue: MonitorCheckQueue, monitorId: string): Promise<void> {
  await queue.add(MONITOR_CHECK_JOB_NAME, { monitorId });
}

/**
 * Programa el check periódico de un monitor Y lo comprueba ya mismo.
 *
 * BullMQ con `every` no ejecuta el primer job hasta que pasa el intervalo
 * completo (la opción `immediately` de BullMQ solo funciona con patrones
 * cron, no con `every`), y queremos que un monitor recién creado o
 * reanudado se compruebe ya, no dentro de hasta 5 minutos — de ahí que esta
 * función combine `upsertMonitorScheduler` + `enqueueImmediateCheck`. Úsala
 * solo en las acciones que el usuario dispara a propósito (crear, reanudar);
 * para reconciliar al arrancar, usa `upsertMonitorScheduler` sola.
 */
export async function scheduleMonitorCheck(
  queue: MonitorCheckQueue,
  monitorId: string,
  intervalSeconds: number
): Promise<void> {
  await upsertMonitorScheduler(queue, monitorId, intervalSeconds);
  await enqueueImmediateCheck(queue, monitorId);
}

/** Quita el job programado de un monitor (al pausarlo o borrarlo). */
export async function unscheduleMonitorCheck(queue: MonitorCheckQueue, monitorId: string): Promise<void> {
  await queue.removeJobScheduler(schedulerIdForMonitor(monitorId));
}
