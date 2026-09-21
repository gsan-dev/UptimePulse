import { io, type Socket } from "socket.io-client";
import { getAccessToken, getActiveOrganizationId } from "./client";

const SOCKET_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

let socket: Socket | null = null;

/**
 * Singleton perezoso: no se conecta hasta que alguien lo pide (RealtimeProvider
 * lo hace solo cuando hay sesión iniciada). `auth` como función (no objeto) se
 * vuelve a evaluar en cada intento de conexión/reconexión, así que siempre
 * manda el access token más reciente en memoria, no uno capturado al crear
 * el socket (que podría haber caducado tras un refresh, Fase 1.1).
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      // La organización activa va también en el handshake (Fase 4.1): el
      // socket entra solo en la sala de esa organización.
      auth: (cb) => cb({ token: getAccessToken(), organizationId: getActiveOrganizationId() ?? undefined }),
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
