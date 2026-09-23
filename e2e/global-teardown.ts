import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { Client } from "pg";

// Borra los usuarios de prueba (e2e-pw-*@example.com) y sus organizaciones
// (cascade). Los monitores ya los borró el propio test vía API, que es lo
// que quita sus job schedulers de la cola.
export default async function globalTeardown(): Promise<void> {
  const envFile = path.join(fileURLToPath(new URL("..", import.meta.url)), ".env");
  const dotenv = fs.existsSync(envFile) ? parse(fs.readFileSync(envFile, "utf8")) : {};
  const url = process.env.DATABASE_URL ?? dotenv.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  await client.connect();
  const orgs = await client.query(
    "delete from organizations where owner_user_id in (select id from users where email like 'e2e-pw-%@example.com')"
  );
  const users = await client.query("delete from users where email like 'e2e-pw-%@example.com'");
  await client.end();
  console.log(
    `[e2e] limpieza: ${users.rowCount} usuarios y ${orgs.rowCount} organizaciones de prueba borrados`
  );
}
