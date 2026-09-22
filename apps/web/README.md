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

`docker build -f apps/web/Dockerfile -t uptimepulse-web .` → nginx sirviendo
`dist/` con fallback a `index.html`, caché de `/assets`, cabeceras de
seguridad y **proxy de `/api` y `/socket.io` hacia `API_UPSTREAM`**
(`apps/web/nginx.conf.template`, procesado con envsubst al arrancar;
`DNS_RESOLVER` para re-resolver el upstream). Así la SPA habla con la API
en su mismo origen (`src/api/config.ts`) y la imagen vale para cualquier
dominio. Solo con API en otro dominio: `--build-arg VITE_API_URL=https://api…`.
