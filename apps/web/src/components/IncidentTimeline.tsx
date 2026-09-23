import type { ApiIncident } from "../api/types";

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

function formatMoment(value: string | number): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Línea temporal de incidentes (README §2.3): una barra que representa todo
 * el rango elegido, con un tramo rojo por cada caída, y debajo la lista con
 * su duración.
 *
 * Es información distinta de las bandas del gráfico de latencia, no una
 * repetición: ahí las caídas son un detalle sobre otra cosa (y desaparecen
 * cuando no hay datos de latencia que dibujar), aquí son el tema — se ve de
 * un vistazo cuánto del periodo estuvo el servicio caído y si las caídas se
 * agrupan o están repartidas.
 *
 * `from`/`to` los decide quien lo usa porque dependen del selector de rango,
 * y con "histórico total" no hay una ventana fija que este componente pueda
 * deducir por su cuenta.
 */
export function IncidentTimeline({
  incidents,
  from,
  to,
}: {
  incidents: ApiIncident[];
  from: number;
  to: number;
}) {
  const span = Math.max(1, to - from);

  // De más reciente a más antiguo en la lista (como el resto de la app),
  // pero los tramos de la barra se pintan igual estén como estén.
  const sorted = [...incidents].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const segments = sorted
    .map((incident) => {
      const startedAt = new Date(incident.startedAt).getTime();
      // Un incidente sin resolver llega hasta "ahora": su tramo crece solo.
      const endedAt = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : to;
      const visibleStart = Math.max(startedAt, from);
      const visibleEnd = Math.min(endedAt, to);
      if (visibleEnd <= from || visibleStart >= to) return null;
      return {
        incident,
        left: ((visibleStart - from) / span) * 100,
        // Suelo del 0,4%: una caída de dos minutos en 90 días es un tramo de
        // menos de un píxel, y no verla sería peor que exagerarla.
        width: Math.max(0.4, ((visibleEnd - visibleStart) / span) * 100),
        durationMs: endedAt - startedAt,
        isOpen: incident.resolvedAt === null,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);

  return (
    <div>
      <div
        className="relative h-8 overflow-hidden rounded-md border border-white/10 bg-emerald-500/15"
        role="img"
        aria-label={
          segments.length === 0
            ? "Sin incidentes en el periodo"
            : `${segments.length} incidentes en el periodo`
        }
      >
        {segments.map((segment) => (
          <div
            key={segment.incident.id}
            title={`${formatMoment(segment.incident.startedAt)} · ${formatDuration(segment.durationMs)}${
              segment.isOpen ? " (en curso)" : ""
            }`}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            className={`absolute top-0 h-full ${segment.isOpen ? "bg-red-500" : "bg-red-500/80"}`}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-xs text-gray-500">
        <span>{formatMoment(from)}</span>
        <span>Ahora</span>
      </div>

      {segments.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">Sin incidentes en este periodo.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {segments.map((segment) => (
            <li
              key={segment.incident.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-1 last:border-0"
            >
              <span className="text-gray-300">
                {formatMoment(segment.incident.startedAt)}
                {segment.isOpen && <span className="ml-2 text-red-400">en curso</span>}
              </span>
              <span className="text-gray-400">
                {segment.incident.causeSummary ?? "Sin detalle"} ·{" "}
                <span className="text-gray-300">{formatDuration(segment.durationMs)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
