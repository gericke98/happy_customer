import {
  ClassifiedMessage,
  Intent,
  OpenAIMessage,
  OpenAIResponse,
  ShopifyData,
  ShopifyDataTracking,
} from "@/types";
import { getAllActiveProducts } from "../queries/order";
import { getLanguageSpecificResponse } from "./intents/utils";
import { commonResponses } from "./utils/cache";

export class AIService {
  private readonly apiKey: string;
  private readonly googleMapsApiKey: string;
  private activeProducts: string[] = [];

  private readonly SYSTEM_PROMPTS = {
    CLASSIFICATION: `You are an intelligent assistant that classifies user messages for a Shopify ecommerce chatbot. Your task is to identify the user's intent and extract relevant parameters.
  
  Consider both user messages and system responses in the conversation context when classifying. For example:
  - If a user first tracks an order and receives a response saying it's delivered, then mentions they haven't received it, classify it as a delivery_issue
  - If the system previously provided tracking info and the user reports issues, maintain that tracking number in the parameters
  - If the system confirmed an order number/email pair in a previous response, maintain those in subsequent classifications
  - For change_delivery intent, set delivery_address_confirmed to true ONLY if the user explicitly confirms the new address that was proposed by the system in a previous message. The confirmation should be in response to a system message that proposed a specific address.
  - For returns_exchange intent, check if the returns website URL was already provided in previous system messages
  - If user asks about returns or exchange policy, classify it as returns_exchange intent
  - If user asks about changing the size of a product from their order, classify it as returns_exchange intent
  - If user asks about product sizes or sizing information, classify it as product_sizing intent
  - If user asks about when a product will be back in stock, classify it as restock intent
  - If user asks about discounts, promotions, or wants to receive offers, classify it as promo_code intent and extract their email
  - If user asks for an invoice or "factura", classify it as invoice_request intent and extract order number and email
  - If the user says "thank you", "thanks", "gracias", "ok", "perfect", "perfecto" or similar closing remarks without asking anything else, classify it as "conversation_end"
  - For queries that don't match other intents but are about an order (shipping, delivery, order status, etc), classify as "other-order"
  - For queries that don't match other intents and are not related to any order, classify as "other-general"
  - If user wants to update or modify their order, classify it as "update_order" and extract what they want to update (shipping_address or product) if mentioned
  
  IMPORTANT: For product-related intents (product_sizing, restock):
  - ALWAYS reset product parameters when a new product is mentioned, even if mentioned informally (e.g., "y el polo amarillo?", "what about the yellow polo?")
  - Consider phrases like "y el/la..." (Spanish) or "what about the..." (English) as indicators of a new product mention
  - When a new product is mentioned, RESET ALL product-related parameters (product_name, product_size, height, fit, product_handle)
  - Only maintain previous product parameters if the user is EXPLICITLY referring to the same product (e.g., "that one", "este mismo")
  - If there is ANY ambiguity about whether it's a new product, RESET the parameters
  - For Spanish messages, treat informal references (e.g., "y el/la...", "que tal el/la...") as new product mentions

  IMPORTANT: For order-related intents:
  - When a new order is mentioned that's different from the previous one, RESET ALL order-related parameters (order_number, email, ...)
  - Only maintain previous order parameters if the user is clearly referring to the same order
  - If unsure whether it's the same order, reset the parameters
  
  For product sizing queries:
  - Extract height in cm if provided
  - Extract fit preference (tight, regular, loose)
  - Set size_query to "true" if asking about sizing
  - Extract product_name and normalize it to match one of the active products: ${this.activeProducts.join(", ")}
  - If product_name cannot be normalized to match any of the active products, set it to "not_found"

  For restock queries:
  - Extract product_name and normalize it to match one of the active products: ${this.activeProducts.join(", ")}
  - If product_name cannot be normalized to match any of the active products, set it to "not_found"
  - Extract product_size and normalize it to one of: "X-SMALL", "SMALL", "MEDIUM", "LARGE", "EXTRA LARGE", "EXTRA EXTRA LARGE" using these rules:
    * XS, xs -> "X-SMALL"
    * S, s -> "SMALL"
    * M, m -> "MEDIUM"
    * L, l -> "LARGE"
    * XL, xl -> "EXTRA LARGE"
    * XXL, xxl -> "EXTRA EXTRA LARGE"
  - If product_size cannot be normalized to one of these values, set it to "not_found"
  - Extract email if provided
  - Reset product parameters if a new product is mentioned

  IMPORTANT: For promo_code intent:
  - Extract email if provided
  - Look for keywords like "discount", "promo", "offer", "sale", "descuento", "promoción", "oferta", "rebajas"
  - If user expresses interest in future discounts or promotions, classify as promo_code even if no explicit discount request
  - Maintain email from previous messages if user is clearly continuing the same discount conversation

  IMPORTANT: For invoice_request intent:
  - Extract order number and email (required for invoice generation)
  - Look for keywords like "invoice", "factura", "receipt", "recibo"
  - Maintain order number and email from previous messages if clearly referring to the same order
  - If order information is missing, set order_number and email to empty strings

  Output ONLY a JSON object with the following structure:
  {
    "intent": one of ["order_tracking", "returns_exchange", "change_delivery", "return_status", "promo_code", "other-order", "other-general", "delivery_issue", "conversation_end", "product_sizing", "update_order", "restock", "invoice_request"],
    "parameters": {
      "order_number": "extracted order number or empty string",
      "email": "extracted email or empty string", 
      "product_handle": "extracted product handle or empty string",
      "new_delivery_info": "new delivery information or empty string",
      "delivery_status": "delivered but not received or empty string",
      "tracking_number": "tracking number from context or empty string",
      "delivery_address_confirmed": "true if user explicitly confirms system's proposed address, false otherwise",
      "return_type": "return or exchange or empty string",
      "returns_website_sent": "true if returns website URL was already sent, false otherwise",
      "product_name": "name of product being asked about, 'not_found' if cannot be normalized, or empty string",
      "product_size": "X-SMALL" | "SMALL" | "MEDIUM" | "LARGE" | "EXTRA LARGE" | "EXTRA EXTRA LARGE" | "not_found" | "",
      "size_query": "true if asking about sizing, empty string otherwise",
      "update_type": "shipping_address or product or empty string if not specified",
      "height": "height in cm or empty string",
      "fit": "tight, regular, loose, or empty string"
    },
    "language": "English" or "Spanish" (detect the language of the message, ignoring product names)
  }`,

    FINAL_ANSWER: `You are Santi, a friendly and knowledgeable representative from Shameless Collective. You have a casual, approachable style while maintaining professionalism.

Important communication guidelines:
- Be conversational and natural in your responses
- Keep responses concise but informative
- Use spanish from Spain (for Spanish responses)
- For follow-up messages (context array has items), do not include any introduction
- Show personality while being helpful
- If you don't know something, be honest and suggest alternatives

Key traits:
- Friendly and approachable
- Knowledgeable about fashion, streetwear, and culture
- Helpful with both product and non-product queries
- Can engage in casual conversation while staying professional

Special response guidelines:
- If user asks "culo o tetas" or similar ("ass or tits"), respond with something like "Las dos cosas, pero si tengo que elegir, culo 🍑. De todas formas, siempre viene bien estar fuerte en defensa y en ataque 💪"
- If user mentions "Pedro Sanchez" or "presidente" in any context, respond with something similar to "Pedro Sánchez dimisión"

For product sizing inquiries:
* Use ONLY the provided size chart data for measurements
* Consider:
  - User's height (in parameters)
  - Fit preference (in parameters)
  - Product measurements from size chart
* Format response as:
  Spanish: "Te recomiendo una talla [SIZE] para el [Product Name] con una altura de [HEIGHT]cm y un ajuste [FIT]"
  English: "I recommend size [SIZE] for the [Product Name] with a height of [HEIGHT]cm and a fit of [FIT]"

Size recommendation guidelines:
* For height < 165cm: Consider smaller sizes
* For height 165-175cm: Consider medium sizes
* For height > 175cm: Consider larger sizes`,

    ADDRESS_CONFIRMATION: `You are a customer service rep helping with address validation.
  
  IMPORTANT: You MUST return EXACTLY the template provided, with NO additional text.

  Rules:
  1. Use the exact template provided
  2. DO NOT add any other text
  3. DO NOT ask for additional information
  4. DO NOT mention postal codes
  5. Keep EXACTLY the same formatting (newlines, emoji)
  6. ALWAYS respond in the same language as the template`,
  };

