import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ApiIncident, ApiTimeseriesPoint } from "../api/types";

interface ResponseTimeChartProps {
  points: ApiTimeseriesPoint[];
  incidents: ApiIncident[];
}

function formatTick(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Gráfico de tiempo de respuesta (un punto por hora, `checks_hourly`) con
 * zonas sombreadas en rojo para cada incidente que se solapa con el rango
 * visible (Fase 2.4). El eje X es numérico (timestamp en ms), no categórico
 * — con un eje de categorías, las `ReferenceArea` solo pueden alinearse a
 * valores exactos del eje, y un incidente casi nunca empieza/termina
 * justo en el borde de un bucket horario.
 */
export function ResponseTimeChart({ points, incidents }: ResponseTimeChartProps) {
  if (points.length === 0) {
    return <p className="text-gray-400">No hay datos suficientes para este rango todavía.</p>;
  }

  const data = points.map((point) => ({
    ts: new Date(point.bucket).getTime(),
    avgResponseTimeMs: point.avgResponseTimeMs,
  }));

  const domainMin = data[0].ts;
  const domainMax = data[data.length - 1].ts;
  const clamp = (value: number) => Math.min(Math.max(value, domainMin), domainMax);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
        <XAxis
          dataKey="ts"
          type="number"
          domain={[domainMin, domainMax]}
          tickFormatter={formatTick}
          stroke="#9ca3af"
          fontSize={12}
          minTickGap={40}
        />
        <YAxis stroke="#9ca3af" fontSize={12} unit="ms" width={56} />
        <Tooltip
          labelFormatter={(value) => new Date(value as number).toLocaleString()}
          formatter={(value: number | string) => [value != null ? `${value} ms` : "—", "Tiempo de respuesta"]}
          contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
          labelStyle={{ color: "#d1d5db" }}
        />
        {incidents.map((incident) => {
          const x1 = clamp(new Date(incident.startedAt).getTime());
          const x2 = clamp(incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now());
          if (x2 <= domainMin || x1 >= domainMax) return null;
          return <ReferenceArea key={incident.id} x1={x1} x2={x2} fill="#ef4444" fillOpacity={0.18} strokeOpacity={0} />;
        })}
        <Line
          type="monotone"
          dataKey="avgResponseTimeMs"
          stroke="#34d399"
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
