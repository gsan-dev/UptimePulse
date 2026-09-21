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

const nodeEnv = process.env.NODE_ENV ?? "development";

/**
 * En producción un secreto de ejemplo (los "changeme_*" de .env.example) o
 * demasiado corto es un fallo de despliegue, no algo que deba arrancar y
 * firmar sesiones con él (Fase 5.1). En desarrollo se permite para no
 * obligar a generar secretos solo para probar en local.
 */
function secret(name: string): string {
  const value = required(name);
  if (nodeEnv === "production" && (value.includes("changeme") || value.length < 32)) {
    throw new Error(
      `${name} no es válido para producción (mínimo 32 caracteres, nunca un valor de ejemplo): genera uno con node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return value;
}

/**
 * Orígenes permitidos por CORS. Sin configurar: solo APP_URL (el frontend).
 * "*" solo se acepta fuera de producción.
 */
function parseCorsOrigins(raw: string | undefined, appUrl: string): string[] | true {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return [appUrl];
  if (list.includes("*")) {
    if (nodeEnv === "production") throw new Error('CORS_ORIGINS="*" no está permitido en producción.');
    return true;
  }
  return list.map((origin) => origin.replace(/\/$/, ""));
}

const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv,
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtAccessSecret: secret("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: secret("JWT_REFRESH_SECRET"),
  // Fase 5.1: orígenes del frontend autorizados por CORS y límite global de
  // peticiones por minuto y por IP (o por API key) para toda la API.
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, appUrl),
  apiRateLimitPerMinute: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 300),
  // Login y registro: más estricto (fuerza bruta / spam de cuentas).
  authRateLimitPerMinute: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10),
  // Fase 5.2: si se define, /metrics exige "Authorization: Bearer <token>".
  metricsToken: process.env.METRICS_TOKEN || undefined,
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
  appUrl,
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
