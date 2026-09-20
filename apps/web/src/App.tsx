import type { Monitor } from "@uptimepulse/shared";

// Placeholder para probar que el tipo Monitor (derivado del esquema real de
// la BD en la Fase 0.3) llega con autocompletado hasta el frontend. El
// listado real, con datos de la API, llega en la Fase 1.4.
const placeholderMonitors: Pick<Monitor, "name" | "type" | "target">[] = [
  { name: "Google", type: "http", target: "https://google.com" },
  { name: "API interna", type: "tcp", target: "10.0.0.5:5432" },
];

export default function App() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>UptimePulse</h1>
      <p>Esqueleto del frontend (Fase 0.1). El dashboard real llega en la Fase 1.4.</p>
      <ul>
        {placeholderMonitors.map((monitor) => (
          <li key={monitor.target}>
            {monitor.name} — {monitor.type} — {monitor.target}
          </li>
        ))}
      </ul>
    </main>
  );
}
