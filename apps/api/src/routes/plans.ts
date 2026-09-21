import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, organizations, plans } from "@uptimepulse/db";
import { createLogger } from "@uptimepulse/shared";
import { countOrganizationMonitors, listPlans } from "../lib/plans.js";
import { requireAuth, requireOrganization, requireRole, requireUserSession } from "../plugins/auth.js";

const logger = createLogger("api");

const idParamSchema = z.object({ id: z.string().uuid() });
const changePlanSchema = z.object({ planName: z.string().min(1).max(50) });

function publicPlan(plan: typeof plans.$inferSelect) {
  return {
    id: plan.id,
    name: plan.name,
    maxMonitors: plan.maxMonitors,
    minIntervalSeconds: plan.minIntervalSeconds,
    allowedChannels: plan.allowedChannels,
    priceCentsMonthly: plan.priceCentsMonthly,
  };
}

export async function planRoutes(app: FastifyInstance): Promise<void> {
  // Pública: la página de precios se ve sin cuenta. Rate limit como el
  // resto de endpoints sin JWT que tocan la base de datos.
  app.get("/plans", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_request, reply) => {
    const rows = await listPlans();
    return reply.send(rows.map(publicPlan));
  });

  app.register(async (scoped) => {
    scoped.addHook("preHandler", requireAuth);
    scoped.addHook("preHandler", requireUserSession);
    scoped.addHook("preHandler", requireOrganization);

    // Organización activa con su plan y su uso actual — lo que necesita la
    // página de precios para decir "estás en free, usas 4 de 5 monitores".
    scoped.get("/organizations/:id", async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success || request.organization!.id !== params.data.id) {
        return reply.code(403).send({ error: "No perteneces a esa organización" });
      }
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, params.data.id) });
      if (!org) {
        return reply.code(404).send({ error: "Organización no encontrada" });
      }
      const plan = org.planId ? await db.query.plans.findFirst({ where: eq(plans.id, org.planId) }) : null;
      const monitorCount = await countOrganizationMonitors(org.id);
      return reply.send({
        id: org.id,
        name: org.name,
        role: request.organization!.role,
        plan: plan ? publicPlan(plan) : null,
        usage: { monitors: monitorCount },
      });
    });

    /**
     * Cambio de plan SIMULADO (Fase 4.3): no hay pasarela de pago. Ver el
     * ADR "Stripe" en TASK.md — cuando existan claves de Stripe, este
     * endpoint pasará a crear una Checkout Session y el cambio real lo hará
     * el webhook `checkout.session.completed`, no esta ruta.
     *
     * Se protege lo que sí importa aunque el pago sea de mentira: solo un
     * admin cambia el plan, y no se puede bajar a un plan cuyo límite de
     * monitores ya se supera (habría monitores "ilegales" que el plan nuevo
     * no permite crear pero sí seguirían ejecutándose).
     */
    scoped.post("/organizations/:id/plan", { preHandler: requireRole("admin") }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success || request.organization!.id !== params.data.id) {
        return reply.code(403).send({ error: "No perteneces a esa organización" });
      }
      const body = changePlanSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }
      const plan = await db.query.plans.findFirst({ where: eq(plans.name, body.data.planName) });
      if (!plan) {
        return reply.code(404).send({ error: "Ese plan no existe" });
      }

      const monitorCount = await countOrganizationMonitors(params.data.id);
      if (monitorCount > plan.maxMonitors) {
        return reply.code(409).send({
          error: `Tienes ${monitorCount} monitores y el plan "${plan.name}" permite ${plan.maxMonitors}: borra ${monitorCount - plan.maxMonitors} antes de cambiar`,
        });
      }

      await db.update(organizations).set({ planId: plan.id }).where(eq(organizations.id, params.data.id));
      logger.info("plan de organización cambiado (simulado, sin pago)", {
        organizationId: params.data.id,
        plan: plan.name,
        byUserId: request.user!.id,
      });
      return reply.send({ organizationId: params.data.id, plan: publicPlan(plan) });
    });
  });
}
