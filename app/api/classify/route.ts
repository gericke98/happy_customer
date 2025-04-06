import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { aiService } from "../ai";
import { handleError, APIError, createRequestId } from "../utils/error-handler";
import { logger } from "../utils/logger";
import { ClassifiedMessage } from "@/app/types/api";
import { eq, and } from "drizzle-orm";
import { allowedOrigins, shops } from "@/db/schema";
import db from "@/db/drizzle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manually allowed origins (temporary solution)
const MANUALLY_ALLOWED_ORIGINS = [
  "https://shameless-test.myshopify.com",
  "https://shameless-test.myshopify.com/",
];

// Function to check if a shop exists in the database
const checkShopExists = async (shopId: string): Promise<string | null> => {
  try {
    // Check if the shop already exists
    const existingShop = await db.query.shops.findFirst({
      where: eq(shops.id, shopId),
    });

    if (existingShop) {
      return shopId;
    }

    // If the shop doesn't exist, return null
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
      const domain = url.hostname;
      const shopId = domain.split(".")[0]; // Extract shop ID from domain (e.g., "shameless-test" from "shameless-test.myshopify.com")

      // Check if the shop exists in the database
      const validShopId = await checkShopExists(shopId);

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

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = createRequestId();
  const origin = req.headers.get("origin");
  logger.info(
    "Received POST request for classification",
    { path: req.nextUrl.pathname },
    requestId
  );

  try {
    // Validate content type
    const contentType = req.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      throw new APIError(
        "Content-Type must be application/json",
        415,
        "INVALID_CONTENT_TYPE"
      );
    }

    // Parse and validate request body
    let body;
    try {
      body = await req.json();
      console.log("Received request body:", JSON.stringify(body));
    } catch (error) {
      logger.error("Error parsing request body", error as Error, {}, requestId);
      throw new APIError("Invalid JSON in request body", 400, "INVALID_JSON");
    }

    // Handle different request formats
    let message, context;

    // Format 1: { message: "..." }
    if (body.message && typeof body.message === "string") {
      message = body.message;
      context = body.context;
    }
    // Format 2: { message: { text: "..." } }
    else if (
      body.message &&
      typeof body.message === "object" &&
      body.message.text
    ) {
      message = body.message.text;
      context = body.context;
    }
    // Format 3: { text: "..." }
    else if (body.text && typeof body.text === "string") {
      message = body.text;
      context = body.context;
    }
    // Invalid format
    else {
      console.error("Invalid request format:", JSON.stringify(body));
      throw new APIError(
        "Invalid request format. Expected { message: '...' } or { message: { text: '...' } } or { text: '...' }",
        400,
        "INVALID_FORMAT"
      );
    }

    // Validate required fields
    if (!message || typeof message !== "string") {
      throw new APIError(
        "Message must be a non-empty string",
        400,
        "INVALID_MESSAGE"
      );
    }

    // Validate context if provided
    if (
      context &&
      (!Array.isArray(context) ||
        !context.every(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.role === "string" &&
            typeof item.content === "string"
        ))
    ) {
      throw new APIError("Invalid context format", 400, "INVALID_CONTEXT");
    }

    // Get shop ID from origin if available
    let shopId: string | undefined = undefined;
    if (origin) {
      const originShopId = await getShopIdFromOrigin(origin);
      shopId = originShopId || undefined;
      logger.info("Shop ID from origin", { shopId }, requestId);
    }

    // Message classification with timeout
    logger.debug("Starting message classification", { message }, requestId);
    const classificationPromise = aiService.classifyMessage(message, context);
    const classification = (await Promise.race([
      classificationPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new APIError(
                "Classification timeout",
                408,
                "CLASSIFICATION_TIMEOUT"
              )
            ),
          30000
        )
      ),
    ])) as ClassifiedMessage;

    logger.logIntentClassification(message, classification, requestId);

    logger.info(
      "Successfully classified message",
      {
        intent: classification.intent,
        shopId: shopId || "unknown",
      },
      requestId
    );

    // Return only the classification intent and parameters
    return NextResponse.json(
      {
        intent: classification.intent,
        parameters: classification.parameters,
      },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    logger.error(
      "Error in classification request",
      error as Error,
      { path: req.nextUrl.pathname },
      requestId
    );
    return handleError(error, requestId, origin);
  }
}
