import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  changePlan,
  formatPrice,
  getOrganizationDetail,
  listPlans,
  type ApiOrganizationDetail,
  type ApiPlan,
} from "../api/plans";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  discord: "Discord",
  slack: "Slack",
  webhook: "Webhook",
  sms: "SMS",
};

function formatInterval(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

/**
 * Página de precios (Fase 4.3) conectada a los planes REALES del backend
 * (`GET /plans`), no a una tabla estática: si cambian los límites en la base
 * de datos, cambia la página. Con sesión, marca el plan actual de la
 * organización activa y su uso; un admin puede cambiar de plan (simulado:
 * sin pasarela de pago, ver ADR Stripe en TASK.md).
 */
export function PricingPage() {
  const { user } = useAuth();
  const { active, isAdmin, refresh: refreshOrganizations } = useOrganization();
  const confirm = useConfirm();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [detail, setDetail] = useState<ApiOrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [plansData, detailData] = await Promise.all([
        listPlans(),
        active ? getOrganizationDetail(active.id) : Promise.resolve(null),
      ]);
      setPlans(plansData);
      setDetail(detailData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los planes");
    }
  }, [active]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleChange(plan: ApiPlan): Promise<void> {
    if (!active) return;
    const confirmed = await confirm({
      title: `¿Cambiar "${active.name}" al plan ${plan.name}?`,
      description:
        plan.priceCentsMonthly > 0
          ? `${formatPrice(plan.priceCentsMonthly)}. Sin pasarela de pago todavía: el cambio se aplica al instante (simulado).`
          : "Los monitores y canales existentes se conservan; solo cambian los límites para crear nuevos.",
      confirmLabel: "Cambiar de plan",
      danger: false,
    });
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    setBusyPlan(plan.name);
    try {
      await changePlan(active.id, plan.name);
      setNotice(`Ahora estás en el plan ${plan.name}.`);
      await Promise.all([refresh(), refreshOrganizations()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar de plan");
    } finally {
      setBusyPlan(null);
    }
  }

  const currentPlanName = detail?.plan?.name ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to={user ? "/monitors" : "/login"} className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-white">Planes</h1>
      <p className="mt-1 mb-6 text-sm text-gray-400">
        {detail
          ? `${detail.name} está en el plan ${currentPlanName ?? "—"} y usa ${detail.usage.monitors} de ${detail.plan?.maxMonitors ?? "—"} monitores.`
          : "Límites reales de cada plan, tal como los aplica la API."}
      </p>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}
      {notice && (
        <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {plans === null && !error && <p className="text-gray-400">Cargando…</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans?.map((plan) => {
          const isCurrent = plan.name === currentPlanName;
          return (
            <div
              key={plan.id}
              data-plan={plan.name}
              className={`rounded-xl border p-6 ${
                isCurrent ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold capitalize text-white">{plan.name}</h2>
                <span className="text-sm text-gray-300">{formatPrice(plan.priceCentsMonthly)}</span>
              </div>
              <ul className="mb-6 space-y-1 text-sm text-gray-300">
                <li>Hasta {plan.maxMonitors} monitores</li>
                <li>Intervalo mínimo de {formatInterval(plan.minIntervalSeconds)}</li>
                <li>
                  Canales: {plan.allowedChannels.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}
                </li>
              </ul>
              {isCurrent ? (
                <span className="inline-block rounded-md bg-emerald-600/20 px-3 py-1.5 text-sm text-emerald-300">
                  Tu plan actual
                </span>
              ) : user && active ? (
                isAdmin ? (
                  <button
                    onClick={() => void handleChange(plan)}
                    disabled={busyPlan !== null}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busyPlan === plan.name ? "Cambiando…" : "Cambiar a este plan"}
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">
                    Solo un administrador puede cambiar el plan
                  </span>
                )
              ) : (
                <Link to="/register" className="text-sm text-emerald-400 hover:underline">
                  Crear cuenta
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
