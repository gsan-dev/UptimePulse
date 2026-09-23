import { defineConfig, devices } from "@playwright/test";

// E2E del flujo crítico (Fase 5.3) contra el stack completo: API, worker y
// web reales, Chromium real. En local reutiliza los procesos ya arrancados
// (npm run dev:*); en CI los arranca él mismo. Necesita Postgres, Redis y
// Mailpit del docker-compose.
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["github"], ["list"]] : "list",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://localhost:3000/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "ignore",
    },
    {
      command: "npm run dev:worker",
      url: "http://localhost:3001/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "ignore",
    },
    {
      command: "npm run dev:web",
      url: "http://localhost:5173",
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: "ignore",
    },
  ],
});
