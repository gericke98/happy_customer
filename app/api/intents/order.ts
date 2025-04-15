import { MessageParameters } from "@/app/types/api";
import {
  extractCompleteOrder,
  trackOrder,
  updateShippingAddress,
} from "../../queries/order";
import { aiService } from "../ai";
import { logger } from "../utils/logger";
import {
  NoOrderNumberOrEmail,
  InvalidCredentials,
  validateOrderParameters,
  handleOpenAIError,
  getLanguageSpecificResponse,
} from "./utils";
import { sendEmail } from "../mail";
import { OpenAIMessage, Order } from "@/types";
import { responseCache, commonResponses } from "../utils/cache";

export async function handleOrderTracking(
  parameters: MessageParameters,
  context: OpenAIMessage[],
  language: string
): Promise<string> {
  const { order_number, email } = parameters;
  logger.info("Handling order tracking request", {
    order_number,
    email,
    language,
  });

  try {
    // Validate parameters
    if (!validateOrderParameters(parameters)) {
      logger.warn("Invalid order parameters", { order_number, email });
      return await NoOrderNumberOrEmail(language);
    }

    // Check cache for common responses
    const cacheKey = `order_tracking_${order_number}_${email}_${language}`;
    const cachedResponse = responseCache.get(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Get order data
    const shopifyData = await extractCompleteOrder(order_number, email);
    if (!shopifyData.success) {
      logger.error(
        "Failed to extract order data",
        new Error(shopifyData.error),
        {
          order_number,
          email,
        }
      );
      return await InvalidCredentials(language, shopifyData.error);
    }

    if (!shopifyData.order) {
      logger.warn("Order not found", { order_number, email });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre tu pedido."
        : "Sorry, I couldn't find information about your order.";
    }

    // Check if order has been in the same status for more than 5 business days
    const order = shopifyData.order;
    const lastUpdate = order.fulfillments?.[0]?.created_at || order.created_at;
    const lastUpdateDate = new Date(lastUpdate);
    const today = new Date();
    const businessDays = calculateBusinessDays(lastUpdateDate, today);

    // Add delay information to parameters
    parameters.delivery_status = businessDays > 5 ? "delayed" : "normal";

    // Generate response using AI
    const response = await aiService.generateFinalAnswer(
      "order_tracking",
      parameters,
      shopifyData,
      context[context.length - 1].content,
      context,
      language
    );

    // Cache the response for 5 minutes
    responseCache.set(cacheKey, response, 5 * 60 * 1000);
    return response;
  } catch (error) {
    logger.error("Error handling order tracking", error as Error, {
      order_number,
      email,
      language,
    });
    return getLanguageSpecificResponse(
      commonResponses.error.es,
      commonResponses.error.en,
      language
    );
  }
}

// Helper function to calculate business days between two dates
function calculateBusinessDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const curDate = new Date(startDate.getTime());
  while (curDate <= endDate) {
    const dayOfWeek = curDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    curDate.setDate(curDate.getDate() + 1);
  }
  return count;
}

