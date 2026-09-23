interface SummaryHeaderProps {
  upCount: number;
  downCount: number;
  pausedCount: number;
  avgUptimePercentage: number | null;
  activeIncidents: number;
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const toneClass = tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

// Cabecera con el resumen agregado de la organización (Fase 2.4): cuántos
// monitores están operativos/caídos/pausados (derivado de lastCheck, ya
// disponible en GET /monitors — no hace falta pedirlo aparte), y el uptime
// medio global + incidentes activos (que sí vienen de GET /monitors/summary,
// agregados sobre checks_hourly/incidents).
export function SummaryHeader({ upCount, downCount, pausedCount, avgUptimePercentage, activeIncidents }: SummaryHeaderProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="Operativos" value={String(upCount)} tone="up" />
      <Card label="Caídos" value={String(downCount)} tone={downCount > 0 ? "down" : undefined} />
      <Card
        label="Uptime medio (24h)"
        value={avgUptimePercentage != null ? `${avgUptimePercentage}%` : "—"}
      />
      <Card
        label="Incidentes activos"
        value={String(activeIncidents)}
        tone={activeIncidents > 0 ? "down" : undefined}
      />
      {pausedCount > 0 && (
        <p className="col-span-full text-xs text-gray-500">{pausedCount} monitor(es) pausado(s), no contados arriba.</p>
      )}
    </div>
  );
}
