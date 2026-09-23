import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

/**
 * Métricas Prometheus de la API (Fase 5.2). Un registro propio (no el
 * global de prom-client) para que los tests puedan crear varios servidores
 * en el mismo proceso sin "metric already registered".
 */
export function createApiTelemetry() {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "api" });
  collectDefaultMetrics({ register: registry, prefix: "uptimepulse_api_" });

  const httpRequestsTotal = new Counter({
    name: "uptimepulse_api_http_requests_total",
    help: "Peticiones HTTP atendidas por la API, por ruta y código de estado",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const httpRequestDuration = new Histogram({
    name: "uptimepulse_api_http_request_duration_seconds",
    help: "Duración de las peticiones HTTP de la API",
    labelNames: ["method", "route"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  return { registry, httpRequestsTotal, httpRequestDuration };
}

export type ApiTelemetry = ReturnType<typeof createApiTelemetry>;
