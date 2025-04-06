import { MessageParameters } from "@/app/types/api";
import { extractProduct, insertCustomer } from "@/app/queries/order";
import { logger } from "../utils/logger";
import {
  ProductVariant,
  ShopifyProduct,
  SizeChart,
  MeasurementType,
} from "@/types";

// Example size chart for different product types
const sizeCharts: Record<string, SizeChart> = {
  CREWNECK: {
    sizes: ["XS", "S", "M", "L", "XL"],
    measurements: [
      {
        name: "Chest",
        unit: "cm",
        values: {
          XS: 64,
          S: 67,
          M: 70,
          L: 73,
          XL: 76,
        },
      },
      {
        name: "Length",
        unit: "cm",
        values: {
          XS: 65,
          S: 68,
          M: 71,
          L: 74,
          XL: 77,
        },
      },
      {
        name: "Sleeve",
        unit: "cm",
        values: {
          XS: 47,
          S: 48,
          M: 49,
          L: 50,
          XL: 51,
        },
      },
    ],
    productType: "Crewneck",
  },
  SWEATSHIRT: {
    sizes: ["S", "M", "L", "XL"],
    measurements: [
      {
        name: "Chest",
        unit: "cm",
        values: {
          S: 67,
          M: 69,
          L: 71,
          XL: 73,
        },
      },
      {
        name: "Length",
        unit: "cm",
        values: {
          S: 65,
          M: 68,
          L: 71,
          XL: 74,
        },
      },
      {
        name: "Sleeve",
        unit: "cm",
        values: {
          S: 58,
          M: 60,
          L: 62,
          XL: 64,
        },
      },
    ],
    productType: "Sweatshirt",
  },
  HOODIE: {
    sizes: ["S", "M", "L", "XL"],
    measurements: [
      {
        name: "Chest",
        unit: "cm",
        values: {
          S: 67,
          M: 69,
          L: 71,
          XL: 73,
        },
      },
      {
        name: "Length",
        unit: "cm",
        values: {
          S: 65,
          M: 68,
          L: 71,
          XL: 74,
        },
      },
      {
        name: "Sleeve",
        unit: "cm",
        values: {
          S: 58,
          M: 60,
          L: 62,
          XL: 64,
        },
      },
    ],
    productType: "Hoodie",
  },
  POLO: {
    sizes: ["XS", "S", "M", "L", "XL"],
    measurements: [
      {
        name: "Chest",
        unit: "cm",
        values: {
          XS: 64,
          S: 66,
          M: 68,
          L: 70,
          XL: 72,
        },
      },
      {
        name: "Length",
        unit: "cm",
        values: {
          XS: 63,
          S: 66,
          M: 69,
          L: 71,
          XL: 74,
        },
      },
      {
        name: "Sleeve",
        unit: "cm",
        values: {
          XS: 48,
          S: 49,
          M: 50,
          L: 51,
          XL: 52,
        },
      },
    ],
    productType: "Polo",
  },
};

interface ChatMessage {
  role: string;
  content: string;
}

