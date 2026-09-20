import { eq } from "drizzle-orm";
import { db, organizationMembers, users } from "@uptimepulse/db";
import { createMailer, monitorDownEmail, monitorRecoveredEmail } from "@uptimepulse/mailer";
import { createLogger } from "@uptimepulse/shared";
import { env } from "../env.js";
import type { CheckOutcome } from "./types.js";

const logger = createLogger("worker");

const mailer = createMailer({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  auth: env.smtpUser && env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  from: env.mailFrom,
});

// "Dueño" de un monitor = todos los miembros de su organización (para el MVP
// suele ser solo el usuario que se registró, ver la simplificación de
// getPrimaryOrganizationId en apps/api). Cuando exista roles/equipos (Fase 4)
// podría filtrarse por rol en vez de notificar a todos.
async function getOrganizationEmails(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId));
  return rows.map((row) => row.email);
}

export interface MonitorForNotification {
  id: string;
  name: string;
  target: string;
  organizationId: string;
}

/** Envía el email de caída o recuperación a todos los miembros de la organización del monitor. */
export async function notifyTransition(monitor: MonitorForNotification, outcome: CheckOutcome): Promise<void> {
  const recipients = await getOrganizationEmails(monitor.organizationId);
  if (recipients.length === 0) return;

  const email =
    outcome.status === "down"
      ? monitorDownEmail(monitor, outcome.errorMessage)
      : monitorRecoveredEmail(monitor, outcome.responseTimeMs);

  await mailer.sendMail({ to: recipients, ...email });

  logger.info("notificación de cambio de estado enviada", {
    monitorId: monitor.id,
    status: outcome.status,
    recipients: recipients.length,
  });
}
