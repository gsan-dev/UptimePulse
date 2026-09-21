import { eq, sql } from "drizzle-orm";
import { db, monitors, organizations, plans } from "@uptimepulse/db";

export interface PlanLimits {
  planName: string;
  maxMonitors: number;
  minIntervalSeconds: number;
  allowedChannels: string[];
}

// Red de seguridad para una organización sin plan asignado (no debería pasar
// tras la Fase 1.2, ya que el registro asigna el plan "free" siempre — ver
// migración 0003_seed_default_plan.sql). Mismos valores que ese plan, para
// no inventar un segundo conjunto de números "mágicos" distinto.
const FALLBACK_LIMITS: PlanLimits = {
  planName: "free",
  maxMonitors: 5,
  minIntervalSeconds: 300,
  allowedChannels: ["email"],
};

export async function getOrganizationPlanLimits(organizationId: string): Promise<PlanLimits> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  if (!org?.planId) {
    return FALLBACK_LIMITS;
  }

  const plan = await db.query.plans.findFirst({ where: eq(plans.id, org.planId) });
  if (!plan) {
    return FALLBACK_LIMITS;
  }

  return {
    planName: plan.name,
    maxMonitors: plan.maxMonitors,
    minIntervalSeconds: plan.minIntervalSeconds,
    allowedChannels: plan.allowedChannels,
  };
}

export async function countOrganizationMonitors(organizationId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(monitors)
    .where(eq(monitors.organizationId, organizationId));
  return count;
}

/** Planes visibles en la página de precios, del más barato al más caro. */
export async function listPlans() {
  return db.query.plans.findMany({ orderBy: (table, { asc }) => [asc(table.priceCentsMonthly), asc(table.name)] });
}
