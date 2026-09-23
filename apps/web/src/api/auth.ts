import { apiFetch, setAccessToken } from "./client";
import type { ApiUser } from "./types";

interface AuthResponse {
  user: ApiUser;
  accessToken: string;
  sessionIdleMinutes: number;
}

// Minutos de inactividad tras los que la sesión caduca. Lo decide la API
// (SESSION_IDLE_TIMEOUT_MINUTES) y lo manda en cada login/registro/refresh;
// aquí se guarda el último valor conocido para que el temporizador del
// navegador use exactamente la misma ventana que el servidor, en vez de una
// constante duplicada que pueda quedar desfasada.
const DEFAULT_SESSION_IDLE_MINUTES = 15;
let sessionIdleMinutes = DEFAULT_SESSION_IDLE_MINUTES;

export function getSessionIdleMinutes(): number {
  return sessionIdleMinutes;
}

function rememberIdleWindow(minutes: number | undefined): void {
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
    sessionIdleMinutes = minutes;
  }
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
  rememberIdleWindow(data.sessionIdleMinutes);
  return data.user;
}

/** `identifier` puede ser el email o el nombre de usuario. */
export async function login(identifier: string, password: string): Promise<ApiUser> {
  const data = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: { identifier, password } });
  setAccessToken(data.accessToken);
  rememberIdleWindow(data.sessionIdleMinutes);
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
    const data = await apiFetch<{ accessToken: string; sessionIdleMinutes?: number }>("/auth/refresh", {
      method: "POST",
      skipAuthRetry: true,
    });
    setAccessToken(data.accessToken);
    rememberIdleWindow(data.sessionIdleMinutes);
    return data.accessToken;
  } catch {
    return null;
  }
}
