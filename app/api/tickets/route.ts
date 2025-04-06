import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { tickets, messages, allowedOrigins, shops } from "@/db/schema";
import { handleError } from "../utils/error-handler";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Manually allowed origins (temporary solution)
const MANUALLY_ALLOWED_ORIGINS = [
  "https://shameless-test.myshopify.com",
  "https://shameless-test.myshopify.com/",
];

// Function to ensure a shop exists in the database
const ensureShopExists = async (
  shopId: string,
  domain: string
): Promise<string | null> => {
  try {
    // Check if the shop already exists
    const existingShop = await db.query.shops.findFirst({
      where: eq(shops.id, shopId),
    });

    if (existingShop) {
      return shopId;
    }

    // If the shop doesn't exist, create it
    const now = new Date().toISOString();
    await db.insert(shops).values({
      id: shopId,
      name: shopId, // Use the ID as the name for now
      domain: domain,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Created new shop: ${shopId}`);
    return shopId;
  } catch (error) {
    console.error(`Error ensuring shop exists: ${error}`);
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
      const validShopId = await ensureShopExists(domain, domain);

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
    const { message, shopId: providedShopId } = await request.json();

    if (!message || typeof message !== "object") {
      return NextResponse.json(
        { error: "Invalid message data" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Get shop ID from origin if not provided in the request
    let shopId = providedShopId;
    if (!shopId && origin) {
      shopId = await getShopIdFromOrigin(origin);
    }

    // Create ticket with or without shop ID
    const now = new Date().toISOString();
    const ticketId = crypto.randomUUID();
    const ticketData = {
      id: ticketId,
      status: "open",
      createdAt: now,
      updatedAt: now,
      ...(shopId ? { shopId } : {}),
    };

    const [ticket] = await db.insert(tickets).values(ticketData).returning();

    // Add the first message
    await db.insert(messages).values({
      sender: "user",
      text: message.text,
      timestamp: message.timestamp || now,
      ticketId: ticket.id,
      ...(shopId ? { shopId } : {}),
    });

    return NextResponse.json(
      { ticketId: ticket.id },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error creating ticket:", error);
    return handleError(error, undefined, origin);
  }
}

export async function GET(request: NextRequest) {
  try {
    const ticketId = request.nextUrl.searchParams.get("ticketId");

    if (!ticketId) {
      return NextResponse.json(
        { error: "Missing ticketId parameter" },
        { status: 400 }
      );
    }

    const ticket = await db.query.tickets.findFirst({
      where: (tickets, { eq }) => eq(tickets.id, ticketId),
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ data: ticket });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    return NextResponse.json(
      { error: "Failed to fetch ticket" },
      { status: 500 }
    );
  }
}
