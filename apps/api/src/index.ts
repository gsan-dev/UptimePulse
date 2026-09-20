// IMPORTANTE: este import va primero a propósito. Carga las variables de
// entorno (.env de la raíz) antes de que cualquier otro módulo —en
// particular "@uptimepulse/db"— intente leerlas.
import { env } from "./env.js";
import { createLogger } from "@uptimepulse/shared";
import { buildServer } from "./server.js";

const logger = createLogger("api");

const app = await buildServer();

app.listen({ port: env.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    logger.error("no se pudo arrancar el servidor", { error: err.message });
    process.exit(1);
  }
  logger.info("servidor escuchando", { address });
});
