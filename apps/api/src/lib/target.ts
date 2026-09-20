import type { MonitorType } from "@uptimepulse/shared";

/** Extrae el hostname a resolver para la comprobación anti-SSRF, según el tipo de monitor. */
export function extractHostname(type: MonitorType, target: string): string {
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
