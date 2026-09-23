-- URL pública propia para CUALQUIER organización, no solo la personal del
-- usuario. Hasta ahora una status page solo era alcanzable en
-- /status/<username>/<slug>, que resuelve a la organización personal de ese
-- usuario (ver getPrimaryOrganizationId): una organización de equipo no
-- tenía forma de publicar nada. Con este slug, sus páginas viven en
-- /status/team/<org-slug>/<page-slug> — una segunda ruta, no un cambio de la
-- existente, para no romper los enlaces ya compartidos.
ALTER TABLE "organizations" ADD COLUMN "slug" text;--> statement-breakpoint
-- Backfill: a la organización más antigua de cada dueño se le da el username
-- de ese dueño. Es único por definición (users.username lo es) y ya cumple
-- las reglas de un slug (minúsculas, números y guiones), así que las
-- organizaciones existentes salen de aquí con una URL de equipo utilizable.
-- El resto se quedan en NULL (sin URL pública) hasta que un admin les ponga
-- una: NULL no colisiona en un UNIQUE de Postgres.
UPDATE "organizations" o
SET "slug" = sub."username"
FROM (
  SELECT DISTINCT ON (o2."owner_user_id") o2."id", u."username"
  FROM "organizations" o2
  JOIN "users" u ON u."id" = o2."owner_user_id"
  WHERE o2."slug" IS NULL
  ORDER BY o2."owner_user_id", o2."created_at"
) sub
WHERE o."id" = sub."id";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_unique" UNIQUE("slug");
