import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { tickets } from "@/db/schema";
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
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

const ITEMS_PER_PAGE = 20;

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const offset = (page - 1) * ITEMS_PER_PAGE;

    // Get total count
    const totalCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(tickets);
    const total = totalCount[0].count;
    const hasMore = offset + ITEMS_PER_PAGE < total;

    // Get paginated tickets
    const result = await db
      .select()
      .from(tickets)
      .orderBy(desc(tickets.createdAt))
      .limit(ITEMS_PER_PAGE)
      .offset(offset);

    return NextResponse.json(
      {
        tickets: result,
        hasMore,
        total,
      },
      { headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error fetching tickets:", error);
    return handleError(error, undefined, origin);
  }
}
