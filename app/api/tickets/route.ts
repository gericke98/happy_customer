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

// Function to ensure an allowed origin exists in the database
const ensureAllowedOriginExists = async (
  origin: string,
  shopId: string
): Promise<void> => {
  console.log(
    `ensureAllowedOriginExists called with origin: ${origin}, shopId: ${shopId}`
  );

  try {
    // Check if the origin already exists
    console.log("Checking if origin exists in database:", origin);
    const existingOrigin = await db.query.allowedOrigins.findFirst({
      where: eq(allowedOrigins.origin, origin),
    });

    if (existingOrigin) {
      console.log(
        "Origin found in database:",
        JSON.stringify(existingOrigin, null, 2)
      );
      // If it exists but is inactive, update it
      if (!existingOrigin.isActive) {
        console.log("Origin is inactive, reactivating it");
        const now = new Date().toISOString();
        await db
          .update(allowedOrigins)
          .set({
            isActive: true,
            updatedAt: now,
          })
          .where(eq(allowedOrigins.id, existingOrigin.id));
        console.log(`Reactivated allowed origin: ${origin}`);
      } else {
        console.log("Origin is already active");
      }
      return;
    }

    // If the origin doesn't exist, create it
    console.log("Origin not found in database, creating it");
    const now = new Date().toISOString();
    const newOrigin = {
      origin: origin,
      shopId: shopId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    console.log(
      "Creating new allowed origin with data:",
      JSON.stringify(newOrigin, null, 2)
    );

    await db.insert(allowedOrigins).values(newOrigin);
    console.log(`Created new allowed origin: ${origin} for shop: ${shopId}`);
  } catch (error) {
    console.error(`Error ensuring allowed origin exists: ${error}`);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
  }
};

// Function to check if an origin is allowed
const isAllowedOrigin = async (origin: string): Promise<boolean> => {
  console.log("isAllowedOrigin called with origin:", origin);

  // First check if it's in our manually allowed origins
  if (MANUALLY_ALLOWED_ORIGINS.includes(origin)) {
    console.log("Origin is in MANUALLY_ALLOWED_ORIGINS, allowing it");
    return true;
  }

  console.log("Origin is not in MANUALLY_ALLOWED_ORIGINS, checking database");
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

    if (allowedOrigin) {
      console.log(
        "Found allowed origin in database:",
        JSON.stringify(allowedOrigin, null, 2)
      );
      if (allowedOrigin.shop) {
        console.log(
          "Associated shop found:",
          JSON.stringify(allowedOrigin.shop, null, 2)
        );
        if (allowedOrigin.shop.isActive) {
          console.log("Shop is active, allowing origin");
          return true;
        } else {
          console.log("Shop is inactive, not allowing origin");
          return false;
        }
      } else {
        console.log(
          "No associated shop found for allowed origin, not allowing origin"
        );
        return false;
      }
    } else {
      console.log("No allowed origin found in database for:", origin);
      return false;
    }
  } catch (error) {
    console.error("Error checking allowed origin:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return false;
  }
};

// Function to get shop ID from origin
const getShopIdFromOrigin = async (origin: string): Promise<string | null> => {
  console.log("getShopIdFromOrigin called with origin:", origin);

  // For manually allowed origins, extract the shop ID from the domain
  if (MANUALLY_ALLOWED_ORIGINS.includes(origin)) {
    console.log("Origin is in MANUALLY_ALLOWED_ORIGINS");
    try {
      const url = new URL(origin);
      const domain = url.hostname; // This will be like "shameless-test.myshopify.com"
      console.log("Extracted domain from origin:", domain);

      // Extract the shop ID from the domain (e.g., "shameless-test" from "shameless-test.myshopify.com")
      const shopId = domain.split(".")[0];
      console.log("Extracted shopId from domain:", shopId);

      // Check if the shop exists in the database
      console.log("Checking if shop exists in database:", shopId);
      const existingShop = await db.query.shops.findFirst({
        where: eq(shops.id, shopId),
      });

      // If the shop exists, ensure the origin is in the allowed_origins table
      if (existingShop) {
        console.log(
          "Shop found in database:",
          JSON.stringify(existingShop, null, 2)
        );
        await ensureAllowedOriginExists(origin, shopId);
        return shopId;
      }

      // If the shop doesn't exist, return null instead of trying to create it
      console.log(`Shop not found in database: ${shopId}`);
      return null;
    } catch (error) {
      console.error("Error extracting shop ID from origin:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
      return null;
    }
  }

  console.log("Origin is not in MANUALLY_ALLOWED_ORIGINS, checking database");
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

    if (allowedOrigin) {
      console.log(
        "Found allowed origin in database:",
        JSON.stringify(allowedOrigin, null, 2)
      );
      if (allowedOrigin.shop) {
        console.log(
          "Associated shop found:",
          JSON.stringify(allowedOrigin.shop, null, 2)
        );
        return allowedOrigin.shop.id;
      } else {
        console.log("No associated shop found for allowed origin");
      }
    } else {
      console.log("No allowed origin found in database for:", origin);
    }

    return null;
  } catch (error) {
    console.error("Error getting shop ID from origin:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return null;
  }
};

const corsHeaders = async (
  origin: string | null
): Promise<Record<string, string>> => {
  console.log("corsHeaders called with origin:", origin);

  // If the origin is in our allowed_origins table and active, allow it
  if (origin) {
    const isAllowed = await isAllowedOrigin(origin);
    console.log(`Origin ${origin} is ${isAllowed ? "allowed" : "not allowed"}`);

    if (isAllowed) {
      console.log("Returning CORS headers with origin:", origin);
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
        "Access-Control-Max-Age": "86400", // 24 hours
      };
    }
  }

  // Default to the first allowed origin if the request origin is not valid
  console.log(
    "Using default CORS headers with origin: https://shamelesscollective.com"
  );
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
  console.log("POST request received from origin:", origin);

  try {
    const body = await request.json();
    console.log("Received request body:", JSON.stringify(body, null, 2));

    // Validate request body
    if (!body || typeof body !== "object") {
      console.error("Invalid request body:", body);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Handle different request formats
    let message, shopId;
    console.log("Processing request format...");

    // Format 1: { message: { text: "..." }, shopId: "..." }
    if (body.message && typeof body.message === "object") {
      console.log(
        "Using Format 1: { message: { text: '...' }, shopId: '...' }"
      );
      message = body.message;
      shopId = body.shopId;
    }
    // Format 2: { text: "...", shopId: "..." } (direct message format)
    else if (body.text && typeof body.text === "string") {
      console.log("Using Format 2: { text: '...', shopId: '...' }");
      message = { text: body.text, timestamp: body.timestamp };
      shopId = body.shopId;
    }
    // Format 3: { message: "..." } (simple string message)
    else if (body.message && typeof body.message === "string") {
      console.log("Using Format 3: { message: '...' }");
      message = { text: body.message };
      shopId = body.shopId;
    }
    // Format 4: { sender: "...", text: "...", timestamp: "...", shopId: "..." } (direct format)
    else if (body.text && body.sender) {
      console.log(
        "Using Format 4: { sender: '...', text: '...', timestamp: '...', shopId: '...' }"
      );
      message = {
        text: body.text,
        sender: body.sender,
        timestamp: body.timestamp,
      };
      shopId = body.shopId;
    }
    // Invalid format
    else {
      console.error("Invalid request format:", JSON.stringify(body, null, 2));
      return NextResponse.json(
        {
          error:
            "Invalid request format. Expected { message: { text: '...' } } or { text: '...' } or { sender: '...', text: '...' }",
          received: JSON.stringify(body),
        },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    console.log("Extracted message:", JSON.stringify(message, null, 2));
    console.log("Extracted shopId:", shopId);

    if (!message.text || typeof message.text !== "string") {
      console.error("Invalid message text:", message);
      return NextResponse.json(
        { error: "Message text is required and must be a string" },
        { status: 400, headers: await corsHeaders(origin) }
      );
    }

    // Get shop ID from origin if not provided in the request
    if (!shopId && origin) {
      console.log("No shopId provided, attempting to get from origin:", origin);
      shopId = await getShopIdFromOrigin(origin);
      console.log(`Shop ID from origin: ${shopId}`);
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

    console.log(
      `Creating ticket with data: ${JSON.stringify(ticketData, null, 2)}`
    );
    try {
      const [ticket] = await db.insert(tickets).values(ticketData).returning();
      console.log(
        `Ticket created successfully: ${JSON.stringify(ticket, null, 2)}`
      );

      // Add the first message
      const messageData = {
        sender: message.sender || "user",
        text: message.text,
        timestamp: message.timestamp || now,
        ticketId: ticket.id,
        ...(shopId ? { shopId } : {}),
      };

      console.log(
        `Adding message with data: ${JSON.stringify(messageData, null, 2)}`
      );
      try {
        await db.insert(messages).values(messageData);
        console.log("Message added successfully");
      } catch (messageError) {
        console.error("Error adding message:", messageError);
        throw messageError;
      }

      return NextResponse.json(
        { ticketId: ticket.id },
        { headers: await corsHeaders(origin) }
      );
    } catch (ticketError) {
      console.error("Error creating ticket:", ticketError);
      throw ticketError;
    }
  } catch (error) {
    console.error("Error in POST handler:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
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
