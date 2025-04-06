"use server";

import db from "@/db/drizzle";
import { messages, tickets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Message, Ticket, CustomerData } from "@/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cache } from "react";

// Custom error types
class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

// Rate limiting implementation
const rateLimits = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 20; // 20 requests per minute

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const userRateLimit = rateLimits.get(identifier);

  if (!userRateLimit || now - userRateLimit.timestamp > RATE_LIMIT_WINDOW) {
    rateLimits.set(identifier, { count: 1, timestamp: now });
    return true;
  }

  if (userRateLimit.count >= MAX_REQUESTS) {
    return false;
  }

  userRateLimit.count += 1;
  return true;
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return (
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
};

// Validation schemas
const ticketIdSchema = z.string().uuid({
  message: "Invalid ticket ID format. Must be a valid UUID.",
});

const messageSchema = z.object({
  sender: z.enum(["user", "bot", "admin"], {
    message: "Sender must be 'user', 'bot', or 'admin'",
  }),
  text: z.string().min(1, "Message content cannot be empty"),
  timestamp: z.string().optional(),
});

const customerDataSchema = z
  .object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  })
  .optional();

// GET ACTIONS
export async function getTickets(): Promise<Ticket[]> {
  console.log("[ACTION] Getting all tickets");
  try {
    const tickets = await db.query.tickets.findMany();
    return tickets;
  } catch (error) {
    console.error("[ERROR] Failed to get tickets:", error);
    throw new DatabaseError("Failed to retrieve tickets", error);
  }
}

export const getTicket = cache(
  async (id: string): Promise<Ticket | undefined> => {
    try {
      const response = await fetch(`${process.env.API_URL}/tickets/${id}`, {
        next: { tags: [`ticket-${id}`] },
      });
      return response.json();
    } catch (error) {
      console.error("Error fetching ticket:", error);
      return undefined;
    }
  }
);

