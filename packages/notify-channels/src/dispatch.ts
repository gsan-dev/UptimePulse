import { sendDiscordMessage } from "./discord.js";
import { sendSlackMessage } from "./slack.js";
import { sendGenericWebhook } from "./webhook.js";
import type { ChannelMessage, ChannelSendResult, NotificationChannelType } from "./types.js";

/**
 * Único punto de entrada usado tanto por el envío real (apps/worker, al
 * abrir/cerrar un incidente o al avisar de un certificado por caducar) como
 * por el botón "probar conexión" de la API (apps/api) — así ambos casos
 * comparten exactamente la misma lógica de envío, y "probar" de verdad
 * prueba lo mismo que se usará en producción, no una simulación aparte.
 */
export async function sendChannelNotification(
  type: NotificationChannelType,
  config: Record<string, unknown>,
  message: ChannelMessage
): Promise<ChannelSendResult> {
  switch (type) {
    case "discord": {
      const webhookUrl = config.webhookUrl;
      if (typeof webhookUrl !== "string" || !webhookUrl) {
        return { ok: false, error: "Falta 'webhookUrl' en la configuración del canal" };
      }
      return sendDiscordMessage(webhookUrl, message);
    }
    case "slack": {
      const webhookUrl = config.webhookUrl;
      if (typeof webhookUrl !== "string" || !webhookUrl) {
        return { ok: false, error: "Falta 'webhookUrl' en la configuración del canal" };
      }
      return sendSlackMessage(webhookUrl, message);
    }
    case "webhook": {
      const url = config.url;
      const secret = config.secret;
      if (typeof url !== "string" || !url || typeof secret !== "string" || !secret) {
        return { ok: false, error: "Falta 'url' o 'secret' en la configuración del canal" };
      }
      return sendGenericWebhook(url, secret, message);
    }
    default:
      return { ok: false, error: `Tipo de canal no soportado: ${String(type)}` };
  }
}
