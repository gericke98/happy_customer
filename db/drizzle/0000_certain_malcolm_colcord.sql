CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"timestamp" text NOT NULL,
	"ticket_id" text
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text,
	"email" text,
	"name" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"status" text NOT NULL,
	"admin" boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;