import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { checks, db, monitors, statusPageMonitors, statusPages } from "@uptimepulse/db";
import { getMonitorDailyHistory, getMonitorMetrics } from "../lib/metrics.js";

const slugParamSchema = z.object({ slug: z.string().min(1).max(60) });

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
  app.get(
    "/public/status/:slug",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsedParams = slugParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: "slug inválido" });
      }

      const page = await db.query.statusPages.findFirst({
        where: and(eq(statusPages.slug, parsedParams.data.slug), eq(statusPages.isPublic, true)),
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
