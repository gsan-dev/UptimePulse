import { connect } from "node:tls";

const SSL_CHECK_TIMEOUT_MS = 5000;

/**
 * Lee la fecha de expiración del certificado TLS de `hostname:port` con una
 * conexión aparte (no reutiliza la del check HTTP: `fetch` no expone el
 * certificado del peer). Best-effort a propósito: si falla o da timeout,
 * devuelve `null` en vez de lanzar — la comprobación SSL es un extra sobre
 * el check normal (Fase 3.1), nunca debe hacer que el check en sí falle.
 */
export function getCertificateExpiry(hostname: string, port = 443): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = connect(
      { host: hostname, port, servername: hostname, timeout: SSL_CHECK_TIMEOUT_MS, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve(null);
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        resolve(Number.isNaN(expiresAt.getTime()) ? null : expiresAt);
      }
    );

    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => {
      resolve(null);
    });
  });
}
