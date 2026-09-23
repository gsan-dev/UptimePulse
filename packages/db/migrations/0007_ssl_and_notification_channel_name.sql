ALTER TABLE "monitors" ADD COLUMN "ssl_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "ssl_last_alerted_threshold_days" integer;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;