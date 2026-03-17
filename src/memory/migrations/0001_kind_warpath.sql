CREATE TABLE "web_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "web_credentials_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "master_user_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_web_credentials_username" ON "web_credentials" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_users_master" ON "users" USING btree ("master_user_id");