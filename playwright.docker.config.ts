import { defineConfig, devices } from "@playwright/test";

// Configuración temporal para verificar la pila de `docker compose up`
// (la web de nginx, no el servidor de Vite). No arranca nada: da por hecho
// que los contenedores ya están levantados.
//   BASE_URL=http://localhost:8080 npx playwright test --config=playwright.docker.config.ts
export default defineConfig({
  testDir: "./e2e-docker",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
