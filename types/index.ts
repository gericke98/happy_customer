// Define the supported intents.
export type Intent =
  | "order_tracking"
  | "product_inquiry"
  | "returns_exchange"
  | "product_information"
  | "change_delivery"
  | "return_status"
  | "promo_code"
  | "returns_policy"
  | "delivery_issue"
  | "product_sizing"
  | "conversation_end"
  | "other-general"
  | "restock"
  | "other-order"
  | "update_order"
  | "invoice_request";

export type ClassifiedMessage = {
  intent: Intent;
  parameters: {
    order_number: string;
    email: string;
    product_handle: string;
    new_delivery_info: string;
    delivery_status: string;
    tracking_number: string;
    delivery_address_confirmed: boolean;
    return_type: string;
    returns_website_sent: boolean;
    product_name: string;
    size_query: string;
    update_type: string;
    height: string;
    fit: string;
  };
  language: string;
};

export type OrderFulfillment = {
  id: number;
  admin_graphql_api_id: string;
  created_at: string;
  location_id: number;
  name: string;
  order_id: number;
  shipment_status: string;
  status: string;
  tracking_company: string;
  tracking_number: string;
  tracking_url: string;
};

export type Address = {
  name: string;
  address1: string;
  phone?: string;
  city: string;
  country: string;
  province: string;
  zip: string;
  address2?: string;
  country_name?: string;
  country_code?: string;
  first_name?: string;
  last_name?: string;
};

export type Order = {
  id: string;
  name: string;
  subtotal_price: string;
  contact_email: string;
  admin_graphql_api_id: string;
  shipping_address: Address;
  billing_address: Address;
  line_items: OrderLineItem[];
  total_price: string;
  current_subtotal_price: string;
  created_at: string;
  customer: CustomerData | undefined;
  fulfillments: OrderFulfillment[];
};

export type OrderLineItem = {
  id: string;
  title: string;
  price: string;
  variant_id: string;
  variant_title: string;
  quantity: number;
  action: string | null;
  reason?: string;
  confirmed?: boolean;
  changed?: boolean;
  new_variant_id?: string;
  new_variant_title?: string;
  discount_allocations?: DiscountAllocation[];
  product_id: number;
};

export type DiscountAllocation = {
  amount: number;
};

export type ShopifyData = {
  success: boolean;
  order: Order[];
  product?: Product;
};

export type ShopifyDataTracking = {
  success: boolean;
  error?: "InvalidOrderNumber" | "EmailMismatch";
  order?: Order;
  product?: Product;
};

export type ShopifyDataProduct = {
  success: boolean;
  handle: string;
  product?: Product;
};

export type Product = {
  title: string;
  description: string;
  images: Image[];
  handle: string;
  status: string;
};

export type Image = {
  src: string;
};

export type OpenAIResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

export type Ticket = {
  id: string;
  orderNumber: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  status: string;
  name: string | null;
  admin: boolean;
};

export type Message = {
  id?: number;
  sender: string;
  text: string;
  timestamp: string;
  ticketId?: string | null;
};

export type OpenAIMessage = {
  role: string;
  content: string;
};

export type CustomerData = {
  first_name: string;
  last_name: string;
};

export type Size = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL" | "ONE SIZE";

export type MeasurementType = {
  name: string;
  unit: "cm" | "in";
  values: Partial<Record<Size, number>>;
};

export type SizeChart = {
  sizes: Size[];
  measurements: MeasurementType[];
  productType: string;
};

export type ChatMessage = {
  role: string;
  content: string;
};

export type EmailData = {
  From: string;
  To: string;
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  MessageStream: string;
  Attachments?: Array<{
    Name: string;
    Content: string;
    ContentType: string;
  }>;
};

export type InvoiceData = {
  name: string;
  direccion: string;
  auxiliarAddress: string;
  phone: string | null;
  invoiceNumber: string;
  date: string;
  pedidoList: OrderItem[];
  ivaBool: boolean;
  subtotalInput: number;
};

export type OrderItem = {
  name: string;
  quantity: string;
  price: string;
  total: string;
};

export type ProductVariant = {
  inventory_quantity: number;
  title: string;
  id: string;
  [key: string]: number | string;
};

export type ShopifyProduct = {
  title: string;
  variants?: ProductVariant[];
  handle?: string;
  id?: string;
  [key: string]: unknown;
};
