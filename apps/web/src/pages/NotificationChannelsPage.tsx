import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createChannel,
  deleteChannel,
  listChannels,
  testChannel,
  type NotificationChannelType,
  type TestChannelResult,
} from "../api/channels";
import type { ApiNotificationChannel } from "../api/types";

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      {children}
    </label>
  );
}

const TYPE_LABELS: Record<NotificationChannelType, string> = {
  discord: "Discord",
  slack: "Slack",
  webhook: "Webhook genérico",
};

export function NotificationChannelsPage() {
  const [channels, setChannels] = useState<ApiNotificationChannel[] | null>(null);
  const [type, setType] = useState<NotificationChannelType>("discord");
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestChannelResult | "pending">>({});

  const refresh = useCallback(async () => {
    try {
      setChannels(await listChannels());
    } catch {
      setError("No se pudieron cargar los canales");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const config: Record<string, string> = type === "webhook" ? { url, secret } : { webhookUrl };
      await createChannel({ type, name, config });
      setName("");
      setWebhookUrl("");
      setUrl("");
      setSecret("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el canal");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("¿Borrar este canal? Se desactivará en todos los monitores que lo tuvieran activado.")) return;
    await deleteChannel(id);
    await refresh();
  }

  async function handleTest(id: string): Promise<void> {
    setTestResults((prev) => ({ ...prev, [id]: "pending" }));
    try {
      const result = await testChannel(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, error: err instanceof ApiError ? err.message : "No se pudo probar el canal" },
      }));
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 mb-6 text-2xl font-semibold text-white">Canales de notificación</h1>
      <p className="mb-6 text-sm text-gray-400">
        Email siempre se envía a los miembros de la organización cuando un monitor cambia de estado. Estos canales son
        adicionales — actívalos por monitor desde su página de detalle.
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="mb-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as NotificationChannelType)} className={inputClass}>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="webhook">Webhook genérico (con firma HMAC)</option>
          </select>
        </Field>

        <Field label="Nombre (para distinguirlo en la lista)">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "discord" ? "Discord #alertas" : type === "slack" ? "Slack #incidentes" : "Mi endpoint"}
            className={inputClass}
          />
        </Field>

        {(type === "discord" || type === "slack") && (
          <Field label="URL del webhook">
            <input
              required
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={type === "discord" ? "https://discord.com/api/webhooks/..." : "https://hooks.slack.com/services/..."}
              className={inputClass}
            />
          </Field>
        )}

        {type === "webhook" && (
          <>
            <Field label="URL de destino">
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://tu-servidor.com/webhooks/uptimepulse"
                className={inputClass}
              />
            </Field>
            <Field label="Secreto (para firmar el payload con HMAC-SHA256)">
              <input
                required
                minLength={8}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="al menos 8 caracteres"
                className={inputClass}
              />
            </Field>
          </>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSubmitting ? "Creando…" : "Crear canal"}
        </button>
      </form>

      {channels === null && <p className="text-gray-400">Cargando…</p>}

      {channels !== null && channels.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-gray-400">
          Todavía no has creado ningún canal.
        </p>
      )}

      <ul className="space-y-2">
        {channels?.map((channel) => {
          const result = testResults[channel.id];
          return (
            <li key={channel.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{channel.name}</p>
                  <p className="text-sm text-gray-400">{TYPE_LABELS[channel.type as NotificationChannelType]}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void handleTest(channel.id)}
                    disabled={result === "pending"}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    {result === "pending" ? "Probando…" : "Probar conexión"}
                  </button>
                  <button
                    onClick={() => void handleDelete(channel.id)}
                    className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    Borrar
                  </button>
                </div>
              </div>
              {result && result !== "pending" && (
                <p className={`mt-2 text-sm ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {result.ok ? `✅ Conexión correcta${result.detail ? ` (${result.detail})` : ""}` : `❌ ${result.error}`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