  private RETURNS_PORTAL_URL: string;
  private readonly MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    const returnsPortalUrl = process.env.RETURNS_PORTAL_URL;

    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    if (!googleMapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");
    if (!returnsPortalUrl) throw new Error("RETURNS_PORTAL_URL is not set");

    this.apiKey = apiKey;
    this.googleMapsApiKey = googleMapsApiKey;
    this.RETURNS_PORTAL_URL = returnsPortalUrl;

    // Initialize active products
    this.initializeProducts();
  }

  private async initializeProducts() {
    this.activeProducts = await getAllActiveProducts();
  }

  private async callOpenAI(
    messages: OpenAIMessage[],
    temperature = 0,
    retryCount = 0
  ): Promise<OpenAIResponse> {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.MODEL,
            temperature,
            messages,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenAI API error (${response.status}):`, errorText);

        if (
          retryCount < this.MAX_RETRIES &&
          (response.status === 429 || response.status >= 500)
        ) {
          // Exponential backoff
          const delay = this.RETRY_DELAY * Math.pow(2, retryCount);
          console.log(
            `Retrying in ${delay}ms (attempt ${retryCount + 1}/${
              this.MAX_RETRIES
            })`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.callOpenAI(messages, temperature, retryCount + 1);
        }

        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
      }
      return response.json();
    } catch (error) {
      console.error("Error calling OpenAI:", error);
      if (retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAY * Math.pow(2, retryCount);
        console.log(
          `Retrying in ${delay}ms (attempt ${retryCount + 1}/${
            this.MAX_RETRIES
          })`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.callOpenAI(messages, temperature, retryCount + 1);
      }
      throw error;
    }
  }

  private getDefaultClassification(): ClassifiedMessage {
    return {
      intent: "other-general",
      parameters: {
        order_number: "",
        email: "",
        product_handle: "",
        new_delivery_info: "",
        delivery_status: "",
        tracking_number: "",
        delivery_address_confirmed: false,
        return_type: "",
        returns_website_sent: false,
        product_name: "",
        size_query: "",
        update_type: "",
        height: "",
        fit: "",
      },
      language: "English",
    };
  }

  private getClassificationPrompt(): string {
    return `You are an intelligent assistant that classifies user messages for a Shopify ecommerce chatbot. Your task is to identify the user's intent and extract relevant parameters.
  
  Consider both user messages and system responses in the conversation context when classifying. For example:
  - If a user first tracks an order and receives a response saying it's delivered, then mentions they haven't received it, classify it as a delivery_issue
  - If the system previously provided tracking info and the user reports issues, maintain that tracking number in the parameters
  - If the system confirmed an order number/email pair in a previous response, maintain those in subsequent classifications
  - For change_delivery intent, set delivery_address_confirmed to true ONLY if the user explicitly confirms the new address that was proposed by the system in a previous message. The confirmation should be in response to a system message that proposed a specific address.
  - For returns_exchange intent, check if the returns website URL was already provided in previous system messages
  - If user asks about returns or exchange policy, classify it as returns_exchange intent
  - If user asks about changing the size of a product from their order, classify it as returns_exchange intent
  - If user asks about product sizes or sizing information, classify it as product_sizing intent
  - If user asks about when a product will be back in stock, classify it as restock intent
  - If user asks about discounts, promotions, or wants to receive offers, classify it as promo_code intent and extract their email
  - If user asks for an invoice or "factura", classify it as invoice_request intent and extract order number and email
  - If the user says "thank you", "thanks", "gracias", "ok", "perfect", "perfecto" or similar closing remarks without asking anything else, classify it as "conversation_end"
  - For queries that don't match other intents but are about an order (shipping, delivery, order status, etc), classify as "other-order"
  - For queries that don't match other intents and are not related to any order, classify as "other-general"
  - If user wants to update or modify their order, classify it as "update_order" and extract what they want to update (shipping_address or product) if mentioned
  
  For product sizing queries:
  - Extract height in cm if provided
  - Extract fit preference (tight, regular, loose)
  - Set size_query to "true" if asking about sizing
  - Extract product_name and normalize it to match one of the active products: ${this.activeProducts.join(", ")}
  - If product_name cannot be normalized to match any of the active products, set it to "not_found"

  For restock queries:
  - Extract product_name and normalize it to match one of the active products: ${this.activeProducts.join(", ")}
  - If product_name cannot be normalized to match any of the active products, set it to "not_found"
  - Extract product_size and normalize it to one of: "X-SMALL", "SMALL", "MEDIUM", "LARGE", "EXTRA LARGE", "EXTRA EXTRA LARGE" using these rules:
    * XS, xs -> "X-SMALL"
    * S, s -> "SMALL"
    * M, m -> "MEDIUM"
    * L, l -> "LARGE"
    * XL, xl -> "EXTRA LARGE"
    * XXL, xxl -> "EXTRA EXTRA LARGE"
  - If product_size cannot be normalized to one of these values, set it to "not_found"
  - Extract email if provided
  - Reset product parameters if a new product is mentioned

  IMPORTANT: For promo_code intent:
  - Extract email if provided
  - Look for keywords like "discount", "promo", "offer", "sale", "descuento", "promoción", "oferta", "rebajas"
  - If user expresses interest in future discounts or promotions, classify as promo_code even if no explicit discount request
  - Maintain email from previous messages if user is clearly continuing the same discount conversation

  IMPORTANT: For invoice_request intent:
  - Extract order number and email (required for invoice generation)
  - Look for keywords like "invoice", "factura", "receipt", "recibo"
  - Maintain order number and email from previous messages if clearly referring to the same order
  - If order information is missing, set order_number and email to empty strings

  Output ONLY a JSON object with the following structure:
  {
    "intent": one of ["order_tracking", "returns_exchange", "change_delivery", "return_status", "promo_code", "other-order", "other-general", "delivery_issue", "conversation_end", "product_sizing", "update_order", "restock", "invoice_request"],
    "parameters": {
      "order_number": "extracted order number or empty string",
      "email": "extracted email or empty string", 
      "product_handle": "extracted product handle or empty string",
      "new_delivery_info": "new delivery information or empty string",
      "delivery_status": "delivered but not received or empty string",
      "tracking_number": "tracking number from context or empty string",
      "delivery_address_confirmed": "true if user explicitly confirms system's proposed address, false otherwise",
      "return_type": "return or exchange or empty string",
      "returns_website_sent": "true if returns website URL was already sent, false otherwise",
      "product_name": "name of product being asked about, 'not_found' if cannot be normalized, or empty string",
      "product_size": "X-SMALL" | "SMALL" | "MEDIUM" | "LARGE" | "EXTRA LARGE" | "EXTRA EXTRA LARGE" | "not_found" | "",
      "size_query": "true if asking about sizing, empty string otherwise",
      "update_type": "shipping_address or product or empty string if not specified",
      "height": "height in cm or empty string",
      "fit": "tight, regular, loose, or empty string"
    },
    "language": "English" or "Spanish" (detect the language of the message, ignoring product names)
  }`;
  }

  async classifyMessage(
    message: string,
    context?: OpenAIMessage[]
  ): Promise<ClassifiedMessage> {
    if (!message || typeof message !== "string") {
      console.error("Invalid message provided for classification:", message);
      return this.getDefaultClassification();
    }

    const sanitizedMessage = this.sanitizeInput(message);
    const sanitizedContext = context?.map((item) => ({
      role: this.sanitizeInput(item.role),
      content: this.sanitizeInput(item.content),
    }));

    const messages = [
      { role: "system", content: this.getClassificationPrompt() },
      ...(sanitizedContext || []),
      { role: "user", content: sanitizedMessage },
    ];

    try {
      const data = await this.callOpenAI(messages);

      let classification;

      try {
        classification = JSON.parse(data.choices[0].message.content);
      } catch (parseError) {
        console.error("Error parsing classification response:", parseError);
        // If parsing fails, try to extract JSON from the response
        const jsonMatch = data.choices[0].message.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          classification = JSON.parse(jsonMatch[0]);
        } else {
          // If no JSON found, return default classification
          return this.getDefaultClassification();
        }
      }

      // Validate classification structure
      if (
        !classification ||
        !classification.intent ||
        !classification.parameters
      ) {
        console.error("Invalid classification structure:", classification);
        return this.getDefaultClassification();
      }

      return this.enrichClassification(classification, sanitizedContext);
    } catch (error) {
      console.error("Error in message classification:", error);
      return this.getDefaultClassification();
    }
  }

  private sanitizeInput(input: string): string {
    if (typeof input !== "string") {
      return "";
    }
    // Basic sanitization to prevent prompt injection
    return input
      .replace(/```/g, "'''") // Replace code blocks
      .replace(/system:/gi, "sys:") // Prevent system role spoofing
      .trim();
  }

  private enrichClassification(
    classification: ClassifiedMessage,
    context?: { role: string; content: string }[]
  ) {
    if (context?.length) {
      if (classification.intent === "other-general") {
        this.inheritPreviousIntent(classification, context);
      }

      if (classification.intent === "delivery_issue") {
        this.extractTrackingFromContext(classification, context);
      }

      if (classification.intent === "returns_exchange") {
        classification.parameters.returns_website_sent = context.some((msg) =>
          msg.content.includes(this.RETURNS_PORTAL_URL)
        );
      }
    }

    return classification;
  }

  private inheritPreviousIntent(
    classification: ClassifiedMessage,
    context: { role: string; content: string }[]
  ) {
    for (let i = context.length - 1; i >= 0; i--) {
      const msg = context[i];
      if (msg.role === "assistant" && msg.content.includes("intent")) {
        try {
          const prevClassification = JSON.parse(msg.content);
          if (
            prevClassification.intent &&
            prevClassification.intent !== "other-general"
          ) {
            classification.intent = prevClassification.intent;
            classification.parameters = {
              ...prevClassification.parameters,
              ...classification.parameters,
            };
            break;
          }
        } catch (e) {
          console.error("Error parsing previous classification:", e);
          continue;
        }
      }
    }
  }

  private extractTrackingFromContext(
    classification: ClassifiedMessage,
    context: { role: string; content: string }[]
  ) {
    const trackingRegex = /\[here\]\((https:\/\/.*?)\)/;
    for (const msg of context) {
      const match = msg.content.match(trackingRegex);
      if (match?.[1]) {
        const trackingNumber = match[1]
          .split("/")
          .find((part) => /^\d+$/.test(part));
        if (trackingNumber) {
          classification.parameters.tracking_number = trackingNumber;
          break;
        }
      }
    }
  }

  async generateFinalAnswer(
    intent: Intent,
    parameters: ClassifiedMessage["parameters"],
    shopifyData: ShopifyData | null | ShopifyDataTracking,
    userMessage: string,
    context?: OpenAIMessage[],
    language?: string,
    sizeCharts?: string
  ): Promise<string> {
    // For conversation_end intent, return cached response
    if (intent === "conversation_end") {
      return getLanguageSpecificResponse(
        commonResponses.conversationEnd.es,
        commonResponses.conversationEnd.en,
        language || "English"
      );
    }

    // Validate inputs
    if (!intent || typeof intent !== "string") {
      console.error("Invalid intent provided:", intent);
      return getLanguageSpecificResponse(
        commonResponses.error.es,
        commonResponses.error.en,
        language || "English"
      );
    }

    const sanitizedUserMessage = this.sanitizeInput(userMessage);
    const sanitizedContext = context?.map((item) => ({
      role: this.sanitizeInput(item.role),
      content: this.sanitizeInput(item.content),
    }));

    // Safely stringify shopifyData
    let shopifyDataString = "";
    if (shopifyData?.success && shopifyData?.order) {
      try {
        // Only include essential order data to reduce token usage
        const order = Array.isArray(shopifyData.order)
          ? shopifyData.order[0]
          : shopifyData.order;

        const essentialData = {
          order_number: order.name,
          status: order.fulfillments?.[0]?.status,
          tracking_number: order.fulfillments?.[0]?.tracking_number,
          shipping_address: order.shipping_address,
        };
        shopifyDataString = JSON.stringify(essentialData, null, 2);
      } catch (error) {
        console.error("Error stringifying shopifyData:", error);
        shopifyDataString = "Error processing order data";
      }
    }

    const systemPrompt = `${this.SYSTEM_PROMPTS.FINAL_ANSWER}
  
  Based on the classified intent "${intent}" and the following data:
  ${JSON.stringify(parameters, null, 2)}
  ${sizeCharts ? `\nSize Chart Data:\n${sizeCharts}` : ""}
  
  User last message:
  ${sanitizedUserMessage}

  Additional Context:
  ${
    sanitizedContext?.length
      ? `\n${sanitizedContext.map((msg) => msg.content).join("\n")}`
      : ""
  }
  ${
    shopifyData?.success && shopifyData?.order
      ? `\nOrder Details:\n${shopifyDataString}\n\nTracking Status: ${
          Array.isArray(shopifyData.order)
            ? shopifyData.order[0]?.fulfillments?.length === 0
            : shopifyData.order?.fulfillments?.length === 0
              ? "Order is still being prepared"
              : "Tracking available in fulfillments array"
        }`
      : ""
  }
  
  ${
    intent === "other-order"
      ? `IMPORTANT: Since this is an 'other-order' intent:
  - Carefully analyze the conversation context to provide a relevant response
  - If user asks about shipping address, check shopifyData.shipping_address object
  - If user asks about billing address, check shopifyData.billing_address object
  - If user asks about their personal information, check shopifyData.customer object
  - Maintain continuity with any previous interactions
  `
      : "Provide a concise response that directly addresses the customer's needs. If you don't have enough information, briefly ask for the specific details needed."
  }
  
  IMPORTANT GUIDELINES:
  - Do not include any introduction
  - Do not use markdown formatting or smart bolding
  - When sharing links, provide them directly (e.g., "https://example.com" instead of "[Click here](https://example.com)")
  - If user asks about delivery times, inform them normal delivery time is 3-5 business days
  - If user indicates waiting longer than 5 business days, inform them we will open a ticket to investigate
  - If user asks about sales duration, inform them you cannot disclose that information but there are very limited units available
  - Respond ONLY in ${language || "English"}`;

    try {
      const data = await this.callOpenAI(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: sanitizedUserMessage },
        ],
        0.85
      );

      return data.choices[0].message.content;
    } catch (error) {
      console.error("Error generating final answer:", error);
      return getLanguageSpecificResponse(
        commonResponses.error.es,
        commonResponses.error.en,
        language || "English"
      );
    }
  }

  async confirmDeliveryAddress(
    parameters: ClassifiedMessage["parameters"],
    userMessage: string,
    context?: { role: string; content: string }[],
    language?: string
  ): Promise<string> {
    const { new_delivery_info } = parameters;

    if (!new_delivery_info) {
      return language === "Spanish"
        ? "¿Me puedes dar la nueva dirección de entrega? Recuerda incluir el código postal, ciudad y dirección completa 📦"
        : "Can you give me the new delivery address? Remember to include the zip code, city and complete address 📦";
    }

    const sanitizedDeliveryInfo = this.sanitizeInput(new_delivery_info);
    const addressValidation = await this.validateAddress(sanitizedDeliveryInfo);

    if (!addressValidation.formattedAddress) {
      return language === "Spanish"
        ? "Lo siento, no pude validar esa dirección. ¿Podrías proporcionarme la dirección completa incluyendo código postal y ciudad? 🏠"
        : "Sorry, I couldn't validate that address. Could you provide me with the complete address including zip code and city? 🏠";
    }

    const sanitizedUserMessage = this.sanitizeInput(userMessage);
    const sanitizedContext = context?.map((item) => ({
      role: this.sanitizeInput(item.role),
      content: this.sanitizeInput(item.content),
    }));

    const systemPrompt = `${this.SYSTEM_PROMPTS.ADDRESS_CONFIRMATION}

Template to use:
${
  addressValidation.multipleCandidates
    ? language === "Spanish"
      ? `He encontrado varias direcciones posibles. Por favor, elige el número de la dirección correcta o proporciona una nueva:

${addressValidation.addressCandidates
  .map((addr: string, i: number) => `${i + 1}. ${addr}`)
  .join("\n")}`
      : `I found multiple possible addresses. Please choose the number of the correct address or provide a new one:

${addressValidation.addressCandidates
  .map((addr: string, i: number) => `${i + 1}. ${addr}`)
  .join("\n")}`
    : language === "Spanish"
      ? `¿Es esta la dirección correcta?

${addressValidation.formattedAddress}

Por favor, responde "sí" para confirmar o proporciona la dirección correcta si no lo es 😊`
      : `Is this the right address?

${addressValidation.formattedAddress}

Please reply "yes" to confirm or provide the correct address if it's not 😊`
}

