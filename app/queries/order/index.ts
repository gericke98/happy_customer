import { Order, Product, ShopifyDataProduct } from "@/types";
import { createSession } from "..";

/// EXTRACT FUNCTION
export async function getOrderQuery(orderNumber: string) {
  const session = createSession();
  // El %23 es lo mismo que poner #
  const url = `${process.env.SHOP_URL}/admin/api/${process.env.API_VERSION}/orders.json?query=name:%23${orderNumber}`;
  try {
    const response = await fetch(url, session);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.orders[0];
  } catch (error) {
    console.error("The order number is not correct:", error);
    return null;
  }
}
export async function getProductQuery(productName: string) {
  const session = createSession();
  const url = `${process.env.SHOP_URL}/admin/api/${
    process.env.API_VERSION
  }/products.json?title=${encodeURIComponent(productName)}`;
  try {
    const response = await fetch(url, session);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.products[0];
  } catch (error) {
    console.error("Error fetching product:", error);
    return null;
  }
}

/// TRACK FUNCTION
export async function trackOrder(
  orderNumber: string,
  email: string
): Promise<{
  success: boolean;
  error?: "InvalidOrderNumber" | "EmailMismatch";
  order?: Order;
}> {
  const cleanOrderNumber = orderNumber.replace(/#/g, "");
  const order = await getOrderQuery(cleanOrderNumber);
  // Order number is invalid if no order is found
  if (!order) {
    return { success: false, error: "InvalidOrderNumber" };
  }

  // Order exists but email does not match
  if (
    !order.contact_email ||
    order.contact_email.toLowerCase() !== email.toLowerCase()
  ) {
    return { success: false, error: "EmailMismatch" };
  }

  return { success: true, order };
}

// Change delivery 1
export async function extractCompleteOrder(
  orderNumber: string,
  email: string
): Promise<{
  success: boolean;
  error?: "InvalidOrderNumber" | "EmailMismatch";
  order?: Order;
}> {
  const cleanOrderNumber = orderNumber.replace(/#/g, "");
  const order = await getOrderQuery(cleanOrderNumber);
  // Order number is invalid if no order is found
  if (!order) {
    return { success: false, error: "InvalidOrderNumber" };
  }

  // Order exists but email does not match
  if (
    !order.contact_email ||
    order.contact_email.toLowerCase() !== email.toLowerCase()
  ) {
    return { success: false, error: "EmailMismatch" };
  }

  // Both order number and email match
  return { success: true, order: order };
}

// Update shipping address
export async function updateShippingAddress(
  orderId: string,
  new_delivery_info: string,
  addressData: {
    first_name: string;
    last_name: string;
    phone: string;
  }
): Promise<{
  success: boolean;
  error?: string;
  orderId?: string;
}> {
  console.log("Updating shipping address");

  // Extract address components from Google Places API
  const addressComponents = {
    address1: "",
    address2: "",
    city: "",
    zip: "",
    provinceCode: "",
  };

  try {
    // Use GPT-4 to parse the address components
    const gptResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Extract address components from addresses into JSON format with these keys: address1, address2, city, zip, province

                  Example input: "Calle Gran Via 32, 4B, Madrid, Spain 28013"
                  Example output: {
                    "address1": "Calle Gran Via 32",
                    "address2": "4B", 
                    "city": "Madrid",
                    "zip": "28013",
                    "province": "Madrid"
                  }`,
            },
            {
              role: "user",
              content: new_delivery_info,
            },
          ],
        }),
      }
    );

    if (!gptResponse.ok) {
      throw new Error("Failed to parse address with GPT");
    }

    const gptData = await gptResponse.json();
    const parsedAddress = JSON.parse(gptData.choices[0].message.content);

    // Map province names to autonomous community codes
    const provinceCodeMap: { [key: string]: string } = {
      "A Coruña": "C",
      "La Coruña": "C",
      Álava: "VI",
      Araba: "VI",
      Albacete: "AB",
      Alicante: "A",
      Alacant: "A",
      Almería: "AL",
      Asturias: "O",
      Ávila: "AV",
      Badajoz: "BA",
      "Illes Balears": "PM",
      "Islas Baleares": "PM",
      Balears: "PM",
      Barcelona: "B",
      Burgos: "BU",
      Cáceres: "CC",
      Cádiz: "CA",
      Cantabria: "S",
      Castellón: "CS",
      Castelló: "CS",
      Ceuta: "CE",
      "Ciudad Real": "CR",
      Córdoba: "CO",
      Cuenca: "CU",
      Gipuzkoa: "SS",
      Guipúzcoa: "SS",
      Girona: "GI",
      Gerona: "GI",
      Granada: "GR",
      Guadalajara: "GU",
      Huelva: "H",
      Huesca: "HU",
      Jaén: "J",
      "La Rioja": "LO",
      "Las Palmas": "GC",
      León: "LE",
      Lleida: "L",
      Lérida: "L",
      Lugo: "LU",
      Madrid: "M",
      Málaga: "MA",
      Melilla: "ML",
      Murcia: "MU",
      Navarra: "NA",
      Nafarroa: "NA",
      Ourense: "OR",
      Orense: "OR",
      Palencia: "P",
      Pontevedra: "PO",
      Salamanca: "SA",
      "Santa Cruz de Tenerife": "TF",
      Segovia: "SG",
      Sevilla: "SE",
      Soria: "SO",
      Tarragona: "T",
      Teruel: "TE",
      Toledo: "TO",
      Valencia: "V",
      València: "V",
      Valladolid: "VA",
      Bizkaia: "BI",
      Vizcaya: "BI",
      Zamora: "ZA",
      Zaragoza: "Z",
    };

    // Update address components with GPT parsed values
    addressComponents.address1 = parsedAddress.address1 || "";
    addressComponents.address2 = parsedAddress.address2 || "";
    addressComponents.city = parsedAddress.city || "";
    addressComponents.zip = parsedAddress.zip || "";
    addressComponents.provinceCode =
      provinceCodeMap[parsedAddress.province] || "";
  } catch (error) {
    console.error("Error validating address:", error);
    return {
      success: false,
      error: "Failed to validate address",
    };
  }

  try {
    const query = `mutation updateOrderMetafields($input: OrderInput!) {
      orderUpdate(input: $input) {
        order {
          id
          shippingAddress {
            address1
            address2
            city
            countryCode
            firstName
            lastName
            phone
            zip
            provinceCode
          }
        }
        userErrors {
          message
          field
        }
      }
    }`;

    const response = await fetch(
      `${process.env.SHOP_URL}/admin/api/${process.env.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN as string,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              id: orderId,
              shippingAddress: {
                ...addressComponents,
                countryCode: "ES",
                firstName: addressData.first_name,
                lastName: addressData.last_name,
                phone: addressData.phone,
              },
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!data.data?.orderUpdate) {
      return {
        success: false,
        error: data.errors?.[0]?.message || "Failed to update order",
      };
    }

    if (data.data.orderUpdate.userErrors.length > 0) {
      return {
        success: false,
        error: data.data.orderUpdate.userErrors[0].message,
      };
    }

    return {
      success: true,
      orderId: data.data.orderUpdate.order.id,
    };
  } catch (error) {
    console.error("Error updating order:", error);
    return {
      success: false,
      error: "Failed to update order",
    };
  }
}

export async function extractProduct(productName: string): Promise<{
  success: boolean;
  product?: ShopifyDataProduct | null;
}> {
  const productShopify = await getProductQuery(productName);

  if (!productShopify) {
    return { success: false, product: null };
  }

  // Both order number and email match
  return { success: true, product: productShopify };
}

// Update shipping address
export async function insertCustomer(
  email: string,
  productName?: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  console.log("Inserting new customer");

  try {
    const query = `mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        userErrors {
          message
          field
        }
        customer {
          email
          emailMarketingConsent {
            marketingState
          }
          note
        }
      }
    }`;

    const response = await fetch(
      `${process.env.SHOP_URL}/admin/api/${process.env.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN as string,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              email: email,
              emailMarketingConsent: {
                marketingState: "SUBSCRIBED",
              },
              note: productName ? `Restock ${productName}` : "",
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!data.data?.customerCreate) {
      return {
        success: false,
        error: data.errors?.[0]?.message || "Failed to create customer",
      };
    }

    if (data.data.customerCreate.userErrors.length > 0) {
      return {
        success: false,
        error: data.data.customerCreate.userErrors[0].message,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error creating customer:", error);
    return {
      success: false,
      error: "Failed to create customer",
    };
  }
}

export async function getAllActiveProducts() {
  const session = createSession();
  const url = `${process.env.SHOP_URL}/admin/api/${process.env.API_VERSION}/products.json?status=active`;
  try {
    const response = await fetch(url, session);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.products.map((product: Product) => product.title);
  } catch (error) {
    console.error("Error fetching products:", error);
    return [];
  }
}

export async function createPromoCode(): Promise<{
  success: boolean;
  code?: string;
  error?: string;
}> {
  console.log("Creating new promo code");

  try {
    const query = `mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 10) {
                nodes {
                  code
                }
              }
              startsAt
              endsAt
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const response = await fetch(
      `${process.env.SHOP_URL}/admin/api/${process.env.API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN as string,
        },
        body: JSON.stringify({
          query,
          variables: {
            input: {
              title: `DISCOUNT${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
              code: `SAVE${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
              startsAt: new Date().toISOString(),
              endsAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              customerSelection: {
                all: true,
              },
              customerGets: {
                value: {
                  percentage: 0.2,
                },
                items: {
                  all: true,
                },
              },
              appliesOncePerCustomer: true,
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!data.data?.discountCodeBasicCreate) {
      return {
        success: false,
        error: data.errors?.[0]?.message || "Failed to create discount",
      };
    }

    if (data.data.discountCodeBasicCreate.userErrors.length > 0) {
      return {
        success: false,
        error: data.data.discountCodeBasicCreate.userErrors[0].message,
      };
    }
    return {
      success: true,
      code: data.data.discountCodeBasicCreate.codeDiscountNode.codeDiscount
        .codes.nodes[0].code,
    };
  } catch (error) {
    console.error("Error creating discount:", error);
    return {
      success: false,
      error: "Failed to create discount",
    };
  }
}
