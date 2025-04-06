import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import db from "@/db/drizzle";
import { messages, allowedOrigins, shops } from "@/db/schema";
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
      const domain = url.hostname;
      const shopId = domain.split(".")[0]; // Extract shop ID from domain (e.g., "shameless-test" from "shameless-test.myshopify.com")

      // Ensure the shop exists in the database
      const validShopId = await ensureShopExists(shopId, domain);

      // Also ensure the origin is in the allowed_origins table
      await ensureAllowedOriginExists(origin, validShopId);

      return validShopId;
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
  ticketId: z.string(),
  shopId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const { ticketId, message } = await request.json();

    if (!ticketId || !message) {
      return NextResponse.json(
        { error: "Missing ticketId or message" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Validate message data
    const validatedMessage = messageSchema.parse({
      ...message,
      ticketId,
    });

    // Get shop ID from origin if not provided in the request
    let shopId = validatedMessage.shopId;
    if (!shopId && origin) {
      const originShopId = await getShopIdFromOrigin(origin);
      if (originShopId) {
        shopId = originShopId;
      }
    }

    // Add message to database
    await db.insert(messages).values({
      sender: validatedMessage.sender,
      text: validatedMessage.text,
      timestamp: validatedMessage.timestamp,
      ticketId: validatedMessage.ticketId,
      ...(shopId ? { shopId } : {}),
    });

    return NextResponse.json(
      { success: true },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error adding message:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          status: 400,
          error: `Invalid message data: ${error.errors[0].message}`,
        },
        { status: 400, headers: await corsHeaders(origin) }
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
