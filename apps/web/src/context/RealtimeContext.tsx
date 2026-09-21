import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { disconnectSocket, getSocket } from "../api/realtime";
import { useAuth } from "./AuthContext";

export interface MonitorStatusChangedEvent {
  monitorId: string;
  name: string;
  status: "up" | "down";
  previousStatus: "up" | "down" | null;
  responseTimeMs: number | null;
  timestamp: string;
}

type Listener = (event: MonitorStatusChangedEvent) => void;

interface RealtimeContextValue {
  /** Devuelve una función para cancelar la suscripción (patrón cleanup de useEffect). */
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

/**
 * Conecta el WebSocket solo mientras hay sesión iniciada (Fase 2.3) y
 * reparte los eventos "monitor:status_changed" a quien se haya suscrito —
 * DashboardPage y MonitorDetailPage, cada una decide qué hacer con ellos
 * (refrescar su propio estado, mostrar un toast).
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const listenersRef = useRef<Set<Listener>>(new Set());

  useEffect(() => {
    if (!user) return;

    const socket = getSocket();
    function handleStatusChanged(event: MonitorStatusChangedEvent): void {
      listenersRef.current.forEach((listener) => listener(event));
    }
    socket.on("monitor:status_changed", handleStatusChanged);
    socket.connect();

    return () => {
      socket.off("monitor:status_changed", handleStatusChanged);
      disconnectSocket();
    };
  }, [user]);

  function subscribe(listener: Listener): () => void {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }

  return <RealtimeContext.Provider value={{ subscribe }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime debe usarse dentro de <RealtimeProvider>");
  return ctx;
}
