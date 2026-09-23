// Logging estructurado en JSON, compartido entre apps/api y apps/worker
// (mejora #6 del análisis inicial del README, ver TASK.md Fase 5.2).
// Una línea por evento, en JSON, para que sea fácil de indexar por cualquier
// sistema de logs (Datadog, Loki, CloudWatch...) sin parsear texto libre.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * Crea un logger identificado por `service` (ej. "api", "worker") para que,
 * al centralizar logs de varios procesos, se pueda filtrar de dónde viene
 * cada línea.
 */
export function createLogger(service: string): Logger {
  function log(level: LogLevel, message: string, fields: LogFields = {}): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...fields,
    };
    const line = JSON.stringify(entry);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
}
