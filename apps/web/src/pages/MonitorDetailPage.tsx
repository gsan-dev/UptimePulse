import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  deleteMonitor,
  getMonitor,
  listMonitorChecks,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
} from "../api/monitors";
import type { ApiCheck, ApiMonitor } from "../api/types";
import { monitorDisplayStatus, StatusBadge } from "../components/StatusBadge";

const POLL_INTERVAL_MS = 10000;
const CHECKS_LIMIT = 20;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-medium text-white">{value}</p>
    </div>
  );
}

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [monitor, setMonitor] = useState<ApiMonitor | null>(null);
  const [checks, setChecks] = useState<ApiCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState(300);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [monitorData, checksData] = await Promise.all([getMonitor(id), listMonitorChecks(id, CHECKS_LIMIT)]);
      setMonitor(monitorData);
      setChecks(checksData);
      setError(null);
    } catch {
      setError("No se pudo cargar el monitor");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (monitor && !isEditing) {
      setEditName(monitor.name);
      setEditInterval(monitor.intervalSeconds);
    }
  }, [monitor, isEditing]);

  async function handleTogglePause(): Promise<void> {
    if (!monitor) return;
    setMonitor(monitor.isPaused ? await resumeMonitor(monitor.id) : await pauseMonitor(monitor.id));
  }

  async function handleDelete(): Promise<void> {
    if (!monitor) return;
    if (!confirm(`¿Borrar el monitor "${monitor.name}"? Esta acción no se puede deshacer.`)) return;
    await deleteMonitor(monitor.id);
    navigate("/monitors");
  }

  async function handleSaveEdit(): Promise<void> {
    if (!monitor) return;
    try {
      setMonitor(await updateMonitor(monitor.id, { name: editName, intervalSeconds: editInterval }));
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el cambio");
    }
  }

  if (error && !monitor) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-red-400">{error}</div>;
  }
  if (!monitor) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-gray-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <header className="mt-4 mb-6 flex items-start justify-between">
        <div>
          {isEditing ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-2xl font-semibold text-white"
            />
          ) : (
            <h1 className="text-2xl font-semibold text-white">{monitor.name}</h1>
          )}
          <p className="text-sm text-gray-400">
            {monitor.type.toUpperCase()} · {monitor.target}
          </p>
        </div>
        <StatusBadge status={monitorDisplayStatus(monitor)} />
      </header>

      {error && <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Intervalo" value={`${monitor.intervalSeconds}s`} />
        <Stat label="Timeout" value={`${monitor.timeoutMs}ms`} />
        <Stat
          label="Último tiempo de respuesta"
          value={monitor.lastCheck?.responseTimeMs != null ? `${monitor.lastCheck.responseTimeMs}ms` : "—"}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleTogglePause()}
          className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
        >
          {monitor.isPaused ? "Reanudar" : "Pausar"}
        </button>

        {isEditing ? (
          <>
            <label htmlFor="edit-interval" className="text-sm text-gray-400">
              Intervalo (s):
            </label>
            <input
              id="edit-interval"
              type="number"
              min={30}
              value={editInterval}
              onChange={(e) => setEditInterval(Number(e.target.value))}
              className="w-24 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-white"
            />
            <button
              onClick={() => void handleSaveEdit()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
            >
              Guardar
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/5"
          >
            Editar
          </button>
        )}

        <button
          onClick={() => void handleDelete()}
          className="ml-auto rounded-md border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
        >
          Borrar
        </button>
      </div>

      <h2 className="mb-3 text-lg font-medium text-white">Últimos checks</h2>
      {checks.length === 0 ? (
        <p className="text-gray-400">Todavía no hay checks registrados para este monitor.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-gray-400">
            <tr>
              <th className="pb-2">Fecha</th>
              <th className="pb-2">Estado</th>
              <th className="pb-2">Tiempo de respuesta</th>
              <th className="pb-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {checks.map((check) => (
              <tr key={check.id}>
                <td className="py-2 text-gray-300">{new Date(check.timestamp).toLocaleString()}</td>
                <td className="py-2">
                  <StatusBadge status={check.status} />
                </td>
                <td className="py-2 text-gray-300">{check.responseTimeMs != null ? `${check.responseTimeMs}ms` : "—"}</td>
                <td className="py-2 text-gray-400">{check.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
