import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { listMonitors } from "../api/monitors";
import {
  createStatusPage,
  deleteStatusPage,
  getStatusPage,
  listStatusPages,
  updateStatusPage,
} from "../api/statusPages";
import { Field, FieldGroup, inputClass } from "../components/forms";
import { StatusPageMonitorsEditor } from "../components/StatusPageMonitorsEditor";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";
import type { ApiMonitor, ApiStatusPage, ApiStatusPageMonitor } from "../api/types";

/** Lo que se está editando de una página ya creada. */
interface EditState {
  id: string;
  title: string;
  isPublic: boolean;
  monitors: ApiStatusPageMonitor[];
}

export function StatusPagesPage() {
  const { user } = useAuth();
  const [pages, setPages] = useState<ApiStatusPage[] | null>(null);
  const [monitors, setMonitors] = useState<ApiMonitor[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [selectedMonitors, setSelectedMonitors] = useState<ApiStatusPageMonitor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const confirm = useConfirm();
  const { canEdit, active } = useOrganization();

  const refresh = useCallback(async () => {
    const [pagesData, monitorsData] = await Promise.all([listStatusPages(), listMonitors()]);
    setPages(pagesData);
    setMonitors(monitorsData);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createStatusPage({ slug, title, monitors: selectedMonitors });
      setSlug("");
      setTitle("");
      setSelectedMonitors([]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la página");
    } finally {
      setIsSubmitting(false);
    }
  }

  // El listado no trae los monitores de cada página (solo el detalle), así
  // que al abrir la edición hay que pedirlos: si no, guardar cualquier
  // cambio de título vaciaría la lista de monitores sin querer.
  async function startEditing(page: ApiStatusPage): Promise<void> {
    setError(null);
    try {
      const detail = await getStatusPage(page.id);
      setEdit({
        id: page.id,
        title: detail.title,
        isPublic: detail.isPublic,
        monitors: detail.monitors ?? (detail.monitorIds ?? []).map((id) => ({ id })),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la status page");
    }
  }

  async function handleSaveEdit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!edit) return;
    setError(null);
    setIsSavingEdit(true);
    try {
      await updateStatusPage(edit.id, {
        title: edit.title,
        isPublic: edit.isPublic,
        monitors: edit.monitors,
      });
      setEdit(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la status page");
    } finally {
      setIsSavingEdit(false);
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
      if (edit?.id === id) setEdit(null);
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
      <p className="mb-2 text-sm text-gray-400">
        Comparte el estado de los monitores que elijas en una URL pública, sin login, sin exponer el
        resto de tu cuenta. Todas tus páginas cuelgan de tu nombre de usuario (
        <code>/status/{user?.username}/…</code>), así que el slug solo tiene que ser único entre las
        tuyas.
      </p>
      {/* La organización puede tener además su propia URL, independiente del
          username de nadie: es la única forma de que una organización de
          equipo publique algo con su nombre. Se configura en /team. */}
      <p className="mb-6 text-sm text-gray-400">
        {active?.slug ? (
          <>
            Esta organización también publica en <code>/status/team/{active.slug}/…</code>.
          </>
        ) : (
          <>
            Esta organización todavía no tiene URL pública propia.{" "}
            <Link to="/team" className="text-emerald-400 hover:underline">
              Dale un identificador
            </Link>{" "}
            para publicar en <code>/status/team/…</code>.
          </>
        )}
      </p>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

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

          <FieldGroup label="Monitores a mostrar">
            <StatusPageMonitorsEditor
              monitors={monitors}
              value={selectedMonitors}
              onChange={setSelectedMonitors}
              idPrefix="new"
            />
          </FieldGroup>

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
          <li key={page.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white">
                  {page.title}
                  {!page.isPublic && (
                    <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-gray-400">
                      no publicada
                    </span>
                  )}
                </p>
                <a
                  href={`/status/${user?.username}/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-emerald-400 hover:underline"
                >
                  /status/{user?.username}/{page.slug}
                </a>
                {active?.slug && (
                  <a
                    href={`/status/team/${active.slug}/${page.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm text-emerald-400/80 hover:underline"
                  >
                    /status/team/{active.slug}/{page.slug}
                  </a>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    onClick={() => void startEditing(page)}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
                  >
                    {edit?.id === page.id ? "Editando" : "Editar"}
                  </button>
                  <button
                    onClick={() => void handleDelete(page.id, page.title)}
                    disabled={deletingId === page.id}
                    className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {deletingId === page.id ? "Borrando…" : "Borrar"}
                  </button>
                </div>
              )}
            </div>

            {edit?.id === page.id && (
              <form
                onSubmit={(e) => void handleSaveEdit(e)}
                className="mt-4 space-y-4 border-t border-white/10 pt-4"
              >
                <Field label="Título">
                  <input
                    required
                    value={edit.title}
                    onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                    className={inputClass}
                  />
                </Field>

                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={edit.isPublic}
                    onChange={(e) => setEdit({ ...edit, isPublic: e.target.checked })}
                  />
                  Visible públicamente (si se desmarca, la URL responde 404)
                </label>

                <FieldGroup label="Monitores a mostrar">
                  <StatusPageMonitorsEditor
                    monitors={monitors}
                    value={edit.monitors}
                    onChange={(value) => setEdit({ ...edit, monitors: value })}
                    idPrefix={`edit-${page.id}`}
                  />
                </FieldGroup>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isSavingEdit ? "Guardando…" : "Guardar cambios"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdit(null)}
                    className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
