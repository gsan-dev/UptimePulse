import { isIP } from "node:net";

export type MonitorKind = "http" | "tcp" | "ping";

/** Extrae el hostname a resolver para la comprobación anti-SSRF, según el tipo de monitor. */
export function extractHostname(type: MonitorKind, target: string): string {
  if (type === "http") {
    return new URL(target).hostname;
  }
  if (type === "tcp") {
    const [host] = target.split(":");
    return host;
  }
  // ping: el target es directamente un host o una IP.
  return target;
}

// Nombre de host RFC 1123: etiquetas alfanuméricas con guiones interiores,
// separadas por puntos, 253 caracteres como máximo en total.
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/**
 * Target válido para un monitor `ping`: una IP (v4 o v6) o un hostname, sin
 * esquema, puerto ni ruta. Se pasa tal cual como argumento al `ping` del
 * sistema, así que lo usan tanto la API (al crear/editar) como el worker
 * (justo antes de ejecutar) para que nunca llegue nada que parezca un flag.
 */
export function isValidPingTarget(target: string): boolean {
  if (target.startsWith("-")) return false;
  return isIP(target) !== 0 || HOSTNAME_REGEX.test(target);
}
