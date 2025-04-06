import { relations } from "drizzle-orm";
import { text, pgTable, serial, boolean } from "drizzle-orm/pg-core";

// Table for storing Shopify shops
export const shops = pgTable("shops", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  accessToken: text("access_token"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Creo una tabla que contenga las orders que han sido editadas
export const tickets = pgTable("tickets", {
  id: text("id").primaryKey().notNull(),
  orderNumber: text("order_number"),
  email: text("email"),
  name: text("name"),
  shopId: text("shop_id").references(() => shops.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  status: text("status").notNull(),
  admin: boolean("admin").notNull().default(false),
});

export const ticketsRelations = relations(tickets, ({ many, one }) => ({
  messages: many(messages),
  shop: one(shops, {
    fields: [tickets.shopId],
    references: [shops.id],
  }),
}));

export const messages = pgTable("messages", {
  id: serial("id").primaryKey().notNull(),
  sender: text("sender").notNull(),
  text: text("text").notNull(),
  timestamp: text("timestamp").notNull(),
  ticketId: text("ticket_id").references(() => tickets.id, {
    onDelete: "cascade",
  }),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  ticket: one(tickets, {
    fields: [messages.ticketId],
    references: [tickets.id],
  }),
}));

// Table for storing allowed origins
export const allowedOrigins = pgTable("allowed_origins", {
  id: serial("id").primaryKey().notNull(),
  origin: text("origin").notNull().unique(),
  shopId: text("shop_id").references(() => shops.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const allowedOriginsRelations = relations(allowedOrigins, ({ one }) => ({
  shop: one(shops, {
    fields: [allowedOrigins.shopId],
    references: [shops.id],
  }),
}));

export const shopsRelations = relations(shops, ({ many }) => ({
  tickets: many(tickets),
  allowedOrigins: many(allowedOrigins),
}));

// CODE TO UPDATE TABLA SCHEMA  npx drizzle-kit push:pg
