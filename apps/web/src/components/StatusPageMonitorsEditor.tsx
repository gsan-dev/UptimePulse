import type { ApiMonitor, ApiStatusPageMonitor } from "../api/types";
import { inputClass } from "./forms";

/**
 * Qué monitores enseña una status page y con qué nombre. El checkbox decide
 * si sale; el campo de al lado es su `displayName` (columna
 * `status_page_monitors.display_name`): el nombre interno suele ser técnico
 * ("api-prod eu-west-1") y no es el que se quiere enseñar a un cliente. En
 * blanco = se usa el nombre del monitor.
 *
 * El mismo componente sirve para crear y para editar, que es lo que evita
 * que la edición se quede atrás respecto al alta — el motivo por el que
 * hasta ahora la lista de monitores de una página no se podía cambiar.
 */
export function StatusPageMonitorsEditor({
  monitors,
  value,
  onChange,
  idPrefix,
}: {
  monitors: ApiMonitor[];
  value: ApiStatusPageMonitor[];
  onChange: (value: ApiStatusPageMonitor[]) => void;
  idPrefix: string;
}) {
  const byId = new Map(value.map((entry) => [entry.id, entry]));

  function toggle(monitorId: string): void {
    if (byId.has(monitorId)) {
      onChange(value.filter((entry) => entry.id !== monitorId));
    } else {
      onChange([...value, { id: monitorId, displayName: null }]);
    }
  }

  function setDisplayName(monitorId: string, raw: string): void {
    const displayName = raw.trim() === "" ? null : raw;
    onChange(value.map((entry) => (entry.id === monitorId ? { ...entry, displayName } : entry)));
  }

  if (monitors.length === 0) {
    return <p className="px-1 py-1 text-sm text-gray-500">No tienes monitores todavía.</p>;
  }

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
      {monitors.map((monitor) => {
        const selected = byId.get(monitor.id);
        const checkboxId = `${idPrefix}-monitor-${monitor.id}`;
        return (
          <div key={monitor.id} className="space-y-1">
            <label
              htmlFor={checkboxId}
              className="flex items-center gap-2 px-1 py-1 text-sm text-gray-200"
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={selected !== undefined}
                onChange={() => toggle(monitor.id)}
              />
              {monitor.name}
            </label>
            {selected !== undefined && (
              <input
                value={selected.displayName ?? ""}
                onChange={(e) => setDisplayName(monitor.id, e.target.value)}
                placeholder={`Nombre público (por defecto: ${monitor.name})`}
                aria-label={`Nombre público de ${monitor.name}`}
                className={`${inputClass} ml-6 w-[calc(100%-1.5rem)] py-1 text-sm`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
