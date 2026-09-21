import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { listMonitors } from "../api/monitors";
import { createStatusPage, deleteStatusPage, listStatusPages } from "../api/statusPages";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";
import type { ApiMonitor, ApiStatusPage } from "../api/types";

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

export function StatusPagesPage() {
  const { user } = useAuth();
  const [pages, setPages] = useState<ApiStatusPage[] | null>(null);
  const [monitors, setMonitors] = useState<ApiMonitor[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();
  const { canEdit } = useOrganization();

  const refresh = useCallback(async () => {
    const [pagesData, monitorsData] = await Promise.all([listStatusPages(), listMonitors()]);
    setPages(pagesData);
    setMonitors(monitorsData);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggleMonitor(id: string): void {
    setSelectedMonitorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createStatusPage({ slug, title, monitorIds: [...selectedMonitorIds] });
      setSlug("");
      setTitle("");
      setSelectedMonitorIds(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la página");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string, pageTitle: string): Promise<void> {
    const confirmed = await confirm({
      title: `¿Borrar la status page "${pageTitle}"?`,
      description:
        "Su URL pública dejará de funcionar inmediatamente. Esta acción no se puede deshacer.",
    });
    if (!confirmed) return;

    setError(null);
    setDeletingId(id);
    try {
      await deleteStatusPage(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar la status page");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 mb-6 text-2xl font-semibold text-white">Status pages públicas</h1>
      <p className="mb-6 text-sm text-gray-400">
        Comparte el estado de los monitores que elijas en una URL pública, sin login, sin exponer el
        resto de tu cuenta. Todas tus páginas cuelgan de tu nombre de usuario (
        <code>/status/{user?.username}/…</code>), así que el slug solo tiene que ser único entre las
        tuyas.
      </p>

      {!canEdit && (
        <p className="mb-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Tu rol en esta organización es de solo lectura: puedes ver, pero no crear ni borrar.
        </p>
      )}
      {canEdit && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mb-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6"
        >
          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          <Field
            label={`Slug — la URL será /status/${user?.username ?? "…"}/${slug || "mi-empresa"}`}
          >
            {/* En `pattern` el guion va escapado: Chrome compila el patrón con la
              flag `v`, y ahí un `-` suelto al final de una clase de caracteres
              es un error de sintaxis — el navegador descartaba el patrón entero
              (con un error en consola) y dejaba de validar el slug. */}
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="[a-z0-9\-]+"
              placeholder="mi-empresa"
              className={inputClass}
            />
          </Field>

          <Field label="Título">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Estado de Mi Empresa"
              className={inputClass}
            />
          </Field>

          <Field label="Monitores a mostrar">
            <div className="space-y-1 rounded-md border border-white/10 bg-black/20 p-2">
              {monitors.length === 0 ? (
                <p className="px-1 py-1 text-sm text-gray-500">No tienes monitores todavía.</p>
              ) : (
                monitors.map((monitor) => (
                  <label
                    key={monitor.id}
                    className="flex items-center gap-2 px-1 py-1 text-sm text-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMonitorIds.has(monitor.id)}
                      onChange={() => toggleMonitor(monitor.id)}
                    />
                    {monitor.name}
                  </label>
                ))
              )}
            </div>
          </Field>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Creando…" : "Crear status page"}
          </button>
        </form>
      )}

      {pages === null && <p className="text-gray-400">Cargando…</p>}
      {pages !== null && pages.length === 0 && (
        <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-gray-400">
          Todavía no has creado ninguna status page.
        </p>
      )}

      <ul className="space-y-2">
        {pages?.map((page) => (
          <li
            key={page.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
          >
            <div>
              <p className="font-medium text-white">{page.title}</p>
              <a
                href={`/status/${user?.username}/${page.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-emerald-400 hover:underline"
              >
                /status/{user?.username}/{page.slug}
              </a>
            </div>
            {canEdit && (
              <button
                onClick={() => void handleDelete(page.id, page.title)}
                disabled={deletingId === page.id}
                className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {deletingId === page.id ? "Borrando…" : "Borrar"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
