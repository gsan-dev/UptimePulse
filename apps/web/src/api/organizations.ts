import { apiFetch } from "./client";

export type OrganizationRole = "admin" | "editor" | "readonly";

export interface ApiOrganizationSummary {
  id: string;
  name: string;
  /**
   * Identificador público de la organización: lo que hace que sus status
   * pages sean alcanzables en `/status/team/<slug>/<page-slug>`.
   * null = todavía no tiene URL pública propia.
   */
  slug: string | null;
  role: OrganizationRole;
  createdAt: string;
}

export interface ApiOrganizationMember {
  userId: string;
  username: string;
  fullName: string | null;
  email: string;
  role: OrganizationRole;
}

export interface ApiInvitation {
  id: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
  createdAt: string;
}

export interface ApiInvitationPreview {
  organizationName: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
}

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  admin: "Administrador",
  editor: "Editor",
  readonly: "Solo lectura",
};

export function listOrganizations(): Promise<ApiOrganizationSummary[]> {
  return apiFetch<ApiOrganizationSummary[]>("/organizations");
}

export function updateOrganization(
  organizationId: string,
  patch: { name?: string; slug?: string | null }
): Promise<{ id: string; name: string; slug: string | null; role: OrganizationRole }> {
  return apiFetch(`/organizations/${organizationId}`, { method: "PATCH", body: patch });
}

export function listMembers(organizationId: string): Promise<ApiOrganizationMember[]> {
  return apiFetch<ApiOrganizationMember[]>(`/organizations/${organizationId}/members`);
}

export function updateMemberRole(organizationId: string, userId: string, role: OrganizationRole): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/members/${userId}`, { method: "PATCH", body: { role } });
}

export function removeMember(organizationId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/members/${userId}`, { method: "DELETE" });
}

export function listInvitations(organizationId: string): Promise<ApiInvitation[]> {
  return apiFetch<ApiInvitation[]>(`/organizations/${organizationId}/invitations`);
}

export function createInvitation(organizationId: string, email: string, role: OrganizationRole): Promise<ApiInvitation> {
  return apiFetch<ApiInvitation>(`/organizations/${organizationId}/invitations`, { method: "POST", body: { email, role } });
}

export function deleteInvitation(organizationId: string, invitationId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/invitations/${invitationId}`, { method: "DELETE" });
}

/** Pública: quien tiene el enlace puede ver a qué le invitan antes de tener cuenta. */
export function getInvitation(token: string): Promise<ApiInvitationPreview> {
  return apiFetch<ApiInvitationPreview>(`/invitations/${token}`, { skipAuthRetry: true });
}

export function acceptInvitation(token: string): Promise<{ organizationId: string; organizationName: string; role: OrganizationRole }> {
  return apiFetch(`/invitations/${token}/accept`, { method: "POST" });
}
