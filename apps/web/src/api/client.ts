const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

// El access token vive solo en memoria (no localStorage/sessionStorage), tal
// como se decidió en la Fase 1.1: reduce el riesgo de robo por XSS. Se pierde
// al recargar la página a propósito — por eso existe silentRefresh() en
// auth.ts, que lo recupera usando la cookie httpOnly de refresh.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// Usado por la conexión WebSocket (Fase 2.3): el socket se autentica con el
// mismo access token en memoria, mandado en cada intento de conexión (ver
// api/realtime.ts) para no arrastrar uno caducado tras un refresh.
export function getAccessToken(): string | null {
  return accessToken;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Evita el reintento automático de refresh (usado por /auth/refresh y /auth/logout, para no entrar en bucle). */
  skipAuthRetry?: boolean;
}

async function rawFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  // Solo si de verdad hay cuerpo: Fastify rechaza con 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY) cualquier petición que declare
  // "Content-Type: application/json" con el cuerpo vacío — algo que pasaba
  // en TODAS las peticiones sin body de esta app (DELETE, pause/resume,
  // attach/detach de canales, /auth/refresh y /auth/logout) porque este
  // header se ponía siempre, sin comprobar si había algo que enviar. El
  // fallo llegaba como un 400 silencioso (nada lo mostraba en la UI), lo que
  // hacía parecer que, por ejemplo, borrar un canal "no hacía nada".
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    // Necesario para que la cookie httpOnly de refresh viaje entre orígenes
    // distintos (web en :5173, api en :3000 durante desarrollo).
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      const messages = [...(flat.formErrors ?? []), ...Object.values(flat.fieldErrors ?? {}).flat()];
      if (messages.length > 0) return messages.join(", ");
    }
  }
  return fallback;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const response = await rawFetch("/auth/refresh", { method: "POST", skipAuthRetry: true });
    if (!response.ok) return false;
    const data = (await response.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch autenticado con reintento automático: si el access token caducó
 * (401), pide uno nuevo con /auth/refresh (vía la cookie httpOnly) y repite
 * la petición original una sola vez. Si el refresh también falla, se
 * propaga el error tal cual (el AuthContext decide cerrar la sesión).
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawFetch(path, options);

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      response = await rawFetch(path, options);
    }
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(extractErrorMessage(data, `Error ${response.status}`), response.status, data);
  }

  return data as T;
}
