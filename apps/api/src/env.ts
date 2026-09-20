// Este archivo debe ser el PRIMER import de cualquier punto de entrada
// (index.ts) que toque "@uptimepulse/db": su cliente lee `process.env.DATABASE_URL`
// en cuanto se importa, así que dotenv tiene que haber corrido antes.
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
};
