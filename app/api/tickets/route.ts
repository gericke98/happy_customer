import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { tickets, messages, allowedOrigins, shops } from "@/db/schema";
import { z } from "zod";
import { handleError } from "../utils/error-handler";
import { eq, and } from "drizzle-orm";

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
): Promise<string> => {
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
    return shopId; // Return the ID even if there was an error
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
      const domain = url.hostname;
      const shopId = domain.split(".")[0]; // Extract shop ID from domain (e.g., "shameless-test" from "shameless-test.myshopify.com")

      // Ensure the shop exists in the database
      return await ensureShopExists(shopId, domain);
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

// Validation schema
const messageSchema = z.object({
  sender: z.enum(["user", "bot", "admin"], {
    message: "Sender must be 'user', 'bot', or 'admin'",
  }),
  text: z.string().min(1, "Message content cannot be empty"),
  timestamp: z.string(),
  status: z.string().optional(),
  admin: z.boolean().optional(),
  shopId: z.string().min(1, "Shop ID is required").optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const body = await request.json();
    const validatedMessage = messageSchema.parse(body);

    // Generate ticket ID
    const ticketId = crypto.randomUUID();

    // Get shop ID from origin if not provided in the request
    let shopId = validatedMessage.shopId;
    if (!shopId && origin) {
      const originShopId = await getShopIdFromOrigin(origin);
      if (originShopId) {
        shopId = originShopId;
      }
    }

    // Create ticket
    const newTicket = await db
      .insert(tickets)
      .values({
        id: ticketId,
        orderNumber: null,
        email: null,
        status: validatedMessage.status || "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        admin: validatedMessage.admin || false,
        // Only include shopId if it's not null
        ...(shopId ? { shopId } : {}),
      })
      .returning();

    // Add the first message
    await db.insert(messages).values({
      sender: validatedMessage.sender,
      text: validatedMessage.text,
      timestamp: validatedMessage.timestamp,
      ticketId: ticketId,
    });

    const headers = await corsHeaders(origin);
    return NextResponse.json(
      {
        status: 200,
        data: newTicket[0],
      },
      { headers }
    );
  } catch (error) {
    console.error("Error creating ticket:", error);
    if (error instanceof z.ZodError) {
      const headers = await corsHeaders(origin);
      return NextResponse.json(
        {
          status: 400,
          error: `Invalid message data: ${error.errors[0].message}`,
        },
        { status: 400, headers }
      );
    }
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
