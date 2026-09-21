import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Redis } from "ioredis";
import { Client, Pool } from "pg";
import { resolveTestEnv } from "./test-env.js";

// Se ejecuta UNA vez antes de todos los tests de integración: crea la base
// uptimepulse_test si no existe, le aplica las migraciones reales
// (packages/db/migrations, las mismas que en desarrollo/producción) y deja
// limpia la base 1 de Redis. Al terminar vuelve a limpiar Redis para no
// dejar job schedulers de monitores de prueba.
const MIGRATIONS = fileURLToPath(new URL("../packages/db/migrations", import.meta.url));

export async function setup(): Promise<void> {
  const env = resolveTestEnv();
  const testDbName = new URL(env.DATABASE_URL).pathname.slice(1);

  const admin = new Client({ connectionString: env.ADMIN_DATABASE_URL });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [testDbName]);
  if (exists.rowCount === 0) {
    await admin.query(`create database "${testDbName}"`);
  }
  await admin.end();

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  await pool.end();

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  await redis.flushdb();
  await redis.quit();
}

export async function teardown(): Promise<void> {
  const env = resolveTestEnv();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  await redis.flushdb();
  await redis.quit();
}
