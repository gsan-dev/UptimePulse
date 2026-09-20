import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { checks, db, monitors } from "@uptimepulse/db";
import { assertPublicHost, extractHostname, SsrfBlockedError } from "@uptimepulse/server-utils";
import { scheduleMonitorCheck, unscheduleMonitorCheck } from "@uptimepulse/queue";
import { env } from "../env.js";
import { requireAuth } from "../plugins/auth.js";
import { getPrimaryOrganizationId } from "../lib/organizations.js";
import { getOrganizationPlanLimits } from "../lib/plans.js";
import { monitorCheckQueue } from "../queue.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

// El intervalo por defecto (300s) coincide a propósito con el mínimo del
// plan "free" (ver lib/plans.ts): así, si el cliente no manda intervalSeconds,
// el valor por defecto nunca choca con el límite del plan.
const baseFields = {
  name: z.string().min(1).max(200),
  intervalSeconds: z.number().int().min(30).max(86400).default(300),
  timeoutMs: z.number().int().min(1000).max(60000).default(5000),
  tags: z.array(z.string()).default([]),
};

const httpMonitorSchema = z.object({
  ...baseFields,
  type: z.literal("http"),
  target: z.string().url(),
  method: z.enum(HTTP_METHODS).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
});

const tcpMonitorSchema = z.object({
  ...baseFields,
  type: z.literal("tcp"),
  target: z.string().regex(/^[^\s:]+:\d{1,5}$/, "Formato esperado: host:puerto"),
});

const pingMonitorSchema = z.object({
  ...baseFields,
  type: z.literal("ping"),
  target: z.string().min(1),
});

const createMonitorSchema = z.discriminatedUnion("type", [
  httpMonitorSchema,
  tcpMonitorSchema,
  pingMonitorSchema,
]);

const updateMonitorSchema = z
  .object({
    name: z.string().min(1).max(200),
    target: z.string().min(1),
    method: z.enum(HTTP_METHODS),
    headers: z.record(z.string()),
    body: z.string(),
    expectedStatus: z.number().int().min(100).max(599),
    intervalSeconds: z.number().int().min(30).max(86400),
    timeoutMs: z.number().int().min(1000).max(60000),
    tags: z.array(z.string()),
  })
  .partial();

const idParamSchema = z.object({ id: z.string().uuid() });

const listChecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function parseId(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const result = idParamSchema.safeParse(request.params);
  if (!result.success) {
    reply.code(400).send({ error: "El id debe ser un UUID válido" });
    return undefined;
  }
  return result.data.id;
}

async function findOwnedMonitor(organizationId: string, monitorId: string) {
  return db.query.monitors.findFirst({
    where: and(eq(monitors.id, monitorId), eq(monitors.organizationId, organizationId)),
  });
}

// El "estado actual" de un monitor no es una columna de la tabla `monitors`
// (ver MonitorStatus en packages/shared): se deriva del último check
// guardado por el worker. Se adjunta aquí, no en el esquema, porque es
// exactamente el tipo de dato que solo tiene sentido en la respuesta de la
// API, no en el modelo de la base de datos.
async function getLastCheck(monitorId: string) {
  const [last] = await db
    .select({ status: checks.status, responseTimeMs: checks.responseTimeMs, timestamp: checks.timestamp })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last ?? null;
}

