import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and, or, isNull, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { checks, db, incidents, maintenanceWindows, monitorNotificationChannels, monitors, notificationChannels } from "@uptimepulse/db";
import { assertPublicHost, extractHostname, SsrfBlockedError } from "@uptimepulse/server-utils";
import { env } from "../env.js";
import { requireAuth, requireOrganization, requireRole } from "../plugins/auth.js";
import { countOrganizationMonitors, getOrganizationPlanLimits } from "../lib/plans.js";
import { getMonitorMetrics, getMonitorTimeseries, getOrganizationSummary, rangeToInterval, UPTIME_RANGES } from "../lib/metrics.js";
import { regionQueues } from "../queue.js";

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
const idAndWindowIdParamSchema = z.object({ id: z.string().uuid(), windowId: z.string().uuid() });
const idAndChannelIdParamSchema = z.object({ id: z.string().uuid(), channelId: z.string().uuid() });

const listChecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const metricsQuerySchema = z.object({
  range: z.enum(UPTIME_RANGES).default("24h"),
});

const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Opcional: filtra a incidentes que se solapan con el rango (Fase 2.4,
  // para las zonas sombreadas del gráfico). Sin él, devuelve los últimos
  // `limit` incidentes sin más (comportamiento de la Fase 2.2).
  range: z.enum(UPTIME_RANGES).optional(),
});

const createMaintenanceWindowSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: "endsAt debe ser posterior a startsAt",
    path: ["endsAt"],
  });

function parseId(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const result = idParamSchema.safeParse(request.params);
  if (!result.success) {
    reply.code(400).send({ error: "El id debe ser un UUID válido" });
    return undefined;
  }
  return result.data.id;
}

function parseIdAndWindowId(
  request: FastifyRequest,
  reply: FastifyReply
): { id: string; windowId: string } | undefined {
  const result = idAndWindowIdParamSchema.safeParse(request.params);
  if (!result.success) {
    reply.code(400).send({ error: "El id y el windowId deben ser UUID válidos" });
    return undefined;
  }
  return result.data;
}

