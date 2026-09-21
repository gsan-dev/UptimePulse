// Debe ser el PRIMER import de cualquier punto de entrada que toque
// "@uptimepulse/db": su cliente lee `process.env.DATABASE_URL` en cuanto se
// importa, así que dotenv tiene que haber corrido antes (mismo patrón que
// apps/api/src/env.ts).
import { config } from "dotenv";
import { DEFAULT_REGION, parseRegions } from "@uptimepulse/queue";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Copia .env.example a .env en la raíz del proyecto.`);
  }
  return value;
}

const checkRegions = parseRegions(process.env.CHECK_REGIONS);
const region = parseRegions(process.env.WORKER_REGION ?? DEFAULT_REGION)[0];
if (!checkRegions.includes(region)) {
  throw new Error(
    `WORKER_REGION="${region}" no está en CHECK_REGIONS="${checkRegions.join(",")}": este worker consumiría una cola en la que la API nunca programa checks.`
  );
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  // Región de ESTE proceso worker (Fase 4.2): consume solo la cola de su
  // región y etiqueta con ella cada check que guarda.
  region,
  // Todas las regiones configuradas — necesarias para el quórum (cuántas
  // regiones hay que consultar y cuántas deben coincidir).
  checkRegions,
  // Cuántos checks puede ejecutar en paralelo ESTE proceso worker (no el
  // total del sistema — cada instancia que arranques suma su propia cuota).
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  // Nº de checks "down" consecutivos antes de abrir un incidente real
  // (Fase 2.2). Con 1 se abriría un incidente por cada bache puntual — 2 es
  // el mínimo que de verdad distingue "caída real" de "ruido".
  incidentFailureThreshold: Number(process.env.INCIDENT_FAILURE_THRESHOLD ?? 2),
  allowPrivateMonitorTargets: process.env.ALLOW_PRIVATE_MONITOR_TARGETS === "true",
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || undefined,
  smtpPass: process.env.SMTP_PASS || undefined,
  mailFrom: process.env.MAIL_FROM ?? "UptimePulse <alerts@uptimepulse.local>",
};
