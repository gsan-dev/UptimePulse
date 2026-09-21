-- Generado con drizzle-kit y editado a mano: la columna "username" no puede
-- nacer NOT NULL en una tabla que ya tiene usuarios, así que primero se añade
-- nullable, se rellena para los usuarios existentes a partir de su email
-- (gdev@outlook.es -> "gdev") y solo entonces se hace obligatoria.
ALTER TABLE "status_pages" DROP CONSTRAINT "status_pages_slug_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text;--> statement-breakpoint
-- Backfill: parte local del email, en minúsculas, dejando solo [a-z0-9-].
-- Si queda demasiado corto (< 3) o vacío, se completa con "user-"; si choca
-- con otro ya asignado, se añade un sufijo numérico creciente.
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN SELECT id, email FROM users WHERE username IS NULL ORDER BY created_at LOOP
    base := lower(regexp_replace(split_part(r.email, '@', 1), '[^a-zA-Z0-9-]', '', 'g'));
    base := trim(both '-' from base);
    IF length(base) < 3 THEN
      base := 'user-' || base;
    END IF;
    base := left(base, 30);
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM users WHERE username = candidate) LOOP
      n := n + 1;
      candidate := left(base, 30 - length(n::text) - 1) || '-' || n;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_organization_id_slug_unique" UNIQUE("organization_id","slug");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
