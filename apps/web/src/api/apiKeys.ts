import { apiFetch } from "./client";

export type ApiKeyScope = "read" | "write";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: string | null;
  createdAt: string;
}

/** Solo en la respuesta de creación: la clave completa, que no vuelve a verse. */
export interface ApiKeyCreated extends ApiKeySummary {
  key: string;
}

export const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  read: "Lectura (monitores, checks, incidentes)",
  write: "Escritura (crear, editar y borrar monitores, canales y status pages)",
};

export function listApiKeys(organizationId: string): Promise<ApiKeySummary[]> {
  return apiFetch<ApiKeySummary[]>(`/organizations/${organizationId}/api-keys`);
}

export function createApiKey(
  organizationId: string,
  input: { name: string; scopes: ApiKeyScope[] }
): Promise<ApiKeyCreated> {
  return apiFetch<ApiKeyCreated>(`/organizations/${organizationId}/api-keys`, {
    method: "POST",
    body: input,
  });
}

export function revokeApiKey(organizationId: string, keyId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/api-keys/${keyId}`, { method: "DELETE" });
}
