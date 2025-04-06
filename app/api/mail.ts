import { EmailData } from "@/types";
import axios from "axios";

function generateEmailTemplateInvoice(orderNumber: string) {
  return {
    From: "hello@shamelesscollective.com",
    To: "hello@shamelesscollective.com",
    Subject: `Factura de tu pedido ${orderNumber}`,
    TextBody: "Aquí tienes tu factura!",
    HtmlBody: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px; margin: 20px auto;">
          <!-- Spanish Section -->
          <div>
            <p style="font-size: 16px; color: #555;"><strong>Hola!</strong>,</p>
            <p style="font-size: 16px; color: #555;">
              Adjuntamos la factura de tu pedido ${orderNumber}! Muchas gracias por confiar en Shameless Collective!
            </p>
            <p style="font-size: 16px; color: #555;">
              Saludos cordiales,<br/>
              <strong>El equipo de Shameless Collective</strong>
            </p>
          </div>
        </div>
      `,
  };
}

function generateEmailTemplate(orderNumber: string, email: string) {
  return {
    From: "hello@shamelesscollective.com",
    To: "hello@shamelesscollective.com",
    Subject: "Comprobante de entrega de pedido",
    TextBody: "Your return was successfully created!",
    HtmlBody: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px; margin: 20px auto;">
          <!-- Spanish Section -->
          <div>
            <p style="font-size: 16px; color: #555;">Hola <strong>Hola!</strong>,</p>
            <p style="font-size: 16px; color: #555;">
              Puedes enviar el comprobante de entrega del pedido ${orderNumber} al siguiente correo: ${email}?
            </p>
            <p style="font-size: 16px; color: #555;">
              Saludos cordiales,<br/>
              <strong>El equipo de Shameless Collective</strong>
            </p>
          </div>
        </div>
      `,
  };
}

export async function sendEmail(
  recipientEmail: string,
  orderNumber: string,
  userEmail: string,
  pdfBuffer?: Buffer
): Promise<{ status: number; error?: string }> {
  const POSTMARK_API_URL = "https://api.postmarkapp.com/email";
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!postmarkToken) {
    return { status: 500, error: "Missing required data" };
  }

  try {
    let emailTemplate = generateEmailTemplate(orderNumber, userEmail);
    if (pdfBuffer) {
      emailTemplate = generateEmailTemplateInvoice(orderNumber);
    }
    const emailData: EmailData = {
      ...emailTemplate,
      To: recipientEmail,
      MessageStream: "outbound",
    };

    // Add attachment if PDF buffer is provided
    if (pdfBuffer) {
      emailData.Attachments = [
        {
          Name: `invoice-${orderNumber}.pdf`,
          Content: pdfBuffer.toString("base64"),
          ContentType: "application/pdf",
        },
      ];
    }

    const result = await axios.post(POSTMARK_API_URL, emailData, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": postmarkToken,
      },
    });

    return { status: result.status };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("Email error:", error.response?.data || error.message);
    } else if (error instanceof Error) {
      console.error("Email error:", error.message);
    }
    return { status: 500, error: "Failed to send email" };
  }
}
