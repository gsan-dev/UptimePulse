import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getUsernameError, normalizeUsername } from "@uptimepulse/shared";
import { checkUsernameAvailability } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      {children}
      {hint && <span className="block text-xs">{hint}</span>}
    </label>
  );
}

type UsernameState =
  | { kind: "idle" }
  | { kind: "invalid"; reason: string }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; reason: string };

/**
 * Comprueba el username contra la API mientras se escribe, con un pequeño
 * retardo para no lanzar una petición por cada tecla. La regla de formato
 * (packages/shared) se evalúa en local al instante; solo si pasa se
 * pregunta a la API si está libre.
 */
function useUsernameAvailability(username: string): UsernameState {
  const [state, setState] = useState<UsernameState>({ kind: "idle" });

  useEffect(() => {
    const normalized = normalizeUsername(username);
    if (normalized === "") {
      setState({ kind: "idle" });
      return;
    }
    const formatError = getUsernameError(normalized);
    if (formatError) {
      setState({ kind: "invalid", reason: formatError });
      return;
    }

    setState({ kind: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      checkUsernameAvailability(normalized)
        .then((result) => {
          if (cancelled) return;
          setState(
            result.available
              ? { kind: "available" }
              : { kind: "taken", reason: result.reason ?? "Ese nombre de usuario ya está en uso" }
          );
        })
        .catch(() => {
          // Si la comprobación falla (red, rate limit) no bloqueamos el
          // formulario: la API volverá a validar al registrarse.
          if (!cancelled) setState({ kind: "idle" });
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  return state;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const usernameState = useUsernameAvailability(username);
  const normalizedUsername = normalizeUsername(username);
  const passwordsMismatch = passwordConfirm !== "" && password !== passwordConfirm;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    const usernameError = getUsernameError(normalizedUsername);
    if (usernameError) {
      setError(`Nombre de usuario: ${usernameError}`);
      return;
    }
    setIsSubmitting(true);
    try {
      await register({
        username: normalizedUsername,
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        organizationName: organizationName.trim() || undefined,
      });
      navigate("/monitors");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo completar el registro");
    } finally {
      setIsSubmitting(false);
    }
  }

  const usernameHint = (() => {
    switch (usernameState.kind) {
      case "idle":
        return <span className="text-gray-500">Minúsculas, números y guiones. Será parte de tus URLs públicas.</span>;
      case "invalid":
        return <span className="text-red-400">{usernameState.reason}</span>;
      case "checking":
        return <span className="text-gray-500">Comprobando disponibilidad…</span>;
      case "available":
        return (
          <span className="text-emerald-400">
            Disponible — tus status pages vivirán en <code>/status/{normalizedUsername}/…</code>
          </span>
        );
      case "taken":
        return <span className="text-red-400">{usernameState.reason}</span>;
    }
  })();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-8"
      >
        <div>
          <h1 className="text-xl font-semibold text-white">Crear cuenta</h1>
          <p className="mt-1 text-sm text-gray-400">
            Cada cuenta tiene su propio espacio: tus status pages públicas se sirven bajo tu nombre de usuario, así
            que nunca chocarán con las de nadie más.
          </p>
        </div>

        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <Field label="Nombre completo">
          <input
            id="fullName"
            required
            maxLength={100}
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ana García"
            className={inputClass}
          />
        </Field>

        <Field label="Nombre de usuario" hint={usernameHint}>
          <div className="flex items-center">
            <span className="rounded-l-md border border-r-0 border-white/10 bg-black/40 px-3 py-2 text-gray-500">@</span>
            <input
              id="username"
              required
              minLength={3}
              maxLength={30}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ana-garcia"
              className={`${inputClass} rounded-l-none`}
            />
          </div>
        </Field>

        <Field label="Email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña (mín. 8 caracteres)">
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label="Repite la contraseña"
            hint={passwordsMismatch ? <span className="text-red-400">Las contraseñas no coinciden</span> : undefined}
          >
            <input
              id="passwordConfirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Nombre de tu organización (opcional)"
          hint={<span className="text-gray-500">Si lo dejas vacío, se llamará "Organización de {fullName.trim() || "…"}".</span>}
        >
          <input
            id="organizationName"
            maxLength={100}
            autoComplete="organization"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="Mi empresa"
            className={inputClass}
          />
        </Field>

        <button
          type="submit"
          disabled={isSubmitting || usernameState.kind === "invalid" || usernameState.kind === "taken" || passwordsMismatch}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSubmitting ? "Creando cuenta…" : "Crear cuenta"}
        </button>
        <p className="text-center text-sm text-gray-400">
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" className="text-emerald-400 hover:underline">
            Inicia sesión
          </Link>
        </p>
      </form>
    </div>
  );
}
