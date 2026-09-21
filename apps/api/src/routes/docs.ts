import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

// La especificación OpenAPI vive en docs/openapi.yaml (raíz del repo) y se
// mantiene a mano (Fase 5.5): las rutas validan con zod, no con esquemas
// JSON de Fastify, así que no hay nada que generar automáticamente. Se sirve
// en /docs (Swagger UI) y /docs/json | /docs/yaml (la especificación).
const OPENAPI_PATH = fileURLToPath(new URL("../../../../docs/openapi.yaml", import.meta.url));

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(swagger, { mode: "static", specification: { path: OPENAPI_PATH, baseDir: "" } });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });
}
