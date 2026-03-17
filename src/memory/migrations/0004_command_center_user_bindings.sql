CREATE TABLE "command_center_user_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "web_credential_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "title" varchar(120),
  "is_primary" boolean DEFAULT true NOT NULL,
  "status" varchar(30) DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_center_user_bindings" ADD CONSTRAINT "command_center_user_bindings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_user_bindings" ADD CONSTRAINT "command_center_user_bindings_web_credential_id_web_credentials_id_fk" FOREIGN KEY ("web_credential_id") REFERENCES "public"."web_credentials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_user_bindings" ADD CONSTRAINT "command_center_user_bindings_member_id_command_center_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."command_center_members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_command_center_user_bindings_owner" ON "command_center_user_bindings" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_command_center_user_bindings_web_credential" ON "command_center_user_bindings" USING btree ("web_credential_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_command_center_user_bindings_member" ON "command_center_user_bindings" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_user_bindings_status" ON "command_center_user_bindings" USING btree ("status");
