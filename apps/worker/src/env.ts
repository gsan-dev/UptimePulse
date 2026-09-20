// Debe ser el PRIMER import de cualquier punto de entrada que toque
// "@uptimepulse/db": su cliente lee `process.env.DATABASE_URL` en cuanto se
// importa, así que dotenv tiene que haber corrido antes (mismo patrón que
// apps/api/src/env.ts).
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Copia .env.example a .env en la raíz del proyecto.`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  // Cuántos checks puede ejecutar en paralelo ESTE proceso worker (no el
  // total del sistema — cada instancia que arranques suma su propia cuota).
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  allowPrivateMonitorTargets: process.env.ALLOW_PRIVATE_MONITOR_TARGETS === "true",
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || undefined,
  smtpPass: process.env.SMTP_PASS || undefined,
  mailFrom: process.env.MAIL_FROM ?? "UptimePulse <alerts@uptimepulse.local>",
};
