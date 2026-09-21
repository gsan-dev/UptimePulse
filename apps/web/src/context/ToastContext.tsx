import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastTone = "up" | "degraded" | "down";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);
const TOAST_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone) => {
    const id = ++nextIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              toast.tone === "down"
                ? "border-red-500/30 bg-red-950/90 text-red-200"
                : toast.tone === "degraded"
                  ? "border-amber-500/30 bg-amber-950/90 text-amber-200"
                  : "border-emerald-500/30 bg-emerald-950/90 text-emerald-200"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
