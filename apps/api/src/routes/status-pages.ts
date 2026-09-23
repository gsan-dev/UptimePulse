import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, monitors, statusPageMonitors, statusPages } from "@uptimepulse/db";
import { requireAuth, requireOrganization, requireRole } from "../plugins/auth.js";

const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "El slug solo puede tener minúsculas, números y guiones");

// Un monitor dentro de una status page puede llevar un nombre propio de cara
// al público (`display_name`): el nombre interno suele ser técnico ("api-prod
// eu-west") y no es el que se quiere enseñar fuera. `null` = usar el nombre
// del monitor.
const statusPageMonitorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(200).nullish(),
});

// Se aceptan las dos formas: `monitorIds` (lista de ids pelados, que es lo
// que mandaban los clientes antes de que existiera `display_name`) y
// `monitors` (con nombre público). Si llegan las dos, manda `monitors`.
const monitorSelectionFields = {
  monitorIds: z.array(z.string().uuid()).optional(),
  monitors: z.array(statusPageMonitorSchema).optional(),
};

type MonitorSelection = { id: string; displayName?: string | null };

function resolveMonitorSelection(input: {
  monitorIds?: string[];
  monitors?: MonitorSelection[];
}): MonitorSelection[] | undefined {
  if (input.monitors !== undefined) return input.monitors;
  if (input.monitorIds !== undefined) return input.monitorIds.map((id) => ({ id }));
  return undefined;
}

const createStatusPageSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  isPublic: z.boolean().default(true),
  ...monitorSelectionFields,
});

const updateStatusPageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
  ...monitorSelectionFields,
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
async function filterOwnedMonitors(
  organizationId: string,
  selection: MonitorSelection[]
): Promise<MonitorSelection[]> {
  if (selection.length === 0) return [];
  const rows = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.organizationId, organizationId), inArray(monitors.id, selection.map((m) => m.id))));
  const owned = new Set(rows.map((row) => row.id));
  // Se quitan los repetidos: (status_page_id, monitor_id) es la clave
  // primaria de la tabla, así que mandar dos veces el mismo monitor haría
  // reventar el INSERT con un 500 en vez de guardarlo una sola vez.
  const seen = new Set<string>();
  return selection.filter((entry) => {
    if (!owned.has(entry.id) || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

async function replaceStatusPageMonitors(statusPageId: string, selection: MonitorSelection[]): Promise<void> {
  await db.delete(statusPageMonitors).where(eq(statusPageMonitors.statusPageId, statusPageId));
  if (selection.length > 0) {
    await db.insert(statusPageMonitors).values(
      selection.map((entry) => ({
        statusPageId,
        monitorId: entry.id,
        displayName: entry.displayName ?? null,
      }))
    );
  }
}

async function loadStatusPageMonitors(statusPageId: string): Promise<MonitorSelection[]> {
  const links = await db
    .select({ id: statusPageMonitors.monitorId, displayName: statusPageMonitors.displayName })
    .from(statusPageMonitors)
    .where(eq(statusPageMonitors.statusPageId, statusPageId));
  return links;
}

export async function statusPageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  // Fase 4.1: resuelve la organización activa (X-Organization-Id o la
  // personal) y el rol del usuario en ella. Las rutas que escriben exigen
  // además rol "editor" o superior; las de lectura valen con "readonly".
  app.addHook("preHandler", requireOrganization);

  app.post("/status-pages", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsed = createStatusPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = request.organization!.id;

    // El slug solo tiene que ser único dentro de ESTA organización: la URL
    // pública lleva delante el username del dueño (/status/<username>/<slug>),
    // así que otro usuario puede tener exactamente el mismo slug.
    const existing = await db.query.statusPages.findFirst({
      where: and(eq(statusPages.organizationId, organizationId), eq(statusPages.slug, parsed.data.slug)),
    });
    if (existing) {
      return reply.code(409).send({ error: "Ya tienes una status page con ese slug, prueba con otro" });
    }

    const ownedMonitors = await filterOwnedMonitors(organizationId, resolveMonitorSelection(parsed.data) ?? []);

    const [page] = await db
      .insert(statusPages)
      .values({
        organizationId,
        slug: parsed.data.slug,
        title: parsed.data.title,
        isPublic: parsed.data.isPublic,
      })
      .returning();

    await replaceStatusPageMonitors(page.id, ownedMonitors);

    return reply.code(201).send({
      ...page,
      monitors: ownedMonitors,
      // `monitorIds` se mantiene por compatibilidad con los clientes
      // anteriores a `display_name` (y con docs/openapi.yaml).
      monitorIds: ownedMonitors.map((m) => m.id),
    });
  });

  app.get("/status-pages", async (request, reply) => {
    const organizationId = request.organization!.id;
    const rows = await db.query.statusPages.findMany({ where: eq(statusPages.organizationId, organizationId) });
    return reply.send(rows);
  });

  app.get("/status-pages/:id", async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = request.organization!.id;
    const page = await findOwnedStatusPage(organizationId, parsedParams.data.id);
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    const pageMonitors = await loadStatusPageMonitors(page.id);
    return reply.send({ ...page, monitors: pageMonitors, monitorIds: pageMonitors.map((m) => m.id) });
  });

  app.patch("/status-pages/:id", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const parsed = updateStatusPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const page = await findOwnedStatusPage(organizationId, parsedParams.data.id);
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    const { monitorIds: _ids, monitors: _monitors, ...patch } = parsed.data;
    const [updated] =
      Object.keys(patch).length > 0
        ? await db.update(statusPages).set(patch).where(eq(statusPages.id, page.id)).returning()
        : [page];

    const selection = resolveMonitorSelection(parsed.data);
    if (selection !== undefined) {
      await replaceStatusPageMonitors(page.id, await filterOwnedMonitors(organizationId, selection));
    }

    const pageMonitors = await loadStatusPageMonitors(page.id);
    return reply.send({ ...updated, monitors: pageMonitors, monitorIds: pageMonitors.map((m) => m.id) });
  });

  app.delete("/status-pages/:id", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "El id debe ser un UUID válido" });
    }

    const organizationId = request.organization!.id;
    const page = await findOwnedStatusPage(organizationId, parsedParams.data.id);
    if (!page) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    await db.delete(statusPages).where(eq(statusPages.id, page.id));
    return reply.code(204).send();
  });
}