export async function handleDeliveryIssue(
  parameters: MessageParameters,
  message: string,
  context: OpenAIMessage[],
  language: string
): Promise<string> {
  const { order_number, email } = parameters;
  logger.info("Handling delivery issue request", {
    order_number,
    email,
    language,
  });

  try {
    if (!validateOrderParameters(parameters)) {
      logger.warn("Invalid order parameters for delivery issue", {
        order_number,
        email,
      });
      return await NoOrderNumberOrEmail(language);
    }

    const shopifyData = await trackOrder(order_number, email);
    if (!shopifyData.success) {
      logger.error(
        "Failed to track order for delivery issue",
        new Error(shopifyData.error),
        { order_number, email }
      );
      return await InvalidCredentials(language, shopifyData.error);
    }

    if (!shopifyData.order) {
      logger.warn("Order not found for delivery issue", {
        order_number,
        email,
      });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre tu pedido."
        : "Sorry, I couldn't find information about your order.";
    }

    // Send notification email
    if (parameters.order_number && parameters.email) {
      try {
        logger.info("Sending delivery issue notification email", {
          order_number,
          email,
        });
        await sendEmail(
          "hello@shamelesscollective.com",
          parameters.order_number,
          parameters.email
        );
        logger.info("Successfully sent delivery issue notification", {
          order_number,
          email,
        });
      } catch (error) {
        logger.error(
          "Failed to send delivery issue notification",
          error as Error,
          {
            order_number,
            email,
          }
        );
        // Continue with the flow even if email fails
      }
    }

    try {
      return await aiService.generateFinalAnswer(
        "delivery_issue",
        parameters,
        shopifyData,
        message,
        context,
        language
      );
    } catch (error) {
      return handleOpenAIError(error, language);
    }
  } catch (error) {
    logger.error("Error handling delivery issue", error as Error, {
      order_number,
      email,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error processing your request. Please try again later.";
  }
}

export async function handleChangeDelivery(
  parameters: MessageParameters,
  message: string,
  context: OpenAIMessage[],
  language: string
): Promise<string> {
  const { order_number, email, new_delivery_info, delivery_address_confirmed } =
    parameters;
  logger.info("Handling delivery address change request", {
    order_number,
    email,
    language,
  });

  try {
    if (!validateOrderParameters(parameters)) {
      logger.warn("Invalid order parameters for delivery change", {
        order_number,
        email,
      });
      return await NoOrderNumberOrEmail(language);
    }

    const shopifyData = await extractCompleteOrder(order_number, email);
    if (!shopifyData.success) {
      logger.error(
        "Failed to extract order data for delivery change",
        new Error(shopifyData.error),
        { order_number, email }
      );
      return await InvalidCredentials(language, shopifyData.error);
    }

    if (!shopifyData.order) {
      logger.warn("Order not found for delivery change", {
        order_number,
        email,
      });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre tu pedido."
        : "Sorry, I couldn't find information about your order.";
    }

    const order = shopifyData.order;
    const hasFulfillments = order.fulfillments?.length > 0;

    if (!new_delivery_info) {
      logger.debug("No new delivery info provided", { order_number, email });
      try {
        return await aiService.confirmDeliveryAddress(
          parameters,
          message,
          context,
          language
        );
      } catch (error) {
        return handleOpenAIError(error, language);
      }
    }

    try {
      const addressValidation =
        await aiService.validateAddress(new_delivery_info);
      if (!addressValidation.formattedAddress) {
        logger.warn("Invalid delivery address format", {
          order_number,
          email,
          new_delivery_info,
        });
        return await aiService.confirmDeliveryAddress(
          parameters,
          message,
          context,
          language
        );
      }

      if (delivery_address_confirmed) {
        if (!hasFulfillments) {
          // Order not yet shipped
          try {
            logger.info("Updating shipping address for unshipped order", {
              order_number,
              email,
              new_address: addressValidation.formattedAddress,
            });
            await updateShippingAddress(
              order.admin_graphql_api_id,
              addressValidation.formattedAddress,
              {
                first_name: order.shipping_address.first_name || "",
                last_name: order.shipping_address.last_name || "",
                phone: order.shipping_address.phone || "",
              }
            );
            logger.info("Successfully updated shipping address", {
              order_number,
              email,
            });

            return language === "Spanish"
              ? `¡Perfecto! He actualizado la dirección de envío a:\n\n${addressValidation.formattedAddress}\n\n¡Tu pedido se enviará a esta nueva dirección! 📦✨`
              : `Perfect! I've updated the shipping address to:\n\n${addressValidation.formattedAddress}\n\nYour order will be shipped to this new address! 📦✨`;
          } catch (error) {
            logger.error("Failed to update shipping address", error as Error, {
              order_number,
              email,
              new_address: addressValidation.formattedAddress,
            });
            return language === "Spanish"
              ? "Lo siento, ha ocurrido un error al actualizar la dirección. Por favor, intenta de nuevo más tarde."
              : "Sorry, there was an error updating the address. Please try again later.";
          }
        } else {
          // Order already shipped - initiate call to shipping company
          return await handleShippedOrderAddressChange(
            order,
            addressValidation.formattedAddress,
            language
          );
        }
      }

      return await aiService.confirmDeliveryAddress(
        parameters,
        message,
        context,
        language
      );
    } catch (error) {
      return handleOpenAIError(error, language);
    }
  } catch (error) {
    logger.error("Error handling delivery address change", error as Error, {
      order_number,
      email,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error processing your request. Please try again later.";
  }
}

async function handleShippedOrderAddressChange(
  order: Order,
  newAddress: string,
  language: string
): Promise<string> {
  try {
    const phoneNumber = "+34608667749";
    logger.info("Initiating delivery address change call", {
      order_number: order.name,
      new_address: newAddress,
    });

    const callPrompt = `Eres una persona llamada Silvia. Estás llamando a una empresa de envíos para modificar la dirección de envío de tu paquete. Responde en 3 a 7 oraciones en la mayoría de los casos.
            Si te pregunta, aquí tienes información adicional sobre el pedido: 
            - Número de seguimiento ${order.fulfillments[0].tracking_number}
            - Nueva dirección de entrega: ${newAddress}
            Actúa como el cliente y no como un agente, es decir, la persona a la que llamas te tiene que dar la solución, tú no le tienes que ayudar en resolver sus problemas.`;

    const firstMessage =
      language === "Spanish"
        ? `Hola, soy Silvia. Llamo para cambiar la dirección de envío de mi pedido`
        : `Hello, this is Silvia. I'm calling to change the delivery address of my order.`;

    const callResponse = await fetch(
      `${process.env.OUTBOUND_CALL_URL || "https://c110-81-33-205-107.ngrok-free.app"}/outbound-call`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: callPrompt,
          first_message: firstMessage,
          number: phoneNumber,
        }),
      }
    );

    if (!callResponse.ok) {
      throw new Error(`HTTP error! status: ${callResponse.status}`);
    }

    const callData = await callResponse.json();
    if (!callData.success) {
      throw new Error(callData.error || "Failed to initiate call");
    }

    const callSid = callData.callSid;
    let callCompleted = false;
    const maxWaitTime = 300; // 5 minutes
    let waitedTime = 0;

    while (!callCompleted && waitedTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      waitedTime += 5;

      try {
        const statusResponse = await fetch(
          `${process.env.OUTBOUND_CALL_URL || "https://c110-81-33-205-107.ngrok-free.app"}/call-status/${callSid}`
        );

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (
            statusData.status === "completed" ||
            statusData.status === "failed" ||
            statusData.status === "busy" ||
            statusData.status === "no-answer" ||
            statusData.status === "canceled"
          ) {
            callCompleted = true;
            logger.info("Call completed", {
              order_number: order.name,
              status: statusData.status,
            });
          }
        }
      } catch (error) {
        logger.error("Error checking call status", error as Error, {
          order_number: order.name,
          callSid,
        });
      }
    }

    if (!callCompleted) {
      logger.warn("Call timed out", { order_number: order.name, callSid });
      return language === "Spanish"
        ? "Lo siento, no pude contactar con la empresa de envíos. Por favor, intenta llamar más tarde."
        : "I'm sorry, I couldn't contact the shipping company. Please try calling later.";
    }

    return language === "Spanish"
      ? "¡Perfecto! He iniciado el proceso de cambio de dirección con la empresa de envíos. Te contactarán pronto para confirmar los detalles."
      : "Perfect! I've initiated the address change process with the shipping company. They'll contact you soon to confirm the details.";
  } catch (error) {
    logger.error(
      "Error initiating delivery address change call",
      error as Error,
      { order_number: order.name }
    );
    return language === "Spanish"
      ? "Lo siento, ha habido un error al intentar cambiar la dirección de envío. Por favor, intenta llamar más tarde."
      : "I'm sorry, there was an error trying to change the delivery address. Please try calling later.";
  }
}

