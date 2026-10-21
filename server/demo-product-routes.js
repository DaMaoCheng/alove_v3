import { sendJson } from "./http-utils.js";

const DEMO_PRODUCTS = Object.freeze([
  {
    title: "Matchday Home Kit",
    name: "Matchday Home Kit",
    subtitle: "Supporter edition",
    price: "GBP 59.99",
    priceNow: "GBP 59.99",
    availability: "in stock",
    image_url: "/assets/jersey_product.png",
    imageUrl: "/assets/jersey_product.png",
    url: "/search?q=Matchday%20Home%20Kit",
    badge: "Recommended",
    tag: "Recommended",
    buttonText: "View & buy →",
    summary: "A clean matchday shirt pick for football chats and kit recommendations.",
  },
]);

export async function handleDemoProductRoute(req, res, { path, requestUrl }) {
  if (req.method !== "GET" || path !== "/api/demo/products") return false;
  const limit = Math.max(1, Math.min(5, Number(requestUrl.searchParams.get("limit") || 1)));
  sendJson(res, 200, {
    ok: true,
    products: DEMO_PRODUCTS.slice(0, limit),
  });
  return true;
}
