import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

// Resuelve la configuración de los tests de integración SIN tocar la base
// de datos de desarrollo: toma DATABASE_URL/REDIS_URL del entorno (CI) o
// del .env de la raíz (local) y les cambia el nombre de la base
// (uptimepulse_test) y el índice de Redis (1). Compartido por el
// globalSetup (proceso principal) y el setupFile (workers de vitest).
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readDotenv(): Record<string, string> {
  const file = path.join(ROOT, ".env");
  return fs.existsSync(file) ? parse(fs.readFileSync(file, "utf8")) : {};
}

export function resolveTestEnv(): Record<string, string> {
  const dotenv = readDotenv();
  const pick = (name: string, fallback: string) => process.env[name] ?? dotenv[name] ?? fallback;

  const baseDb = new URL(
    pick("DATABASE_URL", "postgres://uptimepulse:changeme@localhost:5432/uptimepulse")
  );
  const adminDatabaseUrl = baseDb.toString();
  baseDb.pathname = "/uptimepulse_test";

  const redis = new URL(pick("REDIS_URL", "redis://localhost:6379"));
  redis.pathname = "/1";

  return {
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? baseDb.toString(),
    // Base "administrativa" desde la que se crea uptimepulse_test si no existe.
    ADMIN_DATABASE_URL: adminDatabaseUrl,
    REDIS_URL: process.env.TEST_REDIS_URL ?? redis.toString(),
    JWT_ACCESS_SECRET: "test_access_secret_test_access_secret_1234",
    JWT_REFRESH_SECRET: "test_refresh_secret_test_refresh_secret_1234",
    CHECK_REGIONS: "local",
    WORKER_REGION: "local",
    ALLOW_PRIVATE_MONITOR_TARGETS: "false",
    APP_URL: "http://localhost:5173",
    SMTP_HOST: pick("SMTP_HOST", "localhost"),
    SMTP_PORT: pick("SMTP_PORT", "1025"),
    API_RATE_LIMIT_PER_MINUTE: "10000",
    AUTH_RATE_LIMIT_PER_MINUTE: "10000",
    WORKER_HTTP_PORT: "0",
  };
}

export function applyTestEnv(): void {
  for (const [key, value] of Object.entries(resolveTestEnv())) {
    process.env[key] = value;
  }
}
