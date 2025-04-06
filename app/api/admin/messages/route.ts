import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { handleError } from "../../utils/error-handler";

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

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");

    if (!ticketId) {
      return NextResponse.json(
        { error: "Ticket ID is required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.ticketId, ticketId));

    return NextResponse.json(result, { headers: corsHeaders(origin) });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return handleError(error, undefined, origin);
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const body = await request.json();
    const { sender, text, ticketId } = body;

    if (!sender || !text || !ticketId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const newMessage = {
      sender,
      text,
      timestamp: new Date().toISOString(),
      ticketId,
    };

    const result = await db.insert(messages).values(newMessage).returning();
    return NextResponse.json(result[0], { headers: corsHeaders(origin) });
  } catch (error) {
    console.error("Error creating message:", error);
    return handleError(error, undefined, origin);
  }
}
