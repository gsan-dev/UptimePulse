import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, setActiveOrganizationId } from "../api/client";
import { acceptInvitation, getInvitation, ROLE_LABELS, type ApiInvitationPreview } from "../api/organizations";
import { useAuth } from "../context/AuthContext";

/**
 * Página a la que lleva el enlace del email de invitación (Fase 4.1).
 * Es pública: quien la abre puede no tener cuenta todavía. Muestra a qué
 * organización y con qué rol se le invita, y según el estado de sesión:
 * - sin sesión → botones para entrar o registrarse, volviendo aquí después
 *   (`?next=`), con el email prefijado en el registro;
 * - con sesión de otro email → aviso claro (la API lo rechaza igualmente);
 * - con la sesión correcta → botón "Aceptar".
 */
export function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [invitation, setInvitation] = useState<ApiInvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInvitation(token)
      .then((data) => {
        if (!cancelled) setInvitation(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Invitación no válida o caducada");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept(): Promise<void> {
    if (!token) return;
    setError(null);
    setIsAccepting(true);
    try {
      const result = await acceptInvitation(token);
      // Entrar directamente en la organización recién aceptada. Se recarga
      // la app (no navigate) para que OrganizationProvider vuelva a cargar
      // la lista de organizaciones con la nueva membresía.
      setActiveOrganizationId(result.organizationId);
      try {
        localStorage.setItem("uptimepulse.activeOrganizationId", result.organizationId);
      } catch {
        // sin localStorage se cae a la organización personal tras recargar
      }
      window.location.assign("/monitors");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aceptar la invitación");
      setIsAccepting(false);
    }
  }

  const next = encodeURIComponent(`/invitations/${token ?? ""}`);
  const emailMatches = !!user && !!invitation && user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-xl font-semibold text-white">Invitación a UptimePulse</h1>

        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        {!invitation && !error && <p className="text-gray-400">Cargando…</p>}

        {invitation && (
          <>
            <p className="text-gray-300">
              Te han invitado a unirte a <strong className="text-white">{invitation.organizationName}</strong> con rol de{" "}
              <strong className="text-white">{ROLE_LABELS[invitation.role]}</strong>.
            </p>
            <p className="text-sm text-gray-500">
              Enviada a <code>{invitation.email}</code> · caduca el {new Date(invitation.expiresAt).toLocaleDateString("es-ES")}
            </p>

            {isLoading ? (
              <p className="text-gray-400">Comprobando sesión…</p>
            ) : !user ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-400">Inicia sesión o crea una cuenta con ese email para aceptarla.</p>
                <Link
                  to={`/login?next=${next}`}
                  className="block w-full rounded-md bg-emerald-600 px-3 py-2 text-center font-medium text-white hover:bg-emerald-500"
                >
                  Iniciar sesión
                </Link>
                <Link
                  to={`/register?next=${next}&email=${encodeURIComponent(invitation.email)}`}
                  className="block w-full rounded-md border border-white/10 px-3 py-2 text-center text-gray-200 hover:bg-white/10"
                >
                  Crear cuenta
                </Link>
              </div>
            ) : !emailMatches ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Has iniciado sesión como <code>{user.email}</code>, pero la invitación es para <code>{invitation.email}</code>.
                Cierra sesión y entra con esa cuenta para aceptarla.
              </p>
            ) : (
              <button
                onClick={() => void handleAccept()}
                disabled={isAccepting}
                className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isAccepting ? "Aceptando…" : `Unirme a ${invitation.organizationName}`}
              </button>
            )}
          </>
        )}

        <p className="text-center text-sm text-gray-500">
          <button onClick={() => navigate("/monitors")} className="hover:text-white">
            Ir a la aplicación
          </button>
        </p>
      </div>
    </div>
  );
}
