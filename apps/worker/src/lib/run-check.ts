import { assertPublicHost, extractHostname, SsrfBlockedError } from "@uptimepulse/server-utils";
import { createLogger } from "@uptimepulse/shared";
import { env } from "../env.js";
import { runHttpCheck } from "./http-check.js";
import { runTcpCheck } from "./tcp-check.js";
import type { CheckOutcome } from "./types.js";

const logger = createLogger("worker");

// Hasta 3 intentos con una espera corta entre ellos, para no marcar un
// monitor como caído por un simple error de red puntual (README §2.2:
// "evita falsos positivos"). Solo se guarda UNA fila en `checks` por ciclo
// (el resultado final), nunca una por intento.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

export interface MonitorToCheck {
  id: string;
  type: "http" | "tcp" | "ping";
  target: string;
  method: string | null;
  headers: Record<string, string> | null;
  body: string | null;
  expectedStatus: number | null;
  timeoutMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSingleAttempt(monitor: MonitorToCheck): Promise<CheckOutcome> {
  if (monitor.type === "http") {
    return runHttpCheck({
      target: monitor.target,
      method: monitor.method ?? "GET",
      headers: monitor.headers,
      body: monitor.body,
      expectedStatus: monitor.expectedStatus,
      timeoutMs: monitor.timeoutMs,
      region: env.region,
    });
  }
  if (monitor.type === "tcp") {
    return runTcpCheck({ target: monitor.target, timeoutMs: monitor.timeoutMs });
  }
  // ping: pendiente (requiere ICMP real o invocar el "ping" del sistema
  // operativo; ver nota en DIARIO.md/TASK.md, Fase 1.3). De momento se
  // registra como "down" con un mensaje explícito en vez de fallar en
  // silencio o fingir que funciona.
  return {
    status: "down",
    responseTimeMs: null,
    httpStatus: null,
    errorMessage: "Los checks de tipo 'ping' todavía no están implementados",
  };
}

/**
 * Ejecuta el check de un monitor, revalidando anti-SSRF justo antes (un
 * dominio pudo resolver a una IP pública al crear el monitor en la Fase 1.2
 * y cambiar a una privada después), y reintentando hasta MAX_ATTEMPTS veces
 * antes de dar el resultado como "down" definitivo.
 */
export async function runCheckWithRetries(monitor: MonitorToCheck): Promise<CheckOutcome> {
  try {
    await assertPublicHost(extractHostname(monitor.type, monitor.target), {
      allowPrivateTargets: env.allowPrivateMonitorTargets,
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { status: "down", responseTimeMs: null, httpStatus: null, errorMessage: error.message };
    }
    throw error;
  }

  let lastOutcome: CheckOutcome | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await runSingleAttempt(monitor);
    if (outcome.status === "up") {
      if (attempt > 1) {
        logger.info("check recuperado tras reintento", { monitorId: monitor.id, attempt });
      }
      return outcome;
    }
    lastOutcome = outcome;
    logger.warn("intento de check fallido", { monitorId: monitor.id, attempt, error: outcome.errorMessage });
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  return lastOutcome!;
}
