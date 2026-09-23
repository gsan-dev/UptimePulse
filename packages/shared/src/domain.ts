// Todos los tipos de este archivo se derivan del esquema real de la base de
// datos (`packages/db/src/schema.ts`), en vez de mantenerse a mano por
// duplicado. Así, un cambio de columna en el esquema se refleja aquí (y por
// tanto en `apps/api` y `apps/web`) sin tener que tocar nada en este archivo.
//
// IMPORTANTE: todo lo que se importa de "@uptimepulse/db" aquí debe ser
// `import type`, nunca un import "normal". `@uptimepulse/db` trae el driver
// de Postgres (`pg`) y abre una conexión en cuanto se importa su cliente en
// tiempo de ejecución — algo que nunca debe acabar en el bundle del
// navegador. `import type` se borra por completo al compilar (TypeScript/
// esbuild lo eliminan siempre), así que el frontend obtiene los tipos sin
// arrastrar ni una línea de código de acceso a datos.
import type { InferSelectModel } from "drizzle-orm";
import type {
  checkStatusEnum,
  checks,
  channelTypeEnum,
  incidents,
  maintenanceWindows,
  monitorTypeEnum,
  monitors,
  notificationChannels,
  orgRoleEnum,
  organizations,
  statusPages,
  users,
} from "@uptimepulse/db";

// --- Enums (derivados de los pgEnum del esquema, no reescritos a mano) ---

export type MonitorType = (typeof monitorTypeEnum.enumValues)[number];
export type CheckStatus = (typeof checkStatusEnum.enumValues)[number];
export type ChannelType = (typeof channelTypeEnum.enumValues)[number];
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];

// Estado que se muestra en el dashboard: no es una columna de la BD, es una
// combinación de `Monitor.isPaused` + el resultado del último check (lo
// calculará el worker/la API, no vive tal cual en ninguna tabla).
export type MonitorStatus = "up" | "down" | "degraded" | "paused";

// --- Entidades (una fila = un objeto, tal como las devuelve Drizzle) ---

export type Monitor = InferSelectModel<typeof monitors>;
export type Check = InferSelectModel<typeof checks>;
export type Incident = InferSelectModel<typeof incidents>;
export type NotificationChannel = InferSelectModel<typeof notificationChannels>;
export type MaintenanceWindow = InferSelectModel<typeof maintenanceWindows>;
export type StatusPage = InferSelectModel<typeof statusPages>;
export type Organization = InferSelectModel<typeof organizations>;

// Los usuarios sí necesitan una versión "recortada": el frontend nunca debe
// recibir el hash de la contraseña ni los identificadores de OAuth.
export type PublicUser = Omit<InferSelectModel<typeof users>, "passwordHash" | "oauthId">;

/**
 * Los tipos de arriba reflejan las columnas tal como las devuelve Drizzle en
 * el servidor (con `Date` de verdad y `bigint` de verdad para `Check.id`).
 * Pero JSON no sabe serializar ninguno de los dos: una fecha llega al
 * navegador como string ISO, y un bigint literalmente no se puede meter en
 * un JSON.stringify (lanza una excepción) — por eso la API lo convierte a
 * string antes de responder. `Serialized<T>` refleja la forma REAL en la que
 * un tipo de dominio llega al frontend tras cruzar la red; úsalo ahí, no el
 * tipo original.
 */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends bigint ? string : T[K];
};
