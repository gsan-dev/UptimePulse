# Diario de construcción de UptimePulse

> Registro paso a paso de todo lo que se implementa, cómo se hace y cómo reproducirlo tú mismo desde una terminal, sin depender de este asistente. Cada entrada corresponde a una tarea de [TASK.md](TASK.md).

---

## 2026-09-20 — Fase 0.1: Estructura del monorepo

### Objetivo
Tener el esqueleto de carpetas del proyecto (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`) con cada parte arrancando un "Hello world", más las herramientas base de calidad de código (TypeScript, ESLint, Prettier) y el repositorio git inicializado.

### Decisión de diseño: npm workspaces en vez de pnpm
El README sugería `pnpm` como gestor de monorepo. Al intentar activarlo con `corepack enable pnpm`, Windows dio un error de permisos (`EPERM`) porque corepack necesita escribir en `C:\Program Files\nodejs`, que requiere permisos de administrador.

**Decisión:** usar **npm workspaces** en su lugar. Viene integrado con Node (desde npm 7+), no requiere instalar nada adicional ni permisos de admin, y para el tamaño de este proyecto cubre exactamente lo mismo que pnpm (resolución de dependencias compartidas entre `apps/*` y `packages/*`, scripts por workspace). Si en el futuro el repo crece mucho y se necesita cacheo de builds más agresivo, se puede migrar a Turborepo por encima de npm workspaces sin rehacer la estructura.

> Si más adelante consigues permisos de admin y prefieres pnpm, el cambio es mecánico: borrar `node_modules` y `package-lock.json` de raíz, sustituir `"workspaces"` de `package.json` por un `pnpm-workspace.yaml`, y ejecutar `pnpm install`.

### Qué se hizo

1. **Estructura de carpetas** (README §6):
   ```
   uptimepulse/
   ├── apps/
   │   ├── api/src
   │   ├── worker/src
   │   └── web/src
   └── packages/
       └── shared/src
   ```

2. **`package.json` raíz** con `"workspaces": ["apps/*", "packages/*"]` y scripts atajo:
   - `npm run dev:api` → arranca solo la API.
   - `npm run dev:worker` → arranca solo el worker.
   - `npm run dev:web` → arranca solo el frontend.
   - `npm run build` / `npm run lint` / `npm run test` → se ejecutan en todos los workspaces que tengan ese script (`--workspaces --if-present`).

3. **`tsconfig.base.json`** en la raíz: configuración TypeScript estricta (`strict: true`) compartida, que cada app extiende con `"extends": "../../tsconfig.base.json"`.

4. **`packages/shared`**: paquete `@uptimepulse/shared` sin paso de compilación (se importa el `.ts` directamente vía `tsx`/Vite) que exporta los primeros tipos de dominio (`Monitor`, `MonitorType`, `MonitorStatus`). Este paquete crecerá según se avance en el modelo de datos (Fase 0.3).

5. **`apps/api`** y **`apps/worker`**: cada uno un paquete npm mínimo que usa [`tsx`](https://github.com/privatenumber/tsx) para ejecutar TypeScript directamente en desarrollo (sin compilar a JS cada vez), con `tsx watch` para recarga automática al guardar. De momento solo imprimen un mensaje por consola a modo de placeholder.

6. **`apps/web`**: app React + Vite + TypeScript montada a mano (en vez del scaffold interactivo `npm create vite@latest`, para que cada archivo generado quede documentado aquí). Arranca en `http://localhost:5173`.

7. **Calidad de código**: `eslint.config.js` (formato "flat config" de ESLint 9) con las reglas recomendadas de JS + TypeScript, y `.prettierrc.json` con el estilo de formateo. Scripts `npm run lint` y `npm run format` en la raíz.

8. **`.gitignore`** para no versionar `node_modules`, `dist`, `.env`, logs, etc.

9. **`git init`** — se inicializó el repositorio local. **Aún no se ha hecho ningún commit** (lo dejo para cuando tú lo confirmes explícitamente, ya que crear commits es una decisión tuya).

### Comandos ejecutados (y qué hace cada uno)

```bash
# Comprobar herramientas disponibles
node --version      # v24.19.0
npm --version        # 11.17.0
git --version        # 2.55.0

# Instalar todas las dependencias de todos los workspaces de golpe
npm install

# Arrancar cada app por separado (cada una en su propia terminal, quedan corriendo)
npm run dev:api      # imprime el mensaje placeholder y se queda escuchando cambios
npm run dev:worker   # ídem
npm run dev:web      # levanta Vite en http://localhost:5173

# Comprobar que el código pasa las reglas de estilo/errores básicos
npm run lint

# Inicializar el repositorio git (sin hacer commit todavía)
git init
```

### Cómo reproducir este paso tú mismo, desde cero

Si quisieras montar exactamente esto sin mí, en una carpeta vacía:

1. Verifica que tienes Node 20+ instalado: `node --version`.
2. Crea las carpetas: `mkdir -p apps/api/src apps/worker/src apps/web/src packages/shared/src` (en PowerShell: `New-Item -ItemType Directory -Force -Path apps/api/src, apps/worker/src, apps/web/src, packages/shared/src`).
3. Copia el contenido de cada archivo tal como aparece en el repo actual (`package.json` raíz, `tsconfig.base.json`, `.gitignore`, `eslint.config.js`, `.prettierrc.json`, y los `package.json`/`tsconfig.json`/`src/*` de cada `apps/*` y `packages/shared`) — todos están ya en tu proyecto, este diario documenta el porqué de cada uno, no hace falta rehacerlos.
4. Ejecuta `npm install` en la raíz.
5. Comprueba que arranca cada pieza con `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` (en terminales separadas) y que `npm run lint` no da errores.
6. `git init` si aún no existe `.git/`.

### Cómo verificar que este paso está bien hecho
- `npm run dev:api` imprime `[api] servidor placeholder arrancado...` sin errores.
- `npm run dev:worker` imprime `[worker] proceso placeholder arrancado...` sin errores.
- `npm run dev:web` levanta Vite y `http://localhost:5173` muestra la página "UptimePulse" en el navegador.
- `npm run lint` termina sin listar errores.
- `git status` ya no dice "not a git repository".

### Pendiente / notas para más adelante
- Hay 2 vulnerabilidades reportadas por `npm audit` (1 moderada, 1 alta) en dependencias transitivas del scaffold de Vite/ESLint. No son explotables en este momento (son herramientas de desarrollo, no código que se despliega), pero conviene revisarlas con `npm audit` antes de la Fase 5 (seguridad).
- `npm` avisó de scripts de instalación pendientes de aprobar para `esbuild` (usado por Vite): `npm warn allow-scripts ... esbuild@0.28.2/0.21.5`. Esto es una política de seguridad de npm que bloquea `postinstall` scripts no aprobados explícitamente. Vite funcionó igualmente en la prueba (usa un binario ya publicado), pero si en el futuro ves errores de "esbuild binary not found", ejecuta `npm approve-scripts esbuild` para aprobarlo conscientemente (revisando antes qué hace ese script).
- ~~Todavía no hay ningún commit en git~~ **Corrección (ver entrada del 2026-09-20 más abajo): esto ya no es así.** Fuera de esta conversación se conectó el proyecto a un repositorio remoto real (`github.com/gsan-dev/UptimePulse`), con commits ya hechos. Detalle completo en la siguiente entrada.

### Próximo paso (Fase 0.2)
Levantar `docker-compose.yml` con PostgreSQL (+ TimescaleDB) y Redis para tener la infraestructura de datos local lista antes de diseñar el esquema de la Fase 0.3.

---

## 2026-09-20 (continuación) — Incidente: ramas git y verificación de la Fase 0.1

### Qué pasó
Fuera de esta conversación (probablemente desde el panel de Source Control de VS Code) se conectó el proyecto a un repositorio remoto real: `https://github.com/gsan-dev/UptimePulse.git`. Ahí se crearon dos ramas con historiales muy distintos:

- **`main`** → un único commit `"Initial commit: README only"` cuyo árbol está **completamente vacío** (ni siquiera tiene el readme, pese al mensaje).
- **`dev`** → un commit `"dev-branch 0.1 task.md readme.md apps/ packages/"` que sí contiene todo el trabajo de la Fase 0.1 (readme, TASK.md, DIARIO.md, apps/, packages/, configuración).

En algún momento se hizo `checkout` a `main`, y como esa rama no tiene archivos, Git vació la carpeta de trabajo — esto es lo que pareció "Git ha borrado mis archivos". Al volver a `dev`, todo reapareció porque ahí sí está guardado.

**Decisión tomada con el usuario:** dejar `main` vacía tal cual está por ahora y trabajar exclusivamente en `dev`. `main` seguirá siendo una rama "trampa" (si algo la vuelve a hacer checkout, la carpeta se vacía otra vez), así que conviene fijarse en el selector de rama de VS Code y confirmar que siempre marca `dev` antes de trabajar.

El usuario subió manualmente el `readme.md` a `main` con:
```bash
git checkout main
git checkout dev -- readme.md
git add readme.md
git commit -m "Añadir readme.md a main"
git push origin main
git checkout dev   # importante: volver a dev para seguir trabajando
```

### Verificación completa de la Fase 0.1 (repetida tras el incidente)

Como `node_modules/` no está versionado (está en `.gitignore`), desapareció durante el vaivén de ramas — **esto es normal y no indica ningún problema**, simplemente hay que reinstalar:

```bash
npm install
```

Con eso reinstalado, se repitió la checklist de verificación original y **todo sigue cumpliéndose**:

| Comprobación | Resultado |
|---|---|
| `npm run lint` sin errores | ✅ Correcto |
| `npm run dev:api` imprime el mensaje placeholder | ✅ Correcto |
| `npm run dev:worker` imprime el mensaje placeholder | ✅ Correcto |
| `npm run dev:web` levanta Vite en `http://localhost:5173` | ✅ Correcto |
| `git status` reconoce el repositorio (ya no dice "not a git repository") | ✅ Correcto — además ahora hay un remoto (`origin`) configurado |

**Conclusión: la Fase 0.1 sigue completa y funcional.** Nada se perdió; el susto fue por el checkout a una rama vacía, no por una eliminación real de archivos.

### Lección para el futuro
Cada vez que reabras el proyecto tras un tiempo sin tocarlo (o tras cualquier operación de git rara), el primer chequeo es:
```bash
git branch --show-current   # ¿estás en dev?
git status                  # ¿working tree clean?
npm install                 # por si falta node_modules
```

---

## 2026-09-20 (continuación 2) — Fase 0.2: Docker Compose para desarrollo

### Objetivo
Tener PostgreSQL (con la extensión TimescaleDB) y Redis corriendo en local vía Docker, con datos persistentes entre reinicios y configuración por variables de entorno, listos para que la Fase 0.3 (esquema de base de datos) tenga dónde aplicar sus migraciones.

### Paso previo: instalar y arrancar Docker Desktop
Docker no estaba instalado en la máquina. Se instaló con `winget` (requiere que el propio instalador se autoeleve a administrador — lo pidió Windows vía UAC, no hizo falta hacer nada especial más que aceptar):

```powershell
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements --silent
```

Tras la instalación hizo falta:
1. **Reiniciar el equipo** (para que Windows terminase de activar WSL2/Virtualización, que Docker Desktop necesita como backend). Esto lo hizo el usuario manualmente — reiniciar la máquina es una acción que afecta a todo lo abierto, así que no se automatiza.
2. **Abrir Docker Desktop** — la app no arranca sola tras el reinicio. Se lanzó con:
   ```powershell
   Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
   ```
3. Esperar (30-90s la primera vez) a que el daemon responda:
   ```bash
   docker info
   ```

> **Nota:** el CLI de `docker` no queda en el `PATH` de Git Bash tras la instalación. La ruta completa que funciona es `/c/Program Files/Docker/Docker/resources/bin/docker.exe`. En una consola normal de Windows (PowerShell/CMD) sí queda disponible como `docker` tras reiniciar la terminal, porque Docker Desktop añade esa ruta al `PATH` del sistema, no al de Git Bash específicamente.

### Qué se hizo

1. **`docker-compose.yml`** en la raíz, con dos servicios:
   - `postgres` — imagen `timescale/timescaledb:latest-pg16` (Postgres con la extensión TimescaleDB ya instalada, en vez de la imagen oficial `postgres` a secas + instalar la extensión a mano).
   - `redis` — imagen `redis:7-alpine` (ligera, para la cola de trabajo de la Fase 2.1).
   - Ambos con `healthcheck` (`pg_isready` / `redis-cli ping`) para que `docker compose ps` diga explícitamente si están sanos, no solo "arrancados".
   - Ambos con volumen nombrado (`postgres_data`, `redis_data`) para que los datos sobrevivan a un `docker compose down` (no a un `down -v`, que sí los borra a propósito).
   - Puertos y credenciales parametrizados vía variables de entorno con valores por defecto (`${POSTGRES_USER:-uptimepulse}`), para que funcione incluso sin `.env`.

2. **`.env.example`** (versionado en git) documentando todas las variables: usuario/contraseña/puerto de Postgres, `DATABASE_URL` ya montada, puerto y `REDIS_URL` de Redis.

3. **`.env`** real creado como copia de `.env.example` (ya estaba cubierto por `.gitignore` desde la Fase 0.1, así que nunca se sube).

### Comandos ejecutados (y qué hace cada uno)

```bash
# Copiar la plantilla de variables de entorno a la real (solo la primera vez)
cp .env.example .env

# Descargar las imágenes y levantar los contenedores en segundo plano
docker compose up -d

# Ver el estado de los contenedores (deben decir "healthy", no solo "Up")
docker compose ps

# Comprobar que la extensión TimescaleDB está disponible dentro de Postgres
docker exec uptimepulse-postgres psql -U uptimepulse -d uptimepulse \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT extname, extversion FROM pg_extension WHERE extname='timescaledb';"

# Comprobar que Redis responde
docker exec uptimepulse-redis redis-cli ping

# Ver los volúmenes persistentes creados
docker volume ls
```

**Resultado de la verificación:**
- `uptimepulse-postgres` → `Up (healthy)`, puerto `5432` expuesto.
- `uptimepulse-redis` → `Up (healthy)`, puerto `6379` expuesto.
- Extensión `timescaledb` versión `2.30.1` instalada correctamente.
- Redis responde `PONG`.
- Volúmenes `uptimepulse_postgres_data` y `uptimepulse_redis_data` creados.

### Cómo reproducir este paso tú mismo, desde cero

1. Instala Docker Desktop (si no lo tienes): `winget install --id Docker.DockerDesktop -e`, reinicia el equipo, abre Docker Desktop y espera a que el icono de la ballena diga "running".
2. En la raíz del proyecto: `cp .env.example .env` (en PowerShell: `Copy-Item .env.example .env`). Cambia la contraseña si quieres, aunque en local no es crítico.
3. `docker compose up -d`.
4. `docker compose ps` — comprueba que ambos servicios dicen `healthy`.
5. (Opcional, solo para comprobar) `docker exec uptimepulse-postgres psql -U uptimepulse -d uptimepulse -c "\dx"` — debería listar `timescaledb` entre las extensiones.

### Comandos útiles para el día a día
```bash
docker compose up -d       # arrancar (si ya existen los contenedores, los reutiliza)
docker compose down        # parar y borrar los contenedores (los datos NO se pierden, están en los volúmenes)
docker compose down -v     # parar y borrar TAMBIÉN los volúmenes (esto sí borra los datos, úsalo con cuidado)
docker compose logs -f     # ver logs en vivo de ambos servicios
```

### Pendiente / notas para más adelante
- La imagen usa el tag flotante `latest-pg16` (la última versión de TimescaleDB compatible con Postgres 16). Para producción convendría fijar una versión exacta (ej. `timescale/timescaledb:2.17.2-pg16`) para que un `docker compose pull` futuro no cambie de versión sin avisar. Anotado como mejora, no urgente en desarrollo.
- La contraseña por defecto en `.env.example` es `changeme` — recuerda cambiarla si esto llega a desplegarse en algún sitio accesible, aunque en local no supone riesgo real.

### Próximo paso (Fase 0.3)
Diseñar el modelo de datos (ERD) y elegir herramienta de migraciones (Prisma/Drizzle/node-pg-migrate) para empezar a aplicar el esquema sobre este Postgres.
