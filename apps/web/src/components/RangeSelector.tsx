import type { UptimeRange } from "../api/types";

const RANGES: { value: UptimeRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

export function RangeSelector({ value, onChange }: { value: UptimeRange; onChange: (range: UptimeRange) => void }) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/5 p-1 text-sm">
      {RANGES.map((range) => (
        <button
          key={range.value}
          onClick={() => onChange(range.value)}
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
