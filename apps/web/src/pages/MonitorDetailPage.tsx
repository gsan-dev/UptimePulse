import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  deleteMonitor,
  getMonitor,
  getMonitorMetrics,
  getMonitorTimeseries,
  listMonitorChecks,
  listMonitorIncidents,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
} from "../api/monitors";
import type {
  ApiCheck,
  ApiIncident,
  ApiMonitorDetail,
  ApiMonitorMetrics,
  ApiTimeseriesPoint,
  UptimeRange,
} from "../api/types";
import { MonitorChannelsSection } from "../components/MonitorChannelsSection";
import { RangeSelector } from "../components/RangeSelector";
import { ResponseTimeChart } from "../components/ResponseTimeChart";
import { monitorDisplayStatus, StatusBadge } from "../components/StatusBadge";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";
import { useRealtime } from "../context/RealtimeContext";
import { useToast } from "../context/ToastContext";

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
  const { subscribe } = useRealtime();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { canEdit } = useOrganization();
  const [monitor, setMonitor] = useState<ApiMonitorDetail | null>(null);
  const [checks, setChecks] = useState<ApiCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState(300);
  const [range, setRange] = useState<UptimeRange>("24h");
  const [metrics, setMetrics] = useState<ApiMonitorMetrics | null>(null);
  const [timeseries, setTimeseries] = useState<ApiTimeseriesPoint[]>([]);
  const [rangeIncidents, setRangeIncidents] = useState<ApiIncident[]>([]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [monitorData, checksData] = await Promise.all([
        getMonitor(id),
        listMonitorChecks(id, CHECKS_LIMIT),
      ]);
      setMonitor(monitorData);
      setChecks(checksData);
      setError(null);
    } catch {
      setError("No se pudo cargar el monitor");
    }
  }, [id]);

  // Fase 2.4: métricas/gráfico/incidentes dependen del rango elegido, así
  // que se piden aparte de refresh() (que solo trae el monitor + últimos
  // checks en crudo, independiente del selector de rango).
  const refreshRangeData = useCallback(async () => {
    if (!id) return;
    try {
      const [metricsData, timeseriesData, incidentsData] = await Promise.all([
        getMonitorMetrics(id, range),
        getMonitorTimeseries(id, range),
        listMonitorIncidents(id, range),
      ]);
      setMetrics(metricsData);
      setTimeseries(timeseriesData);
      setRangeIncidents(incidentsData);
    } catch {
      // Un fallo aquí no debe tapar la vista principal del monitor — los
      // Stat de arriba simplemente se quedan en su último valor conocido.
    }
  }, [id, range]);

  // Carga inicial única — el WebSocket (Fase 2.3) dispara el refresco cuando
  // de verdad cambia algo, en vez de sondear cada 10s sin motivo.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshRangeData();
  }, [refreshRangeData]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.monitorId !== id) return;
      void refresh();
      void refreshRangeData();
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
  }, [subscribe, refresh, refreshRangeData, showToast, id]);

  useEffect(() => {
    if (monitor && !isEditing) {
      setEditName(monitor.name);
      setEditInterval(monitor.intervalSeconds);
    }
  }, [monitor, isEditing]);

  async function handleTogglePause(): Promise<void> {
    if (!monitor) return;
    try {
      const updated = monitor.isPaused
        ? await resumeMonitor(monitor.id)
        : await pauseMonitor(monitor.id);
      setMonitor({ ...updated, regions: monitor.regions });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo pausar/reanudar el monitor");
    }
  }

  async function handleDelete(): Promise<void> {
    if (!monitor) return;
    const confirmed = await confirm({
      title: `¿Borrar el monitor "${monitor.name}"?`,
      description:
        "Se borrarán también su historial de checks e incidentes. Esta acción no se puede deshacer.",
    });
    if (!confirmed) return;
    try {
      await deleteMonitor(monitor.id);
      navigate("/monitors");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el monitor");
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (!monitor) return;
    try {
      const updated = await updateMonitor(monitor.id, {
        name: editName,
        intervalSeconds: editInterval,
      });
      setMonitor({ ...updated, regions: monitor.regions });
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

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Intervalo" value={`${monitor.intervalSeconds}s`} />
        <Stat label="Timeout" value={`${monitor.timeoutMs}ms`} />
        <Stat
          label="Último tiempo de respuesta"
          value={
            monitor.lastCheck?.responseTimeMs != null
              ? `${monitor.lastCheck.responseTimeMs}ms`
              : "—"
          }
        />
      </div>

      {/* Fase 4.2: desde qué regiones se ve el monitor. Con una sola región
          configurada no aporta nada y se omite. */}
      {monitor.regions.length > 1 && (
        <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-xs text-gray-400">
            Estado por región (quórum: {Math.floor(monitor.regions.length / 2) + 1} de{" "}
            {monitor.regions.length} regiones para marcar caída)
          </p>
          <ul className="flex flex-wrap gap-4">
            {monitor.regions.map((snapshot) => (
              <li key={snapshot.region} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-gray-300">{snapshot.region}</span>
                <StatusBadge status={snapshot.status ?? "pending"} />
                {snapshot.responseTimeMs != null && (
                  <span className="text-xs text-gray-500">{snapshot.responseTimeMs}ms</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {monitor.type === "http" && monitor.target.startsWith("https://") && (
        <div className="mb-6">
          <Stat
            label="Certificado SSL"
            value={
              monitor.sslExpiresAt
                ? `Caduca en ${Math.max(0, Math.floor((new Date(monitor.sslExpiresAt).getTime() - Date.now()) / 86_400_000))} días`
                : "Todavía sin comprobar"
            }
          />
        </div>
      )}

      {/* Fase 4.1: con rol de solo lectura no se enseñan las acciones (la
          API las rechazaría con 403 igualmente). */}
      {canEdit && (
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
      )}

      <MonitorChannelsSection monitorId={monitor.id} readOnly={!canEdit} />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-white">Histórico</h2>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Uptime"
          value={metrics?.uptimePercentage != null ? `${metrics.uptimePercentage}%` : "—"}
        />
        <Stat
          label="Tiempo de respuesta medio"
          value={metrics?.avgResponseTimeMs != null ? `${metrics.avgResponseTimeMs}ms` : "—"}
        />
        <Stat label="Incidentes" value={metrics ? String(metrics.incidentCount) : "—"} />
        <Stat
          label="MTTR"
          value={metrics?.mttrSeconds != null ? `${Math.round(metrics.mttrSeconds / 60)} min` : "—"}
        />
      </div>

      <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
        <ResponseTimeChart points={timeseries} incidents={rangeIncidents} />
      </div>

      <h2 className="mb-3 text-lg font-medium text-white">Últimos checks</h2>
      {checks.length === 0 ? (
        <p className="text-gray-400">Todavía no hay checks registrados para este monitor.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-gray-400">
            <tr>
              <th className="pb-2">Fecha</th>
              {monitor.regions.length > 1 && <th className="pb-2">Región</th>}
              <th className="pb-2">Estado</th>
              <th className="pb-2">Tiempo de respuesta</th>
              <th className="pb-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {checks.map((check) => (
              <tr key={check.id}>
                <td className="py-2 text-gray-300">{new Date(check.timestamp).toLocaleString()}</td>
                {monitor.regions.length > 1 && (
                  <td className="py-2 font-mono text-xs text-gray-400">{check.region}</td>
                )}
                <td className="py-2">
                  <StatusBadge status={check.status} />
                </td>
                <td className="py-2 text-gray-300">
                  {check.responseTimeMs != null ? `${check.responseTimeMs}ms` : "—"}
                </td>
                <td className="py-2 text-gray-400">{check.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
