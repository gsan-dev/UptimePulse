import type { UptimeRange } from "../api/types";

const RANGES: { value: UptimeRange; label: string; title: string }[] = [
  { value: "24h", label: "24h", title: "Últimas 24 horas" },
  { value: "7d", label: "7d", title: "Últimos 7 días" },
  { value: "30d", label: "30d", title: "Últimos 30 días" },
  { value: "90d", label: "90d", title: "Últimos 90 días" },
  // Histórico total: sin ventana. El uptime % lo cubre entero (el agregado
  // `checks_hourly` no caduca); el tiempo de respuesta medio y el gráfico
  // llegan hasta donde alcance la retención de checks en crudo.
  { value: "all", label: "Todo", title: "Desde que existe el monitor" },
];

/** Milisegundos que abarca un rango, para lo que necesite pintar un eje. */
const RANGE_MS: Record<Exclude<UptimeRange, "all">, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  "90d": 90 * 24 * 60 * 60_000,
};

/**
 * Inicio del rango en milisegundos. Con "all" no hay ventana fija, así que
 * se usa el dato más antiguo que haya llegado (`earliest`); si tampoco lo
 * hay, se cae a 24 horas para no dibujar un eje vacío.
 */
export function rangeStart(range: UptimeRange, now: number, earliest?: number): number {
  if (range !== "all") return now - RANGE_MS[range];
  return earliest ?? now - RANGE_MS["24h"];
}

export function RangeSelector({ value, onChange }: { value: UptimeRange; onChange: (range: UptimeRange) => void }) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/5 p-1 text-sm">
      {RANGES.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
          title={range.title}
          aria-pressed={value === range.value}
          className={`rounded px-3 py-1 transition-colors ${
            value === range.value ? "bg-emerald-600 text-white" : "text-gray-300 hover:bg-white/10"
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
