import { eq } from "drizzle-orm";
import { db, organizations, plans } from "@uptimepulse/db";

export interface PlanLimits {
  maxMonitors: number;
  minIntervalSeconds: number;
}

// Red de seguridad para una organización sin plan asignado (no debería pasar
// tras la Fase 1.2, ya que el registro asigna el plan "free" siempre — ver
// migración 0003_seed_default_plan.sql). Mismos valores que ese plan, para
// no inventar un segundo conjunto de números "mágicos" distinto.
const FALLBACK_LIMITS: PlanLimits = { maxMonitors: 5, minIntervalSeconds: 300 };

export async function getOrganizationPlanLimits(organizationId: string): Promise<PlanLimits> {
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  if (!org?.planId) {
    return FALLBACK_LIMITS;
  }

  const plan = await db.query.plans.findFirst({ where: eq(plans.id, org.planId) });
  if (!plan) {
    return FALLBACK_LIMITS;
  }

  return { maxMonitors: plan.maxMonitors, minIntervalSeconds: plan.minIntervalSeconds };
}
