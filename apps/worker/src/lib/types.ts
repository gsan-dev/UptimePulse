/**
 * Clasificación del fallo de un check (Fase 5.2): es lo que permite contar
 * en métricas "cuántos han fallado por timeout vs. error de conexión" sin
 * analizar los mensajes de error (que están en español y pensados para
 * personas). `null` cuando el check es "up".
 */
export type CheckErrorKind =
  | "timeout"
  | "dns"
  | "connection"
  | "tls"
  | "unexpected_status"
  | "redirect"
  | "ssrf"
  | "invalid_target"
  | "other";

export interface CheckOutcome {
  status: "up" | "down";
  responseTimeMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  errorKind: CheckErrorKind | null;
}