export async function handleUpdateOrder(
  parameters: MessageParameters,
  message: string,
  context: OpenAIMessage[],
  language: string
): Promise<string> {
  const { order_number, email, update_type } = parameters;
  logger.info("Handling order update request", {
    order_number,
    email,
    update_type,
    language,
  });

  try {
    if (!validateOrderParameters(parameters)) {
      logger.warn("Invalid order parameters for update", {
        order_number,
        email,
      });
      return await NoOrderNumberOrEmail(language);
    }

    const shopifyData = await extractCompleteOrder(order_number, email);
    if (!shopifyData.success) {
      logger.error(
        "Failed to extract order data for update",
        new Error(shopifyData.error),
        { order_number, email }
      );
      return await InvalidCredentials(language, shopifyData.error);
    }

    if (!shopifyData.order) {
      logger.warn("Order not found for update", { order_number, email });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre tu pedido."
        : "Sorry, I couldn't find information about your order.";
    }

    logger.info("Successfully retrieved order data for update", {
      order_number,
      email,
      update_type,
    });

    return await aiService.generateFinalAnswer(
      "update_order",
      parameters,
      shopifyData,
      message,
      context,
      language
    );
  } catch (error) {
    logger.error("Error handling order update", error as Error, {
      order_number,
      email,
      update_type,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error processing your request. Please try again later.";
  }
}
