import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const orgRoleEnum = pgEnum("org_role", ["admin", "editor", "readonly"]);
export const monitorTypeEnum = pgEnum("monitor_type", ["http", "tcp", "ping"]);
export const checkStatusEnum = pgEnum("check_status", ["up", "down"]);
// Estado consolidado de un monitor a partir de todas sus regiones (Fase
// 4.2): "degraded" = alguna región lo ve caído pero no las suficientes para
// el quórum. Ver apps/worker/src/lib/health.ts.
export const monitorHealthEnum = pgEnum("monitor_health", ["up", "degraded", "down"]);
export const channelTypeEnum = pgEnum("channel_type", [
  "email",
  "sms",
  "webhook",
  "slack",
  "discord",
]);

// --- Organizaciones ---

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Identificador público de la organización, para su propia URL de estado
  // (/status/team/<slug>/<page-slug>). Es NULL mientras no tenga URL
  // pública: en Postgres un UNIQUE admite tantos NULL como haga falta, así
  // que "sin slug" no compite con nadie. Vive en un espacio de nombres
  // distinto al de `users.username` (va detrás de /status/team/), así que
  // una organización y un usuario pueden llamarse igual sin conflicto.
  slug: text("slug").unique(),
  // Quién la creó (Fase 4.1). La organización "personal" de un usuario es la
  // que se creó en su registro; con equipos ya no vale "la más antigua de
  // las que es miembro" (puede unirse a una más antigua que la suya), así
  // que se guarda explícitamente. No es una FK con cascade: borrar el
  // usuario no debe borrar una organización con más miembros.
  ownerUserId: uuid("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Usuarios ---

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  // Identificador público del usuario (minúsculas, números y guiones). Es lo
  // que aparece en las URLs propias de cada usuario, por ejemplo
  // /status/<username>/<slug> — así dos usuarios pueden usar el mismo slug
  // sin pisarse. Los usuarios anteriores a esta columna lo recibieron
  // derivado de su email (ver migración 0008) y pueden cambiarlo en /me.
  username: text("username").notNull().unique(),
  fullName: text("full_name"),
  passwordHash: text("password_hash"),
  oauthProvider: text("oauth_provider"),
  oauthId: text("oauth_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull().default("readonly"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })]
);

// --- Invitaciones a organizaciones (Fase 4.1) ---
// El token solo se guarda hasheado (sha256): si se filtrara la base de datos
// nadie podría aceptar invitaciones ajenas. El token en claro va únicamente
// en el email. Una invitación es de un solo uso (accepted_at) y caduca.

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: orgRoleEnum("role").notNull().default("readonly"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Monitores ---

export const monitors = pgTable("monitors", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: monitorTypeEnum("type").notNull(),
  target: text("target").notNull(),
  method: text("method"),
  headers: jsonb("headers").$type<Record<string, string>>(),
  body: text("body"),
  expectedStatus: integer("expected_status"),
  intervalSeconds: integer("interval_seconds").notNull().default(60),
  timeoutMs: integer("timeout_ms").notNull().default(5000),
  isPaused: boolean("is_paused").notNull().default(false),
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // --- SSL (Fase 3.1) ---
  // Se rellenan solo para monitores HTTP contra target "https://"; el resto
  // se quedan en null sin más (no es un error, simplemente no aplica).
  sslExpiresAt: timestamp("ssl_expires_at", { withTimezone: true }),
  // Último umbral (30/15/7 días) ya notificado para el certificado ACTUAL.
  // Se resetea a null en cuanto se detecta una fecha de caducidad distinta
  // (el certificado se renovó) — así una alerta nunca se reenvía para el
  // mismo certificado, pero sí vuelve a dispararse para uno nuevo.
  sslLastAlertedThresholdDays: integer("ssl_last_alerted_threshold_days"),
  // --- Multi-región (Fase 4.2) ---
  // Lo mantiene el worker tras cada check aplicando el quórum entre
  // regiones; null hasta el primer check. Antes el estado se derivaba del
  // último check sin más, lo que con varias regiones ya no tiene sentido
  // (el "último" sería el de la región que casualmente acabó antes).
  consolidatedStatus: monitorHealthEnum("consolidated_status"),
});

// --- Checks (hypertable de TimescaleDB, ver migración 0002) ---
// Nota: la PK de una hypertable debe incluir la columna de tiempo de partición
// (`timestamp`), por eso aquí es (id, timestamp) en vez de solo (id).

export const checks = pgTable(
  "checks",
  {
    id: bigint("id", { mode: "bigint" })
      .notNull()
      .generatedByDefaultAsIdentity(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    status: checkStatusEnum("status").notNull(),
    responseTimeMs: integer("response_time_ms"),
    httpStatus: integer("http_status"),
    errorMessage: text("error_message"),
    // Región del worker que ejecutó el check (Fase 4.2). "local" es la
    // única región cuando no se configura CHECK_REGIONS.
    region: text("region").notNull().default("local"),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.timestamp] }),
    // "Último check de cada región de este monitor" y "últimos N checks de
    // esta región" son las dos consultas del quórum, en cada check.
    index("checks_monitor_region_timestamp_idx").on(table.monitorId, table.region, table.timestamp.desc()),
  ]
);

// --- Incidentes ---

export const incidents = pgTable("incidents", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitorId: uuid("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  causeSummary: text("cause_summary"),
});

// --- Canales de notificación ---

export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Añadido en la Fase 3.2 (no estaba en el diseño original de la Fase 0.3):
  // con varios canales del mismo tipo (dos webhooks de Discord distintos,
  // por ejemplo) hace falta una etiqueta para distinguirlos en la UI.
  name: text("name").notNull(),
  type: channelTypeEnum("type").notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const monitorNotificationChannels = pgTable(
  "monitor_notification_channels",
  {
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.channelId] })]
);

// --- Ventanas de mantenimiento ---

export const maintenanceWindows = pgTable("maintenance_windows", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitorId: uuid("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  note: text("note"),
});

// --- Status pages públicas ---

export const statusPages = pgTable(
  "status_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Único POR ORGANIZACIÓN, no global: la URL pública lleva delante el
    // username del dueño (/status/<username>/<slug>), así que "status" puede
    // existir a la vez para gdev y para gsan sin conflicto.
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    isPublic: boolean("is_public").notNull().default(true),
  },
  (table) => [unique("status_pages_organization_id_slug_unique").on(table.organizationId, table.slug)]
);

export const statusPageMonitors = pgTable(
  "status_page_monitors",
  {
    statusPageId: uuid("status_page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
  },
  (table) => [primaryKey({ columns: [table.statusPageId, table.monitorId] })]
);

// --- API keys ---

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Nombre que le da el usuario ("CI de producción") y prefijo visible de la
  // clave (Fase 5.1): la clave completa solo se muestra una vez al crearla,
  // en la base de datos queda su sha256.
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").notNull().$type<ApiKeyScope[]>().default([]),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "read" = ver monitores/checks/incidentes (equivale al rol readonly);
// "write" = además crear/editar/borrar (equivale al rol editor). Una API key
// nunca puede administrar la organización (miembros, plan, otras claves).
export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
