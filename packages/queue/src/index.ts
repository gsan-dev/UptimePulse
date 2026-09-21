import { Redis } from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";

// Fase 4.2: una cola POR REGIÓN. Un worker desplegado en eu-west consume
// solo "monitor-checks--eu-west" (BullMQ prohíbe ":" en nombres de cola, lo
// usa como separador interno de claves), así que un check "de" una región lo ejecuta
// siempre un proceso de esa región — no hay forma de que un worker de otra
// región lo robe. Con una sola región (la configuración por defecto,
// CHECK_REGIONS=local) todo se comporta como antes.
const QUEUE_NAME_PREFIX = "monitor-checks";
export const MONITOR_CHECK_JOB_NAME = "check";
export const DEFAULT_REGION = "local";

// Clave en Redis con todas las regiones que han tenido cola alguna vez, para
// poder limpiar las que se retiren de CHECK_REGIONS (ver
// removeQueuesForUnknownRegions).
const KNOWN_REGIONS_KEY = "uptimepulse:regions";

// Minúsculas, números y guiones: va en nombres de cola de Redis y en el
// User-Agent de los checks.
const REGION_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseRegions(raw: string | undefined): string[] {
  const regions = (raw ?? DEFAULT_REGION)
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r !== "");
  const unique = [...new Set(regions)];
  if (unique.length === 0) return [DEFAULT_REGION];
  for (const region of unique) {
    if (!REGION_REGEX.test(region)) {
      throw new Error(`Región inválida "${region}": solo minúsculas, números y guiones`);
    }
  }
  return unique;
}

/**
 * Quórum de regiones (Fase 4.2): mayoría estricta. R=1 → 1 (el
 * comportamiento de siempre), R=2 → 2 (las dos deben verlo caído: un fallo
 * en una sola región nunca marca el monitor como caído), R=3 → 2.
 */
export function quorumFor(regionCount: number): number {
  return Math.floor(regionCount / 2) + 1;
}

export function queueNameForRegion(region: string): string {
  return `${QUEUE_NAME_PREFIX}--${region}`;
}

export interface MonitorCheckJobData {
  monitorId: string;
  region: string;
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

export function createMonitorCheckQueue(connection: Redis, region: string): MonitorCheckQueue {
  return new Queue<MonitorCheckJobData>(queueNameForRegion(region), { connection });
}

export function createMonitorCheckWorker(
  connection: Redis,
  region: string,
  processor: Processor<MonitorCheckJobData>,
  concurrency: number
): MonitorCheckWorker {
  return new Worker<MonitorCheckJobData>(queueNameForRegion(region), processor, { connection, concurrency });
}

/**
 * Conjunto de colas del productor (la API): una por región configurada.
 * Todas las operaciones de programación se hacen sobre todas a la vez, para
 * que cada región compruebe cada monitor.
 */
export class RegionQueues {
  readonly regions: string[];
  private readonly queues: Map<string, MonitorCheckQueue>;

  constructor(
    private readonly connection: Redis,
    regions: string[]
  ) {
    this.regions = regions;
    this.queues = new Map(regions.map((region) => [region, createMonitorCheckQueue(connection, region)]));
  }

  all(): MonitorCheckQueue[] {
    return [...this.queues.values()];
  }

  /** Registra las regiones configuradas como "conocidas" (ver removeQueuesForUnknownRegions). */
  async rememberRegions(): Promise<void> {
    await this.connection.sadd(KNOWN_REGIONS_KEY, ...this.regions);
  }

  /**
   * Borra por completo las colas de regiones que estuvieron configuradas y
   * ya no lo están. Sin esto, sus job schedulers seguirían encolando checks
   * en una cola que ningún worker consume, acumulando jobs en Redis para
   * siempre.
   */
  async removeQueuesForUnknownRegions(): Promise<string[]> {
    const known = await this.connection.smembers(KNOWN_REGIONS_KEY);
    const stale = known.filter((region) => !this.queues.has(region));
    for (const region of stale) {
      const queue = createMonitorCheckQueue(this.connection, region);
      await queue.obliterate({ force: true });
      await queue.close();
      await this.connection.srem(KNOWN_REGIONS_KEY, region);
    }
    return stale;
  }

  /**
   * Antes de la Fase 4.2 la cola se llamaba "monitor-checks" a secas y sus
   * job schedulers siguen en Redis tras actualizar: hay que borrarla una
   * vez o encolaría checks que ya ningún worker consume.
   */
  async removeLegacyQueue(): Promise<boolean> {
    const legacy = new Queue(QUEUE_NAME_PREFIX, { connection: this.connection });
    const schedulers = await legacy.getJobSchedulers(0, 0);
    const counts = await legacy.getJobCounts();
    const hasAnything = schedulers.length > 0 || Object.values(counts).some((n) => n > 0);
    if (hasAnything) {
      await legacy.obliterate({ force: true });
    }
    await legacy.close();
    return hasAnything;
  }

  async upsertMonitorScheduler(monitorId: string, intervalSeconds: number): Promise<void> {
    await Promise.all(
      this.regions.map((region) => upsertMonitorScheduler(this.queues.get(region)!, monitorId, region, intervalSeconds))
    );
  }

  async enqueueImmediateCheck(monitorId: string): Promise<void> {
    await Promise.all(this.regions.map((region) => enqueueImmediateCheck(this.queues.get(region)!, monitorId, region)));
  }

  async scheduleMonitorCheck(monitorId: string, intervalSeconds: number): Promise<void> {
    await this.upsertMonitorScheduler(monitorId, intervalSeconds);
    await this.enqueueImmediateCheck(monitorId);
  }

  async unscheduleMonitorCheck(monitorId: string): Promise<void> {
    await Promise.all(
      this.regions.map((region) => unscheduleMonitorCheck(this.queues.get(region)!, monitorId, region))
    );
  }
}

function schedulerIdForMonitor(monitorId: string, region: string): string {
  return `monitor:${monitorId}:${region}`;
}

/**
 * Crea o actualiza el "job scheduler" del monitor en una región (un id
 * estable por monitor y región). Llamar a esto dos veces con un
 * `intervalSeconds` distinto simplemente actualiza el intervalo, no crea un
 * duplicado — por eso es seguro llamarlo también en cada arranque de la API
 * como reconciliación (ver `reconcileMonitorSchedulers` en apps/api), sin
 * que eso dispare nada adicional.
 */
export async function upsertMonitorScheduler(
  queue: MonitorCheckQueue,
  monitorId: string,
  region: string,
  intervalSeconds: number
): Promise<void> {
  await queue.upsertJobScheduler(
    schedulerIdForMonitor(monitorId, region),
    { every: intervalSeconds * 1000 },
    { name: MONITOR_CHECK_JOB_NAME, data: { monitorId, region } }
  );
}

/** Encola un check de un monitor para ejecutarse ya, sin esperar a su próximo ciclo programado. */
export async function enqueueImmediateCheck(queue: MonitorCheckQueue, monitorId: string, region: string): Promise<void> {
  await queue.add(MONITOR_CHECK_JOB_NAME, { monitorId, region });
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
  region: string,
  intervalSeconds: number
): Promise<void> {
  await upsertMonitorScheduler(queue, monitorId, region, intervalSeconds);
  await enqueueImmediateCheck(queue, monitorId, region);
}

/** Quita el job programado de un monitor en una región (al pausarlo o borrarlo). */
export async function unscheduleMonitorCheck(queue: MonitorCheckQueue, monitorId: string, region: string): Promise<void> {
  await queue.removeJobScheduler(schedulerIdForMonitor(monitorId, region));
}
