import type { ChannelMessage, ChannelSendResult } from "./types.js";

// Colores de los "embeds" de Discord (decimal, no hex string) — los mismos
// tonos que usa la propia app de Discord para sus estados de sistema.
const TONE_COLORS: Record<ChannelMessage["tone"], number> = {
  down: 0xed4245,
  up: 0x57f287,
  warning: 0xfee75c,
};

export async function sendDiscordMessage(webhookUrl: string, message: ChannelMessage): Promise<ChannelSendResult> {
  // "?wait=true": Discord devuelve 200 + el mensaje creado (con su id) en
  // vez de un 204 vacío — permite confirmar de verdad que el mensaje se
  // creó, no solo que la petición fue aceptada.
  const urlWithWait = webhookUrl.includes("?") ? `${webhookUrl}&wait=true` : `${webhookUrl}?wait=true`;
  try {
    const response = await fetch(urlWithWait, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: message.title,
            description: message.description,
            color: TONE_COLORS[message.tone],
            fields: message.fields?.map((field) => ({ name: field.name, value: field.value, inline: true })),
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Discord respondió ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }

    const created = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, detail: created?.id ? `message id: ${created.id}` : undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido enviando a Discord" };
  }
}
