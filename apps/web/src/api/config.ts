// Dónde está la API (Fase 5.4, self-hosted):
//  - En desarrollo (Vite), la API corre aparte en http://localhost:3000.
//  - En la imagen de producción, nginx sirve esta SPA y hace de proxy de la
//    API en /api y del WebSocket en /socket.io (apps/web/nginx.conf), así
//    que por defecto todo es mismo origen: sin CORS, sin URL incrustada en
//    el build y válido para cualquier dominio.
//  - VITE_API_URL (en build) fuerza una URL absoluta para el caso de API y
//    frontend en dominios distintos.
const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

export const API_BASE = configured || (import.meta.env.DEV ? "http://localhost:3000" : "/api");

export const SOCKET_URL =
  configured || (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin);
