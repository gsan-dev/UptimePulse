import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, monitors, statusPageMonitors, statusPages } from "@uptimepulse/db";
import { requireAuth } from "../plugins/auth.js";
import { getPrimaryOrganizationId } from "../lib/organizations.js";

const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "El slug solo puede tener minúsculas, números y guiones");

const createStatusPageSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  isPublic: z.boolean().default(true),
  monitorIds: z.array(z.string().uuid()).default([]),
});

const updateStatusPageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
  monitorIds: z.array(z.string().uuid()).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

async function findOwnedStatusPage(organizationId: string, id: string) {
  return db.query.statusPages.findFirst({
    where: and(eq(statusPages.id, id), eq(statusPages.organizationId, organizationId)),
  });
}

/**
 * Filtra `monitorIds` a solo los que de verdad pertenecen a la organización
 * del usuario — una status page pública expone lo que contenga, así que
 * "colar" el id de un monitor ajeno aquí sería una fuga de datos entre
 * organizaciones, no solo un error de validación cualquiera.
 */
async function filterOwnedMonitorIds(organizationId: string, monitorIds: string[]): Promise<string[]> {
  if (monitorIds.length === 0) return [];
  const rows = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.organizationId, organizationId), inArray(monitors.id, monitorIds)));
  return rows.map((row) => row.id);
}

async function replaceStatusPageMonitors(statusPageId: string, monitorIds: string[]): Promise<void> {
  await db.delete(statusPageMonitors).where(eq(statusPageMonitors.statusPageId, statusPageId));
  if (monitorIds.length > 0) {
    await db.insert(statusPageMonitors).values(monitorIds.map((monitorId) => ({ statusPageId, monitorId })));
  }
}

export async function statusPageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/status-pages", async (request, reply) => {
    const parsed = createStatusPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.code(403).send({ error: "El usuario no pertenece a ninguna organización" });
    }

    // El slug solo tiene que ser único dentro de ESTA organización: la URL
    // pública lleva delante el username del dueño (/status/<username>/<slug>),
    // así que otro usuario puede tener exactamente el mismo slug.
    const existing = await db.query.statusPages.findFirst({
      where: and(eq(statusPages.organizationId, organizationId), eq(statusPages.slug, parsed.data.slug)),
    });
    if (existing) {
      return reply.code(409).send({ error: "Ya tienes una status page con ese slug, prueba con otro" });
    }

    const ownedMonitorIds = await filterOwnedMonitorIds(organizationId, parsed.data.monitorIds);

    const [page] = await db
      .insert(statusPages)
      .values({
        organizationId,
        slug: parsed.data.slug,
        title: parsed.data.title,
        isPublic: parsed.data.isPublic,
      })
      .returning();

    await replaceStatusPageMonitors(page.id, ownedMonitorIds);

    return reply.code(201).send({ ...page, monitorIds: ownedMonitorIds });
  });

  app.get("/status-pages", async (request, reply) => {
    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.send([]);
    }
    const rows = await db.query.statusPages.findMany({ where: eq(statusPages.organizationId, organizationId) });
    return reply.send(rows);
  });

  app.get("/status-pages/:id", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const page = organizationId ? await findOwnedStatusPage(organizationId, parsedParams.data.id) : null;
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    const links = await db
      .select({ monitorId: statusPageMonitors.monitorId })
      .from(statusPageMonitors)
      .where(eq(statusPageMonitors.statusPageId, page.id));

    return reply.send({ ...page, monitorIds: links.map((link) => link.monitorId) });
  });

  app.patch("/status-pages/:id", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const parsed = updateStatusPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const page = organizationId ? await findOwnedStatusPage(organizationId, parsedParams.data.id) : null;
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    const { monitorIds, ...patch } = parsed.data;
    const [updated] =
      Object.keys(patch).length > 0
        ? await db.update(statusPages).set(patch).where(eq(statusPages.id, page.id)).returning()
        : [page];

    if (monitorIds !== undefined) {
      const ownedMonitorIds = await filterOwnedMonitorIds(organizationId!, monitorIds);
      await replaceStatusPageMonitors(page.id, ownedMonitorIds);
    }

    return reply.send(updated);
  });

  app.delete("/status-pages/:id", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const page = organizationId ? await findOwnedStatusPage(organizationId, parsedParams.data.id) : null;
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    await db.delete(statusPages).where(eq(statusPages.id, page.id));
    return reply.code(204).send();
  });
}
