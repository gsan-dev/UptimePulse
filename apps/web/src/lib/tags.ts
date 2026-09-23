import type { ApiMonitor } from "../api/types";

/**
 * Las etiquetas que existen en una lista de monitores, sin repetir y
 * ordenadas alfabéticamente. No hay catálogo de etiquetas en la base de
 * datos (son un `jsonb` por monitor), así que "las etiquetas que hay" es
 * siempre algo que se deriva de los monitores que se están mirando.
 */
export function collectTags(monitors: ApiMonitor[]): string[] {
  const all = new Set<string>();
  for (const monitor of monitors) {
    for (const tag of monitor.tags ?? []) all.add(tag);
  }
  return [...all].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Filtra por etiquetas en Y, no en O: pedir "producción" + "api" da los
 * monitores que son las dos cosas. Es lo que se espera al ir acotando una
 * lista pulsando etiquetas una tras otra.
 */
export function filterByTags(monitors: ApiMonitor[], selected: string[]): ApiMonitor[] {
  if (selected.length === 0) return monitors;
  return monitors.filter((monitor) => {
    const tags = monitor.tags ?? [];
    return selected.every((tag) => tags.includes(tag));
  });
}
