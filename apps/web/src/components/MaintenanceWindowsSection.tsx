import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import {
  createMaintenanceWindow,
  deleteMaintenanceWindow,
  listMaintenanceWindows,
} from "../api/monitors";
import type { ApiMaintenanceWindow } from "../api/types";
import { useConfirm } from "../context/ConfirmContext";
import { Field, inputClass } from "./forms";

/**
 * Un `<input type="datetime-local">` habla en HORA LOCAL sin zona
 * ("2026-09-22T10:00"), y la API espera algo que `new Date(...)` interprete
 * sin ambigüedad. `new Date(local).toISOString()` hace exactamente esa
 * conversión usando la zona del navegador, que es la que la persona tenía en
 * la cabeza al escribirlo.
 */
function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

/** El camino de vuelta: ISO en UTC → el formato que espera el input. */
function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatRange(window: ApiMaintenanceWindow): string {
  const starts = new Date(window.startsAt);
  const ends = new Date(window.endsAt);
  return `${starts.toLocaleString()} → ${ends.toLocaleString()}`;
}

type WindowState = "past" | "active" | "upcoming";

function windowState(window: ApiMaintenanceWindow, now: number): WindowState {
  if (new Date(window.endsAt).getTime() <= now) return "past";
  if (new Date(window.startsAt).getTime() <= now) return "active";
  return "upcoming";
}

const STATE_STYLE: Record<WindowState, { label: string; className: string }> = {
  active: { label: "En curso", className: "text-amber-300" },
  upcoming: { label: "Programada", className: "text-gray-300" },
  past: { label: "Terminada", className: "text-gray-500" },
};

/**
 * Ventanas de mantenimiento de un monitor (Fase 2.2). Durante una ventana el
 * worker sigue comprobando el monitor y guardando checks, pero NO abre
 * incidentes ni manda alertas — que es justo lo que se quiere al tirar algo
 * abajo a propósito.
 *
 * No hay edición porque el backend tampoco la ofrece: una ventana mal puesta
 * se borra y se vuelve a crear, que para un rango de fechas es igual de
 * rápido que corregirlo.
 */
export function MaintenanceWindowsSection({
  monitorId,
  readOnly = false,
}: {
  monitorId: string;
  readOnly?: boolean;
}) {
  const confirm = useConfirm();
  const [windows, setWindows] = useState<ApiMaintenanceWindow[] | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWindows(await listMaintenanceWindows(monitorId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las ventanas");
    }
  }, [monitorId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Al abrir el formulario por primera vez propone "de aquí a una hora": es
  // el caso más común (un despliegue ya mismo) y ahorra teclear dos fechas
  // completas.
  function prefillIfEmpty(): void {
    if (startsAt !== "" || endsAt !== "") return;
    const now = new Date();
    setStartsAt(isoToLocalInput(now.toISOString()));
    setEndsAt(isoToLocalInput(new Date(now.getTime() + 60 * 60_000).toISOString()));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError("El fin debe ser posterior al inicio");
      return;
    }
    setIsSubmitting(true);
    try {
      await createMaintenanceWindow(monitorId, {
        startsAt: localInputToIso(startsAt),
        endsAt: localInputToIso(endsAt),
        note: note.trim() || undefined,
      });
      setStartsAt("");
      setEndsAt("");
      setNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la ventana");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(window: ApiMaintenanceWindow): Promise<void> {
    const confirmed = await confirm({
      title: "¿Borrar esta ventana de mantenimiento?",
      description: `${formatRange(window)}. Si está en curso, el monitor volverá a generar incidentes y alertas de inmediato.`,
      confirmLabel: "Borrar",
    });
    if (!confirmed) return;
    setError(null);
    setBusyId(window.id);
    try {
      await deleteMaintenanceWindow(monitorId, window.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar la ventana");
    } finally {
      setBusyId(null);
    }
  }

  if (windows === null) return null;

  const now = Date.now();

  return (
    <div className="mb-6">
      <h2 className="mb-1 text-lg font-medium text-white">Ventanas de mantenimiento</h2>
      <p className="mb-3 text-sm text-gray-400">
        Durante una ventana se siguen ejecutando los checks, pero no se abren incidentes ni se
        envían alertas.
      </p>

      {error && <p className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      {windows.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-white/10 p-4 text-center text-sm text-gray-400">
          No hay ventanas programadas.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {windows.map((window) => {
            const style = STATE_STYLE[windowState(window, now)];
            return (
              <li
                key={window.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white">{formatRange(window)}</p>
                  <p className="text-xs text-gray-400">
                    <span className={style.className}>{style.label}</span>
                    {window.note && ` · ${window.note}`}
                  </p>
                </div>
                {!readOnly && (
                  <button
                    onClick={() => void handleDelete(window)}
                    disabled={busyId === window.id}
                    className="rounded-md border border-white/10 px-3 py-1 text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {busyId === window.id ? "Borrando…" : "Borrar"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          onFocus={prefillIfEmpty}
          className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inicio">
              <input
                id="maintenance-starts-at"
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Fin">
              <input
                id="maintenance-ends-at"
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Nota (opcional)">
            <input
              id="maintenance-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Migración de base de datos"
              className={inputClass}
            />
          </Field>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Programando…" : "Programar ventana"}
          </button>
        </form>
      )}
    </div>
  );
}
