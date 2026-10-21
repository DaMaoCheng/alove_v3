export function extractCallProductsFromPayload(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((item) => String(item?.contentType || item?.content_type || "").trim().toLowerCase() === "product")
    .map((item) => normalizeCallProduct(item))
    .filter(Boolean);
}

export function mergeCallProducts(existingProducts = [], nextProducts = []) {
  const rows = [
    ...normalizeCallProductList(nextProducts),
    ...normalizeCallProductList(existingProducts),
  ];
  const seen = new Set();
  const merged = [];
  rows.forEach((product) => {
    const identity = getCallProductIdentity(product);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    merged.push(product);
  });
  return merged;
}

export function normalizeCallProduct(productMessage = {}) {
  if (!productMessage || typeof productMessage !== "object") return null;
  const product = productMessage.product && typeof productMessage.product === "object"
    ? productMessage.product
    : productMessage;
  const name = String(product.name || product.title || productMessage.text || "").trim();
  if (!name) return null;
  return {
    ...product,
    name,
    messageId: product.messageId || productMessage.id || "",
    characterId: product.characterId || productMessage.characterId || "",
  };
}

export function normalizeCallProductIndex(index = 0, products = []) {
  const count = Array.isArray(products) ? products.length : 0;
  if (!count) return 0;
  const normalizedIndex = Number(index || 0);
  if (!Number.isFinite(normalizedIndex)) return 0;
  return Math.min(Math.max(Math.trunc(normalizedIndex), 0), count - 1);
}

export function hasCallProducts(callState = {}) {
  return Array.isArray(callState?.products) && callState.products.length > 0;
}

export function resolveLatestCallProduct(callState = {}) {
  return hasCallProducts(callState) ? callState.products[0] : null;
}

function normalizeCallProductList(products = []) {
  if (!Array.isArray(products)) return [];
  return products.map((product) => normalizeCallProduct(product)).filter(Boolean);
}

function getCallProductIdentity(product = {}) {
  return [
    product.siteSlug || product.siteId || "",
    product.productId || product.id || "",
    product.url || "",
    product.name || "",
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join("|");
}
