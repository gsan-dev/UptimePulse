import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import type { Queue } from "bullmq";

/**
 * Métricas Prometheus del worker (Fase 5.2). Responden a la pregunta de
 * TASK.md: "cuántos checks se han ejecutado en la última hora y cuántos han
 * fallado por timeout vs. error de conexión" →
 *   increase(uptimepulse_checks_total[1h])  y
 *   increase(uptimepulse_checks_total{status="down"}[1h]) by (error_kind).
 */
export function createWorkerTelemetry(region: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "worker", region });
  collectDefaultMetrics({ register: registry, prefix: "uptimepulse_worker_" });

  const checksTotal = new Counter({
    name: "uptimepulse_checks_total",
    help: "Checks ejecutados, por tipo de monitor, resultado y clase de error",
    labelNames: ["type", "status", "error_kind"] as const,
    registers: [registry],
  });

  const checkDuration = new Histogram({
    name: "uptimepulse_check_duration_seconds",
    help: "Tiempo de respuesta medido por los checks (solo los que obtuvieron respuesta)",
    labelNames: ["type"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  const checksRateLimited = new Counter({
    name: "uptimepulse_checks_rate_limited_total",
    help: "Checks no ejecutados porque el host de destino agotó su cuota por minuto",
    registers: [registry],
  });

  const checksSkipped = new Counter({
    name: "uptimepulse_checks_skipped_total",
    help: "Jobs ignorados porque el monitor ya no existe o está pausado",
    registers: [registry],
  });

  const jobsFailed = new Counter({
    name: "uptimepulse_jobs_failed_total",
    help: "Jobs de check que terminaron con una excepción no controlada",
    registers: [registry],
  });

  const incidents = new Counter({
    name: "uptimepulse_incidents_total",
    help: "Incidentes abiertos y cerrados por este worker",
    labelNames: ["action"] as const,
    registers: [registry],
  });

  const queueJobs = new Gauge({
    name: "uptimepulse_queue_jobs",
    help: "Jobs en la cola de esta región, por estado (se consulta al leer /metrics)",
    labelNames: ["state"] as const,
    registers: [registry],
  });

  return {
    registry,
    checksTotal,
    checkDuration,
    checksRateLimited,
    checksSkipped,
    jobsFailed,
    incidents,
    /** Actualiza el gauge de la cola; se llama justo antes de servir /metrics. */
    async refreshQueueGauge(queue: Queue): Promise<void> {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed"
      );
      for (const [state, value] of Object.entries(counts)) {
        queueJobs.set({ state }, value);
      }
    },
  };
}

export type WorkerTelemetry = ReturnType<typeof createWorkerTelemetry>;
