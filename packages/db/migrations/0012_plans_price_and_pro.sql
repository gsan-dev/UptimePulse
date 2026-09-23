ALTER TABLE "plans" ADD COLUMN "price_cents_monthly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Segundo plan (Fase 4.3) para que los límites tengan sentido: "free" se queda
-- como en la Fase 0.3 (5 monitores, 5 min, solo email); "pro" abre todos los
-- canales, permite 50 monitores y baja el intervalo mínimo a 1 minuto.
-- Precios de portfolio, no de negocio.
INSERT INTO plans (name, max_monitors, min_interval_seconds, allowed_channels, price_cents_monthly)
VALUES ('pro', 50, 60, '["email","discord","slack","webhook","sms"]'::jsonb, 900)
ON CONFLICT (name) DO NOTHING;
