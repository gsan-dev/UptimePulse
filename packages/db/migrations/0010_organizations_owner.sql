ALTER TABLE "organizations" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
-- Backfill: hasta la Fase 4.1 cada organización tenía exactamente un miembro
-- (el usuario que se registró), que es por definición su dueño.
UPDATE "organizations" o
SET "owner_user_id" = (
  SELECT om."user_id" FROM "organization_members" om
  WHERE om."organization_id" = o."id" AND om."role" = 'admin'
  ORDER BY om."user_id" LIMIT 1
)
WHERE o."owner_user_id" IS NULL;