function parseIdAndChannelId(
  request: FastifyRequest,
  reply: FastifyReply
): { id: string; channelId: string } | undefined {
  const result = idAndChannelIdParamSchema.safeParse(request.params);
  if (!result.success) {
    reply.code(400).send({ error: "El id y el channelId deben ser UUID válidos" });
    return undefined;
  }
  return result.data;
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

// Fase 4.2: último check de cada región configurada — para que el detalle
// muestre "desde dónde" se ve caído un monitor. Solo regiones de
// CHECK_REGIONS: una región retirada puede tener checks antiguos que ya no
// cuentan para el quórum, y aquí tampoco deben aparecer como si contaran.
async function getRegionSnapshots(monitorId: string) {
  const rows = await db
    .selectDistinctOn([checks.region], {
      region: checks.region,
      status: checks.status,
      responseTimeMs: checks.responseTimeMs,
      timestamp: checks.timestamp,
    })
    .from(checks)
    .where(and(eq(checks.monitorId, monitorId), inArray(checks.region, env.checkRegions)))
    .orderBy(checks.region, desc(checks.timestamp));
  const byRegion = new Map(rows.map((row) => [row.region, row]));
  return env.checkRegions.map((region) => byRegion.get(region) ?? { region, status: null, responseTimeMs: null, timestamp: null });
}

export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  // Fase 4.1: resuelve la organización activa (X-Organization-Id o la
  // personal) y el rol del usuario en ella. Las rutas que escriben exigen
  // además rol "editor" o superior; las de lectura valen con "readonly".
  app.addHook("preHandler", requireOrganization);

  app.post("/monitors", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsed = createMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const input = parsed.data;

    const organizationId = request.organization!.id;

    const limits = await getOrganizationPlanLimits(organizationId);
    if (input.intervalSeconds < limits.minIntervalSeconds) {
      return reply
        .code(422)
        .send({
          error: `Tu plan "${limits.planName}" exige un intervalo mínimo de ${limits.minIntervalSeconds} segundos`,
          limit: { kind: "minInterval", plan: limits.planName, minIntervalSeconds: limits.minIntervalSeconds },
        });
    }

    const currentCount = await countOrganizationMonitors(organizationId);
    if (currentCount >= limits.maxMonitors) {
      return reply.code(422).send({
        error: `Tu plan "${limits.planName}" permite un máximo de ${limits.maxMonitors} monitores`,
        limit: { kind: "maxMonitors", plan: limits.planName, max: limits.maxMonitors, current: currentCount },
      });
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

    await regionQueues.scheduleMonitorCheck(monitor.id, monitor.intervalSeconds);

    return reply.code(201).send(monitor);
  });

  app.get("/monitors", async (request, reply) => {
    const organizationId = request.organization!.id;
    const rows = await db.query.monitors.findMany({ where: eq(monitors.organizationId, organizationId) });
    const withStatus = await Promise.all(rows.map(withLastCheck));
    return reply.send(withStatus);
  });

  app.get("/monitors/:id", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }
    return reply.send({ ...(await withLastCheck(monitor)), regions: await getRegionSnapshots(monitor.id) });
  });

  app.get("/monitors/:id/checks", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const queryParsed = listChecksQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: queryParsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
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

  app.patch("/monitors/:id", { preHandler: requireRole("editor") }, async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const parsed = updateMonitorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const patch = parsed.data;

    const organizationId = request.organization!.id;
    const existing = await findOwnedMonitor(organizationId, id);
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    if (patch.intervalSeconds !== undefined) {
      const limits = await getOrganizationPlanLimits(organizationId);
      if (patch.intervalSeconds < limits.minIntervalSeconds) {
        return reply
          .code(422)
          .send({
          error: `Tu plan "${limits.planName}" exige un intervalo mínimo de ${limits.minIntervalSeconds} segundos`,
          limit: { kind: "minInterval", plan: limits.planName, minIntervalSeconds: limits.minIntervalSeconds },
        });
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
      await regionQueues.scheduleMonitorCheck(updated.id, updated.intervalSeconds);
    }

    return reply.send(updated);
  });

  app.delete("/monitors/:id", { preHandler: requireRole("editor") }, async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const existing = await findOwnedMonitor(organizationId, id);
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    await db.delete(monitors).where(eq(monitors.id, id));
    await regionQueues.unscheduleMonitorCheck(id);

    return reply.code(204).send();
  });

  app.post("/monitors/:id/pause", { preHandler: requireRole("editor") }, async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const existing = await findOwnedMonitor(organizationId, id);
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const [updated] = await db.update(monitors).set({ isPaused: true }).where(eq(monitors.id, id)).returning();
    await regionQueues.unscheduleMonitorCheck(id);

    return reply.send(updated);
  });

  app.post("/monitors/:id/resume", { preHandler: requireRole("editor") }, async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const existing = await findOwnedMonitor(organizationId, id);
    if (!existing) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const [updated] = await db.update(monitors).set({ isPaused: false }).where(eq(monitors.id, id)).returning();
    await regionQueues.scheduleMonitorCheck(updated.id, updated.intervalSeconds);

    return reply.send(updated);
  });

  // --- Métricas e incidentes (Fase 2.2) ---

  app.get("/monitors/:id/metrics", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const queryParsed = metricsQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: queryParsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    return reply.send(await getMonitorMetrics(id, queryParsed.data.range));
  });

  app.get("/monitors/:id/timeseries", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const queryParsed = metricsQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: queryParsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    return reply.send(await getMonitorTimeseries(id, queryParsed.data.range));
  });

  // Resumen agregado de la organización para la cabecera del dashboard
  // (Fase 2.4): uptime medio global + incidentes activos + una sparkline de
  // 24h por monitor, en una sola petición.
  app.get("/monitors/summary", async (request, reply) => {
    const organizationId = request.organization!.id;

    const orgMonitors = await db.query.monitors.findMany({ where: eq(monitors.organizationId, organizationId) });

    const [summary, sparklineEntries] = await Promise.all([
      getOrganizationSummary(organizationId),
      Promise.all(orgMonitors.map(async (m) => [m.id, await getMonitorTimeseries(m.id, "24h")] as const)),
    ]);

    return reply.send({ ...summary, sparklines: Object.fromEntries(sparklineEntries) });
  });

  app.get("/monitors/:id/incidents", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const queryParsed = listIncidentsQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: queryParsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const { range, limit } = queryParsed.data;
    const rows = await db
      .select()
      .from(incidents)
      .where(
        range
          ? and(
              eq(incidents.monitorId, id),
              // Un incidente "pertenece" al rango si empezó dentro de él, o
              // si sigue abierto (aunque empezara antes) — de lo contrario
              // una caída larga desaparecería del gráfico en cuanto su
              // inicio quedara fuera de la ventana visible.
              or(isNull(incidents.resolvedAt), sql`${incidents.startedAt} >= now() - ${rangeToInterval(range)}::interval`)
            )
          : eq(incidents.monitorId, id)
      )
      .orderBy(desc(incidents.startedAt))
      .limit(limit);

    return reply.send(rows);
  });

  // --- Ventanas de mantenimiento (Fase 2.2) ---
  // CRUD mínimo: solo lo necesario para poder programar una ventana y que el
  // motor de incidentes del worker la respete. No hay edición porque para
  // este alcance basta con borrar y volver a crear.

  app.get("/monitors/:id/maintenance-windows", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const rows = await db
      .select()
      .from(maintenanceWindows)
      .where(eq(maintenanceWindows.monitorId, id))
      .orderBy(desc(maintenanceWindows.startsAt));

    return reply.send(rows);
  });

  app.post("/monitors/:id/maintenance-windows", { preHandler: requireRole("editor") }, async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const parsed = createMaintenanceWindowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const [window] = await db
      .insert(maintenanceWindows)
      .values({
        monitorId: id,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        note: parsed.data.note ?? null,
      })
      .returning();

    return reply.code(201).send(window);
  });

  app.delete("/monitors/:id/maintenance-windows/:windowId", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsedParams = parseIdAndWindowId(request, reply);
    if (!parsedParams) return;
    const { id, windowId } = parsedParams;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    await db
      .delete(maintenanceWindows)
      .where(and(eq(maintenanceWindows.id, windowId), eq(maintenanceWindows.monitorId, id)));

    return reply.code(204).send();
  });

  // --- Canales de notificación por monitor (Fase 3.2) ---
  // La "matriz" del README §3.5 se resuelve así: cada monitor expone qué
  // canales (ya creados en /notification-channels) tiene activados, y se
  // activan/desactivan uno a uno — no hace falta un endpoint que reciba la
  // lista completa cada vez.

  app.get("/monitors/:id/notification-channels", async (request, reply) => {
    const id = parseId(request, reply);
    if (!id) return;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const rows = await db
      .select({ channelId: monitorNotificationChannels.channelId })
      .from(monitorNotificationChannels)
      .where(eq(monitorNotificationChannels.monitorId, id));

    return reply.send(rows.map((row) => row.channelId));
  });

  app.post("/monitors/:id/notification-channels/:channelId", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsedParams = parseIdAndChannelId(request, reply);
    if (!parsedParams) return;
    const { id, channelId } = parsedParams;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    const channel = organizationId
      ? await db.query.notificationChannels.findFirst({
          where: and(eq(notificationChannels.id, channelId), eq(notificationChannels.organizationId, organizationId)),
        })
      : null;
    if (!channel) {
      return reply.code(404).send({ error: "Canal no encontrado" });
    }

    await db
      .insert(monitorNotificationChannels)
      .values({ monitorId: id, channelId })
      .onConflictDoNothing();

    return reply.code(204).send();
  });

  app.delete("/monitors/:id/notification-channels/:channelId", { preHandler: requireRole("editor") }, async (request, reply) => {
    const parsedParams = parseIdAndChannelId(request, reply);
    if (!parsedParams) return;
    const { id, channelId } = parsedParams;

    const organizationId = request.organization!.id;
    const monitor = await findOwnedMonitor(organizationId, id);
    if (!monitor) {
      return reply.code(404).send({ error: "Monitor no encontrado" });
    }

    await db
      .delete(monitorNotificationChannels)
      .where(and(eq(monitorNotificationChannels.monitorId, id), eq(monitorNotificationChannels.channelId, channelId)));

    return reply.code(204).send();
  });
}
