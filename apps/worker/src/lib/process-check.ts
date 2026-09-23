import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { checks, db, monitors } from "@uptimepulse/db";
import type { MonitorCheckJobData } from "@uptimepulse/queue";
import { extractHostname } from "@uptimepulse/server-utils";
import { createLogger } from "@uptimepulse/shared";
import { hostRateLimiter, telemetry } from "../runtime.js";
import { runCheckWithRetries } from "./run-check.js";
import { notifyTransition } from "./notifications.js";
import { evaluateMonitorHealth } from "./health.js";
import { emitMonitorStatusChanged } from "./realtime-emitter.js";
import { checkSslExpiry } from "./ssl-alerts.js";
import { env } from "../env.js";

const logger = createLogger("worker");

/**
 * Procesa un job de la cola: ejecuta el check de un monitor y guarda el
 * resultado. Si el monitor ya no existe (se borró) o está pausado (se
 * pausó justo después de que se encolara este job), no hace nada — no es
 * un fallo, solo una carrera normal entre la API (que agenda/quita jobs) y
 * la cola (que puede tener uno ya en vuelo).
 */
export async function processCheckJob(job: Job<MonitorCheckJobData>): Promise<void> {
  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, job.data.monitorId) });
  if (!monitor || monitor.isPaused) {
    telemetry.checksSkipped.inc();
    return;
  }

  // Fase 5.1: cuota por host de destino. Si se supera, el check no se
  // ejecuta ni se guarda (no es información sobre el monitor, es
  // protección del destino); el siguiente ciclo lo reintentará.
  const hostname = safeHostname(monitor.type, monitor.target);
  if (hostname) {
    const quota = await hostRateLimiter.tryAcquire(hostname);
    if (!quota.allowed) {
      telemetry.checksRateLimited.inc();
      logger.warn("check saltado: el host de destino agotó su cuota por minuto", {
        monitorId: monitor.id,
        hostname,
        count: quota.count,
        limit: quota.limit,
      });
      return;
    }
  }

  const outcome = await runCheckWithRetries({
    id: monitor.id,
    type: monitor.type,
    target: monitor.target,
    method: monitor.method,
    headers: monitor.headers,
    body: monitor.body,
    expectedStatus: monitor.expectedStatus,
    timeoutMs: monitor.timeoutMs,
  });

  telemetry.checksTotal.inc({
    type: monitor.type,
    status: outcome.status,
    error_kind: outcome.errorKind ?? "none",
  });
  if (
    outcome.responseTimeMs !== null &&
    outcome.errorKind !== "ssrf" &&
    outcome.errorKind !== "invalid_target"
  ) {
    telemetry.checkDuration.observe({ type: monitor.type }, outcome.responseTimeMs / 1000);
  }

  const [savedCheck] = await db
    .insert(checks)
    .values({
      monitorId: monitor.id,
      status: outcome.status,
      responseTimeMs: outcome.responseTimeMs,
      httpStatus: outcome.httpStatus,
      errorMessage: outcome.errorMessage,
      region: env.region,
    })
    .returning();

  logger.info("check registrado", {
    monitorId: monitor.id,
    name: monitor.name,
    region: env.region,
    status: outcome.status,
    responseTimeMs: outcome.responseTimeMs,
    errorMessage: outcome.errorMessage,
    errorKind: outcome.errorKind,
    jobId: job.id,
    pid: process.pid,
  });

  // Motor de estado multi-región (Fase 4.2): consolida el último check de
  // cada región con el quórum configurado y decide, en la misma transacción,
  // si este check cambia el estado visible del monitor y si abre o cierra un
  // incidente (N caídas consecutivas por región, ≥ quórum regiones, fuera de
  // ventanas de mantenimiento). Sustituye a "estado = último check" (Fases
  // 1-3), que con varias regiones dependería de cuál acabó antes.
  const health = await evaluateMonitorHealth({
    monitorId: monitor.id,
    regions: env.checkRegions,
    failureThreshold: env.incidentFailureThreshold,
    checkTimestamp: savedCheck.timestamp,
    errorMessage: outcome.errorMessage,
  });

  // Tiempo real (Fase 2.3): el dashboard se entera al instante de un cambio
  // de estado consolidado sin sondear — vía Redis, hasta la API, hasta el
  // navegador. Se emite solo cuando el consolidado cambia (no en cada check
  // crudo): con dos regiones, que una lo vea caído mientras la otra no lo
  // pone "degradado", y eso sí se notifica.
  if (health.previous !== null && health.previous !== health.current) {
    emitMonitorStatusChanged(monitor.organizationId, {
      monitorId: monitor.id,
      name: monitor.name,
      status: health.current,
      previousStatus: health.previous,
      downRegions: health.downRegions,
      region: env.region,
      responseTimeMs: outcome.responseTimeMs,
      timestamp: savedCheck.timestamp.toISOString(),
    });
  }

  if (health.incidentOpened) telemetry.incidents.inc({ action: "opened" });
  if (health.incidentClosed) telemetry.incidents.inc({ action: "closed" });

  if (health.incidentOpened || health.incidentClosed) {
    try {
      await notifyTransition(
        {
          id: monitor.id,
          name: monitor.name,
          target: monitor.target,
          organizationId: monitor.organizationId,
        },
        {
          ...outcome,
          // Al cerrar un incidente el check que lo cierra puede ser "up" en
          // esta región pero el consolidado es lo que manda; y al abrirlo,
          // el mensaje incluye desde qué regiones se vio.
          status: health.incidentOpened ? "down" : "up",
          errorMessage:
            health.incidentOpened && env.checkRegions.length > 1
              ? `${outcome.errorMessage ?? "Caída"} (visto desde: ${health.failingRegions.join(", ")})`
              : outcome.errorMessage,
        }
      );
    } catch (error) {
      logger.error("no se pudo enviar la notificación de cambio de estado", {
        monitorId: monitor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // SSL (Fase 3.1): solo tiene sentido para monitores HTTP contra un target
  // "https://" — el resto (http sin TLS, tcp, ping) no tienen certificado
  // que comprobar. Va después de todo lo demás porque es información
  // adicional, nunca debe retrasar ni condicionar el resultado del check.
  if (monitor.type === "http" && monitor.target.startsWith("https://")) {
    const url = new URL(monitor.target);
    await checkSslExpiry(
      {
        id: monitor.id,
        name: monitor.name,
        target: monitor.target,
        organizationId: monitor.organizationId,
        sslExpiresAt: monitor.sslExpiresAt,
        sslLastAlertedThresholdDays: monitor.sslLastAlertedThresholdDays,
      },
      url.hostname,
      url.port ? Number(url.port) : 443
    );
  }
}

function safeHostname(type: "http" | "tcp" | "ping", target: string): string | null {
  try {
    return extractHostname(type, target);
  } catch {
    return null;
  }
}
