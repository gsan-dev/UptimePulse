import { useState, type FormEvent } from "react";
import { getSlugError, suggestSlug } from "@uptimepulse/shared";
import { ApiError } from "../api/client";
import { updateOrganization, type ApiOrganizationSummary } from "../api/organizations";
import { useConfirm } from "../context/ConfirmContext";
import { Field, inputClass } from "./forms";

/**
 * Identificador público de la organización: lo que hace que sus status pages
 * sean alcanzables en `/status/team/<slug>/<page-slug>`.
 *
 * Sin esto, la única URL pública posible era `/status/<username>/<slug>`, que
 * resuelve a la organización PERSONAL de ese usuario — así que una
 * organización de equipo no tenía forma de publicar nada con su propio
 * nombre. Las dos rutas conviven: la del username sigue funcionando igual.
 */
export function OrganizationSlugSection({
  organization,
  onSaved,
}: {
  organization: ApiOrganizationSummary;
  onSaved: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [slug, setSlug] = useState(organization.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Al cambiar de organización activa el componente no se desmonta, así que
  // el campo tiene que pasar a hablar de la nueva. Se reacciona SOLO al
  // cambio de id, no al del slug: guardar cambia el slug, y reaccionar a eso
  // borraba el "Identificador guardado." un instante después de enseñarlo.
  const [shownOrganizationId, setShownOrganizationId] = useState(organization.id);
  if (shownOrganizationId !== organization.id) {
    setShownOrganizationId(organization.id);
    setSlug(organization.slug ?? "");
    setError(null);
    setNotice(null);
  }

  const trimmed = slug.trim();
  const validationError = trimmed === "" ? null : getSlugError(trimmed);
  const hasChanged = trimmed !== (organization.slug ?? "");

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Cambiar o quitar el slug rompe los enlaces ya compartidos, igual que
    // cambiar de username (ver ProfilePage). Es justo el tipo de cosa que no
    // debe pasar por escribir en el campo sin darse cuenta.
    if (organization.slug && trimmed !== organization.slug) {
      const confirmed = await confirm({
        title: trimmed === "" ? "¿Quitar la URL pública?" : "¿Cambiar el identificador público?",
        description:
          trimmed === ""
            ? `Las páginas en /status/team/${organization.slug}/… dejarán de funcionar.`
            : `Los enlaces a /status/team/${organization.slug}/… dejarán de funcionar y habrá que compartir los nuevos.`,
        confirmLabel: trimmed === "" ? "Quitar" : "Cambiar",
      });
      if (!confirmed) return;
    }

    setIsSaving(true);
    try {
      await updateOrganization(organization.id, { slug: trimmed === "" ? null : trimmed });
      await onSaved();
      setNotice(trimmed === "" ? "La organización ya no tiene URL pública." : "Identificador guardado.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el identificador");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mb-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6"
    >
      <h2 className="text-lg font-medium text-white">URL pública de la organización</h2>
      <p className="text-sm text-gray-400">
        Con un identificador, las status pages de esta organización se publican también en{" "}
        <code>/status/team/&lt;identificador&gt;/&lt;slug&gt;</code> — una URL propia, que no depende
        del nombre de usuario de nadie.
      </p>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {notice && (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>
      )}

      <Field
        label="Identificador"
        hint="Minúsculas, números y guiones. Déjalo vacío para que la organización no tenga URL pública."
      >
        <input
          id="organization-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder={suggestSlug(organization.name) || "mi-empresa"}
          className={inputClass}
        />
      </Field>

      {trimmed !== "" && !validationError && (
        <p className="text-xs text-gray-500">
          URL: <code>/status/team/{trimmed}/&lt;slug-de-la-página&gt;</code>
        </p>
      )}
      {validationError && <p className="text-xs text-amber-300">{validationError}</p>}

      <button
        type="submit"
        disabled={isSaving || !hasChanged || validationError !== null}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {isSaving ? "Guardando…" : "Guardar identificador"}
      </button>
    </form>
  );
}
