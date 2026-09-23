import { eq } from "drizzle-orm";
import { db, monitors } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { getCertificateExpiry } from "./ssl-check.js";
import { notifySslExpiring } from "./notifications.js";

const logger = createLogger("worker");

// Ascendente a propósito: se recorre de más urgente a menos urgente y se
// devuelve el primero que ya se cruzó — así con 10 días restantes el umbral
// resuelto es 15 (no 30), el más ajustado que ya aplica.
const THRESHOLDS_DAYS_ASC = [7, 15, 30];

function resolveTargetThreshold(daysUntilExpiry: number): number | null {
  for (const threshold of THRESHOLDS_DAYS_ASC) {
    if (daysUntilExpiry <= threshold) return threshold;
  }
  return null;
}

export interface MonitorForSslCheck {
  id: string;
  name: string;
  target: string;
  organizationId: string;
  sslExpiresAt: Date | null;
  sslLastAlertedThresholdDays: number | null;
}

/**
 * Comprueba la caducidad del certificado de un monitor HTTPS y, si toca,
 * dispara la alerta (30/15/7 días, Fase 3.1). Se llama tras el check normal
 * del monitor — es información adicional, no sustituye ni afecta al
 * resultado del check en sí (`getCertificateExpiry` nunca lanza).
 */
export async function checkSslExpiry(monitor: MonitorForSslCheck, hostname: string, port: number): Promise<void> {
  const expiresAt = await getCertificateExpiry(hostname, port);
  if (!expiresAt) return;

  const certRenewed =
    !monitor.sslExpiresAt || monitor.sslExpiresAt.getTime() !== expiresAt.getTime();
  // Si el certificado cambió, el umbral ya avisado deja de aplicar — es un
  // certificado distinto, con su propia cuenta atrás.
  const lastAlertedThresholdDays = certRenewed ? null : monitor.sslLastAlertedThresholdDays;

  const daysUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
  const targetThreshold = resolveTargetThreshold(daysUntilExpiry);
  const shouldAlert =
    targetThreshold !== null && (lastAlertedThresholdDays === null || targetThreshold < lastAlertedThresholdDays);

  if (certRenewed || shouldAlert) {
    await db
      .update(monitors)
      .set({
        sslExpiresAt: expiresAt,
        sslLastAlertedThresholdDays: shouldAlert ? targetThreshold : lastAlertedThresholdDays,
      })
      .where(eq(monitors.id, monitor.id));
  }

  if (!shouldAlert) return;

  logger.warn("certificado SSL próximo a caducar", {
    monitorId: monitor.id,
    daysUntilExpiry,
    targetThreshold,
  });

  try {
    await notifySslExpiring(
      { id: monitor.id, name: monitor.name, target: monitor.target, organizationId: monitor.organizationId },
      expiresAt,
      daysUntilExpiry
    );
  } catch (error) {
    logger.error("no se pudo enviar la alerta de expiración SSL", {
      monitorId: monitor.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
