import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getUsernameError, normalizeUsername } from "@uptimepulse/shared";
import { ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

/**
 * Perfil del usuario: nombre y nombre de usuario. Existe sobre todo porque
 * las cuentas anteriores a la migración 0008 recibieron un username derivado
 * de su email sin haberlo elegido — desde aquí pueden cambiarlo.
 */
export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) return null;

  const normalizedUsername = normalizeUsername(username);
  const usernameError = normalizedUsername === "" ? "Indica un nombre de usuario" : getUsernameError(normalizedUsername);
  const usernameChanged = normalizedUsername !== user.username;
  const fullNameChanged = fullName.trim() !== (user.fullName ?? "");
  const hasChanges = usernameChanged || fullNameChanged;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (usernameError) {
      setError(`Nombre de usuario: ${usernameError}`);
      return;
    }
    setIsSubmitting(true);
    try {
      await updateProfile({
        ...(usernameChanged ? { username: normalizedUsername } : {}),
        ...(fullNameChanged ? { fullName: fullName.trim() } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el perfil");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 mb-6 text-2xl font-semibold text-white">Tu perfil</h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
        {saved && !hasChanges && (
          <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">Perfil guardado.</p>
        )}

        <Field label="Email">
          <input value={user.email} disabled className={`${inputClass} opacity-60`} />
        </Field>

        <Field label="Nombre completo">
          <input
            required
            maxLength={100}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Tu nombre"
            className={inputClass}
          />
        </Field>

        <Field
          label="Nombre de usuario"
          hint={
            usernameError && normalizedUsername !== "" ? (
              <span className="text-red-400">{usernameError}</span>
            ) : usernameChanged ? (
              <span className="text-amber-400">
                Ojo: cambiarlo cambia la URL de todas tus status pages públicas, que pasarán a{" "}
                <code>/status/{normalizedUsername}/…</code>. Los enlaces antiguos dejarán de funcionar.
              </span>
            ) : (
              <>
                Tus status pages públicas viven en <code>/status/{user.username}/…</code>
              </>
            )
          }
        >
          <div className="flex items-center">
            <span className="rounded-l-md border border-r-0 border-white/10 bg-black/40 px-3 py-2 text-gray-500">@</span>
            <input
              required
              minLength={3}
              maxLength={30}
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`${inputClass} rounded-l-none`}
            />
          </div>
        </Field>

        <button
          type="submit"
          disabled={isSubmitting || !hasChanges || usernameError !== null}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>
    </div>
  );
}
