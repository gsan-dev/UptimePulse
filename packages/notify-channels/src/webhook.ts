import { createHmac } from "node:crypto";
import type { ChannelMessage, ChannelSendResult } from "./types.js";

/**
 * Firma el cuerpo exacto que se manda (no un objeto reconstruido aparte) —
 * el receptor debe poder recalcular el mismo HMAC sobre los mismos bytes
 * que recibió, byte a byte, o la verificación fallaría por diferencias de
 * serialización JSON (orden de claves, espacios).
 */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export async function sendGenericWebhook(url: string, secret: string, message: ChannelMessage): Promise<ChannelSendResult> {
  const payload = {
    event: message.tone,
    title: message.title,
    description: message.description,
    fields: message.fields ?? [],
    timestamp: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  const signature = signWebhookPayload(secret, body);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UptimePulse-Signature": `sha256=${signature}`,
      },
      body,
    });

    if (!response.ok) {
      return { ok: false, error: `El endpoint respondió ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido enviando el webhook" };
  }
}