async function withLastCheck<T extends { id: string }>(monitor: T) {
  return { ...monitor, lastCheck: await getLastCheck(monitor.id) };
}

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/monitors", async (request, reply) => {
    const parsed = createMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const input = parsed.data;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.code(403).send({ error: "El usuario no pertenece a ninguna organización" });
    }

    const limits = await getOrganizationPlanLimits(organizationId);
    if (input.intervalSeconds < limits.minIntervalSeconds) {
      return reply
        .code(422)
        .send({ error: `Tu plan exige un intervalo mínimo de ${limits.minIntervalSeconds} segundos` });
    }

    const [{ count: currentCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(monitors)
      .where(eq(monitors.organizationId, organizationId));
    if (currentCount >= limits.maxMonitors) {
      return reply.code(422).send({ error: `Tu plan permite un máximo de ${limits.maxMonitors} monitores` });
    }

    try {
      await assertPublicHost(extractHostname(input.type, input.target), { allowPrivateTargets: env.allowPrivateMonitorTargets });
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        return reply.code(422).send({ error: error.message });
      }
      throw error;
    }

    const [monitor] = await db
      .insert(monitors)
      .values({
        organizationId,
        name: input.name,
        type: input.type,
        target: input.target,
        method: input.type === "http" ? input.method : null,
        headers: input.type === "http" ? (input.headers ?? null) : null,
        body: input.type === "http" ? (input.body ?? null) : null,
        expectedStatus: input.type === "http" ? (input.expectedStatus ?? null) : null,
        intervalSeconds: input.intervalSeconds,
        timeoutMs: input.timeoutMs,
        tags: input.tags,
      })
      .returning();

    await scheduleMonitorCheck(monitorCheckQueue, monitor.id, monitor.intervalSeconds);

    return reply.code(201).send(monitor);
  });

  app.get("/monitors", async (request, reply) => {
    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    if (!organizationId) {
      return reply.send([]);
    }
    const rows = await db.query.monitors.findMany({ where: eq(monitors.organizationId, organizationId) });
    const withStatus = await Promise.all(rows.map(withLastCheck));
    return reply.send(withStatus);
  });

  app.get("/monitors/:id", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const monitor = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }
    return reply.send(await withLastCheck(monitor));
  });

  app.get("/monitors/:id/checks", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const queryParsed = listChecksQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: queryParsed.error.flatten() });
    }

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const monitor = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const rows = await db
      .select()
      .from(checks)
      .where(eq(checks.monitorId, id))
      .orderBy(desc(checks.timestamp))
      .limit(queryParsed.data.limit);

    // checks.id es un bigint (Fase 0.3): JSON no sabe serializarlo, hay que
    // convertirlo a string explícitamente antes de responder (ver la nota
    // de Serialized<T> en packages/shared).
    const serialized = rows.map((row) => ({ ...row, id: row.id.toString() }));
    return reply.send(serialized);
  });

  app.patch("/monitors/:id", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const parsed = updateMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const patch = parsed.data;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const existing = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    if (patch.intervalSeconds !== undefined) {
      const limits = await getOrganizationPlanLimits(organizationId!);
      if (patch.intervalSeconds < limits.minIntervalSeconds) {
        return reply
          .code(422)
          .send({ error: `Tu plan exige un intervalo mínimo de ${limits.minIntervalSeconds} segundos` });
      }
    }

    if (patch.target !== undefined) {
      try {
        await assertPublicHost(extractHostname(existing.type, patch.target), { allowPrivateTargets: env.allowPrivateMonitorTargets });
      } catch (error) {
        if (error instanceof SsrfBlockedError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    }

    const [updated] = await db.update(monitors).set(patch).where(eq(monitors.id, id)).returning();

    // Solo reprogramar si de verdad cambió el intervalo y el monitor está
    // activo — si está pausado, no hay que reactivarlo de rebote por editar
    // otro campo cualquiera.
    if (patch.intervalSeconds !== undefined && !updated.isPaused) {
      await scheduleMonitorCheck(monitorCheckQueue, updated.id, updated.intervalSeconds);
    }

    return reply.send(updated);
  });

  app.delete("/monitors/:id", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const existing = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    await db.delete(monitors).where(eq(monitors.id, id));
    await unscheduleMonitorCheck(monitorCheckQueue, id);

    return reply.code(204).send();
  });

  app.post("/monitors/:id/pause", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const existing = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const [updated] = await db.update(monitors).set({ isPaused: true }).where(eq(monitors.id, id)).returning();
    await unscheduleMonitorCheck(monitorCheckQueue, id);

    return reply.send(updated);
  });

  app.post("/monitors/:id/resume", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = await getPrimaryOrganizationId(request.user!.id);
    const existing = organizationId ? await findOwnedMonitor(organizationId, id) : null;
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const [updated] = await db.update(monitors).set({ isPaused: false }).where(eq(monitors.id, id)).returning();
    await scheduleMonitorCheck(monitorCheckQueue, updated.id, updated.intervalSeconds);

    return reply.send(updated);
  });
}
