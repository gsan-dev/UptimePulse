import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  SCOPE_LABELS,
  type ApiKeyCreated,
  type ApiKeyScope,
  type ApiKeySummary,
} from "../api/apiKeys";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";
import { useToast } from "../context/ToastContext";

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

// Swagger UI vive en la API, no en esta SPA.
const DOCS_URL = `${(import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000"}/docs`;

/**
 * API keys de la organización (Fase 5.1). Solo un administrador llega aquí
 * con controles; la API lo exige igualmente. La clave completa se enseña
 * UNA vez, justo después de crearla, con un botón para copiarla: después
 * solo se ve su prefijo.
 */
export function ApiKeysPage() {
  const { active, isAdmin } = useOrganization();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["read"]);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const organizationId = active?.id ?? null;

  const refresh = useCallback(async () => {
    if (!organizationId || !isAdmin) return;
    try {
      setKeys(await listApiKeys(organizationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las API keys");
    }
  }, [organizationId, isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!active) return null;

  function toggleScope(scope: ApiKeyScope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    );
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const key = await createApiKey(organizationId, { name: name.trim(), scopes });
      setCreated(key);
      setName("");
      setScopes(["read"]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la API key");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevoke(key: ApiKeySummary) {
    if (!organizationId) return;
    const ok = await confirm({
      title: `¿Revocar la API key "${key.name}"?`,
      description: `Cualquier integración que use ${key.keyPrefix}… dejará de funcionar al instante. No se puede deshacer.`,
      confirmLabel: "Revocar",
      danger: true,
    });
    if (!ok) return;
    setBusyId(key.id);
    try {
      await revokeApiKey(organizationId, key.id);
      if (created?.id === key.id) setCreated(null);
      showToast(`API key revocada: ${key.name}`, "up");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo revocar la API key");
    } finally {
      setBusyId(null);
    }
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      showToast("Clave copiada al portapapeles", "up");
    } catch {
      showToast("No se pudo copiar; selecciónala y cópiala a mano", "degraded");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-white">API keys de {active.name}</h1>
      <p className="mt-1 mb-6 text-sm text-gray-400">
        Para integraciones (CI, scripts, Terraform…). Se usan como{" "}
        <code className="rounded bg-black/40 px-1">Authorization: Bearer up_…</code> contra la misma
        API que usa esta web (
        <a
          href={DOCS_URL}
          className="text-emerald-400 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          documentación
        </a>
        ). Una clave nunca puede gestionar el equipo, el plan ni otras claves.
      </p>

      {!isAdmin && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Solo un administrador de la organización puede ver y gestionar las API keys.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {created && (
        <section
          data-testid="new-key"
          className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
          <h2 className="font-medium text-emerald-300">Clave creada: {created.name}</h2>
          <p className="mt-1 text-sm text-gray-300">
            Cópiala ahora. Por seguridad no se guarda y <strong>no volverá a mostrarse</strong>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-black/50 px-2 py-1 text-sm text-white">
              {created.key}
            </code>
            <button
              type="button"
              onClick={() => void copyKey(created.key)}
              className="rounded-md border border-white/10 px-3 py-1 text-sm text-gray-200 hover:bg-white/10"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="text-sm text-gray-400 hover:text-white"
            >
              Ya la he guardado
            </button>
          </div>
        </section>
      )}

      {isAdmin && (
        <form
          onSubmit={handleCreate}
          className="mb-8 space-y-3 rounded-lg border border-white/10 bg-white/5 p-4"
        >
          <h2 className="font-medium text-white">Nueva API key</h2>
          <label className="block space-y-1">
            <span className="text-sm text-gray-400">Nombre (para reconocerla)</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI de producción"
              maxLength={100}
              className={inputClass}
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-sm text-gray-400">Permisos</legend>
            {(Object.keys(SCOPE_LABELS) as ApiKeyScope[]).map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                <span>
                  <code className="rounded bg-black/40 px-1">{scope}</code> — {SCOPE_LABELS[scope]}
                </span>
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={isSubmitting || scopes.length === 0 || name.trim() === ""}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Creando…" : "Crear API key"}
          </button>
        </form>
      )}

      {isAdmin && (
        <section>
          <h2 className="mb-2 font-medium text-white">Claves activas</h2>
          {keys === null ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-gray-500">No hay API keys todavía.</p>
          ) : (
            <ul className="space-y-2">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div>
                    <p className="text-white">
                      {key.name}{" "}
                      <code className="ml-1 rounded bg-black/40 px-1 text-xs text-gray-300">
                        {key.keyPrefix}…
                      </code>
                    </p>
                    <p className="text-xs text-gray-400">
                      {key.scopes.join(", ")} · creada el{" "}
                      {new Date(key.createdAt).toLocaleDateString()} ·{" "}
                      {key.lastUsedAt
                        ? `último uso ${new Date(key.lastUsedAt).toLocaleString()}`
                        : "nunca usada"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === key.id}
                    onClick={() => void handleRevoke(key)}
                    className="rounded-md border border-red-500/40 px-3 py-1 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {busyId === key.id ? "Revocando…" : "Revocar"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
