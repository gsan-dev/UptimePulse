import { apiFetch, setAccessToken } from "./client";
import type { ApiUser } from "./types";

interface AuthResponse {
  user: ApiUser;
  accessToken: string;
}

export interface RegisterInput {
  username: string;
  fullName: string;
  email: string;
  password: string;
  /** Opcional: si no se indica, la API la llama "Organización de <nombre>". */
  organizationName?: string;
}

export interface UpdateProfileInput {
  username?: string;
  fullName?: string;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason?: string;
}

export async function register(input: RegisterInput): Promise<ApiUser> {
  const data = await apiFetch<AuthResponse>("/auth/register", { method: "POST", body: input });
  setAccessToken(data.accessToken);
  return data.user;
}

/** `identifier` puede ser el email o el nombre de usuario. */
export async function login(identifier: string, password: string): Promise<ApiUser> {
  const data = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: { identifier, password } });
  setAccessToken(data.accessToken);
  return data.user;
}

export function fetchMe(): Promise<ApiUser> {
  return apiFetch<ApiUser>("/me");
}

export function updateMe(input: UpdateProfileInput): Promise<ApiUser> {
  return apiFetch<ApiUser>("/me", { method: "PATCH", body: input });
}

// Sin sesión a propósito: se usa desde el formulario de registro. Lleva su
// propio rate limit en la API.
export function checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
  return apiFetch<UsernameAvailability>(`/auth/username-available?username=${encodeURIComponent(username)}`, {
    skipAuthRetry: true,
  });
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST", skipAuthRetry: true });
  setAccessToken(null);
}

/** Intenta recuperar una sesión existente usando la cookie httpOnly de refresh (ej. al recargar la página). */
export async function silentRefresh(): Promise<string | null> {
  try {
    const data = await apiFetch<{ accessToken: string }>("/auth/refresh", { method: "POST", skipAuthRetry: true });
    setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}
