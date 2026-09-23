import jwt from "jsonwebtoken";
import { env } from "../env.js";

/**
 * Dos tokens, dos propósitos:
 *
 *  - El **access token** viaja en cada petición, así que dura poco: si se
 *    filtra, la ventana de riesgo son minutos.
 *  - El **refresh token** solo sirve para pedir un access nuevo, y su
 *    caducidad ES la ventana de inactividad de la sesión
 *    (`SESSION_IDLE_TIMEOUT_MINUTES`, 15 minutos por defecto). Cada
 *    /auth/refresh emite uno nuevo con la cuenta a cero, así que usar la
 *    aplicación prorroga la sesión indefinidamente y dejar de usarla la
 *    cierra sola. Antes duraba 7 días fijos, lo que significaba que un
 *    navegador que recuperase su cookie de sesión (el "continuar donde lo
 *    dejaste" de Chrome) volvía a entrar sin pedir contraseña una semana
 *    después.
 *
 * La cookie que lo transporta NO lleva Max-Age a propósito (ver
 * routes/auth.ts): es una cookie de sesión, el navegador la tira al
 * cerrarse. La caducidad corta del token es el cinturón que respalda ese
 * tirante para los navegadores que restauran la sesión al reabrirse.
 */
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;

export const REFRESH_TOKEN_TTL_SECONDS = env.sessionIdleMinutes * 60;

export interface TokenPayload {
  sub: string;
  email: string;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    // Nunca más largo que la ventana de inactividad: si no, una pestaña
    // olvidada podría seguir llamando a la API con un access todavía válido
    // después de que la sesión hubiera caducado por inactividad.
    expiresIn: Math.min(ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS),
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as TokenPayload;
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as TokenPayload;
}
