import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createInvitation,
  deleteInvitation,
  listInvitations,
  listMembers,
  removeMember,
  ROLE_LABELS,
  updateMemberRole,
  type ApiInvitation,
  type ApiOrganizationMember,
  type OrganizationRole,
} from "../api/organizations";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useOrganization } from "../context/OrganizationContext";

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

const ROLE_OPTIONS: OrganizationRole[] = ["readonly", "editor", "admin"];

const ROLE_HELP: Record<OrganizationRole, string> = {
  readonly: "Ve monitores, incidentes y canales; no puede cambiar nada.",
  editor: "Además crea, edita y borra monitores, canales y status pages.",
  admin: "Además gestiona miembros, invitaciones y API keys.",
};

/**
 * Página de equipo (Fase 4.1): miembros de la organización activa con su
 * rol, invitaciones pendientes y formulario para invitar. Todo el mundo
 * puede ver los miembros; solo un admin ve y usa los controles de gestión
 * (la API lo exige igualmente: aquí solo se evita enseñar botones que
 * darían 403).
 */
export function TeamPage() {
  const { user } = useAuth();
  const { active, isAdmin, refresh: refreshOrganizations } = useOrganization();
  const confirm = useConfirm();
  const [members, setMembers] = useState<ApiOrganizationMember[] | null>(null);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("readonly");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const organizationId = active?.id ?? null;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [membersData, invitationsData] = await Promise.all([
        listMembers(organizationId),
        isAdmin ? listInvitations(organizationId) : Promise.resolve([]),
      ]);
      setMembers(membersData);
      setInvitations(invitationsData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el equipo");
    }
  }, [organizationId, isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleInvite(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!organizationId) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const invitation = await createInvitation(organizationId, email.trim(), role);
      setEmail("");
      setNotice(`Invitación enviada a ${invitation.email}`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar la invitación");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(member: ApiOrganizationMember, nextRole: OrganizationRole): Promise<void> {
    if (!organizationId || nextRole === member.role) return;
    setError(null);
    setBusyId(member.userId);
    try {
      await updateMemberRole(organizationId, member.userId, nextRole);
      await refresh();
      // Si me he cambiado el rol a mí mismo, la cabecera debe reflejarlo.
      if (member.userId === user?.id) await refreshOrganizations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el rol");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(member: ApiOrganizationMember): Promise<void> {
    if (!organizationId) return;
    const confirmed = await confirm({
      title: `¿Quitar a ${member.fullName ?? member.username} de la organización?`,
      description: "Dejará de ver los monitores y de recibir alertas. Se le puede volver a invitar.",
      confirmLabel: "Quitar",
    });
    if (!confirmed) return;
    setError(null);
    setBusyId(member.userId);
    try {
      await removeMember(organizationId, member.userId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar al miembro");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelInvitation(invitation: ApiInvitation): Promise<void> {
    if (!organizationId) return;
    setError(null);
    setBusyId(invitation.id);
    try {
      await deleteInvitation(organizationId, invitation.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cancelar la invitación");
    } finally {
      setBusyId(null);
    }
  }

  if (!active) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/monitors" className="text-sm text-gray-400 hover:text-white">
        &larr; Volver
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-white">Equipo de {active.name}</h1>
      <p className="mt-1 mb-6 text-sm text-gray-400">
        Tu rol aquí: <strong className="text-gray-200">{ROLE_LABELS[active.role]}</strong>. {ROLE_HELP[active.role]}
      </p>

      {error && <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>}

      {isAdmin && (
        <form onSubmit={(e) => void handleInvite(e)} className="mb-8 space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium text-white">Invitar a alguien</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className="block space-y-1">
              <span className="text-sm text-gray-400">Email</span>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="compañero@empresa.com"
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-gray-400">Rol</span>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as OrganizationRole)} className={inputClass}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500">{ROLE_HELP[role]}</p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Enviando…" : "Enviar invitación"}
          </button>
        </form>
      )}

      <h2 className="mb-3 text-lg font-medium text-white">Miembros</h2>
      {members === null && <p className="text-gray-400">Cargando…</p>}
      <ul className="mb-8 space-y-2">
        {members?.map((member) => {
          const isMe = member.userId === user?.id;
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
            >
              <div>
                <p className="font-medium text-white">
                  {member.fullName ?? member.username}
                  {isMe && <span className="ml-2 text-xs text-gray-500">(tú)</span>}
                </p>
                <p className="text-sm text-gray-400">
                  @{member.username} · {member.email}
                </p>
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Rol de ${member.username}`}
                    value={member.role}
                    disabled={busyId === member.userId}
                    onChange={(e) => void handleRoleChange(member, e.target.value as OrganizationRole)}
                    className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleRemove(member)}
                    disabled={busyId === member.userId}
                    className="rounded-md border border-red-500/30 px-3 py-1 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-300">{ROLE_LABELS[member.role]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {isAdmin && (
        <>
          <h2 className="mb-3 text-lg font-medium text-white">Invitaciones pendientes</h2>
          {invitations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-gray-400">
              No hay invitaciones pendientes.
            </p>
          ) : (
            <ul className="space-y-2">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-white">{invitation.email}</p>
                    <p className="text-sm text-gray-400">
                      {ROLE_LABELS[invitation.role]} · caduca el {new Date(invitation.expiresAt).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleCancelInvitation(invitation)}
                    disabled={busyId === invitation.id}
                    className="rounded-md border border-white/10 px-3 py-1 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
