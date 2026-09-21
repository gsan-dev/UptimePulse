import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { checks, db, monitors, organizationMembers, statusPageMonitors, statusPages, users } from "@uptimepulse/db";
import { normalizeUsername } from "@uptimepulse/shared";
import { getMonitorDailyHistory, getMonitorMetrics } from "../lib/metrics.js";

const paramsSchema = z.object({
  username: z.string().min(1).max(60),
  slug: z.string().min(1).max(60),
});

const HISTORY_DAYS = 90;

async function getLastCheckStatus(monitorId: string): Promise<"up" | "down" | null> {
  const [last] = await db
    .select({ status: checks.status })
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.timestamp))
    .limit(1);
  return last?.status ?? null;
}

/**
 * Sin autenticación a propósito (Fase 3.3): cualquiera con el slug puede
 * verla, ese es el punto de una status page pública. Por lo mismo, nunca
 * expone el `target` real de un monitor (una URL interna, un host:puerto)
 * ni ningún otro dato de la cuenta — solo `name`/`displayName` y su estado
 * derivado. Limitada con @fastify/rate-limit (ver server.ts) porque es el
 * único endpoint de toda la API alcanzable sin JWT.
 */
export async function publicStatusRoutes(app: FastifyInstance): Promise<void> {
  // La URL pública es /status/<username>/<slug>: el username delimita el
  // espacio de nombres, así que el mismo slug puede existir para varios
  // usuarios. Se resuelve username -> usuario -> su organización principal
  // (misma simplificación que getPrimaryOrganizationId: una organización por
  // usuario hasta la Fase 4) -> status page con ese slug en esa organización.
  // Un username inexistente y un slug inexistente responden IGUAL (404 sin
  // distinguir) para no permitir enumerar qué usernames existen desde fuera.
  app.get(
    "/public/status/:username/:slug",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsedParams = paramsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "URL inválida" });
      }
      const username = normalizeUsername(parsedParams.data.username);

      const [owner] = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(users)
        .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
        .where(eq(users.username, username))
        .limit(1);
      if (!owner) {
        return reply.code(404).send({ error: "Página no encontrada" });
      }

      const page = await db.query.statusPages.findFirst({
        where: and(
          eq(statusPages.organizationId, owner.organizationId),
          eq(statusPages.slug, parsedParams.data.slug),
          eq(statusPages.isPublic, true)
        ),
      });
      if (!page) {
        return reply.code(404).send({ error: "Página no encontrada" });
      }

      const links = await db
        .select({ monitorId: statusPageMonitors.monitorId, displayName: statusPageMonitors.displayName })
        .from(statusPageMonitors)
        .where(eq(statusPageMonitors.statusPageId, page.id));

      const monitorsData = await Promise.all(
        links.map(async (link) => {
          const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, link.monitorId) });
          if (!monitor) return null;

          const [metrics90d, dailyHistory, lastStatus] = await Promise.all([
            getMonitorMetrics(monitor.id, "90d"),
            getMonitorDailyHistory(monitor.id, HISTORY_DAYS),
            getLastCheckStatus(monitor.id),
          ]);

          return {
            id: monitor.id,
            name: link.displayName ?? monitor.name,
            currentStatus: monitor.isPaused ? "paused" : (lastStatus ?? "pending"),
            uptimePercentage90d: metrics90d.uptimePercentage,
            dailyHistory,
          };
        })
      );

      const visibleMonitors = monitorsData.filter((m): m is NonNullable<typeof m> => m !== null);
      const downCount = visibleMonitors.filter((m) => m.currentStatus === "down").length;
      const overallStatus =
        downCount === 0 ? "operational" : downCount === visibleMonitors.length ? "outage" : "degraded";

      return reply.send({ title: page.title, overallStatus, monitors: visibleMonitors });
    }
  );
}
