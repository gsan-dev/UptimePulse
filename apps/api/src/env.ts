// Este archivo debe ser el PRIMER import de cualquier punto de entrada
// (index.ts) que toque "@uptimepulse/db": su cliente lee `process.env.DATABASE_URL`
// en cuanto se importa, así que dotenv tiene que haber corrido antes.
import { config } from "dotenv";
import { parseRegions } from "@uptimepulse/queue";
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
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  // Solo para desarrollo local: desactiva la comprobación anti-SSRF para
  // poder monitorizar hosts internos (ej. http://localhost:4000). Ver
  // lib/ssrf-guard.ts. Nunca debe activarse en un despliegue real.
  allowPrivateMonitorTargets: process.env.ALLOW_PRIVATE_MONITOR_TARGETS === "true",
  // Regiones desde las que se ejecutan los checks (Fase 4.2), separadas por
  // comas. Cada una es una cola BullMQ y necesita al menos un worker con
  // WORKER_REGION=<región>. Compartida con el worker vía el .env de la raíz.
  checkRegions: parseRegions(process.env.CHECK_REGIONS),
  // URL pública del frontend, para construir enlaces en emails (invitaciones,
  // Fase 4.1). En desarrollo es el servidor de Vite.
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  // Mismo SMTP que usa el worker (Mailpit en desarrollo): la API manda los
  // emails de invitación desde aquí, no a través de la cola, porque son
  // síncronos con la acción del usuario y no hay motivo para diferirlos.
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || undefined,
  smtpPass: process.env.SMTP_PASS || undefined,
  mailFrom: process.env.MAIL_FROM ?? "UptimePulse <alerts@uptimepulse.local>",
};
