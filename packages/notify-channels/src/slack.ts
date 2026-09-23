import type { ChannelMessage, ChannelSendResult } from "./types.js";

const TONE_EMOJI: Record<ChannelMessage["tone"], string> = {
  down: "🔴",
  up: "🟢",
  warning: "🟡",
};

export async function sendSlackMessage(webhookUrl: string, message: ChannelMessage): Promise<ChannelSendResult> {
  const lines = [`${TONE_EMOJI[message.tone]} *${message.title}*`, message.description];
  if (message.fields?.length) {
    lines.push(...message.fields.map((field) => `• *${field.name}:* ${field.value}`));
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Slack respondió ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido enviando a Slack" };
  }
}
