import type { Redis } from "ioredis";

/**
 * Límite de checks salientes por host de destino (Fase 5.1). Sin esto, un
 * usuario con 50 monitores a 30 s contra el mismo dominio (o varios
 * usuarios contra la misma víctima) convierten a UptimePulse en una
 * herramienta de DDoS de baja intensidad. El contador vive en Redis y es
 * global: lo comparten todos los workers de todas las regiones.
 *
 * Ventana fija de 60 s por host: sencilla, barata (INCR + EXPIRE) y
 * suficiente — no hace falta la precisión de un sliding window para esto.
 */
export interface HostRateLimiter {
  /** true si el check puede ejecutarse; false si el host ya agotó su cuota este minuto. */
  tryAcquire(hostname: string): Promise<{ allowed: boolean; count: number; limit: number }>;
}

const KEY_PREFIX = "uptimepulse:host-rate";
const WINDOW_SECONDS = 60;

export function createHostRateLimiter(redis: Redis, maxChecksPerMinute: number): HostRateLimiter {
  return {
    async tryAcquire(hostname) {
      const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
      const key = `${KEY_PREFIX}:${hostname.toLowerCase()}:${windowStart}`;
      const [[, count]] = (await redis
        .multi()
        .incr(key)
        // Un margen sobre la ventana para que la clave caduque sola aunque
        // el proceso muera entre el INCR y el EXPIRE de la siguiente vuelta.
        .expire(key, WINDOW_SECONDS * 2)
        .exec()) as [[Error | null, number], [Error | null, number]];
      return { allowed: count <= maxChecksPerMinute, count, limit: maxChecksPerMinute };
    },
  };
}
