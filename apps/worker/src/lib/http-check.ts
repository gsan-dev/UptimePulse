import type { CheckOutcome } from "./types.js";

export interface HttpCheckInput {
  target: string;
  method: string;
  headers: Record<string, string> | null;
  body: string | null;
  expectedStatus: number | null;
  timeoutMs: number;
}

export async function runHttpCheck(input: HttpCheckInput): Promise<CheckOutcome> {
  const startedAt = Date.now();
  try {
    const response = await fetch(input.target, {
      method: input.method,
      headers: input.headers ?? undefined,
      body: input.body ?? undefined,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const responseTimeMs = Date.now() - startedAt;
    const expected = input.expectedStatus;
    const isUp = expected !== null ? response.status === expected : response.status < 400;

    return {
      status: isUp ? "up" : "down",
      responseTimeMs,
      httpStatus: response.status,
      errorMessage: isUp
        ? null
        : `Se esperaba ${expected !== null ? `status ${expected}` : "un status < 400"}, se obtuvo ${response.status}`,
    };
  } catch (error) {
    return {
      status: "down",
      responseTimeMs: Date.now() - startedAt,
      httpStatus: null,
      errorMessage: describeFetchError(error, input.timeoutMs),
    };
  }
}

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") {
    return `Timeout tras ${timeoutMs}ms`;
  }
  if (error instanceof Error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code;
    if (code === "ENOTFOUND") return "No se pudo resolver el nombre de dominio (DNS)";
    if (code === "ECONNREFUSED") return "Conexión rechazada";
    if (code === "ECONNRESET") return "Conexión reiniciada por el servidor remoto";
    if (code === "CERT_HAS_EXPIRED") return "Certificado SSL caducado";
    return error.message;
  }
  return "Error desconocido en la petición HTTP";
}
