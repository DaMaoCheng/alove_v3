const TRUSTED_PRODUCT_ORIGINS = Symbol("trustedProductOrigins");

export function markServerProductOrigins(result = {}, products = []) {
  const origins = new Set();
  for (const product of Array.isArray(products) ? products : []) {
    addOrigin(origins, product?.url);
    addOrigin(origins, product?.imageUrl);
    for (const imageUrl of Array.isArray(product?.imageUrls) ? product.imageUrls : []) addOrigin(origins, imageUrl);
    for (const size of Array.isArray(product?.sizes) ? product.sizes : []) addOrigin(origins, size?.buyUrl || size?.buy_url);
  }
  Object.defineProperty(result, TRUSTED_PRODUCT_ORIGINS, {
    value: Object.freeze([...origins]),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return result;
}

export function getServerProductOrigins(result = {}) {
  return Array.isArray(result?.[TRUSTED_PRODUCT_ORIGINS]) ? result[TRUSTED_PRODUCT_ORIGINS] : [];
}

function addOrigin(origins, value) {
  try {
    const url = new URL(String(value || "").trim());
    if (["http:", "https:"].includes(url.protocol)) origins.add(url.origin);
  } catch {
    // Relative or malformed URLs are validated against the configured site later.
  }
}
