import { useEffect, useRef } from "react";
import { getSessionIdleMinutes, silentRefresh } from "../api/auth";

// Lo que cuenta como "tocar la interfaz". `scroll` y `mousemove` van en
// captura y pasivos para no interferir con nada de la página.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"] as const;

// Cada cuánto se comprueba si se ha agotado la ventana. Nada más fino tiene
// sentido: la precisión que importa es la de la API, que es quien de verdad
// invalida la sesión.
const TICK_MS = 15_000;

// Mínimo entre dos refrescos provocados por actividad. Sin esto, mover el
// ratón dispararía una petición por evento; con esto, como mucho una por
// minuto, que basta de sobra para ir corriendo una ventana de 15.
const REFRESH_THROTTLE_MS = 60_000;

/**
 * Cierra la sesión sola tras N minutos sin tocar la interfaz, y la prorroga
 * mientras sí se toca.
 *
 * El reloj de verdad está en la API: el refresh token caduca a los
 * `SESSION_IDLE_TIMEOUT_MINUTES` y se renueva en cada `/auth/refresh` (ver
 * apps/api/src/lib/tokens.ts). Este hook hace las dos mitades que le
 * corresponden al navegador:
 *
 *  1. **Prorrogar**: ante actividad real, y como mucho una vez por minuto,
 *     llama a `silentRefresh()` para que el servidor reinicie la cuenta.
 *     Sin esto, una persona leyendo el dashboard sin hacer clic se quedaría
 *     fuera a los 15 minutos aunque estuviera delante.
 *  2. **Echar**: si se agota la ventana, llama a `onExpire` en vez de
 *     esperar a que falle la siguiente petición — así la sesión se cierra
 *     también en una pestaña que estaba quieta, y no se queda un dashboard
 *     con datos a la vista de alguien que ya no debería verlos.
 *
 * Que la pestaña esté en segundo plano no cuenta como actividad: volver a
 * ella sí (`visibilitychange`), y ahí se comprueba de inmediato si la sesión
 * ya había caducado mientras no se miraba.
 */
export function useIdleSession(enabled: boolean, onExpire: () => void): void {
  // En refs y no en estado: cambiarlos no debe repintar nada, y el efecto no
  // debe volver a montarse (perdiendo la cuenta) porque cambie `onExpire`.
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(Date.now());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!enabled) return;

    lastActivityRef.current = Date.now();
    lastRefreshRef.current = Date.now();
    let expired = false;

    function idleMs(): number {
      return getSessionIdleMinutes() * 60_000;
    }

    function expire(): void {
      if (expired) return;
      expired = true;
      onExpireRef.current();
    }

    function handleActivity(): void {
      if (expired) return;
      const now = Date.now();
      // Una actividad que llega DESPUÉS de agotada la ventana no la
      // reinicia: la sesión ya estaba muerta en el servidor, y revivirla
      // aquí solo serviría para enseñar datos con un token que la API va a
      // rechazar en la siguiente petición.
      if (now - lastActivityRef.current >= idleMs()) {
        expire();
        return;
      }
      lastActivityRef.current = now;
      if (now - lastRefreshRef.current >= REFRESH_THROTTLE_MS) {
        lastRefreshRef.current = now;
        void silentRefresh();
      }
    }

    function handleVisibility(): void {
      if (document.visibilityState === "visible") handleActivity();
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);

    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleMs()) expire();
    }, TICK_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(timer);
    };
  }, [enabled]);
}
