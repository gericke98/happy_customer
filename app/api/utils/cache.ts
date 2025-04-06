import { logger } from "./logger";

interface CacheEntry {
  response: string;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class ResponseCache {
  private cache: Map<string, CacheEntry>;
  private readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.cache = new Map();
  }

  set(key: string, response: string, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      ttl,
    });
    logger.debug("Cached response", { key, ttl });
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      logger.debug("Cache entry expired", { key });
      return null;
    }

    logger.debug("Cache hit", { key });
    return entry.response;
  }

  clear(): void {
    this.cache.clear();
    logger.info("Cache cleared");
  }
}

// Common response templates
export const commonResponses = {
  returnsExchange: {
    es: "¡Claro! Puedes hacer el cambio o devolución en el siguiente link: https://shameless-returns-web.vercel.app. Recuerda que el número de pedido es algo como #35500 y lo puedes encontrar en el correo de confirmación de pedido.",
    en: "Sure thing! You can make the change or return in the following link: https://shameless-returns-web.vercel.app. Remember that the order number is of the form #35500 and you can find it in the order confirmation email.",
  },
  promoCodeRequest: {
    es: "Vamos a hacer una cosa, si me dejas tu email te crearé un descuento del 20% que podrás usar durante los próximos 15 minutos😊",
    en: "Perfect! If you share your email with me, I'll notify you when the product is back in stock 😊",
  },
  conversationEnd: {
    es: "¡Gracias por confiar en Shameless Collective! ¡Que tengas un buen día! 🙌✨",
    en: "Thank you for trusting Shameless Collective! Have a great day! 🙌✨",
  },
  error: {
    es: "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.",
    en: "Sorry, there was an error. Please try again later.",
  },
  openAIError: {
    es: "Lo siento, estamos experimentando una alta demanda en este momento. Por favor, intenta de nuevo en unos minutos.",
    en: "Sorry, we're experiencing high demand at the moment. Please try again in a few minutes.",
  },
};

// Create and export a singleton instance
export const responseCache = new ResponseCache();
