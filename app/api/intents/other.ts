import { MessageParameters } from "@/app/types/api";
import {
  getLanguageSpecificResponse,
  InvalidCredentials,
  NoOrderNumberOrEmail,
} from "./utils";
import {
  createPromoCode,
  extractCompleteOrder,
  insertCustomer,
} from "../../queries/order";
import { InvoiceData } from "@/types";
import { sendEmail } from "../mail";
import { jsPDF } from "jspdf";
import { logger } from "../utils/logger";
import { responseCache, commonResponses } from "../utils/cache";

export async function handleReturnsExchange(language: string): Promise<string> {
  try {
    logger.info("Handling returns/exchange request", { language });

    // Check cache first
    const cacheKey = `returns_exchange_${language}`;
    const cachedResponse = responseCache.get(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    // If not in cache, get response and cache it
    const response = getLanguageSpecificResponse(
      commonResponses.returnsExchange.es,
      commonResponses.returnsExchange.en,
      language
    );

    responseCache.set(cacheKey, response);
    return response;
  } catch (error) {
    logger.error("Error handling returns/exchange request", error as Error, {
      language,
    });
    return getLanguageSpecificResponse(
      commonResponses.error.es,
      commonResponses.error.en,
      language
    );
  }
}

export async function handlePromoCode(
  parameters: Partial<MessageParameters>,
  language: string
): Promise<string> {
  const { email } = parameters;
  logger.info("Handling promo code request", { email, language });

  try {
    if (!email || typeof email !== "string") {
      logger.debug("No email provided for promo code request");
      return getLanguageSpecificResponse(
        commonResponses.promoCodeRequest.es,
        commonResponses.promoCodeRequest.en,
        language
      );
    }

    // Create customer
    const response = await insertCustomer(email);
    if (response.error === "Email has already been taken") {
      logger.info("Customer already exists, creating promo code", { email });
      const promoCode = await createPromoCode();
      if (promoCode.success) {
        logger.info("Successfully created promo code for existing customer", {
          email,
          code: promoCode.code,
        });
        return language === "Spanish"
          ? `Aquí tienes tu descuento del 20%: ${promoCode.code}. Hemos visto que ya eres cliente nuestro, así que te lo regalamos. No se lo digas a nadie! Caduca en 15 minutos por lo que aprovéchalo!`
          : `Here's your 20% discount code: ${promoCode.code}. We've seen that you're already a customer, so we're giving it to you for free. Don't tell anyone! It expires in 15 minutes so take advantage of it!`;
      } else {
        logger.error(
          "Failed to create promo code for existing customer",
          new Error(promoCode.error),
          { email }
        );
        return language === "Spanish"
          ? "Lo siento, ha ocurrido un error al crear el descuento. ¿Podrías intentarlo de nuevo?"
          : "I'm sorry, there was an error creating the discount. Could you please try again?";
      }
    }

    if (response.success) {
      logger.info("Successfully created new customer", { email });
      const promoCode = await createPromoCode();
      if (promoCode.success) {
        logger.info("Successfully created promo code for new customer", {
          email,
          code: promoCode.code,
        });
        return language === "Spanish"
          ? `Aquí tienes tu descuento del 20%: ${promoCode.code}. No se lo digas a nadie! Caduca en 15 minutos por lo que aprovéchalo!`
          : `Here's your 20% discount code: ${promoCode.code}. Don't tell anyone! It expires in 15 minutes so take advantage of it!`;
      } else {
        logger.error(
          "Failed to create promo code for new customer",
          new Error(promoCode.error),
          { email }
        );
        return language === "Spanish"
          ? "Lo siento, ha ocurrido un error al crear el descuento. ¿Podrías intentarlo de nuevo?"
          : "I'm sorry, there was an error creating the discount. Could you please try again?";
      }
    }

    logger.error("Failed to create customer", new Error(response.error), {
      email,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error al crear el descuento. ¿Podrías intentarlo de nuevo?"
      : "I'm sorry, there was an error creating the discount. Could you please try again?";
  } catch (error) {
    logger.error("Error handling promo code request", error as Error, {
      email,
      language,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error. Please try again later.";
  }
}

export async function handleInvoiceRequest(
  parameters: Partial<MessageParameters>,
  language: string
): Promise<string> {
  const { order_number, email } = parameters;
  logger.info("Handling invoice request", { order_number, email, language });

  try {
    if (!order_number || !email) {
      logger.warn("Missing order number or email for invoice request");
      return await NoOrderNumberOrEmail(language);
    }

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
      logger.warn("Order not found for invoice request", {
        order_number,
        email,
      });
      return language === "Spanish"
        ? "Lo siento, no he podido encontrar información sobre tu pedido."
        : "Sorry, I couldn't find information about your order.";
    }

    const { billing_address, line_items, total_price, created_at } =
      shopifyData.order;

    // Prepare invoice data
    const invoiceData: InvoiceData = {
      name: `${billing_address.name}`,
      direccion: billing_address.address1,
      auxiliarAddress: `${billing_address.city}, ${billing_address.province}, ${billing_address.zip}`,
      phone: billing_address.phone || null,
      invoiceNumber: order_number,
      date: new Date(created_at).toLocaleDateString(),
      pedidoList: line_items.map((item) => ({
        name: item.title,
        quantity: item.quantity.toString(),
        price: `${item.price} €`,
        total: `${(parseFloat(item.price) * item.quantity).toFixed(2)} €`,
      })),
      ivaBool: true,
      subtotalInput: parseFloat(total_price),
    };

    try {
      logger.info("Generating invoice", { order_number, email });
      const pdfBuffer = await generateInvoice(invoiceData);

      logger.info("Sending invoice email", { order_number, email });
      await sendEmail(
        email,
        invoiceData.invoiceNumber,
        "Please find your invoice attached",
        pdfBuffer
      );

      logger.info("Successfully sent invoice", { order_number, email });
      return language === "Spanish"
        ? "¡Perfecto! Te he enviado la factura por email 📧"
        : "Perfect! I've sent the invoice to your email 📧";
    } catch (error) {
      logger.error("Error generating or sending invoice", error as Error, {
        order_number,
        email,
      });
      return language === "Spanish"
        ? "Lo siento, ha habido un error generando la factura. Por favor, inténtalo de nuevo más tarde."
        : "Sorry, there was an error generating the invoice. Please try again later.";
    }
  } catch (error) {
    logger.error("Error handling invoice request", error as Error, {
      order_number,
      email,
      language,
    });
    return language === "Spanish"
      ? "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
      : "Sorry, there was an error. Please try again later.";
  }
}

const generateInvoice = async (data: InvoiceData): Promise<Buffer> => {
  try {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Set initial position and margins
    let y = 20;
    let y1 = y;
    const leftMargin = 20;
    const centerMargin = 105;
    const rightMargin = 190;
    const lineHeight = 6;

    // Title
    doc.setFontSize(16);
    doc.text("FACTURA", rightMargin, y, { align: "right" });
    y += lineHeight * 2;
    doc.text(data.invoiceNumber, rightMargin, y, { align: "right" });
    y += lineHeight;
    doc.text(data.date, rightMargin, y, { align: "right" });

    y += lineHeight * 3;
    y1 = y;
    // Client data
    doc.setFontSize(12);
    doc.text("Datos del cliente", leftMargin, y);
    y += lineHeight * 2;
    doc.setFontSize(10);
    doc.text(data.name, leftMargin, y);
    y += lineHeight;
    doc.text(data.direccion, leftMargin, y);
    y += lineHeight;
    doc.text(data.auxiliarAddress, leftMargin, y);
    if (data.phone) {
      y += lineHeight;
      doc.text(data.phone, leftMargin, y);
    }

    // Company data
    doc.setFontSize(12);
    doc.text("Datos", rightMargin, y1, { align: "right" });
    y1 += lineHeight * 2;
    doc.setFontSize(10);
    doc.text("CORISA TEXTIL S.L.", rightMargin, y1, { align: "right" });
    y1 += lineHeight;
    doc.text("B02852895", rightMargin, y1, { align: "right" });
    y1 += lineHeight;
    doc.text("Calle Neptuno 29", rightMargin, y1, { align: "right" });
    y1 += lineHeight;
    doc.text("Pozuelo de Alarcón, Madrid, 28224", rightMargin, y1, {
      align: "right",
    });
    y1 += lineHeight;
    doc.text("(+34) 608667749", rightMargin, y1, { align: "right" });

    // Table headers
    y = y1 + 50;
    doc.setFontSize(12);
    doc.text("ARTÍCULOS", leftMargin, y);
    doc.text("CANTIDAD", centerMargin - 20, y);
    doc.text("PRECIO", centerMargin + 20, y);
    doc.text("TOTAL", rightMargin, y, { align: "right" });

    // Draw table lines
    doc.setLineWidth(0.5);
    doc.line(leftMargin, y - 5, rightMargin, y - 5);
    doc.line(leftMargin, y + 5, rightMargin, y + 5);

    // Order items
    y += lineHeight * 2;
    let subtotal = 0;
    data.pedidoList.forEach((item) => {
      doc.setFontSize(10);
      doc.text(item.name, leftMargin, y);
      doc.text(item.quantity, centerMargin - 20, y);
      doc.text(item.price, centerMargin + 20, y);
      doc.text(item.total, rightMargin, y, { align: "right" });

      subtotal += parseFloat(item.total.slice(0, -2));
      y += lineHeight * 1.5;
    });

    // Totals calculation
    const subtotalBase = data.subtotalInput / 1.21;
    subtotal = Math.round(subtotalBase * 100) / 100;
    const iva = data.ivaBool ? Math.round(0.21 * subtotal * 100) / 100 : 0;
    const total = subtotal + iva;

    // Footer totals
    y += lineHeight;
    doc.setFontSize(12);
    doc.text("Subtotal", centerMargin + 20, y);
    doc.text(`${subtotal} €`, rightMargin, y, { align: "right" });
    y += lineHeight * 2;
    doc.text("IVA", centerMargin + 20, y);
    doc.text(`${iva} €`, rightMargin, y, { align: "right" });
    y += lineHeight * 2;
    doc.text("TOTAL", centerMargin + 20, y);
    doc.text(`${total} €`, rightMargin, y, { align: "right" });

    // Get the PDF as a buffer
    return Buffer.from(doc.output("arraybuffer"));
  } catch (error) {
    logger.error("Error generating invoice PDF", error as Error, {
      invoice_number: data.invoiceNumber,
    });
    throw error;
  }
};
