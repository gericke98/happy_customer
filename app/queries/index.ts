export const createSession = (): RequestInit => {
  if (!process.env.SHOPIFY_ACCESS_TOKEN || !process.env.SHOP_URL) {
    throw new Error("Missing Shopify access token or shop URL");
  }

  return {
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
  };
};
