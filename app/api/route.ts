import { NextResponse } from "next/server";
import { trackOrder } from "../queries/order";
import { updateTicketWithOrderInfo } from "../actions/tickets";
import { aiService } from "./ai";
import { NextRequest } from "next/server";
import { getMessages } from "@/app/actions/tickets";
import {
  handleChangeDelivery,
  handleDeliveryIssue,
  handleInvoiceRequest,
  handleProductInquiry,
  handleProductInquiryRestock,
  handlePromoCode,
  handleUpdateOrder,
  InvalidCredentials,
  NoOrderNumberOrEmail,
  handleOrderTracking,
  handleReturnsExchange,
} from "./intents";
import { handleError, APIError, createRequestId } from "./utils/error-handler";
import { logger } from "./utils/logger";
import {
  ClassifiedMessage,
  Intent,
  MessageParameters,
  APIResponse,
} from "@/app/types/api";
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

export async function GET(request: NextRequest) {
  const requestId = createRequestId();
  const origin = request.headers.get("origin");
  logger.info(
    "Received GET request",
    { path: request.nextUrl.pathname },
    requestId
  );

  try {
    const ticketId = request.nextUrl.searchParams.get("ticketId");

    if (!ticketId) {
      throw new APIError(
        "Missing ticketId parameter",
        400,
        "MISSING_PARAMETER"
      );
    }

    const messages = await getMessages(ticketId);
    logger.info("Retrieved messages successfully", { ticketId }, requestId);

    return NextResponse.json<APIResponse>(
      {
        data: { messages },
        requestId,
        timestamp: new Date().toISOString(),
      },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    logger.error(
      "Error in GET request",
      error as Error,
      { path: request.nextUrl.pathname },
      requestId
    );
    return handleError(error, requestId, origin);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = createRequestId();
  const origin = req.headers.get("origin");
  logger.info(
    "Received POST request",
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
    } catch (error) {
      logger.error("Error parsing request body", error as Error, {}, requestId);
      throw new APIError("Invalid JSON in request body", 400, "INVALID_JSON");
    }

    const { message, context, currentTicket } = body;

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
    let shopId = null;
    if (origin) {
      shopId = await getShopIdFromOrigin(origin);
    }

    // Call the classification API
    logger.debug("Calling classification API", { message }, requestId);
    const classificationResponse = await fetch(
      `${req.nextUrl.origin}/api/classify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, context }),
      }
    );

    if (!classificationResponse.ok) {
      const errorData = await classificationResponse.json();
      throw new APIError(
        errorData.error || "Classification failed",
        classificationResponse.status,
        errorData.code || "CLASSIFICATION_ERROR"
      );
    }

    const classificationData = await classificationResponse.json();
    const classification = classificationData.data
      .classification as ClassifiedMessage;

    logger.logIntentClassification(message, classification, requestId);
    const { intent, parameters, language } = classification;

    // Handle ticket updates
    if (
      currentTicket?.id &&
      parameters.order_number &&
      parameters.email &&
      (!currentTicket.orderNumber || !currentTicket.email)
    ) {
      if (!parameters.order_number || !parameters.email) {
        return NextResponse.json<APIResponse>(
          {
            data: { response: await NoOrderNumberOrEmail(language) },
            requestId,
            timestamp: new Date().toISOString(),
          },
          { headers: await corsHeaders(origin) }
        );
      }

      const shopifyData = await trackOrder(
        parameters.order_number,
        parameters.email
      );

      if (!shopifyData.success) {
        logger.warn(
          "Invalid credentials",
          {
            orderNumber: parameters.order_number,
            error: shopifyData.error,
          },
          requestId
        );

        return NextResponse.json<APIResponse>(
          {
            data: {
              response: await InvalidCredentials(language, shopifyData.error),
            },
            requestId,
            timestamp: new Date().toISOString(),
          },
          { headers: await corsHeaders(origin) }
        );
      }

      await updateTicketWithOrderInfo(
        currentTicket.id,
        parameters.order_number,
        parameters.email,
        shopifyData.order?.customer
      );
      logger.info(
        "Updated ticket with order info",
        {
          ticketId: currentTicket.id,
          orderNumber: parameters.order_number,
        },
        requestId
      );
    }

    // Process intent with timeout
    const intentHandler = async (
      intent: Intent,
      parameters: MessageParameters
    ) => {
      logger.debug("Processing intent", { intent, parameters }, requestId);
      switch (intent) {
        case "order_tracking":
          return handleOrderTracking(parameters, context, language);
        case "returns_exchange":
          return handleReturnsExchange(language);
        case "delivery_issue":
          return handleDeliveryIssue(parameters, message, context, language);
        case "change_delivery":
          return handleChangeDelivery(parameters, message, context, language);
        case "product_sizing":
          return handleProductInquiry(parameters, message, context, language);
        case "update_order":
          return handleUpdateOrder(parameters, message, context, language);
        case "restock":
          return handleProductInquiryRestock(parameters, language);
        case "promo_code":
          return handlePromoCode(parameters, language);
        case "invoice_request":
          return handleInvoiceRequest(parameters, language);
        case "other-order":
          if (!parameters.order_number || !parameters.email) {
            return language === "Spanish"
              ? "Para ayudarte mejor con tu consulta sobre el pedido, necesito el número de pedido (tipo #12345) y tu email 😊"
              : "To better help you with your order-related query, I need your order number (like #12345) and email 😊";
          }
          const orderData = await trackOrder(
            parameters.order_number,
            parameters.email
          );
          return aiService.generateFinalAnswer(
            intent,
            parameters,
            orderData,
            message,
            context,
            language
          );
        default:
          return aiService.generateFinalAnswer(
            intent,
            parameters,
            null,
            message,
            context,
            language
          );
      }
    };

    const response = await Promise.race([
      intentHandler(intent, parameters),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new APIError(
                "Intent processing timeout",
                408,
                "INTENT_PROCESSING_TIMEOUT"
              )
            ),
          30000
        )
      ),
    ]);

    logger.info(
      "Successfully processed request",
      {
        intent,
        shopId: shopId || "unknown",
      },
      requestId
    );
    return NextResponse.json<APIResponse>(
      {
        data: { response },
        requestId,
        timestamp: new Date().toISOString(),
      },
      { headers: await corsHeaders(origin) }
    );
  } catch (error) {
    logger.error(
      "Error in POST request",
      error as Error,
      { path: req.nextUrl.pathname },
      requestId
    );
    return handleError(error, requestId, origin);
  }
}
