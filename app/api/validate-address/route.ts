import { NextResponse } from "next/server";
import { aiService } from "../ai";

export async function POST(request: Request) {
  try {
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

    const validationResult = await aiService.validateAddress(address);

    return NextResponse.json({
      data: validationResult,
      success: true,
    });
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
