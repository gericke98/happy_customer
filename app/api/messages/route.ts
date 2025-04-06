import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { messages, allowedOrigins, shops } from "@/db/schema";
import { handleError } from "../utils/error-handler";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Manually allowed origins (temporary solution)
const MANUALLY_ALLOWED_ORIGINS = [
  "https://shameless-test.myshopify.com",
  "https://shameless-test.myshopify.com/",
];

// Function to ensure a shop exists in the database
const ensureShopExists = async (shopId: string): Promise<string | null> => {
  try {
    // Check if the shop already exists
    const existingShop = await db.query.shops.findFirst({
      where: eq(shops.id, shopId),
    });

    if (existingShop) {
      return shopId;
    }

    // If the shop doesn't exist, return null instead of creating it
    console.log(`Shop not found: ${shopId}`);
    return null;
  } catch (error) {
    console.error(`Error checking if shop exists: ${error}`);
    return null;
  }
};

// Function to ensure an allowed origin exists in the database
const ensureAllowedOriginExists = async (
  origin: string,
  shopId: string
): Promise<void> => {
  try {
    // Check if the origin already exists
    const existingOrigin = await db.query.allowedOrigins.findFirst({
      where: eq(allowedOrigins.origin, origin),
    });

    if (existingOrigin) {
      // If it exists but is inactive, update it
      if (!existingOrigin.isActive) {
        const now = new Date().toISOString();
        await db
          .update(allowedOrigins)
          .set({
            isActive: true,
            updatedAt: now,
          })
          .where(eq(allowedOrigins.id, existingOrigin.id));
        console.log(`Reactivated allowed origin: ${origin}`);
      }
      return;
    }

    // If the origin doesn't exist, create it
    const now = new Date().toISOString();
    await db.insert(allowedOrigins).values({
      origin: origin,
      shopId: shopId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Created new allowed origin: ${origin} for shop: ${shopId}`);
  } catch (error) {
    console.error(`Error ensuring allowed origin exists: ${error}`);
  }
};

// Function to check if an origin is allowed
const isAllowedOrigin = async (origin: string): Promise<boolean> => {
  // First check if it's in our manually allowed origins
  if (MANUALLY_ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  try {
    const allowedOrigin = await db.query.allowedOrigins.findFirst({
      where: and(
        eq(allowedOrigins.origin, origin),
        eq(allowedOrigins.isActive, true)
      ),
      with: {
        shop: true,
      },
    });
    return (
      !!allowedOrigin && !!allowedOrigin.shop && allowedOrigin.shop.isActive
    );
  } catch (error) {
    console.error("Error checking allowed origin:", error);
    return false;
  }
};

// Function to get shop ID from origin
const getShopIdFromOrigin = async (origin: string): Promise<string | null> => {
  // For manually allowed origins, extract the shop ID from the domain
  if (MANUALLY_ALLOWED_ORIGINS.includes(origin)) {
    try {
      const url = new URL(origin);
      const domain = url.hostname; // This will be like "shameless-test.myshopify.com"

      // Check if the shop exists in the database
      const validShopId = await ensureShopExists(domain);

      // If the shop exists, ensure the origin is in the allowed_origins table
      if (validShopId) {
        await ensureAllowedOriginExists(origin, validShopId);
        return validShopId;
      }

      return null;
    } catch (error) {
      console.error("Error extracting shop ID from origin:", error);
      return null;
    }
  }

  try {
    const allowedOrigin = await db.query.allowedOrigins.findFirst({
      where: and(
        eq(allowedOrigins.origin, origin),
        eq(allowedOrigins.isActive, true)
      ),
      with: {
        shop: true,
      },
    });
    return allowedOrigin?.shop?.id || null;
  } catch (error) {
    console.error("Error getting shop ID from origin:", error);
    return null;
  }
};

const corsHeaders = async (
  origin: string | null
): Promise<Record<string, string>> => {
  // If the origin is in our allowed_origins table and active, allow it
  if (origin && (await isAllowedOrigin(origin))) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      "Access-Control-Max-Age": "86400", // 24 hours
    };
  }

  // Default to the first allowed origin if the request origin is not valid
  return {
    "Access-Control-Allow-Origin": "https://shamelesscollective.com",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Max-Age": "86400", // 24 hours
  };
};

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = await corsHeaders(origin);
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const body = await request.json();
    console.log("Received request body:", JSON.stringify(body));

    // Validate request body
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Handle different request formats
    let ticketId, message, shopId;

    // Format 1: { ticketId: "...", message: { sender: "...", text: "...", ... } }
    if (body.ticketId && body.message && typeof body.message === "object") {
      ticketId = body.ticketId;
      message = body.message;
      shopId = message.shopId;
    }
    // Format 2: { ticketId: "...", sender: "...", text: "...", ... }
    else if (body.ticketId && body.text && body.sender) {
      ticketId = body.ticketId;
      message = {
        sender: body.sender,
        text: body.text,
        timestamp: body.timestamp,
        ticketId: body.ticketId,
        shopId: body.shopId,
      };
      shopId = body.shopId;
    }
    // Invalid format
    else {
      return NextResponse.json(
        {
          error:
            "Invalid request format. Expected { ticketId: '...', message: { sender: '...', text: '...', ... } } or { ticketId: '...', sender: '...', text: '...', ... }",
          received: JSON.stringify(body),
        },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    if (!ticketId || typeof ticketId !== "string") {
      return NextResponse.json(
        { error: "Ticket ID is required and must be a string" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    if (!message.text || typeof message.text !== "string") {
      return NextResponse.json(
        { error: "Message text is required and must be a string" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    if (!message.sender || typeof message.sender !== "string") {
      return NextResponse.json(
        { error: "Message sender is required and must be a string" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Get shop ID from origin if not provided in the request
    if (!shopId && origin) {
      shopId = await getShopIdFromOrigin(origin);
      console.log(`Shop ID from origin: ${shopId}`);
    }

    // Add message to database
    const messageData = {
      sender: message.sender,
      text: message.text,
      timestamp: message.timestamp || new Date().toISOString(),
      ticketId: ticketId,
      ...(shopId ? { shopId } : {}),
    };

    console.log(`Adding message with data: ${JSON.stringify(messageData)}`);
    await db.insert(messages).values(messageData);

    return NextResponse.json(
      { success: true },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error adding message:", error);
    return handleError(error, undefined, origin);
  }
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const ticketId = request.nextUrl.searchParams.get("ticketId");

  if (!ticketId) {
    return NextResponse.json(
      { error: "Missing ticketId parameter" },
      { status: 400, headers: await corsHeaders(origin) }
    );
  }

  try {
    const messages = await db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.ticketId, ticketId),
      orderBy: (messages, { asc }) => [asc(messages.timestamp)],
    });

    return NextResponse.json(
      { messages },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error fetching messages:", error);
    return handleError(error, undefined, origin);
  }
}
