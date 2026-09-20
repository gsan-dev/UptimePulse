import { apiFetch, setAccessToken } from "./client";
import type { ApiUser } from "./types";

interface AuthResponse {
  user: ApiUser;
  accessToken: string;
}

export async function register(email: string, password: string): Promise<ApiUser> {
  const data = await apiFetch<AuthResponse>("/auth/register", { method: "POST", body: { email, password } });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function login(email: string, password: string): Promise<ApiUser> {
  const data = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
  setAccessToken(data.accessToken);
  return data.user;
}

export function fetchMe(): Promise<ApiUser> {
  return apiFetch<ApiUser>("/me");
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
