// setupFile de los tests de integración: fija las variables de entorno
// ANTES de que ningún test importe "@uptimepulse/db" o apps/api/src/env.ts
// (ambos leen process.env al importarse; dotenv no pisa lo ya definido).
import { applyTestEnv } from "./test-env.js";

applyTestEnv();
