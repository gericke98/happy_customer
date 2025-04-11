import { NextResponse } from "next/server";
import { aiService } from "../ai";
import { headers } from "next/headers";

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 100; // Max requests per hour
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export async function POST(request: Request) {
  try {
    // Check API key
    const headersList = headers();

    // Rate limiting
    const clientIp = headersList.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const clientRateLimit = rateLimitMap.get(clientIp);

    if (clientRateLimit) {
      if (now > clientRateLimit.resetTime) {
        // Reset rate limit window
        rateLimitMap.set(clientIp, {
          count: 1,
          resetTime: now + RATE_LIMIT_WINDOW,
        });
      } else if (clientRateLimit.count >= MAX_REQUESTS) {
        return NextResponse.json(
          {
            error: {
              message: "Rate limit exceeded",
              code: "RATE_LIMIT_EXCEEDED",
              retryAfter: Math.ceil((clientRateLimit.resetTime - now) / 1000),
            },
          },
          { status: 429 }
        );
      } else {
        // Increment request count
        rateLimitMap.set(clientIp, {
          count: clientRateLimit.count + 1,
          resetTime: clientRateLimit.resetTime,
        });
      }
    } else {
      // Initialize rate limit for new client
      rateLimitMap.set(clientIp, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW,
      });
    }

    // Validate request body
    const { address } = await request.json();

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        {
          error: {
            message: "Address is required and must be a string",
            code: "INVALID_INPUT",
          },
        },
        { status: 400 }
      );
    }

    // Validate address
    const validationResult = await aiService.validateAddress(address);

    // Format response based on language
    const response = {
      data: {
        formattedAddress: validationResult.formattedAddress,
        multipleCandidates: validationResult.multipleCandidates,
        addressCandidates: validationResult.addressCandidates,
        validationStatus: validationResult.formattedAddress
          ? "VALID"
          : "INVALID",
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error validating address:", error);
    return NextResponse.json(
      {
        error: {
          message: "Failed to validate address",
          code: "VALIDATION_ERROR",
        },
      },
      { status: 500 }
    );
  }
}