export const getMessages = cache(async (id: string): Promise<Message[]> => {
  try {
    const response = await fetch(
      `${process.env.API_URL}/tickets/${id}/messages`,
      {
        next: { tags: [`messages-${id}`] },
      }
    );
    return response.json();
  } catch (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
});

// POST ACTIONS
export async function createTicket(userMessage: Message) {
  console.log("[ACTION] Creating new ticket");

  try {
    // Validate input
    const validatedMessage = messageSchema.parse(userMessage);

    // Check rate limit using IP or some other identifier
    const identifier = "create-ticket"; // In production, use IP or user identifier
    if (!checkRateLimit(identifier)) {
      console.warn(`[RATE LIMIT] Create ticket request rate limited`);
      return {
        status: 429,
        error: "Too many requests. Please try again later.",
      };
    }

    // Create ticket without using transaction
    const ticketId = crypto.randomUUID();
    console.log(`[DEBUG] Generated ticket ID: ${ticketId}`);
    console.log(
      `[DEBUG] Values to insert: ${{
        id: ticketId,
        orderNumber: null,
        email: null,
        status: "open",
        createdAt: formatDate(new Date().toISOString()),
        updatedAt: formatDate(new Date().toISOString()),
        admin: false,
      }}`
    );

    try {
      const newTicket = await db
        .insert(tickets)
        .values({
          id: ticketId,
          orderNumber: null,
          email: null,
          status: "open",
          createdAt: formatDate(new Date().toISOString()),
          updatedAt: formatDate(new Date().toISOString()),
          admin: false,
        })
        .returning();

      console.log(
        `[DEBUG] Ticket inserted successfully: ${JSON.stringify(newTicket)}`
      );

      // Add the first message
      try {
        await db.insert(messages).values({
          sender: validatedMessage.sender,
          text: validatedMessage.text,
          timestamp: formatDate(new Date().toISOString()),
          ticketId: ticketId,
        });

        console.log(
          `[DEBUG] Message inserted successfully for ticket: ${ticketId}`
        );
      } catch (messageError) {
        console.error(`[ERROR] Failed to insert message: ${messageError}`);
        return {
          status: 500,
          error: `Failed to insert message: ${messageError instanceof Error ? messageError.message : String(messageError)}`,
        };
      }

      console.log(`[SUCCESS] Created ticket with ID: ${ticketId}`);
      return {
        status: 200,
        data: newTicket[0],
      };
    } catch (ticketError) {
      console.error(`[ERROR] Failed to insert ticket: ${ticketError}`);
      return {
        status: 500,
        error: `Failed to insert ticket: ${ticketError instanceof Error ? ticketError.message : String(ticketError)}`,
      };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[VALIDATION ERROR] Invalid message data:", error.errors);
      return {
        status: 400,
        error: `Invalid message data: ${error.errors[0].message}`,
      };
    }
    console.error("[ERROR] Failed to create ticket:", error);
    return {
      status: 500,
      error: `Failed to create ticket: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function updateTicketWithOrderInfo(
  ticketId: string,
  orderNumber: string,
  email: string,
  customer: CustomerData | undefined
) {
  console.log(`[ACTION] Updating ticket ${ticketId} with order info`);

  try {
    // Validate inputs
    const validatedId = ticketIdSchema.parse(ticketId);
    const validatedOrderNumber = z.string().min(1).parse(orderNumber);
    const validatedEmail = z.string().email().parse(email);
    const validatedCustomer = customerDataSchema.parse(customer);

    // Check if ticket exists
    const existingTicket = await db.query.tickets.findFirst({
      where: eq(tickets.id, validatedId),
    });

    if (!existingTicket) {
      return { status: 404, error: "Ticket not found" };
    }

    const updatedTicket = await db
      .update(tickets)
      .set({
        orderNumber: validatedOrderNumber,
        email: validatedEmail,
        name: validatedCustomer
          ? `${validatedCustomer.first_name || ""} ${validatedCustomer.last_name || ""}`.trim()
          : null,
        updatedAt: formatDate(new Date().toISOString()),
      })
      .where(eq(tickets.id, validatedId))
      .returning();

    revalidatePath(`/`);
    console.log(`[SUCCESS] Updated ticket ${validatedId} with order info`);

    return {
      status: 200,
      data: updatedTicket[0],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        `[VALIDATION ERROR] Invalid data for ticket ${ticketId}:`,
        error.errors
      );
      return {
        status: 400,
        error: `Validation error: ${error.errors[0].message}`,
      };
    }
    console.error(
      `[ERROR] Failed to update ticket ${ticketId} with order info:`,
      error
    );
    return {
      status: 500,
      error: "Failed to update ticket with order information",
    };
  }
}

export async function updateTicketAdmin(ticketId: string, admin: boolean) {
  console.log(
    `[ACTION] Updating admin status for ticket ${ticketId} to ${admin}`
  );

  try {
    // Validate inputs
    const validatedId = ticketIdSchema.parse(ticketId);
    const validatedAdmin = z.boolean().parse(admin);

    // Check if ticket exists
    const existingTicket = await db.query.tickets.findFirst({
      where: eq(tickets.id, validatedId),
    });

    if (!existingTicket) {
      return { status: 404, error: "Ticket not found" };
    }

    const updatedTicket = await db
      .update(tickets)
      .set({
        admin: validatedAdmin,
        updatedAt: formatDate(new Date().toISOString()),
      })
      .where(eq(tickets.id, validatedId))
      .returning();

    revalidatePath("/");
    console.log(
      `[SUCCESS] Updated admin status for ticket ${validatedId} to ${validatedAdmin}`
    );

    return {
      status: 200,
      data: updatedTicket[0],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        `[VALIDATION ERROR] Invalid data for ticket ${ticketId}:`,
        error.errors
      );
      return {
        status: 400,
        error: `Validation error: ${error.errors[0].message}`,
      };
    }
    console.error(
      `[ERROR] Failed to update admin status for ticket ${ticketId}:`,
      error
    );
    return { status: 500, error: "Failed to update ticket admin status" };
  }
}

export async function addMessageToTicket(ticketId: string, message: Message) {
  try {
    // Use localhost:3000 in development and production URL in production
    const baseUrl =
      process.env.NODE_ENV === "development"
        ? process.env.DEVELOPMENT_URL
        : process.env.PRODUCTION_URL;

    const response = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticketId, message }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error adding message:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`HTTP error! status: ${response.status}\n${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error adding message:", error);
    throw error;
  }
}
