# `apps/web` — frontend (React + Vite + Tailwind)

SPA con React Router. Habla con la API por REST (`VITE_API_URL`, por
defecto `http://localhost:3000`) y recibe los cambios de estado por
Socket.io con el mismo JWT.

## Arrancar en local

```bash
npm install            # una vez, desde la raíz
npm run dev:web        # http://localhost:5173 (Vite, con HMR)
```

Necesita la API arrancada (`npm run dev:api`) y, para ver estados reales,
el worker (`npm run dev:worker`).

## Rutas

| Ruta | Página |
| --- | --- |
| `/register`, `/login` | registro (username, nombre, email, contraseña) y login por email o username |
| `/monitors` | dashboard: contadores, lista con sparklines, estado en tiempo real |
| `/monitors/new`, `/monitors/:id` | crear (HTTP/TCP/ping) y detalle (métricas, gráfico, incidentes, canales, pausar/editar/borrar) |
| `/channels` | canales de notificación (Discord, Slack, webhook firmado) |
| `/status-pages` | status pages públicas de la organización |
| `/status/:username/:slug` | status page pública (sin sesión) |
| `/team`, `/invitations/:token` | miembros, roles e invitaciones |
| `/pricing` | planes reales del backend y cambio de plan (simulado) |
| `/profile` | username y nombre |

## Decisiones que conviene conocer

- **Nunca `confirm()`/`alert()`/`prompt()`** (regla de ESLint): en el
  navegador integrado de VS Code y en iframes con sandbox devuelven `false`
  sin preguntar. Usa `useConfirm()` (`context/ConfirmContext.tsx`) y
  `showToast()` (`context/ToastContext.tsx`).
- El access token vive en memoria (`context/AuthContext.tsx`) y se renueva
  con la cookie httpOnly de refresh; la organización activa va en
  `localStorage` y se manda en `X-Organization-Id` (`api/client.ts`).
- `components/StatusBadge.tsx` decide el estado visible a partir de
  `consolidatedStatus` (up / degraded / down / paused / pending).

## Comprobar

```bash
npx tsc --noEmit -p apps/web
npx eslint apps/web/src
npm run build --workspace=apps/web     # vite build → apps/web/dist
npm run test:e2e                       # Playwright, flujo crítico (desde la raíz)
```

## Imagen Docker

`docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.midominio.com -t uptimepulse-web .`
→ nginx sirviendo `dist/` con fallback a `index.html`, caché de `/assets` y
cabeceras de seguridad (`apps/web/nginx.conf`). La URL de la API se fija en
el build.
