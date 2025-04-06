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

// Function to ensure allowed origin exists
const ensureAllowedOriginExists = async (origin: string, shopId: string) => {
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
      return;
    }

    // If the origin doesn't exist, create it
    console.log("Origin not found in database, creating it");
    const now = new Date().toISOString();
    const newOrigin = {
      origin,
      shopId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    console.log(
      "Creating new origin with data:",
      JSON.stringify(newOrigin, null, 2)
    );
    await db.insert(allowedOrigins).values(newOrigin);
    console.log(`Created new origin: ${origin}`);
  } catch (error) {
    console.error(`Error ensuring origin exists: ${error}`);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
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

// Function to get CORS headers
const corsHeaders = (origin: string | null): Record<string, string> => {
  console.log("corsHeaders called with origin:", origin);

  if (!origin) {
    console.log("No origin provided, using default CORS headers");
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  console.log("Checking if origin is allowed:", origin);
  const isAllowed = MANUALLY_ALLOWED_ORIGINS.includes(origin);
  console.log("Is origin allowed:", isAllowed);

  if (isAllowed) {
    console.log("Origin is allowed, returning specific CORS headers");
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  console.log("Origin is not allowed, using default CORS headers");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
};

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

export async function POST(request: NextRequest) {
  console.log("POST /api/messages called");

  try {
    // Log the request headers for debugging
    const headers = Object.fromEntries(request.headers.entries());
    console.log("Request headers:", JSON.stringify(headers, null, 2));

    // Get the origin from the request headers
    const origin = request.headers.get("origin");
    console.log("Request origin:", origin);

    // Validate content type
    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      console.error("Invalid content type:", contentType);
      return NextResponse.json(
        { error: "Content type must be application/json" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Parse the request body
    const body = await request.json();
    console.log("Received request body:", JSON.stringify(body, null, 2));

    // Validate request body
    if (!body || typeof body !== "object") {
      console.error("Invalid request body:", body);
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Extract ticket ID and message data
    const {
      ticketId,
      message,
      sender,
      text,
      timestamp,
      shopId: providedShopId,
    } = body;

    // Validate ticket ID
    if (!ticketId) {
      console.error("Missing ticketId in request body");
      return NextResponse.json(
        { error: "ticketId is required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Get shop ID from origin if not provided in request
    let shopId = providedShopId;
    if (!shopId && origin) {
      console.log(
        "No shopId provided in request, getting from origin:",
        origin
      );
      shopId = await getShopIdFromOrigin(origin);
      console.log("Shop ID from origin:", shopId);
    }

    // If shop ID is a full domain (e.g., "shameless-test.myshopify.com"), extract just the shop name
    if (shopId?.includes(".myshopify.com")) {
      console.log("Shop ID is a full domain, extracting shop name");
      shopId = shopId.split(".")[0];
      console.log("Extracted shop name:", shopId);
    }

    // Check if the shop exists in the database
    if (shopId) {
      console.log("Checking if shop exists in database:", shopId);
      const existingShop = await db.query.shops.findFirst({
        where: eq(shops.id, shopId),
      });

      if (!existingShop) {
        console.error("Shop not found in database:", shopId);
        return NextResponse.json(
          { error: "Invalid shop ID" },
          { status: 400, headers: corsHeaders(origin) }
        );
      }
      console.log(
        "Shop found in database:",
        JSON.stringify(existingShop, null, 2)
      );
    }

    // Process message data based on format
    let messageData;
    if (message && typeof message === "object") {
      // Format 1: { ticketId: "...", message: { sender: "...", text: "...", ... } }
      console.log("Processing message in Format 1");
      messageData = message;
    } else if (sender && text) {
      // Format 2: { ticketId: "...", sender: "...", text: "...", ... }
      console.log("Processing message in Format 2");
      messageData = { sender, text, timestamp };
    } else {
      console.error("Invalid message format:", body);
      return NextResponse.json(
        {
          error:
            "Invalid message format. Must include either a message object or sender and text fields",
        },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Validate message data
    if (!messageData.text) {
      console.error("Missing message text");
      return NextResponse.json(
        { error: "Message text is required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    if (!messageData.sender) {
      console.error("Missing message sender");
      return NextResponse.json(
        { error: "Message sender is required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Insert the message into the database
    console.log(
      "Inserting message into database:",
      JSON.stringify(messageData, null, 2)
    );
    const now = new Date().toISOString();
    const newMessage = {
      ticketId,
      shopId,
      sender: messageData.sender,
      text: messageData.text,
      timestamp: messageData.timestamp || now,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(messages).values(newMessage);
    console.log("Message inserted successfully");

    return NextResponse.json(
      { success: true, message: newMessage },
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error processing message:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(request.headers.get("origin")) }
    );
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
