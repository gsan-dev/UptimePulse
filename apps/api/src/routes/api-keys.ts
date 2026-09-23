import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { API_KEY_SCOPES, apiKeys, db } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { generateApiKey } from "../lib/api-keys.js";
import { requireAuth, requireOrganization, requireRole, requireUserSession } from "../plugins/auth.js";

const logger = createLogger("api");

const idParamSchema = z.object({ id: z.string().uuid() });
const keyParamSchema = z.object({ id: z.string().uuid(), keyId: z.string().uuid() });
const createKeySchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre a la clave").max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, "Elige al menos un permiso"),
});

const MAX_KEYS_PER_ORGANIZATION = 20;

function publicKey(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Gestión de API keys de la organización (Fase 5.1): solo un admin con
 * sesión puede crearlas, listarlas y revocarlas. La clave completa se
 * devuelve UNA sola vez en la respuesta de creación; después solo se ve su
 * prefijo. Revocar = borrar la fila: la clave deja de autenticar al instante.
 */
export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireUserSession);
  app.addHook("preHandler", requireOrganization);
  app.addHook("preHandler", requireRole("admin"));

  app.get("/organizations/:id/api-keys", async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success || request.organization!.id !== params.data.id) {
      return reply.code(403).send({ error: "No perteneces a esa organización" });
    }
    const rows = await db.query.apiKeys.findMany({
      where: eq(apiKeys.organizationId, params.data.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return reply.send(rows.map(publicKey));
  });

  app.post("/organizations/:id/api-keys", async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success || request.organization!.id !== params.data.id) {
      return reply.code(403).send({ error: "No perteneces a esa organización" });
    }
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    }
    const existing = await db.query.apiKeys.findMany({ where: eq(apiKeys.organizationId, params.data.id) });
    if (existing.length >= MAX_KEYS_PER_ORGANIZATION) {
      return reply.code(422).send({ error: `Máximo ${MAX_KEYS_PER_ORGANIZATION} API keys por organización` });
    }

    const generated = generateApiKey();
    const [row] = await db
      .insert(apiKeys)
      .values({
        organizationId: params.data.id,
        name: parsed.data.name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        scopes: [...new Set(parsed.data.scopes)],
        createdByUserId: request.user!.id,
      })
      .returning();
    logger.info("api key creada", { organizationId: params.data.id, apiKeyId: row!.id, scopes: row!.scopes });
    return reply.code(201).send({ ...publicKey(row!), key: generated.key });
  });

  app.delete("/organizations/:id/api-keys/:keyId", async (request, reply) => {
    const params = keyParamSchema.safeParse(request.params);
    if (!params.success || request.organization!.id !== params.data.id) {
      return reply.code(403).send({ error: "No perteneces a esa organización" });
    }
    const [deleted] = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, params.data.keyId), eq(apiKeys.organizationId, params.data.id)))
      .returning({ id: apiKeys.id });
    if (!deleted) {
      return reply.code(404).send({ error: "API key no encontrada" });
    }
    logger.info("api key revocada", { organizationId: params.data.id, apiKeyId: deleted.id });
    return reply.code(204).send();
  });
}
