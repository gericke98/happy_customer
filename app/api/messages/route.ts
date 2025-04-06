import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { messages } from "@/db/schema";
import { z } from "zod";
import { handleError } from "../utils/error-handler";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://shamelesscollective.com",
  "https://shameless-test.myshopify.com",
];

const corsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin || "")
    ? origin || ALLOWED_ORIGINS[0]
    : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400", // 24 hours
});

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

// Validation schema
const messageSchema = z.object({
  sender: z.enum(["user", "bot", "admin"], {
    message: "Sender must be 'user', 'bot', or 'admin'",
  }),
  text: z.string().min(1, "Message content cannot be empty"),
  timestamp: z.string(),
  ticketId: z.string(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const { ticketId, message } = await request.json();

    if (!ticketId || !message) {
      return NextResponse.json(
        { error: "Missing ticketId or message" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Validate message data
    const validatedMessage = messageSchema.parse({
      ...message,
      ticketId,
    });

    // Add message to database
    await db.insert(messages).values({
      sender: validatedMessage.sender,
      text: validatedMessage.text,
      timestamp: validatedMessage.timestamp,
      ticketId: validatedMessage.ticketId,
    });

    return NextResponse.json(
      { success: true },
      { headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error adding message:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          status: 400,
          error: `Invalid message data: ${error.errors[0].message}`,
        },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
    return handleError(error, undefined, origin);
  }
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const ticketId = request.nextUrl.searchParams.get("ticketId");

  if (!ticketId) {
    return NextResponse.json(
      { error: "Missing ticketId parameter" },
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  try {
    const messages = await db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.ticketId, ticketId),
      orderBy: (messages, { asc }) => [asc(messages.timestamp)],
    });

    return NextResponse.json({ messages }, { headers: corsHeaders(origin) });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return handleError(error, undefined, origin);
  }
}
