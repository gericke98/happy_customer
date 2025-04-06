"use server";
import "@shopify/shopify-api/adapters/node";
import { cache } from "react";
import db from "./drizzle";
import { eq } from "drizzle-orm";
import { tickets } from "./schema";
export const getOrderById = cache(async (id: string) => {
  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, id),
  });
  return ticket;
});
