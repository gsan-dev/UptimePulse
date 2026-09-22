-- Se eliminan los planes de suscripción y sus límites (decisión del
-- 2026-09-22): no hay planes de pago, ni máximo de monitores, ni intervalo
-- mínimo por plan, ni tipos de canal restringidos. "DROP TABLE ... CASCADE"
-- se lleva por delante la FK desde organizations; la columna se borra
-- explícitamente después.
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_plan_id_plans_id_fk";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "plan_id";--> statement-breakpoint
DROP TABLE IF EXISTS "plans" CASCADE;
