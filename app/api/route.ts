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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
      { headers: corsHeaders(origin) }
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
          { headers: corsHeaders(origin) }
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
          { headers: corsHeaders(origin) }
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

    logger.info("Successfully processed request", { intent }, requestId);
    return NextResponse.json<APIResponse>(
      {
        data: { response },
        requestId,
        timestamp: new Date().toISOString(),
      },
      { headers: corsHeaders(origin) }
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