export async function handleProductInquiry(
  parameters: Partial<MessageParameters>,
  message: string,
  context: ChatMessage[],
  language: string
): Promise<string> {
  const { product_name, height, fit } = parameters;
  logger.info("Handling product inquiry", {
    product_name,
    height,
    fit,
    language,
  });

  // First check if we have a product name
  if (!product_name) {
    logger.debug("No product name provided for inquiry");
    return language === "Spanish"
      ? "¿Sobre qué producto te gustaría saber la talla?"
      : "Which product would you like to know the size for?";
  }

  try {
    const shopifyData = await extractProduct(product_name);
    logger.debug("Product data retrieved", { success: shopifyData?.success });

    if (!shopifyData) {
      logger.error(
        "Failed to fetch product data",
        new Error("No data returned"),
        { product_name }
      );
      return language === "Spanish"
        ? "Lo siento, ha ocurrido un error al buscar el producto. Por favor, intenta de nuevo más tarde."
        : "Sorry, there was an error searching for the product. Please try again later.";
    }

    // For size queries, we need both product data and size-related parameters
    if (shopifyData.success && shopifyData.product) {
      let product_type = "CREWNECK"; // default type

      // Type guard to ensure we have a valid product with title
      const product = shopifyData.product;
      if (
        typeof product === "object" &&
        product !== null &&
        "title" in product &&
        typeof product.title === "string"
      ) {
        const upperTitle = product.title.toUpperCase();
        if (upperTitle.includes("HOODIE")) {
          product_type = "HOODIE";
        } else if (upperTitle.includes("SWEATSHIRT")) {
          product_type = "SWEATSHIRT";
        } else if (upperTitle.includes("POLO")) {
          product_type = "POLO";
        }
        logger.debug("Product type determined", {
          product_type,
          title: product.title,
        });
      }

      // If asking about sizing, we need height and fit preference
      const productTitle =
        shopifyData?.product && "title" in shopifyData.product
          ? shopifyData.product.title
          : "";

      if (!height || !fit) {
        logger.debug("Missing size parameters", { height, fit });
        return language === "Spanish"
          ? `Para ayudarte a encontrar la talla perfecta del ${productTitle}, necesito saber tu altura y si prefieres un ajuste más ajustado o más holgado. ¿Podrías proporcionarme esta información?`
          : `To help you find the perfect size for the ${productTitle}, I need to know your height and if you prefer a tighter or looser fit. Could you provide this information?`;
      }

      // Get size chart for the product type
      const sizeChart = sizeCharts[product_type];
      if (!sizeChart) {
        logger.warn("No size chart found for product type", { product_type });
        return language === "Spanish"
          ? "Lo siento, no tengo una tabla de tallas para este tipo de producto."
          : "Sorry, I don't have a size chart for this type of product.";
      }

      // Calculate recommended size based on height and fit preference
      const heightNum = parseInt(height);
      if (isNaN(heightNum)) {
        logger.warn("Invalid height value provided", { height });
        return language === "Spanish"
          ? "Lo siento, no pude entender la altura proporcionada. ¿Podrías especificarla en centímetros?"
          : "Sorry, I couldn't understand the height provided. Could you specify it in centimeters?";
      }

      let recommendedSize: string;
      if (heightNum < 170) {
        recommendedSize = fit === "tight" ? "XS" : "S";
      } else if (heightNum < 180) {
        recommendedSize = fit === "tight" ? "S" : "M";
      } else if (heightNum < 190) {
        recommendedSize = fit === "tight" ? "M" : "L";
      } else {
        recommendedSize = fit === "tight" ? "L" : "XL";
      }

      // Get measurements for the recommended size
      const measurements = sizeChart.measurements
        .map(
          (m: MeasurementType) =>
            `${m.name}: ${m.values[recommendedSize as keyof typeof m.values]}${m.unit}`
        )
        .join(", ");

      logger.info("Size recommendation generated", {
        product_name,
        height: heightNum,
        fit,
        recommended_size: recommendedSize,
      });

      return language === "Spanish"
        ? `Basado en tu altura de ${heightNum}cm y preferencia de ajuste ${fit}, te recomiendo la talla ${recommendedSize}. Las medidas son: ${measurements}. ¿Te gustaría que te ayude a comprarlo?`
        : `Based on your height of ${heightNum}cm and ${fit} fit preference, I recommend size ${recommendedSize}. The measurements are: ${measurements}. Would you like help purchasing it?`;
    }
  } catch (error) {
    logger.error("Error handling product inquiry", error as Error, {
      product_name,
      height,
      fit,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error. Please try again later.";
  }

  logger.warn("Product not found or invalid data", { product_name });
  return language === "Spanish"
    ? "Lo siento, no he podido encontrar información sobre ese producto."
    : "Sorry, I couldn't find information about that product.";
}

export async function handleProductInquiryRestock(
  parameters: Partial<MessageParameters>,
  language: string
): Promise<string> {
  const { product_name, email } = parameters;
  logger.info("Handling product restock inquiry", {
    product_name,
    email,
    language,
  });

  if (!product_name) {
    logger.debug("No product name provided for restock inquiry");
    return language === "Spanish"
      ? "¿De qué producto te gustaría saber la disponibilidad?"
      : "Which product would you like to know the availability of?";
  }

  try {
    const shopifyData = await extractProduct(product_name);
    logger.debug("Product data retrieved for restock", {
      success: shopifyData?.success,
    });

    if (!shopifyData) {
      logger.error(
        "Failed to fetch product data",
        new Error("No data returned"),
        { product_name }
      );
      return language === "Spanish"
        ? "Lo siento, ha ocurrido un error al buscar el producto. Por favor, intenta de nuevo más tarde."
        : "Sorry, there was an error searching for the product. Please try again later.";
    }

    if (!shopifyData.success || !shopifyData.product) {
      logger.warn("Product not found or invalid data", { product_name });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre ese producto."
        : "Sorry, I couldn't find information about that product.";
    }

    const product = shopifyData.product;
    if (
      typeof product === "object" &&
      product !== null &&
      "title" in product &&
      typeof product.title === "string"
    ) {
      const productTitle = product.title;
      const variants =
        "variants" in product ? (product as ShopifyProduct).variants || [] : [];
      const availableVariants = variants.filter(
        (variant: ProductVariant) => variant.inventory_quantity > 0
      );

      if (availableVariants.length > 0) {
        logger.info("Product is in stock", {
          product_name,
          available_variants: availableVariants.length,
        });
        return language === "Spanish"
          ? `¡Sí! El ${productTitle} está disponible en nuestra tienda. ¿Te gustaría que te ayude a comprarlo?`
          : `Yes! The ${productTitle} is available in our store. Would you like help purchasing it?`;
      } else {
        logger.info("Product is out of stock", { product_name });
        if (!email) {
          return language === "Spanish"
            ? `El ${productTitle} está agotado en este momento. Si me dejas tu email, te avisaré cuando vuelva a estar disponible 😊`
            : `The ${productTitle} is currently out of stock. If you share your email with me, I'll notify you when it's back in stock 😊`;
        }

        try {
          // Create customer
          const response = await insertCustomer(email);
          if (response.success) {
            logger.info(
              "Successfully added customer to restock notification list",
              { email, product_name }
            );
            return language === "Spanish"
              ? `¡Perfecto! Te avisaré cuando el ${productTitle} vuelva a estar disponible 😊`
              : `Perfect! I'll notify you when the ${productTitle} is back in stock 😊`;
          } else {
            logger.error(
              "Failed to add customer to restock notification list",
              new Error(response.error),
              { email, product_name }
            );
            return language === "Spanish"
              ? "Lo siento, ha ocurrido un error. ¿Podrías intentarlo de nuevo?"
              : "I'm sorry, there was an error. Could you please try again?";
          }
        } catch (error) {
          logger.error(
            "Error creating customer for restock notification",
            error as Error,
            { email, product_name }
          );
          return language === "Spanish"
            ? "Lo siento, ha ocurrido un error. ¿Podrías intentarlo de nuevo?"
            : "I'm sorry, there was an error. Could you please try again?";
        }
      }
    }
  } catch (error) {
    logger.error("Error handling product restock inquiry", error as Error, {
      product_name,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error. Please try again later.";
  }

  logger.warn("Product not found or invalid data for restock", {
    product_name,
  });
  return language === "Spanish"
    ? "Lo siento, no he podido encontrar información sobre ese producto."
    : "Sorry, I couldn't find information about that product.";
}
