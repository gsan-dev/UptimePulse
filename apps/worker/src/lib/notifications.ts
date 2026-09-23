import { eq } from "drizzle-orm";
import { db, monitorNotificationChannels, notificationChannels, organizationMembers, users } from "@uptimepulse/db";
import { createMailer, monitorDownEmail, monitorRecoveredEmail, sslExpiringEmail } from "@uptimepulse/mailer";
import { sendChannelNotification, type ChannelMessage, type NotificationChannelType } from "@uptimepulse/notify-channels";
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

async function getMonitorChannels(monitorId: string) {
  return db
    .select({
      id: notificationChannels.id,
      name: notificationChannels.name,
      type: notificationChannels.type,
      config: notificationChannels.config,
    })
    .from(monitorNotificationChannels)
    .innerJoin(notificationChannels, eq(notificationChannels.id, monitorNotificationChannels.channelId))
    .where(eq(monitorNotificationChannels.monitorId, monitorId));
}

/**
 * Manda `message` a todos los canales (webhook/Slack/Discord) que este
 * monitor tenga activados (Fase 3.2) — email NO pasa por aquí, sigue su
 * propio camino (mailer, siempre a todos los miembros de la organización)
 * porque es el aviso mínimo garantizado, no un canal opcional más. Un canal
 * que falla se registra y no interrumpe a los demás — el error de uno no
 * debe tapar que otro sí llegó.
 */
async function dispatchToChannels(monitorId: string, message: ChannelMessage): Promise<void> {
  const channels = await getMonitorChannels(monitorId);
  await Promise.all(
    channels.map(async (channel) => {
      const result = await sendChannelNotification(channel.type as NotificationChannelType, channel.config, message);
      if (!result.ok) {
        logger.error("no se pudo enviar la notificación por canal", {
          monitorId,
          channelId: channel.id,
          channelName: channel.name,
          channelType: channel.type,
          error: result.error,
        });
      }
    })
  );
}

export interface MonitorForNotification {
  id: string;
  name: string;
  target: string;
  organizationId: string;
}

/** Envía el aviso de caída/recuperación por email (a la organización) y por los canales que el monitor tenga activados. */
export async function notifyTransition(monitor: MonitorForNotification, outcome: CheckOutcome): Promise<void> {
  const email =
    outcome.status === "down"
      ? monitorDownEmail(monitor, outcome.errorMessage)
      : monitorRecoveredEmail(monitor, outcome.responseTimeMs);

  const recipients = await getOrganizationEmails(monitor.organizationId);
  if (recipients.length > 0) {
    await mailer.sendMail({ to: recipients, ...email });
    logger.info("notificación de cambio de estado enviada por email", {
      monitorId: monitor.id,
      status: outcome.status,
      recipients: recipients.length,
    });
  }

  await dispatchToChannels(monitor.id, {
    title: email.subject,
    description:
      outcome.status === "down"
        ? `Motivo: ${outcome.errorMessage ?? "desconocido"}`
        : `Tiempo de respuesta: ${outcome.responseTimeMs != null ? `${outcome.responseTimeMs}ms` : "—"}`,
    tone: outcome.status === "down" ? "down" : "up",
    fields: [{ name: "Target", value: monitor.target }],
  });
}

/** Envía el aviso de certificado SSL a punto de caducar (Fase 3.1), por email y por los canales activados. */
export async function notifySslExpiring(
  monitor: MonitorForNotification,
  expiresAt: Date,
  daysUntilExpiry: number
): Promise<void> {
  const email = sslExpiringEmail(monitor, daysUntilExpiry, expiresAt);

  const recipients = await getOrganizationEmails(monitor.organizationId);
  if (recipients.length > 0) {
    await mailer.sendMail({ to: recipients, ...email });
    logger.info("alerta de expiración SSL enviada por email", { monitorId: monitor.id, daysUntilExpiry });
  }

  await dispatchToChannels(monitor.id, {
    title: email.subject,
    description: `El certificado caduca el ${expiresAt.toLocaleDateString("es-ES")} (en ${daysUntilExpiry} días).`,
    tone: "warning",
    fields: [{ name: "Target", value: monitor.target }],
  });
}
