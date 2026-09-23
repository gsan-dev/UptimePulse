import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, monitors, organizationMembers, organizations, statusPageMonitors, statusPages, users } from "@uptimepulse/db";
import { normalizeSlug, normalizeUsername } from "@uptimepulse/shared";
import { getMonitorDailyHistory, getMonitorMetrics } from "../lib/metrics.js";

const userParamsSchema = z.object({
  username: z.string().min(1).max(60),
  slug: z.string().min(1).max(60),
});

const orgParamsSchema = z.object({
  orgSlug: z.string().min(1).max(60),
  slug: z.string().min(1).max(60),
});

const HISTORY_DAYS = 90;

const PUBLIC_RATE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

/**
 * Cuerpo común de las dos rutas públicas: dada la organización ya resuelta y
 * el slug de la página, monta la respuesta. Nunca expone el `target` real de
 * un monitor (una URL interna, un host:puerto) ni ningún otro dato de la
 * cuenta — solo `name`/`displayName` y su estado derivado.
 */
async function sendStatusPage(reply: FastifyReply, organizationId: string, slug: string) {
  const page = await db.query.statusPages.findFirst({
    where: and(
      eq(statusPages.organizationId, organizationId),
      eq(statusPages.slug, slug),
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

      const [metrics90d, dailyHistory] = await Promise.all([
        getMonitorMetrics(monitor.id, "90d"),
        getMonitorDailyHistory(monitor.id, HISTORY_DAYS),
      ]);

      return {
        id: monitor.id,
        // El nombre público (Fase 3.3) sustituye al interno cuando existe:
        // "API de pagos" en vez de "api-prod eu-west-1".
        name: link.displayName ?? monitor.name,
        // Fase 4.2: estado consolidado entre regiones (puede ser
        // "degraded"), no el último check crudo.
        currentStatus: monitor.isPaused ? "paused" : (monitor.consolidatedStatus ?? "pending"),
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

/**
 * Sin autenticación a propósito (Fase 3.3): cualquiera con el slug puede
 * verla, ese es el punto de una status page pública. Limitadas con
 * @fastify/rate-limit (ver server.ts) porque son los únicos endpoints de
 * toda la API alcanzables sin JWT.
 *
 * Hay DOS direcciones para la misma cosa:
 *  - /public/status/<username>/<slug> — la original: resuelve a la
 *    organización personal de ese usuario.
 *  - /public/status/team/<org-slug>/<slug> — cualquier organización que
 *    tenga slug, incluidas las de equipo, que con la primera ruta no tenían
 *    ninguna URL propia (solo la del username de su dueño).
 * No se unifican en una sola ruta porque eso metería usernames y slugs de
 * organización en el mismo espacio de nombres, y habría que empezar a
 * impedir que un usuario se llame como una organización ajena. "team" está
 * en RESERVED_USERNAMES, así que /public/status/team/... nunca es ambiguo.
 */
export async function publicStatusRoutes(app: FastifyInstance): Promise<void> {
  // Se registra ANTES que la de username para que quede clarísimo que es la
  // más específica; el router de Fastify prioriza el segmento estático
  // ("team") sobre el parámetro igualmente, pero aquí tienen además
  // distinto número de segmentos, así que no pueden solaparse.
  app.get("/public/status/team/:orgSlug/:slug", PUBLIC_RATE_LIMIT, async (request, reply) => {
    const parsedParams = orgParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "URL inválida" });
    }

    const organization = await db.query.organizations.findFirst({
      where: eq(organizations.slug, normalizeSlug(parsedParams.data.orgSlug)),
    });
    // Una organización inexistente responde igual que una página
    // inexistente: desde fuera no se puede enumerar qué organizaciones hay.
    if (!organization) {
      return reply.code(404).send({ error: "Página no encontrada" });
    }

    return sendStatusPage(reply, organization.id, parsedParams.data.slug);
  });

  // La URL original: el username delimita el espacio de nombres, así que el
  // mismo slug puede existir para varios usuarios. Se resuelve username ->
  // usuario -> su organización principal -> status page con ese slug en esa
  // organización. Un username inexistente y un slug inexistente responden
  // IGUAL (404 sin distinguir) para no permitir enumerar qué usernames
  // existen desde fuera.
  app.get("/public/status/:username/:slug", PUBLIC_RATE_LIMIT, async (request, reply) => {
    const parsedParams = userParamsSchema.safeParse(request.params);
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

    return sendStatusPage(reply, owner.organizationId, parsedParams.data.slug);
  });
}
