CREATE TABLE "command_center_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "code" varchar(60),
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_center_departments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "code" varchar(60),
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_center_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "department_id" uuid,
  "display_name" varchar(120) NOT NULL,
  "employee_code" varchar(60),
  "role_title" varchar(120),
  "employment_status" varchar(30) DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_center_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "center_id" uuid NOT NULL,
  "department_id" uuid,
  "assignee_member_id" uuid,
  "title" varchar(200) NOT NULL,
  "description" text,
  "status" varchar(30) DEFAULT 'incoming' NOT NULL,
  "priority" varchar(20) DEFAULT 'medium' NOT NULL,
  "source" varchar(40) DEFAULT 'manual' NOT NULL,
  "requested_by" varchar(120),
  "due_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_center_task_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "event_type" varchar(40) NOT NULL,
  "actor_type" varchar(30) DEFAULT 'user' NOT NULL,
  "actor_id" varchar(120),
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "command_center_centers" ADD CONSTRAINT "command_center_centers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_departments" ADD CONSTRAINT "command_center_departments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_departments" ADD CONSTRAINT "command_center_departments_center_id_command_center_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."command_center_centers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_members" ADD CONSTRAINT "command_center_members_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_members" ADD CONSTRAINT "command_center_members_center_id_command_center_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."command_center_centers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_members" ADD CONSTRAINT "command_center_members_department_id_command_center_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."command_center_departments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_tasks" ADD CONSTRAINT "command_center_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_tasks" ADD CONSTRAINT "command_center_tasks_center_id_command_center_centers_id_fk" FOREIGN KEY ("center_id") REFERENCES "public"."command_center_centers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_tasks" ADD CONSTRAINT "command_center_tasks_department_id_command_center_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."command_center_departments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_tasks" ADD CONSTRAINT "command_center_tasks_assignee_member_id_command_center_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."command_center_members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_task_events" ADD CONSTRAINT "command_center_task_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "command_center_task_events" ADD CONSTRAINT "command_center_task_events_task_id_command_center_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."command_center_tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_command_center_centers_owner" ON "command_center_centers" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_centers_code" ON "command_center_centers" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "idx_command_center_departments_owner" ON "command_center_departments" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_departments_center" ON "command_center_departments" USING btree ("center_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_members_owner" ON "command_center_members" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_members_center" ON "command_center_members" USING btree ("center_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_members_department" ON "command_center_members" USING btree ("department_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_tasks_owner" ON "command_center_tasks" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_tasks_center" ON "command_center_tasks" USING btree ("center_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_tasks_department" ON "command_center_tasks" USING btree ("department_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_tasks_assignee" ON "command_center_tasks" USING btree ("assignee_member_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_tasks_status" ON "command_center_tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_command_center_task_events_owner" ON "command_center_task_events" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_task_events_task" ON "command_center_task_events" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "idx_command_center_task_events_type" ON "command_center_task_events" USING btree ("event_type");
