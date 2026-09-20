import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { createMonitor } from "../api/monitors";
import type { MonitorType } from "../api/types";

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

export function NewMonitorPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<MonitorType>("http");
  const [target, setTarget] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [expectedStatus, setExpectedStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createMonitor({
        name,
        type,
        target,
        intervalSeconds,
        timeoutMs,
        expectedStatus: type === "http" && expectedStatus ? Number(expectedStatus) : undefined,
      });
      navigate("/monitors");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el monitor");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Nuevo monitor</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <Field label="Nombre">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>

        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as MonitorType)} className={inputClass}>
            <option value="http">HTTP</option>
            <option value="tcp">TCP</option>
            <option value="ping">Ping (el worker todavía no lo ejecuta, ver TASK.md)</option>
          </select>
        </Field>

        <Field label={type === "tcp" ? "Host:puerto" : "URL / host"}>
          <input
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={type === "http" ? "https://ejemplo.com" : type === "tcp" ? "ejemplo.com:443" : "ejemplo.com"}
            className={inputClass}
          />
        </Field>

        {type === "http" && (
          <Field label="Status HTTP esperado (opcional; si no se indica, cualquier status < 400 cuenta como operativo)">
            <input
              value={expectedStatus}
              onChange={(e) => setExpectedStatus(e.target.value)}
              placeholder="200"
              className={inputClass}
            />
          </Field>
        )}

        <Field label="Intervalo en segundos (el mínimo depende de tu plan)">
          <input
            type="number"
            min={30}
            required
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
            className={inputClass}
          />
        </Field>

        <Field label="Timeout en milisegundos">
          <input
            type="number"
            min={1000}
            required
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className={inputClass}
          />
        </Field>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSubmitting ? "Creando…" : "Crear monitor"}
        </button>
      </form>
    </div>
  );
}