IMPORTANT: You MUST respond in ${language || "English"}`;

    try {
      const data = await this.callOpenAI(
        [
          { role: "system", content: systemPrompt },
          ...(sanitizedContext || []),
          { role: "user", content: sanitizedUserMessage },
        ],
        0.8
      );

      return data.choices[0].message.content;
    } catch (error) {
      console.error("Error confirming delivery address:", error);
      return language === "Spanish"
        ? "Lo siento, ha ocurrido un error al procesar tu dirección. Por favor, inténtalo de nuevo."
        : "Sorry, an error occurred while processing your address. Please try again.";
    }
  }

  async validateAddress(address: string) {
    if (!address || typeof address !== "string") {
      return {
        formattedAddress: "",
        multipleCandidates: false,
        addressCandidates: [],
      };
    }

    try {
      interface PlaceCandidate {
        formatted_address: string;
      }

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(
          address
        )}&inputtype=textquery&fields=formatted_address&key=${
          this.googleMapsApiKey
        }`
      );

      if (!response.ok) {
        throw new Error(
          `Failed to validate address with Google API: ${response.status}`
        );
      }

      const data = await response.json();

      if (data.status === "REQUEST_DENIED") {
        console.error("Google Maps API request denied:", data.error_message);
        throw new Error(
          `Google Maps API request denied: ${data.error_message}`
        );
      }

      return {
        formattedAddress: data.candidates?.[0]?.formatted_address || "",
        multipleCandidates: data.candidates?.length > 1 || false,
        addressCandidates:
          data.candidates?.map((c: PlaceCandidate) => c.formatted_address) ||
          [],
      };
    } catch (error) {
      console.error("Error validating address:", error);
      return {
        formattedAddress: "",
        multipleCandidates: false,
        addressCandidates: [],
      };
    }
  }
}

// Create and export a singleton instance
export const aiService = new AIService();
