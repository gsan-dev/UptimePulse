export interface MonitorForEmail {
  name: string;
  target: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function monitorDownEmail(monitor: MonitorForEmail, errorMessage: string | null): EmailContent {
  const reason = errorMessage ?? "motivo desconocido";
  return {
    subject: `🔴 ${monitor.name} está caído`,
    text: `Tu monitor "${monitor.name}" (${monitor.target}) ha dejado de responder.\n\nMotivo: ${reason}\n\n— UptimePulse`,
    html: `
      <div style="font-family: sans-serif; color: #111;">
        <p>Tu monitor <strong>${escapeHtml(monitor.name)}</strong> (${escapeHtml(monitor.target)}) ha dejado de responder.</p>
        <p><strong>Motivo:</strong> ${escapeHtml(reason)}</p>
        <p style="color: #666; font-size: 12px;">— UptimePulse</p>
      </div>
    `.trim(),
  };
}

export function monitorRecoveredEmail(monitor: MonitorForEmail, responseTimeMs: number | null): EmailContent {
  const timing = responseTimeMs != null ? ` (respondió en ${responseTimeMs}ms)` : "";
  return {
    subject: `🟢 ${monitor.name} se ha recuperado`,
    text: `Tu monitor "${monitor.name}" (${monitor.target}) vuelve a estar operativo${timing}.\n\n— UptimePulse`,
    html: `
      <div style="font-family: sans-serif; color: #111;">
        <p>Tu monitor <strong>${escapeHtml(monitor.name)}</strong> (${escapeHtml(monitor.target)}) vuelve a estar operativo${timing}.</p>
        <p style="color: #666; font-size: 12px;">— UptimePulse</p>
      </div>
    `.trim(),
  };
}

export function sslExpiringEmail(monitor: MonitorForEmail, daysUntilExpiry: number, expiresAt: Date): EmailContent {
  const expiresAtText = expiresAt.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
  return {
    subject: `🟡 El certificado SSL de ${monitor.name} caduca en ${daysUntilExpiry} días`,
    text: `El certificado SSL de tu monitor "${monitor.name}" (${monitor.target}) caduca el ${expiresAtText} (en ${daysUntilExpiry} días).\n\nRenuévalo antes de esa fecha para evitar que tus visitantes vean avisos de seguridad.\n\n— UptimePulse`,
    html: `
      <div style="font-family: sans-serif; color: #111;">
        <p>El certificado SSL de tu monitor <strong>${escapeHtml(monitor.name)}</strong> (${escapeHtml(monitor.target)}) caduca el <strong>${expiresAtText}</strong> (en ${daysUntilExpiry} días).</p>
        <p>Renuévalo antes de esa fecha para evitar que tus visitantes vean avisos de seguridad.</p>
        <p style="color: #666; font-size: 12px;">— UptimePulse</p>
      </div>
    `.trim(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
