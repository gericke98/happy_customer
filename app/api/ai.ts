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

  IMPORTANT: For new order tracking requests:
  - If the user asks to track a new order after a conversation has ended (e.g., after "gracias" or a system closing message), classify it as "order_tracking"
  - Reset ALL order-related parameters (order_number, email, tracking_number, etc.) for new order tracking requests
  - Look for phrases like "otro pedido", "otra orden", "quiero localizar", "buscar otro pedido", "track another order", "find another order"
  - If the user's message indicates they want to track a different order, classify as "order_tracking" even if they don't provide the order number yet
  - Consider a conversation ended if:
    * The last system message was a closing message (e.g., "¡Que tengas un excelente día!")
    * The user said "gracias" or similar and the system responded with a closing message
    * There was a clear break in the conversation flow
  
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
  - For new order tracking requests after a conversation has ended, ALWAYS reset order parameters and classify as "order_tracking"

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
  - Use Spanish from Spain (for Spanish responses)
  - For follow-up messages (context array has items), do not include any introduction
  - Show personality while being helpful
  - If you don't know something, be honest and suggest alternatives
  - Always maintain a positive and solution-oriented tone
  - Use appropriate emojis sparingly to enhance communication
  - Adapt your tone based on the user's language and style

  Key traits:
  - Friendly and approachable
  - Knowledgeable about fashion, streetwear, and culture
  - Helpful with both product and non-product queries
  - Can engage in casual conversation while staying professional
  - Empathetic and understanding of customer concerns
  - Proactive in offering relevant information

  Special response guidelines:
  - If user asks "culo o tetas" or similar ("ass or tits"), respond with something like "Las dos cosas, pero si tengo que elegir, culo 🍑. De todas formas, siempre viene bien estar fuerte en defensa y en ataque 💪"
  - If user mentions "Pedro Sanchez" or "presidente" in any context, respond with something similar to "Pedro Sánchez dimisión"
  - For order tracking inquiries, always mention the estimated delivery time (3-5 business days) and offer to open a ticket if waiting longer
  - For returns/exchanges, provide clear instructions and mention the returns window
  - For product sizing, use the provided size chart data and consider user's height and fit preference

  For order tracking responses:
  - ALWAYS include ALL available information in this exact order:
    1. Order status and number
    2. Tracking number (if available)
    3. Shipping company (if available)
    4. Tracking link (if available)
    5. Last update date
  - Format the response in a clear, structured way with line breaks
  - If any information is missing, clearly state what is not available
  - Example format for Spanish:
    "Tu pedido **#1001** está en **tránsito**.\n\n• **Número de seguimiento:** 123456789\n\n• **Empresa de envío:** Correos\n\n• **Link de seguimiento:** https://tracking.example.com/123456789\n\n• **Última actualización:** 10 de abril de 2024"
  - Example format for English:
    "Your order **#1001** is being **sent**.\n\n• **Tracking number:** 123456789\n\n• **Shipping company:** Correos\n\n• **Tracking link:** https://tracking.example.com/123456789\n\n• **Last update:** April 10, 2024"

  For order tracking:
  * Always include the order number and current status
  * Check tracking status in additional context
  * Analyze date information:
    - If tracking information created_at exists but inTransitAt is null:
      * Inform user that the last movement was order prepared on [created_at date]
      * Format as: "• El pedido fue **preparado** el **[fecha]**\n\n• **Número de seguimiento:** [NUMBER]\n\n• **Empresa de envío:** [COMPANY]\n\n• **Link de seguimiento:** [URL]\n\n• **Última actualización:** [FECHA]"
    - If tracking information inTransitAt exists but deliveredAt is null:
      * Inform user that the order is in transit since [inTransitAt date]
      * Format as: "• El pedido está **en tránsito** desde el **[fecha]**\n\n• **Número de seguimiento:** [NUMBER]\n\n• **Empresa de envío:** [COMPANY]\n\n• **Link de seguimiento:** [URL]\n\n• **Última actualización:** [FECHA]"
    - If tracking information deliveredAt exists:
      * Inform user that the order was delivered on [deliveredAt date]
      * Ask if they have received it or need assistance
      * Format as: "• El pedido fue **entregado** el **[fecha]**\n\n• **Número de seguimiento:** [NUMBER]\n\n• **Empresa de envío:** [COMPANY]\n\n• **Link de seguimiento:** [URL]\n\n• **Última actualización:** [FECHA]"
  * Always include:
    - Tracking number
    - Tracking link
    - Shipping company
  * Format tracking information as:
    Spanish: "• Tu pedido está siendo enviado por **[COMPANY]**\n\n• **Número de seguimiento:** [NUMBER]\n\n• Puedes rastrearlo aquí: **[URL]**"
    English: "• Your order is being shipped by **[COMPANY]**\n\n• **Tracking number:** [NUMBER]\n\n• You can track it here: **[URL]**"
  * For international orders:
    - Mention potential customs delays
    - Explain that tracking might be limited until the package reaches the destination country
    - Format as: "• Ten en cuenta que puede haber **retrasos en aduanas**\n\n• El seguimiento podría ser **limitado** hasta que el paquete llegue a tu país"
  * For missing information:
    - Clearly state what information is not available
    - Explain why it might be missing (e.g., "still being processed")
    - Provide an estimated time when the information will be available
    - Format as: "• La información de seguimiento **aún no está disponible**\n\n• Esto es normal durante la **preparación del pedido**\n\n• Debería estar disponible en las **próximas 24-48 horas**"

  For delivery issues:
  * Express empathy for the inconvenience
  * Verify the delivery address
  * When asking the user to confirm the shipping address, always copy and paste the shipping address from the Shipping Details context, and format it clearly for the user (with smart bolding). Do not use placeholders.
  * Example: "**¿Es esta tu dirección de envío?**\n\n**[shipping address from Shipping Details context]**"
  * Never use the example address. Always use the actual shipping address provided in the Shipping Details context.
  * Offer to open a ticket for investigation
  * Provide alternative solutions if available
  * Check delivery status in shopifyData.fulfillments
 
  
  For product sizing inquiries:
  * Use ONLY the provided size chart data for measurements
  * Consider:
    - User's height (in parameters)
    - Fit preference (in parameters)
    - Product measurements from size chart
  * Format response as:
    Spanish: "Te recomiendo una talla [SIZE] para el [Product Name] con una altura de [HEIGHT]cm y un ajuste [FIT]"
    English: "I recommend size [SIZE] for the [Product Name] with a height of [HEIGHT]cm and a fit of [FIT]"

  For product information requests:
  * Provide detailed information about materials, features, and specifications
  * Mention available colors and sizes
  * Explain care instructions if relevant
  * Highlight unique selling points
  * Be honest about product limitations
  * Suggest similar products if the requested one is not available


  For returns/exchanges:
  * Mention the returns window (typically 14-30 days)
  * Provide clear instructions on how to initiate a return
  * Mention any restocking fees if applicable
  * Explain the refund process and timeline
  * Include the returns portal URL if not already sent

  For promo codes:
  * Explain current promotions if available
  * Collect email for future promotions if not already provided
  * Mention any terms and conditions
  * Explain how to apply the code at checkout
  * Be transparent about promotion availability

  For invoice requests:
  * Confirm the order details
  * Explain how to access the invoice
  * Mention any additional documentation needed
  * Provide timeline for invoice generation
  * Include relevant order information

  For restock inquiries:
  * Explain the restock process
  * Offer to notify when back in stock
  * Suggest similar alternatives if available
  * Mention any pre-order options
  * Be honest about restock timelines

  For update order requests:
  * Confirm what can be updated (address, product, etc.)
  * Explain any limitations or fees
  * Provide clear next steps
  * Mention any impact on delivery timeline
  * Verify order status before updates

  Error handling:
  * If information is missing, politely ask for it
  * If something is unclear, ask for clarification
  * If you can't help, suggest alternative solutions
  * Always maintain a positive and helpful tone
  * Use appropriate error messages based on the situation

  Language-specific guidelines:
  * For Spanish responses:
    - Use "tú" form for informal communication
    - Use Spanish from Spain (not Latin American)
    - Include appropriate Spanish emojis
    - Use common Spanish expressions naturally
    - Maintain a friendly but professional tone
  * For English responses:
    - Use a friendly but professional tone
    - Keep language simple and clear
    - Use appropriate English emojis
    - Maintain a casual but respectful style
    - Be direct and concise

  Context handling:
  * For follow-up messages:
    - Reference previous conversation points
    - Maintain continuity in the discussion
    - Don't repeat information already provided
    - Build on previous context
  * For new requests:
    - Start fresh with appropriate greeting
    - Don't reference previous conversations
    - Treat as a new interaction

  Data usage:
  * Always check shopifyData for relevant information
  * Use order details from shopifyData.order
  * Reference product information from shopifyData.product
  * Verify tracking information in fulfillments
  * Cross-reference information for accuracy

  For all responses, keep messages very concise and to the point, as the audience is young people`,

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

  IMPORTANT CLASSIFICATION RULES:
  1. Consider both user messages and system responses in the conversation context
  2. Maintain parameters from previous messages when clearly referring to the same order/product
  3. Reset parameters when a new order/product is mentioned
  4. Detect language (English or Spanish) based on the message content
  5. Extract all relevant parameters for each intent type
  6. For ambiguous cases, choose the most specific intent that matches

  INTENT CLASSIFICATION GUIDELINES:

  1. ORDER TRACKING:
     - When user asks about order location, status, or delivery time
     - English examples: "Where is my order?", "What's the status of my order?", "Has my order shipped?", "When will my order arrive?", "Can you track my order?", "I want to know where my package is"
     - Spanish examples: "¿Dónde está mi pedido?", "¿Estado de mi pedido?", "¿Rastrear mi pedido?", "¿Cuándo llega mi pedido?", "¿Ha sido enviado mi pedido?", "¿Puedes localizar mi pedido?", "Quiero saber dónde está mi paquete"
     - Extract: order_number, email, tracking_number

  2. DELIVERY ISSUE:
     - When user reports not receiving a delivered order or delivery problems
     - English examples: "I haven't received my order", "My package is late", "My order was marked as delivered but I don't have it", "I'm still waiting for my package", "It says delivered but I don't have it"
     - Spanish examples: "No he recibido mi pedido", "Mi paquete está retrasado", "Mi pedido aparece como entregado pero no lo tengo", "Sigo esperando mi paquete", "Dice entregado pero no lo tengo"
     - Extract: order_number, email, tracking_number, delivery_status

  3. RETURNS/EXCHANGE:
     - When user wants to return, exchange, or change a product
     - English examples: "I want to return this", "How do I exchange this?", "Can I get a refund?", "I need to change the size", "I want to send this back", "How do I return an item?"
     - Spanish examples: "Quiero devolver esto", "¿Cómo puedo cambiar esto?", "¿Puedo obtener un reembolso?", "Necesito cambiar la talla", "Quiero enviar esto de vuelta", "¿Cómo devuelvo un artículo?"
     - Extract: order_number, email, return_type, product_name, product_size
     - Set returns_website_sent to true if URL was already provided

  4. CHANGE DELIVERY:
     - When user wants to change delivery address or shipping details
     - English examples: "I need to change my delivery address", "Can you update my shipping address?", "I want to send it to a different address", "I put the wrong address", "Can you change where my order is going?"
     - Spanish examples: "Necesito cambiar mi dirección de entrega", "¿Puedes actualizar mi dirección de envío?", "Quiero enviarlo a una dirección diferente", "Puse la dirección incorrecta", "¿Puedes cambiar a dónde va mi pedido?"
     - Extract: order_number, email, new_delivery_info
     - Set delivery_address_confirmed to true ONLY if user explicitly confirms a proposed address

  5. PRODUCT SIZING:
     - When user asks about product sizes, measurements, or fit
     - English examples: "What size should I get?", "How does this fit?", "What are the measurements?", "Is this true to size?", "I'm 180cm, what size do I need?", "Does this run small or large?"
     - Spanish examples: "¿Qué talla debo comprar?", "¿Cómo va de talla?", "¿Cuáles son las medidas?", "¿Es talla real?", "Mido 180cm, ¿qué talla necesito?", "¿Va pequeño o grande?"
     - Extract: product_name, product_size, height, fit, size_query (set to "true")

  6. PRODUCT INFORMATION:
     - When user asks about product details, features, materials, or specifications
     - English examples: "What material is this made of?", "Tell me about this product", "What are the features?", "Is this waterproof?", "What colors does this come in?", "Can you tell me more about this item?"
     - Spanish examples: "¿De qué material está hecho?", "Cuéntame sobre este producto", "¿Cuáles son las características?", "¿Es impermeable?", "¿En qué colores viene?", "¿Me puedes contar más sobre este artículo?"
     - Extract: product_name, product_type
     - Look for keywords: material, features, specifications, details, information, características, especificaciones, detalles, información

  7. RESTOCK:
     - When user asks about product availability or restocking
     - English examples: "When will this be back in stock?", "Do you know when you'll restock this?", "Will you have more of this soon?", "Is this coming back?", "When can I buy this again?"
     - Spanish examples: "¿Cuándo tendrán esto de nuevo?", "¿Saben cuándo repondrán esto?", "¿Tendrán más pronto?", "¿Volverá a estar disponible?", "¿Cuándo podré comprar esto de nuevo?"
     - Extract: product_name, product_size, email
     - Normalize product_size using these rules:
       * XS, xs -> "X-SMALL"
       * S, s -> "SMALL"
       * M, m -> "MEDIUM"
       * L, l -> "LARGE"
       * XL, xl -> "EXTRA LARGE"
       * XXL, xxl -> "EXTRA EXTRA LARGE"

  8. PROMO CODE:
     - When user asks about discounts, promotions, or offers
     - English examples: "Do you have any discounts?", "Are there any promotions?", "Can I get a discount code?", "Do you offer any sales?", "Is there a coupon I can use?", "Any special offers?"
     - Spanish examples: "¿Tienen descuentos?", "¿Hay promociones?", "¿Puedo obtener un código de descuento?", "¿Hacen rebajas?", "¿Hay algún cupón que pueda usar?", "¿Ofertas especiales?"
     - Extract: email
     - Look for keywords: discount, promo, offer, sale, descuento, promoción, oferta, rebajas

  9. INVOICE REQUEST:
     - When user asks for an invoice, receipt, or billing document
     - English examples: "Can I get an invoice?", "I need a receipt", "Can you send me an invoice?", "I need a bill for my records", "Can you provide an invoice?"
     - Spanish examples: "¿Puedo obtener una factura?", "Necesito un recibo", "¿Me puedes enviar una factura?", "Necesito una factura para mis registros", "¿Puedes proporcionar una factura?"
     - Extract: order_number, email
     - Look for keywords: invoice, factura, receipt, recibo

  10. UPDATE ORDER:
      - When user wants to modify an existing order
      - English examples: "I want to update my order", "Can I change my order?", "I need to modify my purchase", "Can you update my shipping?", "I want to change what I ordered"
      - Spanish examples: "Quiero actualizar mi pedido", "¿Puedo cambiar mi pedido?", "Necesito modificar mi compra", "¿Puedes actualizar mi envío?", "Quiero cambiar lo que pedí"
      - Extract: order_number, email, update_type (shipping_address or product)

  11. CONVERSATION END:
      - When user expresses gratitude or satisfaction without further questions
      - English examples: "Thank you", "Thanks", "That's all", "Perfect", "Great, thanks", "That's helpful"
      - Spanish examples: "Gracias", "Perfecto", "Eso es todo", "Genial, gracias", "Me ha servido"
      - No parameters needed

  12. OTHER-ORDER:
      - For order-related queries that don't fit other intents
      - English examples: "What payment methods do you accept?", "Do you ship internationally?", "What's your shipping policy?", "How long does shipping take?"
      - Spanish examples: "¿Qué métodos de pago aceptan?", "¿Envían internacionalmente?", "¿Cuál es su política de envío?", "¿Cuánto tarda el envío?"
      - Extract relevant parameters if available

  13. OTHER-GENERAL:
      - For non-order related queries
      - English examples: "What's your return policy?", "Do you have a physical store?", "What are your business hours?", "Tell me about your brand"
      - Spanish examples: "¿Cuál es su política de devolución?", "¿Tienen tienda física?", "¿Cuáles son sus horarios?", "Cuéntame sobre su marca"
      - No specific parameters needed

  Output ONLY a JSON object with the following structure:
  {
    "intent": one of [
    "order_tracking"
    , "delivery_issue"
    , "returns_exchange"
    , "change_delivery"
    , "product_sizing"
    , "product_information"
    , "restock"
    , "promo_code"
    , "invoice_request"
    , "update_order"
    , "conversation_end"
    , "return_status"
    , "other-order"
    , "other-general"
    ],
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
      "product_name": "name of product being asked about",
      "product_type": "type of product being asked about or empty string",
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
      // Check if this is a follow-up message providing information requested by the system
      const isFollowUpResponse = this.isFollowUpResponse(
        classification,
        context
      );

      // Check if this is a new request after a previous conversation has concluded
      const isNewRequest = this.isNewRequest(classification, context);

      if (isFollowUpResponse) {
        // Inherit intent from previous messages if this is a follow-up
        this.inheritPreviousIntent(classification, context);
      } else if (isNewRequest) {
        // For new requests, try to classify based on the message content
        this.classifyNewRequest(classification);
      } else if (classification.intent === "other-general") {
        // For non-follow-up messages, try to inherit intent if classified as other-general
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

      // Extract order number and email from context if they're missing
      this.extractOrderInfoFromContext(classification, context);
    }

    return classification;
  }

  private isFollowUpResponse(
    classification: ClassifiedMessage,
    context: { role: string; content: string }[]
  ): boolean {
    // Check if the last system message asked for specific information
    const lastSystemMessage = [...context]
      .reverse()
      .find((msg) => msg.role === "system" || msg.role === "assistant");

    if (!lastSystemMessage) return false;

    const systemContent = lastSystemMessage.content.toLowerCase();
    const userMessage =
      classification.parameters.order_number ||
      classification.parameters.email ||
      "";

    // Check if system asked for order number and/or email
    const askedForOrderNumber =
      systemContent.includes("número de pedido") ||
      systemContent.includes("order number") ||
      systemContent.includes("#");

    const askedForEmail =
      systemContent.includes("email") || systemContent.includes("correo");

    // Check if user provided order number or email
    const providedOrderNumber =
      userMessage.includes("#") || /\d{4,}/.test(userMessage);

    const providedEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(
      userMessage
    );

    // If system asked for info and user provided it, this is likely a follow-up
    return (
      (askedForOrderNumber && providedOrderNumber) ||
      (askedForEmail && providedEmail)
    );
  }

  private isNewRequest(
    classification: ClassifiedMessage,
    context: { role: string; content: string }[]
  ): boolean {
    // Look for patterns that indicate a new request after a previous conversation
    const lastUserMessage =
      classification.parameters.order_number ||
      classification.parameters.email ||
      "";

    // Check for phrases that indicate starting a new request
    const newRequestPhrases = [
      // Spanish phrases
      "otro pedido",
      "otra orden",
      "otra cosa",
      "algo más",
      "quiero",
      "necesito",
      "tengo",
      "buscar",
      // English phrases
      "another order",
      "something else",
      "want to",
      "need to",
      "have",
      "find",
      "track",
    ];

    // Check if the message contains any of these phrases
    const containsNewRequestPhrase = newRequestPhrases.some((phrase) =>
      lastUserMessage.toLowerCase().includes(phrase)
    );

    // Check if the last system message was a conclusion to a previous request
    const lastSystemMessage = [...context]
      .reverse()
      .find((msg) => msg.role === "system" || msg.role === "assistant");

    if (!lastSystemMessage) return false;

    const systemContent = lastSystemMessage.content.toLowerCase();

    // Check if the last system message was a conclusion to a previous request
    const wasConcludingPreviousRequest =
      // Check for closing phrases
      systemContent.includes("que tengas") ||
      systemContent.includes("have a great") ||
      systemContent.includes("gracias") ||
      systemContent.includes("thank you") ||
      // Check if it was providing final information
      (systemContent.includes("pedido") &&
        (systemContent.includes("número de seguimiento") ||
          systemContent.includes("tracking number"))) ||
      (systemContent.includes("devolución") &&
        systemContent.includes("procedimiento")) ||
      (systemContent.includes("return") &&
        systemContent.includes("procedure")) ||
      (systemContent.includes("talla") &&
        systemContent.includes("recomendación")) ||
      (systemContent.includes("size") &&
        systemContent.includes("recommendation"));

    return containsNewRequestPhrase && wasConcludingPreviousRequest;
  }

  private classifyNewRequest(classification: ClassifiedMessage) {
    const userMessage =
      classification.parameters.order_number ||
      classification.parameters.email ||
      "";

    // Reset all parameters for a new request
    classification.parameters = {
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
    };

    // Check for order tracking intent
    if (
      userMessage.toLowerCase().includes("pedido") &&
      (userMessage.toLowerCase().includes("localizar") ||
        userMessage.toLowerCase().includes("donde") ||
        userMessage.toLowerCase().includes("buscar") ||
        userMessage.toLowerCase().includes("track") ||
        userMessage.toLowerCase().includes("where") ||
        userMessage.toLowerCase().includes("find"))
    ) {
      classification.intent = "order_tracking";
    }
    // Check for returns/exchange intent
    else if (
      userMessage.toLowerCase().includes("devolver") ||
      userMessage.toLowerCase().includes("cambiar") ||
      userMessage.toLowerCase().includes("return") ||
      userMessage.toLowerCase().includes("exchange") ||
      userMessage.toLowerCase().includes("devolución") ||
      userMessage.toLowerCase().includes("cambio")
    ) {
      classification.intent = "returns_exchange";
    }
    // Check for product sizing intent
    else if (
      userMessage.toLowerCase().includes("talla") ||
      userMessage.toLowerCase().includes("tamaño") ||
      userMessage.toLowerCase().includes("size") ||
      userMessage.toLowerCase().includes("fit") ||
      userMessage.toLowerCase().includes("medida")
    ) {
      classification.intent = "product_sizing";
    }
    // Check for restock intent
    else if (
      userMessage.toLowerCase().includes("disponible") ||
      userMessage.toLowerCase().includes("stock") ||
      userMessage.toLowerCase().includes("available") ||
      userMessage.toLowerCase().includes("cuando") ||
      userMessage.toLowerCase().includes("when")
    ) {
      classification.intent = "restock";
    }
    // Check for promo code intent
    else if (
      userMessage.toLowerCase().includes("descuento") ||
      userMessage.toLowerCase().includes("promo") ||
      userMessage.toLowerCase().includes("discount") ||
      userMessage.toLowerCase().includes("offer") ||
      userMessage.toLowerCase().includes("código") ||
      userMessage.toLowerCase().includes("code")
    ) {
      classification.intent = "promo_code";
    }
    // Check for invoice request intent
    else if (
      userMessage.toLowerCase().includes("factura") ||
      userMessage.toLowerCase().includes("recibo") ||
      userMessage.toLowerCase().includes("invoice") ||
      userMessage.toLowerCase().includes("receipt")
    ) {
      classification.intent = "invoice_request";
    }
    // Check for delivery issue intent
    else if (
      userMessage.toLowerCase().includes("no he recibido") ||
      userMessage.toLowerCase().includes("no llega") ||
      userMessage.toLowerCase().includes("haven't received") ||
      userMessage.toLowerCase().includes("not arrived") ||
      userMessage.toLowerCase().includes("problema") ||
      userMessage.toLowerCase().includes("problem")
    ) {
      classification.intent = "delivery_issue";
    }
    // Check for change delivery intent
    else if (
      userMessage.toLowerCase().includes("cambiar dirección") ||
      userMessage.toLowerCase().includes("nueva dirección") ||
      userMessage.toLowerCase().includes("change address") ||
      userMessage.toLowerCase().includes("new address") ||
      userMessage.toLowerCase().includes("dirección") ||
      userMessage.toLowerCase().includes("address")
    ) {
      classification.intent = "change_delivery";
    }
    // Check for update order intent
    else if (
      userMessage.toLowerCase().includes("actualizar pedido") ||
      userMessage.toLowerCase().includes("modificar pedido") ||
      userMessage.toLowerCase().includes("update order") ||
      userMessage.toLowerCase().includes("modify order") ||
      userMessage.toLowerCase().includes("cambiar pedido") ||
      userMessage.toLowerCase().includes("change order")
    ) {
      classification.intent = "update_order";
    }
    // If we couldn't classify it specifically, but it mentions "order" or "pedido",
    // it's likely an order-related query
    else if (
      userMessage.toLowerCase().includes("pedido") ||
      userMessage.toLowerCase().includes("order")
    ) {
      classification.intent = "other-order";
    }
    // If none of the above, classify as other-general
    else {
      classification.intent = "other-general";
    }
  }

  private extractOrderInfoFromContext(
    classification: ClassifiedMessage,
    context: { role: string; content: string }[]
  ) {
    // If order number or email is missing, try to extract from context
    if (
      !classification.parameters.order_number ||
      !classification.parameters.email
    ) {
      // Look for order number pattern (#12345)
      const orderNumberRegex = /#(\d{4,})/;
      // Look for email pattern
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

      for (const msg of context) {
        // Only look at user messages
        if (msg.role !== "user") continue;

        // Extract order number if missing
        if (!classification.parameters.order_number) {
          const orderMatch = msg.content.match(orderNumberRegex);
          if (orderMatch && orderMatch[1]) {
            classification.parameters.order_number = orderMatch[1];
          }
        }

        // Extract email if missing
        if (!classification.parameters.email) {
          const emailMatch = msg.content.match(emailRegex);
          if (emailMatch) {
            classification.parameters.email = emailMatch[0];
          }
        }

        // If we found both, we can stop
        if (
          classification.parameters.order_number &&
          classification.parameters.email
        ) {
          break;
        }
      }
    }
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
      throw new Error("Invalid intent");
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
        console.log("order", order);
        const essentialData = {
          order_number: order.name,
          status: order.fulfillments?.[0]?.status,
          tracking_number: order.fulfillments?.[0]?.trackingInfo[0].number,
          shipping_address: order.shippingAddress,
          created_at: order.fulfillments?.[0]?.createdAt,
          displayStatus: order.fulfillments?.[0]?.displayStatus,
          inTransitAt: order.fulfillments?.[0]?.inTransitAt,
          deliveredAt: order.fulfillments?.[0]?.deliveredAt,
          estimatedDeliveryAt: order.fulfillments?.[0]?.estimatedDeliveryAt,
        };
        console.log("essentialData", essentialData);
        shopifyDataString = JSON.stringify(essentialData, null, 2);
        console.log("shopifyDataString", shopifyDataString);
      } catch (error) {
        console.error("Error stringifying shopifyData:", error);
        shopifyDataString = "Error processing order data";
      }
    }

    const systemPrompt = `${this.SYSTEM_PROMPTS.FINAL_ANSWER}
  
  Based on the classified intent: "${intent}"
  Using the following data:

  ${JSON.stringify(parameters, null, 2)}
  ${sizeCharts ? `\nSize Chart Data:\n${sizeCharts}` : ""}
  
  User last message:
