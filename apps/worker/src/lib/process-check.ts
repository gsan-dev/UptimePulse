import { desc, eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { checks, db, monitors } from "@uptimepulse/db";
import type { MonitorCheckJobData } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";
import { runCheckWithRetries } from "./run-check.js";
import { notifyTransition } from "./notifications.js";
import { updateIncidentState } from "./incidents.js";
import { emitMonitorStatusChanged } from "./realtime-emitter.js";
import { checkSslExpiry } from "./ssl-alerts.js";
import { env } from "../env.js";

const logger = createLogger("worker");

async function getPreviousCheckStatus(monitorId: string): Promise<"up" | "down" | null> {
  const [last] = await db
    .select({ status: checks.status })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last?.status ?? null;
}

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
    return;
  }

  // Se lee ANTES de insertar el nuevo check — es la única forma de saber si
  // este check cambia el estado visible del monitor. Deliberadamente
  // independiente del motor de incidentes (Fase 2.2): el dashboard debe
  // reflejar el estado real de cada check al instante, mientras que abrir un
  // incidente/alertar exige N caídas consecutivas. Son dos preguntas
  // distintas ("¿qué está pasando ahora mismo?" vs. "¿es esto una caída de
  // verdad?") que conviene no mezclar.
  const previousStatus = await getPreviousCheckStatus(monitor.id);

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

  const [savedCheck] = await db
    .insert(checks)
    .values({
      monitorId: monitor.id,
      status: outcome.status,
      responseTimeMs: outcome.responseTimeMs,
      httpStatus: outcome.httpStatus,
      errorMessage: outcome.errorMessage,
    })
    .returning();

  logger.info("check registrado", {
    monitorId: monitor.id,
    name: monitor.name,
    status: outcome.status,
    responseTimeMs: outcome.responseTimeMs,
    errorMessage: outcome.errorMessage,
    pid: process.pid,
  });

  // Tiempo real (Fase 2.3): el dashboard se entera al instante de un cambio
  // de estado sin sondear — vía Redis, hasta la API, hasta el navegador.
  if (previousStatus !== null && previousStatus !== outcome.status) {
    emitMonitorStatusChanged(monitor.organizationId, {
      monitorId: monitor.id,
      name: monitor.name,
      status: outcome.status,
      previousStatus,
      responseTimeMs: outcome.responseTimeMs,
      timestamp: savedCheck.timestamp.toISOString(),
    });
  }

  // El motor de incidentes (Fase 2.2) decide si este check abre/cierra un
  // incidente real (N caídas consecutivas, respetando ventanas de
  // mantenimiento) — las notificaciones ahora se disparan por incidente, no
  // por cada check "down" suelto, para no alertar por un único bache.
  const transition = await updateIncidentState(
    monitor.id,
    outcome.status,
    outcome.errorMessage,
    savedCheck.timestamp,
    env.incidentFailureThreshold
  );

  if (transition.opened || transition.closed) {
    try {
      await notifyTransition(
        { id: monitor.id, name: monitor.name, target: monitor.target, organizationId: monitor.organizationId },
        outcome
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
