import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { z } from "zod";
import { aiService } from "../ai";
import {
  handleChangeDelivery,
  handleDeliveryIssue,
  handleInvoiceRequest,
  handleProductInquiry,
  handleProductInquiryRestock,
  handlePromoCode,
  handleUpdateOrder,
  handleOrderTracking,
} from "../intents";
import { ClassifiedMessage } from "@/types";
import { ChatMessage } from "@/types";
import { MessageParameters } from "@/app/types/api";
import { handleError } from "../utils/error-handler";

export const dynamic = "force-dynamic";

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

// Validation schema
const chatRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
  context: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const body = await request.json();
    const validatedRequest = chatRequestSchema.parse(body);

    // Get bot response with timeout
    const classificationPromise = aiService.classifyMessage(
      validatedRequest.message,
      validatedRequest.context
    );

    const classification = (await Promise.race([
      classificationPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Classification timeout")), 30000)
      ),
    ])) as ClassifiedMessage;

    const { intent, parameters, language } = classification;

    // Convert context to ChatMessage array
    const chatContext: ChatMessage[] =
      validatedRequest.context?.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date().toISOString(),
      })) || [];

    // Handle different intents
    let response = "";
    switch (intent) {
      case "order_tracking":
        response = await handleOrderTracking(
          parameters as MessageParameters,
          chatContext,
          language
        );
        break;
      case "product_sizing":
        response = await handleProductInquiry(
          parameters as MessageParameters,
          validatedRequest.message,
          chatContext,
          language
        );
        break;
      case "restock":
        response = await handleProductInquiryRestock(
          parameters as MessageParameters,
          language
        );
        break;
      case "promo_code":
        response = await handlePromoCode(
          parameters as MessageParameters,
          language
        );
        break;
      case "invoice_request":
        response = await handleInvoiceRequest(
          parameters as MessageParameters,
          language
        );
        break;
      case "delivery_issue":
        response = await handleDeliveryIssue(
          parameters as MessageParameters,
          validatedRequest.message,
          chatContext,
          language
        );
        break;
      case "change_delivery":
        response = await handleChangeDelivery(
          parameters as MessageParameters,
          validatedRequest.message,
          chatContext,
          language
        );
        break;
      case "update_order":
        response = await handleUpdateOrder(
          parameters as MessageParameters,
          validatedRequest.message,
          chatContext,
          language
        );
        break;
      default:
        response =
          "I'm not sure how to help with that. Could you please rephrase your question?";
    }

    return NextResponse.json(
      {
        status: 200,
        data: { response },
      },
      { headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error processing chat request:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          status: 400,
          error: `Invalid request data: ${error.errors[0].message}`,
        },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
    if (error instanceof Error && error.message === "Classification timeout") {
      return NextResponse.json(
        {
          status: 408,
          error: "Request timed out. Please try again.",
        },
        { status: 408, headers: corsHeaders(origin) }
      );
    }
    return handleError(error, undefined, origin);
  }
}
