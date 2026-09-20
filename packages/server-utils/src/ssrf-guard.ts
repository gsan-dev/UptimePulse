import dns from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {}

// Rangos IPv4 privados/loopback/link-local. 169.254.0.0/16 incluye
// 169.254.169.254, la IP del endpoint de metadatos de AWS/GCP/Azure — el
// objetivo clásico de un ataque SSRF contra un servicio "monitoriza esta URL".
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local + metadata cloud)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7
  if (normalized.startsWith("::ffff:")) {
    // IPv4 mapeada sobre IPv6 (ej. "::ffff:127.0.0.1") — comprobar la IPv4 embebida.
    return isPrivateIPv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export interface AssertPublicHostOptions {
  /**
   * Desactiva la comprobación por completo. Pensado para que cada proceso
   * (api, worker) lo controle con su propia variable de entorno
   * ALLOW_PRIVATE_MONITOR_TARGETS, sin que este paquete dependa de ningún
   * mecanismo concreto de configuración.
   */
  allowPrivateTargets?: boolean;
}

/**
 * Lanza SsrfBlockedError si `hostname` es, o resuelve por DNS a, una IP
 * privada/loopback/link-local. Comprueba TODAS las direcciones que devuelve
 * el DNS (no solo la primera) para no dejar un hueco vía round-robin/DNS
 * rebinding.
 *
 * Usado en dos sitios: `apps/api` al crear/editar un monitor, y
 * `apps/worker` justo antes de ejecutar cada check real — un dominio podría
 * resolver a una IP pública al crearlo y cambiar a una privada más tarde.
 */
export async function assertPublicHost(hostname: string, options: AssertPublicHostOptions = {}): Promise<void> {
  if (options.allowPrivateTargets) return;

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new SsrfBlockedError(`"${hostname}" es una dirección IP privada/interna; no se puede monitorizar.`);
    }
    return;
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new SsrfBlockedError(`No se pudo resolver el host "${hostname}".`);
  }

  const blocked = addresses.find((address) => isPrivateIp(address));
  if (blocked) {
    throw new SsrfBlockedError(
      `"${hostname}" resuelve a "${blocked}", una dirección privada/interna; no se puede monitorizar.`
    );
  }
}
