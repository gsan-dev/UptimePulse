import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Pinta el botón principal en rojo (borrados y demás acciones destructivas). */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

/**
 * Diálogo de confirmación propio, en React, que sustituye a window.confirm().
 *
 * Por qué no usar confirm() a secas: es un diálogo *del navegador* y hay
 * entornos donde sencillamente no aparece y devuelve false sin avisar — el
 * navegador integrado de VS Code / webviews embebidas, Chrome cuando el
 * usuario marca "impedir que esta página cree más diálogos", iframes con
 * sandbox sin allow-modals, y las pestañas en segundo plano de algunos
 * navegadores. En esos casos `if (!confirm(...)) return;` corta la función
 * antes de llamar a la API: el botón "Borrar" no hace absolutamente nada y
 * no hay ni error ni rastro en consola que lo explique.
 *
 * Este diálogo se renderiza dentro de la propia app, así que funciona igual
 * en cualquier entorno y además es accesible por teclado (Esc cancela).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((nextOptions) => {
    setOptions(nextOptions);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setOptions(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={options.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => close(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-gray-900 p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-white">{options.title}</h2>
            {options.description && <p className="mt-2 text-sm text-gray-400">{options.description}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
              >
                {options.cancelLabel ?? "Cancelar"}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                  options.danger === false
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {options.confirmLabel ?? "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}
