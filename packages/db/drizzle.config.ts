import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// El .env vive en la raíz del monorepo, no en packages/db.
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
