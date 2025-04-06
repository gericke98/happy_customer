export type Intent =
  | "order_tracking"
  | "returns_exchange"
  | "delivery_issue"
  | "change_delivery"
  | "product_sizing"
  | "update_order"
  | "other-order"
  | "restock"
  | "conversation_end"
  | "promo_code"
  | "invoice_request"
  | "other-general";

export interface MessageParameters {
  // Order related
  order_number: string;
  email: string;
  product_handle: string;

  // Delivery related
  new_delivery_info: string;
  delivery_status: string;
  tracking_number: string;
  delivery_address_confirmed: boolean;

  // Returns related
  return_type: string;
  return_reason: string;
  returns_website_sent: boolean;

  // Product related
  product_type: string;
  product_name: string;
  product_size: string;
  fit: string;
  size_query: string;

  // Order updates
  update_type: string;

  // Customer info
  height: string;
  weight: string;
  usual_size: string;
}

export interface ClassifiedMessage {
  intent: Intent;
  parameters: MessageParameters;
  language: string;
}

export interface APIResponse<T = unknown> {
  data?: T;
  error?: {
    message: string;
    code: string;
  };
  requestId: string;
  timestamp: string;
}
