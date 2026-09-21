import { assertPublicHost, SsrfBlockedError } from "@uptimepulse/server-utils";
import type { CheckErrorKind, CheckOutcome } from "./types.js";

export interface HttpCheckInput {
  target: string;
  method: string;
  headers: Record<string, string> | null;
  body: string | null;
  expectedStatus: number | null;
  timeoutMs: number;
  /** Región del worker (Fase 4.2): se anuncia en el User-Agent. */
  region: string;
  /** Desactiva el anti-SSRF en las redirecciones (solo desarrollo, ver env). */
  allowPrivateTargets?: boolean;
  /** Inyectable en tests; por defecto el fetch global de Node. */
  fetchImpl?: typeof fetch;
}

// Como hacen los navegadores: más de 5 saltos suele ser un bucle.
export const MAX_REDIRECTS = 5;

function hasHeader(headers: Record<string, string> | null, name: string): boolean {
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase());
}

/**
 * Check HTTP. Las redirecciones se siguen A MANO (`redirect: "manual"`) para
 * revalidar el anti-SSRF en cada salto (Fase 5.1): una URL pública puede
 * responder 302 hacia http://169.254.169.254/ o http://localhost:6379 y, con
 * el seguimiento automático de fetch, el worker haría esa petición interna
 * sin que nadie la hubiera comprobado. Se aplica el mismo timeout a la
 * cadena completa, no a cada salto.
 */
export async function runHttpCheck(input: HttpCheckInput): Promise<CheckOutcome> {
  const startedAt = Date.now();
  const doFetch = input.fetchImpl ?? fetch;
  // Identificarse como UptimePulse y desde qué región se comprueba es lo
  // que hace cualquier servicio de monitorización serio (los logs del
  // servidor vigilado lo agradecen) — y además permite probar el quórum sin
  // infraestructura real: un servidor puede fallar solo para una región.
  // Si el usuario configuró su propio User-Agent en el monitor, se respeta.
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (!hasHeader(input.headers, "user-agent")) {
    headers["User-Agent"] = `UptimePulse/1.0 (+region=${input.region})`;
  }
  const signal = AbortSignal.timeout(input.timeoutMs);

  try {
    let url = input.target;
    let method = input.method;
    let body: string | undefined = input.body ?? undefined;

    for (let hop = 0; ; hop++) {
      const response = await doFetch(url, { method, headers, body, signal, redirect: "manual" });
      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location !== null;

      if (!isRedirect) {
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
          errorKind: isUp ? null : "unexpected_status",
        };
      }

      if (hop >= MAX_REDIRECTS) {
        return failure(
          startedAt,
          response.status,
          `Demasiadas redirecciones (más de ${MAX_REDIRECTS})`,
          "redirect"
        );
      }

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return failure(
          startedAt,
          response.status,
          `Redirección a una URL inválida: ${location}`,
          "redirect"
        );
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return failure(
          startedAt,
          response.status,
          `Redirección a un esquema no permitido: ${next.protocol}`,
          "redirect"
        );
      }
      // El salto se comprueba igual que el target original: si apunta a una
      // IP privada (o a un dominio que resuelve a una), se corta aquí.
      await assertPublicHost(next.hostname, { allowPrivateTargets: input.allowPrivateTargets });

      // Semántica HTTP: 303 siempre pasa a GET; 301/302 con POST también (es
      // lo que hacen los navegadores y fetch); 307/308 conservan método y body.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === "POST")
      ) {
        method = "GET";
        body = undefined;
      }
      url = next.toString();
    }
  } catch (error) {
    const { message, kind } = describeFetchError(error, input.timeoutMs);
    return failure(startedAt, null, message, kind);
  }
}

function failure(
  startedAt: number,
  httpStatus: number | null,
  message: string,
  kind: CheckErrorKind
): CheckOutcome {
  return {
    status: "down",
    responseTimeMs: Date.now() - startedAt,
    httpStatus,
    errorMessage: message,
    errorKind: kind,
  };
}

function describeFetchError(
  error: unknown,
  timeoutMs: number
): { message: string; kind: CheckErrorKind } {
  if (error instanceof SsrfBlockedError) {
    return { message: `Redirección bloqueada: ${error.message}`, kind: "ssrf" };
  }
  if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") {
    return { message: `Timeout tras ${timeoutMs}ms`, kind: "timeout" };
  }
  if (error instanceof Error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return { message: "No se pudo resolver el nombre de dominio (DNS)", kind: "dns" };
    }
    if (code === "ECONNREFUSED") return { message: "Conexión rechazada", kind: "connection" };
    if (code === "ECONNRESET")
      return { message: "Conexión reiniciada por el servidor remoto", kind: "connection" };
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH")
      return { message: "Host inalcanzable", kind: "connection" };
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return { message: `Timeout tras ${timeoutMs}ms`, kind: "timeout" };
    }
    if (code === "CERT_HAS_EXPIRED") return { message: "Certificado SSL caducado", kind: "tls" };
    if (
      code?.startsWith("ERR_TLS") ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN"
    ) {
      return { message: `Error TLS: ${code}`, kind: "tls" };
    }
    return { message: error.message, kind: "other" };
  }
  return { message: "Error desconocido en la petición HTTP", kind: "other" };
}
