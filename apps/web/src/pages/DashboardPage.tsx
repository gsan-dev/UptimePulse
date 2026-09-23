import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboardSummary, listMonitors } from "../api/monitors";
import type { ApiDashboardSummary, ApiMonitor } from "../api/types";
import { OrganizationSwitcher } from "../components/OrganizationSwitcher";
import { Sparkline } from "../components/Sparkline";
import { monitorDisplayStatus, StatusBadge } from "../components/StatusBadge";
import { SummaryHeader } from "../components/SummaryHeader";
import { TagFilter } from "../components/TagFilter";
import { collectTags, filterByTags } from "../lib/tags";
import { useAuth } from "../context/AuthContext";
import { useOrganization } from "../context/OrganizationContext";
import { useRealtime } from "../context/RealtimeContext";
import { useToast } from "../context/ToastContext";

export function DashboardPage() {
  const { user, logout } = useAuth();
  const { canEdit } = useOrganization();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();
  const [monitors, setMonitors] = useState<ApiMonitor[] | null>(null);
  const [summary, setSummary] = useState<ApiDashboardSummary | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [monitorsData, summaryData] = await Promise.all([
        listMonitors(),
        getDashboardSummary(),
      ]);
      setMonitors(monitorsData);
      setSummary(summaryData);
      setError(null);
    } catch {
      setError("No se pudieron cargar los monitores");
    }
  }, []);

  // Carga inicial única — a partir de aquí, el WebSocket (Fase 2.3) avisa
  // cuándo volver a pedir datos. Ya no hay sondeo a intervalo fijo.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribe((event) => {
      void refresh();
      showToast(
        `${event.name} ahora está ${
          event.status === "up"
            ? "operativo ✅"
            : event.status === "degraded"
              ? `degradado 🟡 (caído desde ${event.downRegions.join(", ")})`
              : "caído 🔴"
        }`,
        event.status
      );
    });
  }, [subscribe, refresh, showToast]);

  // Las etiquetas salen de TODOS los monitores (si no, filtrar por una
  // haría desaparecer las demás del filtro y no habría forma de volver),
  // pero la lista y los contadores hablan de lo que se está viendo: con un
  // filtro puesto, "3 operativos" tiene que referirse a esos tres.
  const allTags = useMemo(() => collectTags(monitors ?? []), [monitors]);
  const visibleMonitors = useMemo(
    () => (monitors === null ? null : filterByTags(monitors, selectedTags)),
    [monitors, selectedTags]
  );

  const upCount = visibleMonitors?.filter((m) => monitorDisplayStatus(m) === "up").length ?? 0;
  const downCount = visibleMonitors?.filter((m) => monitorDisplayStatus(m) === "down").length ?? 0;
  const pausedCount = visibleMonitors?.filter((m) => monitorDisplayStatus(m) === "paused").length ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Monitores</h1>
          <p className="text-sm text-gray-400">
            {user?.fullName ?? user?.email}{" "}
            <Link to="/profile" className="text-gray-500 hover:text-emerald-400">
              @{user?.username}
            </Link>
          </p>
          <div className="mt-2">
            <OrganizationSwitcher />
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            to="/status-pages"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            Status pages
          </Link>
          <Link
            to="/channels"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            Canales
          </Link>
          {canEdit && (
            <Link
              to="/monitors/new"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Nuevo monitor
            </Link>
          )}
          <button
            onClick={() => void logout()}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {monitors !== null && monitors.length > 0 && (
        <TagFilter tags={allTags} selected={selectedTags} onChange={setSelectedTags} />
      )}

      {visibleMonitors !== null && visibleMonitors.length > 0 && (
        <SummaryHeader
          upCount={upCount}
          downCount={downCount}
          pausedCount={pausedCount}
          avgUptimePercentage={summary?.avgUptimePercentage ?? null}
          activeIncidents={summary?.activeIncidents ?? 0}
        />
      )}

      {monitors === null && <p className="text-gray-400">Cargando…</p>}

      {monitors !== null && monitors.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-gray-400">
          Todavía no tienes monitores.{" "}
          <Link to="/monitors/new" className="text-emerald-400 hover:underline">
            Crea el primero
          </Link>
          .
        </p>
      )}

      {monitors !== null && monitors.length > 0 && visibleMonitors?.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-gray-400">
          Ningún monitor tiene {selectedTags.length === 1 ? "esa etiqueta" : "todas esas etiquetas"}.
        </p>
      )}

      <ul className="space-y-2">
        {visibleMonitors?.map((monitor) => {
          const sparklinePoints = summary?.sparklines[monitor.id] ?? [];
          return (
            <li key={monitor.id}>
              <Link
                to={`/monitors/${monitor.id}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/10"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{monitor.name}</p>
                  <p className="truncate text-sm text-gray-400">{monitor.target}</p>
                  {(monitor.tags?.length ?? 0) > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {monitor.tags?.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-6">
                  <Sparkline
                    points={sparklinePoints}
                    hasDowntime={sparklinePoints.some((p) => p.downChecks > 0)}
                  />
                  <span className="text-sm text-gray-400">
                    {monitor.lastCheck?.responseTimeMs != null
                      ? `${monitor.lastCheck.responseTimeMs} ms`
                      : "—"}
                  </span>
                  <StatusBadge status={monitorDisplayStatus(monitor)} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
