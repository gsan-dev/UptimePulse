CREATE TYPE "public"."monitor_health" AS ENUM('up', 'degraded', 'down');--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "region" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "consolidated_status" "monitor_health";--> statement-breakpoint
CREATE INDEX "checks_monitor_region_timestamp_idx" ON "checks" USING btree ("monitor_id","region","timestamp" DESC NULLS LAST);--> statement-breakpoint
-- Backfill: hasta ahora había una sola región, así que el estado consolidado
-- de cada monitor es simplemente su último check. Sin esto, todo monitor
-- existente aparecería como "sin datos" hasta su siguiente check.
UPDATE "monitors" m
SET "consolidated_status" = (
  SELECT c."status"::text::"monitor_health" FROM "checks" c
  WHERE c."monitor_id" = m."id" ORDER BY c."timestamp" DESC LIMIT 1
)
WHERE m."consolidated_status" IS NULL;
