import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { ApiTimeseriesPoint } from "../api/types";

// Sparkline compacta de tiempo de respuesta (últimas 24h, un punto por
// hora — ver checks_hourly). Sin ejes ni tooltip a propósito: es un
// "vistazo" dentro de la fila del dashboard, el detalle completo está en la
// vista de detalle del monitor (Fase 2.4).
export function Sparkline({ points, hasDowntime }: { points: ApiTimeseriesPoint[]; hasDowntime: boolean }) {
  if (points.length < 2) {
    return <span className="text-xs text-gray-600">Sin histórico suficiente</span>;
  }

  const data = points.map((point) => ({ value: point.avgResponseTimeMs ?? 0 }));
  const color = hasDowntime ? "#f87171" : "#34d399";

  return (
    <div className="h-8 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
