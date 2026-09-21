import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicStatusPage,
  type DailyStatus,
  type OverallStatus,
  type PublicStatusPageData,
} from "../api/publicStatus";

const OVERALL_BANNER: Record<OverallStatus, { label: string; className: string }> = {
  operational: { label: "Todos los sistemas operativos", className: "bg-emerald-600" },
  degraded: { label: "Algunos sistemas con problemas", className: "bg-amber-500" },
  outage: { label: "Interrupción del servicio", className: "bg-red-600" },
};

const DAILY_COLOR: Record<DailyStatus, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  outage: "bg-red-500",
  "no-data": "bg-gray-700",
};

const CURRENT_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  up: { label: "Operativo", className: "text-emerald-400" },
  down: { label: "Caído", className: "text-red-400" },
  paused: { label: "Pausado", className: "text-gray-400" },
  pending: { label: "Sin datos", className: "text-gray-500" },
};

function DailyHistoryBar({ history }: { history: { date: string; status: DailyStatus }[] }) {
  return (
    <div className="flex gap-0.5">
      {history.map((point) => (
        <div key={point.date} title={`${point.date}: ${point.status}`} className={`h-8 w-1.5 rounded-sm ${DAILY_COLOR[point.status]}`} />
      ))}
    </div>
  );
}

// Layout completamente distinto al del dashboard (Fase 3.3): sin cabecera de
// sesión, sin sidebar, sin enlaces a /monitors — una página aislada pensada
// para compartirse con quien NO tiene cuenta.
export function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicStatusPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getPublicStatusPage(slug)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar la página");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-400">
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-400">
        <p>Cargando…</p>
      </div>
    );
  }

  const banner = OVERALL_BANNER[data.overallStatus];

  return (
    <div className="min-h-screen bg-gray-950">
      <div className={`px-4 py-6 text-center text-lg font-semibold text-white ${banner.className}`}>{banner.label}</div>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-8 text-2xl font-semibold text-white">{data.title}</h1>

        <div className="space-y-4">
          {data.monitors.map((monitor) => {
            const statusInfo = CURRENT_STATUS_LABEL[monitor.currentStatus] ?? CURRENT_STATUS_LABEL.pending;
            return (
              <div key={monitor.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-white">{monitor.name}</p>
                  <span className={`text-sm font-medium ${statusInfo.className}`}>{statusInfo.label}</span>
                </div>
                <DailyHistoryBar history={monitor.dailyHistory} />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>{monitor.dailyHistory.length} días</span>
                  <span>{monitor.uptimePercentage90d != null ? `${monitor.uptimePercentage90d}% uptime (90d)` : "Sin datos suficientes"}</span>
                </div>
              </div>
            );
          })}

          {data.monitors.length === 0 && <p className="text-center text-gray-500">No hay servicios que mostrar.</p>}
        </div>

        <p className="mt-10 text-center text-xs text-gray-600">Powered by UptimePulse</p>
      </div>
    </div>
  );
}