${sanitizedUserMessage}

${sanitizedContext?.length ? `Conversation Context:\n${sanitizedContext.map((msg) => msg.content).join("\n")}` : ""}

${
  shopifyData?.success && shopifyData?.order
    ? `
Order Details:
${shopifyDataString}

Tracking Details: 
${(() => {
  const order = Array.isArray(shopifyData.order)
    ? shopifyData.order[0]
    : shopifyData.order;
  const fulfillment = order?.fulfillments?.[0];

  if (!fulfillment) {
    return "No tracking information available yet.";
  }

  const trackingNumber =
    fulfillment.trackingInfo?.[0]?.number || "Not available";
  const shipmentStatus = fulfillment.displayStatus || "Pending";
  const trackingUrl = fulfillment.trackingInfo?.[0]?.url || "Not available";
  const lastUpdate = fulfillment.createdAt;
  const shipment_status = fulfillment.displayStatus;
  const inTransitAt = fulfillment.inTransitAt;
  const deliveredAt = fulfillment.deliveredAt;
  const estimatedDeliveryAt = fulfillment.estimatedDeliveryAt
    ? new Date(fulfillment.createdAt).toLocaleDateString()
    : "Not available";

  return `Tracking Number: ${trackingNumber}
          Tracking Status: ${shipmentStatus}
          Tracking Link: ${trackingUrl}
          Last Update: ${lastUpdate}
          Shipment Status: ${shipment_status}
          In Transit At: ${inTransitAt}
          Delivered At: ${deliveredAt}
          Estimated Delivery At: ${estimatedDeliveryAt}
          `;
})()}
`
    : "No order data available."
}
IMPORTANT: For delivery_issue intent, use the following shipping Details: 
$${(() => {
      if (shopifyData?.success && shopifyData?.order) {
        const order = Array.isArray(shopifyData.order)
          ? shopifyData.order[0]
          : shopifyData.order;
        const shippingAddress = order?.shippingAddress;
        if (shippingAddress) {
          return `\n**${shippingAddress.address1 || ""}${shippingAddress.address2 ? ", " + shippingAddress.address2 : ""}, ${shippingAddress.zip || ""} ${shippingAddress.city || ""}, ${shippingAddress.province || ""}, ${shippingAddress.country || ""}**\n`;
        }
        return "No shipping address available.";
      }
      return "No shipping address available.";
    })()}
  
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
      ${
        intent === "product_information"
          ? `IMPORTANT: Since this is a 'product_information' intent:
  - Extract the data from ${shopifyData?.product}
  - Maintain continuity with any previous interactions
  `
          : "Provide a concise response that directly addresses the customer's needs. If you don't have enough information, briefly ask for the specific details needed."
      }
  
  IMPORTANT GUIDELINES:
  - Do not include any introduction
  - Do not use markdown formatting or smart bolding
  - When sharing links, provide them directly (e.g., "https://example.com" instead of "[Click here](https://example.com)")
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
