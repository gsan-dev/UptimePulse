import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, notificationChannels } from "@uptimepulse/db";
import { assertPublicHost, SsrfBlockedError } from "@uptimepulse/server-utils";
import { sendChannelNotification, type NotificationChannelType } from "@uptimepulse/notify-channels";
import { requireAuth } from "../plugins/auth.js";
import { getPrimaryOrganizationId } from "../lib/organizations.js";
import { env } from "../env.js";

// "sms" queda fuera a propósito (Fase 3.2: sin credenciales de Twilio para
// probarlo de verdad esta sesión) y "email" no se gestiona como canal aquí
// (sigue siendo el aviso automático a todos los miembros de la organización,
// Fase 1.5) — solo se pueden crear los tres tipos que sí se implementaron.
const discordConfigSchema = z.object({ webhookUrl: z.string().url() });
const slackConfigSchema = z.object({ webhookUrl: z.string().url() });
const webhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8, "El secreto debe tener al menos 8 caracteres"),
});

const createChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("discord"), name: z.string().min(1).max(100), config: discordConfigSchema }),
  z.object({ type: z.literal("slack"), name: z.string().min(1).max(100), config: slackConfigSchema }),
  z.object({ type: z.literal("webhook"), name: z.string().min(1).max(100), config: webhookConfigSchema }),
]);

const idParamSchema = z.object({ id: z.string().uuid() });

function extractUrlFromConfig(type: NotificationChannelType, config: Record<string, unknown>): string {
  return type === "webhook" ? (config.url as string) : (config.webhookUrl as string);
}

// Mismo mecanismo anti-SSRF que ya protege los targets de monitores (Fase
// 1.2): la URL de un webhook/Discord/Slack es tan capaz de apuntar a un
// servicio interno como el target de un monitor, y este endpoint acepta
// URLs arbitrarias puestas por el usuario.
async function assertChannelUrlIsPublic(type: NotificationChannelType, config: Record<string, unknown>): Promise<void> {
  const hostname = new URL(extractUrlFromConfig(type, config)).hostname;
  await assertPublicHost(hostname, { allowPrivateTargets: env.allowPrivateMonitorTargets });
}

async function findOwnedChannel(organizationId: string, channelId: string) {
  return db.query.notificationChannels.findFirst({
    where: and(eq(notificationChannels.id, channelId), eq(notificationChannels.organizationId, organizationId)),
  });
}

export async function notificationChannelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/notification-channels", async (request, reply) => {
    const parsed = createChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.code(403).send({ error: "El usuario no pertenece a ninguna organización" });
    }

    try {
      await assertChannelUrlIsPublic(parsed.data.type, parsed.data.config);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        return reply.code(422).send({ error: error.message });
      }
      throw error;
    }

    const [channel] = await db
      .insert(notificationChannels)
      .values({ organizationId, name: parsed.data.name, type: parsed.data.type, config: parsed.data.config })
      .returning();

    return reply.code(201).send(channel);
  });

  app.get("/notification-channels", async (request, reply) => {
    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.send([]);
    }
    const rows = await db.query.notificationChannels.findMany({
      where: eq(notificationChannels.organizationId, organizationId),
    });
    return reply.send(rows);
  });

  app.delete("/notification-channels/:id", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const channel = organizationId ? await findOwnedChannel(organizationId, parsedParams.data.id) : null;
    if (!channel) {
      return reply.code(404).send({ error: "Canal no encontrado" });
    }

    // Nota: monitor_notification_channels tiene ON DELETE CASCADE sobre
    // channel_id (Fase 0.3), así que borrar el canal también desvincula
    // automáticamente cualquier monitor que lo tuviera activado.
    await db.delete(notificationChannels).where(eq(notificationChannels.id, channel.id));
    return reply.code(204).send();
  });

  // Envía un mensaje de prueba real por el canal — usa exactamente el mismo
  // camino de envío que el worker usará de verdad (packages/notify-channels),
  // así "probar" prueba lo mismo que se disparará ante una caída real.
  app.post("/notification-channels/:id/test", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const channel = organizationId ? await findOwnedChannel(organizationId, parsedParams.data.id) : null;
    if (!channel) {
      return reply.code(404).send({ error: "Canal no encontrado" });
    }

    const result = await sendChannelNotification(channel.type as NotificationChannelType, channel.config, {
      title: "Prueba de conexión — UptimePulse",
      description: `Mensaje de prueba del canal "${channel.name}". Si lo ves, la conexión funciona correctamente.`,
      tone: "up",
    });

    return reply.send(result);
  });
}
