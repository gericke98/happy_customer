import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { aiService } from "../ai";
import { handleError, APIError, createRequestId } from "../utils/error-handler";
import { logger } from "../utils/logger";
import { Intent } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// CORS headers for the response
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400", // 24 hours
};

// Valid intent values
const VALID_INTENTS = [
  "order_tracking",
  "returns_exchange",
  "change_delivery",
  "return_status",
  "promo_code",
  "other-order",
  "other-general",
  "delivery_issue",
  "conversation_end",
  "product_sizing",
  "update_order",
  "restock",
  "invoice_request",
];

// Simple in-memory rate limiting
const rateLimits = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute

// Simple in-memory response caching
const responseCache = new Map<
  string,
  { response: string; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = createRequestId();
  const clientIp = req.ip || req.headers.get("x-forwarded-for") || "unknown";

  logger.info(
    "Received POST request for answer generation",
    { path: req.nextUrl.pathname, clientIp },
    requestId
  );

  try {
    // Check rate limit
    const now = Date.now();
    const clientRateLimit = rateLimits.get(clientIp);

    if (clientRateLimit) {
      // Reset if the window has passed
      if (now > clientRateLimit.resetTime) {
        rateLimits.set(clientIp, {
          count: 1,
          resetTime: now + RATE_LIMIT_WINDOW,
        });
      } else if (clientRateLimit.count >= MAX_REQUESTS_PER_WINDOW) {
        // Rate limit exceeded
        throw new APIError(
          "Rate limit exceeded. Please try again later.",
          429,
          "RATE_LIMIT_EXCEEDED"
        );
      } else {
        // Increment counter
        clientRateLimit.count++;
      }
    } else {
      // First request from this IP
      rateLimits.set(clientIp, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW,
      });
    }

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
      console.log("Received request body:", JSON.stringify(body, null, 2));
    } catch (error) {
      logger.error("Error parsing request body", error as Error, {}, requestId);
      throw new APIError("Invalid JSON in request body", 400, "INVALID_JSON");
    }

    // Extract required fields
    const {
      intent,
      parameters,
      userMessage,
      context,
      language,
      sizeCharts,
      shopifyData,
    } = body;

    // Validate required fields
    if (!intent || typeof intent !== "string") {
      throw new APIError(
        "Intent is required and must be a string",
        400,
        "INVALID_INTENT"
      );
    }

    // Validate intent value
    if (!VALID_INTENTS.includes(intent)) {
      throw new APIError(
        `Invalid intent value. Must be one of: ${VALID_INTENTS.join(", ")}`,
        400,
        "INVALID_INTENT_VALUE"
      );
    }

    if (!userMessage || typeof userMessage !== "string") {
      throw new APIError(
        "User message is required and must be a string",
        400,
        "INVALID_USER_MESSAGE"
      );
    }

    if (!parameters || typeof parameters !== "object") {
      throw new APIError(
        "Parameters are required and must be an object",
        400,
        "INVALID_PARAMETERS"
      );
    }

    // Validate context if provided
    if (context && !Array.isArray(context)) {
      console.error("Invalid context:", context);
      throw new APIError(
        "Context must be an array of messages",
        400,
        "INVALID_CONTEXT"
      );
    }

    // Validate shopifyData if provided
    if (shopifyData && typeof shopifyData !== "object") {
      throw new APIError(
        "Shopify data must be an object",
        400,
        "INVALID_SHOPIFY_DATA"
      );
    }

    // Check cache for identical requests
    const cacheKey = JSON.stringify({
      intent,
      parameters,
      userMessage,
      context,
      language,
      sizeCharts,
      shopifyData,
    });

    const cachedResponse = responseCache.get(cacheKey);
    if (cachedResponse && now - cachedResponse.timestamp < CACHE_TTL) {
      logger.info("Returning cached response", { cacheKey }, requestId);

      return NextResponse.json(
        {
          answer: cachedResponse.response,
          cached: true,
          timestamp: new Date(cachedResponse.timestamp).toISOString(),
          requestId,
        },
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    // Convert context to the format expected by generateFinalAnswer
    let openAIContext;
    if (context && Array.isArray(context)) {
      openAIContext = context.map(
        (msg: { role?: string; content?: string }) => {
          if (typeof msg === "string") {
            return { role: "user", content: msg };
          } else if (msg.role && msg.content) {
            return { role: msg.role, content: msg.content };
          } else {
            throw new APIError(
              "Invalid message format in context",
              400,
              "INVALID_CONTEXT_FORMAT"
            );
          }
        }
      );
    }

    // Generate the answer
    const answerPromise = aiService.generateFinalAnswer(
      intent as Intent,
      parameters,
      shopifyData || null,
      userMessage,
      openAIContext,
      language,
      sizeCharts
    );

    // Set a timeout for the answer generation
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => {
        reject(new APIError("Answer generation timed out", 504, "TIMEOUT"));
      }, 30000); // 30 seconds timeout
    });

    // Race between answer generation and timeout
    const answer = await Promise.race([answerPromise, timeoutPromise]);

    // Cache the response
    responseCache.set(cacheKey, { response: answer, timestamp: now });

    // Return the answer with metadata
    return NextResponse.json(
      {
        answer,
        cached: false,
        timestamp: new Date().toISOString(),
        requestId,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    return handleError(error, requestId, null);
  }
}
