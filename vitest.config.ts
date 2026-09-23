import { defineConfig } from "vitest/config";

// Dos proyectos (Fase 5.3):
//  - unit: lógica pura, sin base de datos ni Redis. `npm run test:unit`.
//  - integration: la API real (`buildServer()` + `app.inject`) y el motor de
//    incidentes del worker contra una base de datos de TEST aparte
//    (uptimepulse_test, se crea y migra sola) y la base 1 de Redis. Necesita
//    el docker-compose levantado. `npm run test:integration`.
// `npm test` ejecuta los dos.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/**/src/**/*.test.ts",
            "apps/api/src/**/*.test.ts",
            "apps/worker/src/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/api/test/**/*.test.ts", "apps/worker/test/**/*.test.ts"],
          setupFiles: ["./test/setup-env.ts"],
          globalSetup: ["./test/global-setup.ts"],
          // Todos los archivos comparten la misma base de datos y la
          // truncan entre pruebas: en paralelo se pisarían.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
