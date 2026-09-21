import { apiFetch } from "./client";
import type { OrganizationRole } from "./organizations";

export interface ApiPlan {
  id: string;
  name: string;
  maxMonitors: number;
  minIntervalSeconds: number;
  allowedChannels: string[];
  priceCentsMonthly: number;
}

export interface ApiOrganizationDetail {
  id: string;
  name: string;
  role: OrganizationRole;
  plan: ApiPlan | null;
  usage: { monitors: number };
}

/** Pública: la página de precios se ve sin sesión. */
export function listPlans(): Promise<ApiPlan[]> {
  return apiFetch<ApiPlan[]>("/plans", { skipAuthRetry: true });
}

export function getOrganizationDetail(organizationId: string): Promise<ApiOrganizationDetail> {
  return apiFetch<ApiOrganizationDetail>(`/organizations/${organizationId}`);
}

/** Cambio de plan simulado (sin pasarela de pago; ver ADR Stripe en TASK.md). */
export function changePlan(organizationId: string, planName: string): Promise<{ plan: ApiPlan }> {
  return apiFetch(`/organizations/${organizationId}/plan`, { method: "POST", body: { planName } });
}

/**
 * Forma del error 422 que devuelve la API cuando un plan bloquea una acción
 * (crear monitor por encima del límite, intervalo demasiado corto, tipo de
 * canal no incluido). Permite al formulario enlazar a /pricing.
 */
export function isPlanLimitError(details: unknown): boolean {
  return !!details && typeof details === "object" && "limit" in details;
}

export function formatPrice(cents: number): string {
  if (cents === 0) return "Gratis";
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €/mes`;
}
