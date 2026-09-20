import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listMonitors } from "../api/monitors";
import type { ApiMonitor } from "../api/types";
import { monitorDisplayStatus, StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";

// Polling simple (no WebSocket todavía, eso es Fase 2.3). 10s coincide con
// el ciclo de sondeo por defecto del worker (WORKER_POLL_INTERVAL_MS).
const POLL_INTERVAL_MS = 10000;

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [monitors, setMonitors] = useState<ApiMonitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMonitors(await listMonitors());
      setError(null);
    } catch {
      setError("No se pudieron cargar los monitores");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Monitores</h1>
          <p className="text-sm text-gray-400">{user?.email}</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/monitors/new"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Nuevo monitor
          </Link>
          <button
            onClick={() => void logout()}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {error && <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

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

      <ul className="space-y-2">
        {monitors?.map((monitor) => (
          <li key={monitor.id}>
            <Link
              to={`/monitors/${monitor.id}`}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/10"
            >
              <div>
                <p className="font-medium text-white">{monitor.name}</p>
                <p className="text-sm text-gray-400">{monitor.target}</p>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-gray-400">
                  {monitor.lastCheck?.responseTimeMs != null ? `${monitor.lastCheck.responseTimeMs} ms` : "—"}
                </span>
                <StatusBadge status={monitorDisplayStatus(monitor)} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
