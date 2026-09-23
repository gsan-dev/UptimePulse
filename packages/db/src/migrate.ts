import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

config({ path: path.resolve(fileURLToPath(new URL("../../../.env", import.meta.url))) });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

console.log(`[db] aplicando migraciones desde ${migrationsFolder} ...`);
await migrate(db, { migrationsFolder });
console.log("[db] migraciones aplicadas correctamente.");

await pool.end();
