import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { attachChannelToMonitor, detachChannelFromMonitor, listChannels, listMonitorChannelIds } from "../api/channels";
import type { ApiNotificationChannel } from "../api/types";

const TYPE_LABELS: Record<string, string> = {
  discord: "Discord",
  slack: "Slack",
  webhook: "Webhook genérico",
};

/**
 * La "matriz" del README §3.5 resuelta por monitor: cada canal ya creado
 * (Fase 3.2, ver /channels) se activa o desactiva aquí con un checkbox, que
 * persiste al instante (sin botón "Guardar" aparte) contra
 * POST/DELETE /monitors/:id/notification-channels/:channelId.
 */
export function MonitorChannelsSection({ monitorId, readOnly = false }: { monitorId: string; readOnly?: boolean }) {
  const [channels, setChannels] = useState<ApiNotificationChannel[] | null>(null);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [channelsData, attachedData] = await Promise.all([listChannels(), listMonitorChannelIds(monitorId)]);
    setChannels(channelsData);
    setAttachedIds(new Set(attachedData));
  }, [monitorId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleToggle(channelId: string, isAttached: boolean): Promise<void> {
    setPendingId(channelId);
    setError(null);
    try {
      if (isAttached) {
        await detachChannelFromMonitor(monitorId, channelId);
        setAttachedIds((prev) => {
          const next = new Set(prev);
          next.delete(channelId);
          return next;
        });
      } else {
        await attachChannelToMonitor(monitorId, channelId);
        setAttachedIds((prev) => new Set(prev).add(channelId));
      }
    } catch {
      setError("No se pudo actualizar el canal, inténtalo de nuevo");
    } finally {
      setPendingId(null);
    }
  }

  if (channels === null) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-lg font-medium text-white">Canales de notificación</h2>
      {error && <p className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {channels.length === 0 ? (
        <p className="text-sm text-gray-400">
          Todavía no tienes canales creados.{" "}
          <Link to="/channels" className="text-emerald-400 hover:underline">
            Crea uno
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {channels.map((channel) => {
            const isAttached = attachedIds.has(channel.id);
            return (
              <li
                key={channel.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-white">{channel.name}</p>
                  <p className="text-xs text-gray-400">{TYPE_LABELS[channel.type] ?? channel.type}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={isAttached}
                    disabled={readOnly || pendingId === channel.id}
                    onChange={() => void handleToggle(channel.id, isAttached)}
                  />
                  Activado
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
