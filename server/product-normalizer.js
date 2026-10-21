import { resolveLocalProductSizeChart } from "./product-size-chart-catalog.js";
import { resolveCanonicalProductEdition } from "./product-edition-service.js";

const MAX_PRODUCTS = 5;
const MAX_TEXT_LENGTH = 240;

export function normalizeProducts(payload, { currency = "", maxProducts = MAX_PRODUCTS } = {}) {
  const rows = extractProductRows(payload);
  return rows.map((row) => normalizeProductRow(row, { currency })).filter((item) => item.name).slice(0, normalizeProductLimit(maxProducts));
}

export async function normalizeShopifySearchProduct(storefrontUrl, row = {}, { currency = "", fetchProductDetail = async () => ({}), fetchCustomizationOptions = async () => [] } = {}) {
  const product = row && typeof row === "object" ? row : {};
  const detail = await fetchProductDetail(storefrontUrl, product);
  if (!detail || typeof detail !== "object" || (!detail.title && !detail.id && !detail.handle)) return null;
  const merged = { ...product, ...detail };
  const price = normalizeShopifyPrice(merged.price ?? merged.price_min, currency);
  const priceWas = normalizeShopifyPrice(merged.compare_at_price ?? merged.compare_at_price_min ?? merged.compare_at_price_max, currency);
  const imageUrl = normalizeExternalUrl(
    storefrontUrl,
    merged.featured_image?.url || merged.featured_image || merged.image || merged.image_url
  );
  const imageUrls = normalizeProductImageUrls(merged, { baseUrl: storefrontUrl });
  const url = normalizeExternalUrl(storefrontUrl, merged.url || product.url);
  const customizationOptions = Array.isArray(merged.customizationOptions)
    ? merged.customizationOptions
    : await fetchCustomizationOptions(url, merged);
  const sizeChart = resolveLocalProductSizeChart({
    ...merged,
    sku: extractPrimarySku(merged.variants) || merged.sku || product.sku,
  });
  return {
    id: clipText(merged.id || merged.product_id || merged.productId || product.id || product.product_id || product.productId || merged.handle || extractProductIdFromUrl(url)),
    sku: clipText(extractPrimarySku(merged.variants) || merged.sku || product.sku),
    name: clipText(merged.title || merged.name),
    canonicalEdition: resolveCanonicalProductEdition(merged),
    subtitle: clipText(merged.product_type || merged.type || merged.vendor || ""),
    price,
    priceWas,
    currency: normalizeCurrency(currency),
    stock: normalizeAvailable(merged.available) === false ? "Sold out" : "Available",
    url,
    imageUrl: imageUrls[0] || imageUrl,
    imageUrls: imageUrls.length ? imageUrls : [imageUrl].filter(Boolean),
    code: "",
    tag: normalizeAvailable(merged.available) === false ? "Sold out" : "Recommended",
    summary: clipText(stripHtml(merged.description || merged.body_html || "")),
    available: normalizeAvailable(merged.available),
    sizes: normalizeShopifySizes(merged.variants, { currency, productUrl: url }),
    features: normalizeShopifyFeatures(merged),
    publishedAt: normalizeProductDate(merged.published_at || merged.publishedAt),
    createdAt: normalizeProductDate(merged.created_at || merged.createdAt),
    updatedAt: normalizeProductDate(merged.updated_at || merged.updatedAt),
    customizationOptions: normalizeCustomizationOptions(customizationOptions || merged.customization_options),
    sizeChart,
    sizeChartResolved: true,
  };
}

export function normalizeShopifyAdminProduct(row = {}, { currency = "", shopDomain = "" } = {}) {
  const product = row && typeof row === "object" ? row : {};
  const imageUrls = normalizeShopifyAdminImages(product);
  const url = safeString(product.onlineStoreUrl)
    || normalizeExternalUrl(`https://${shopDomain}`, `/products/${safeString(product.handle)}`);
  const variants = normalizeShopifyAdminVariants(product.variants?.nodes || product.variants?.edges, { currency, productUrl: url });
  const firstVariant = variants[0] || {};
  const lowestVariant = selectLowestPricedVariant(variants) || firstVariant;
  const available = product.status === "ACTIVE" && variants.some((variant) => variant.available !== false);

  return {
    id: clipText(product.id || product.handle || extractProductIdFromUrl(url)),
    sku: clipText(firstVariant.sku || ""),
    name: clipText(product.title || product.name),
    canonicalEdition: resolveCanonicalProductEdition(product),
    subtitle: clipText(product.productType || product.vendor || ""),
    price: lowestVariant.price || "",
    priceWas: lowestVariant.priceWas || "",
    currency: normalizeCurrency(lowestVariant.currency || currency),
    stock: available ? "Available" : "Sold out",
    url,
    imageUrl: imageUrls[0] || "",
    imageUrls,
    code: "",
    tag: available ? "Recommended" : "Sold out",
    summary: "",
    available,
    sizes: variants,
    features: normalizeFeatures([
      product.productType,
      product.vendor,
      available ? "Available now" : "",
    ]),
    publishedAt: normalizeProductDate(product.publishedAt || product.published_at),
    createdAt: normalizeProductDate(product.createdAt || product.created_at),
    updatedAt: normalizeProductDate(product.updatedAt || product.updated_at),
    customizationOptions: normalizeCustomizationOptions(product.customizationOptions || product.customization_options || parseShopifyCustomizationMetafield(product.customization)),
    sizeChart: resolveLocalProductSizeChart({
      ...product,
      sku: firstVariant.sku || product.sku,
      variants: product.variants?.nodes || product.variants?.edges?.map((edge) => edge?.node || edge) || [],
    }),
    sizeChartResolved: true,
  };
}

export function normalizeCurrency(value = "") {
  const text = safeString(value).toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

export function normalizeExternalUrl(baseUrl, value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    if (text.startsWith("//")) {
      const base = new URL(baseUrl);
      return `${base.protocol}${text}`;
    }
    return new URL(text, new URL(baseUrl).origin).toString();
  } catch {
    return text;
  }
}

function extractProductRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "products", "data", "list", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === "object") {
    for (const key of ["items", "products", "list", "results"]) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  return [];
}

function normalizeProductRow(row, { currency = "" } = {}) {
  const product = row && typeof row === "object" ? row : {};
  const imageUrls = normalizeProductImageUrls(product);
  return {
    id: clipText(product.id || product.product_id || product.productId || product.handle || extractProductIdFromUrl(product.url || product.link || product.product_url || product.productUrl)),
    sku: clipText(product.sku || product.SKU || product.variant_sku || product.variantSku),
    name: clipText(product.name || product.title || product.product_name || product.productName),
    canonicalEdition: resolveCanonicalProductEdition(product),
    subtitle: clipText(product.subtitle || product.variant || product.category || product.type),
    price: formatDisplayPrice(product.price || product.priceNow || product.sale_price || product.salePrice || product.current_price || product.currentPrice, currency),
    priceWas: formatDisplayPrice(product.price_was || product.priceWas || product.original_price || product.originalPrice || product.compare_at_price || product.compareAtPrice, currency),
    currency: normalizeCurrency(currency),
    stock: clipText(product.stock || product.stock_status || product.stockStatus || product.availability || product.inventory || product.available),
    url: clipText(product.url || product.link || product.product_url || product.productUrl),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    code: clipText(product.code || product.coupon || product.coupon_code || product.couponCode || product.promo_code || product.promoCode),
    tag: clipText(product.tag || product.badge || product.label),
    summary: clipText(product.summary || product.description || product.short_description || product.shortDescription),
    available: normalizeAvailable(product.available ?? product.inStock ?? product.is_available ?? product.isAvailable),
    sizes: normalizeSizes(product.sizes || product.variants || product.options, { currency }),
    features: normalizeFeatures(product.features || product.parameters || product.params || product.highlights),
    publishedAt: normalizeProductDate(product.publishedAt || product.published_at || product.publishDate || product.publish_date),
    createdAt: normalizeProductDate(product.createdAt || product.created_at),
    updatedAt: normalizeProductDate(product.updatedAt || product.updated_at),
    customizationOptions: normalizeCustomizationOptions(product.customizationOptions || product.customization_options),
    sizeChart: resolveLocalProductSizeChart(product),
    sizeChartResolved: true,
  };
}

function normalizeCustomizationOptions(value) {
  return (Array.isArray(value) ? value : []).map((option, index) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) return null;
    const values = (Array.isArray(option.values) ? option.values : []).map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        id: clipText(item.id || item.valueId || item.value || item.label),
        label: clipText(item.label || item.value || item.name),
        price: Number(item.price) > 0 ? Number(item.price) : 0,
        imageUrl: normalizeExternalUrl("https://example.test", item.imageUrl || item.image_url || ""),
      };
    }).filter((item) => item?.id && item.label).slice(0, 100);
    const id = clipText(option.id || option.optionId || option.name || `customization-${index}`);
    const name = clipText(option.name || option.label || "Customization");
    if (!id || !name || (!values.length && !["text", "number", "date", "email", "phone", "file"].includes(String(option.type)))) return null;
    return {
      id,
      name,
      type: clipText(option.type || "dropdown"),
      required: option.required === true,
      placeholder: clipText(option.placeholder),
      price: Number(option.price) > 0 ? Number(option.price) : 0,
      values,
    };
  }).filter(Boolean).slice(0, 24);
}

function normalizeShopifyPrice(value, currency = "") {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return formatDisplayPrice((value / 100).toFixed(2), currency);
  }
  return formatDisplayPrice(value, currency);
}

function normalizeShopifySizes(variants = [], { currency = "", productUrl = "" } = {}) {
  if (!Array.isArray(variants)) return [];
  return variants.map((variant) => ({
    label: clipText(variant.public_title || variant.title || variant.option1 || variant.name),
    available: normalizeAvailable(variant.available),
    sku: clipText(variant.sku),
    price: normalizeShopifyPrice(variant.price, currency),
    variantId: normalizeShopifyVariantId(variant.id),
    buyUrl: buildShopifyVariantCartUrl(productUrl, variant.id),
  })).filter((item) => item.label).slice(0, 12);
}

function normalizeShopifyAdminVariants(edges = [], { currency = "", productUrl = "" } = {}) {
  const rows = Array.isArray(edges) ? edges : [];
  return rows.map((edge) => {
    const variant = edge?.node || edge || {};
    const optionLabel = Array.isArray(variant.selectedOptions)
      ? variant.selectedOptions.map((option) => option?.value).filter(Boolean).join(" / ")
      : "";
    const contextualPricing = variant.contextualPricing && typeof variant.contextualPricing === "object"
      ? variant.contextualPricing
      : {};
    const priceCurrency = normalizeCurrency(contextualPricing.price?.currencyCode || currency);
    return {
      label: clipText(optionLabel || variant.title || variant.name),
      available: normalizeAvailable(variant.availableForSale),
      sku: clipText(variant.sku),
      price: formatDisplayPrice(contextualPricing.price?.amount, priceCurrency),
      priceWas: formatDisplayPrice(contextualPricing.compareAtPrice?.amount, normalizeCurrency(contextualPricing.compareAtPrice?.currencyCode || priceCurrency)),
      currency: priceCurrency,
      inventoryQuantity: Number.isFinite(Number(variant.inventoryQuantity)) ? Number(variant.inventoryQuantity) : null,
      variantId: normalizeShopifyVariantId(variant.id),
      buyUrl: buildShopifyVariantCartUrl(productUrl, variant.id),
    };
  }).filter((item) => item.label).slice(0, 100);
}

function selectLowestPricedVariant(variants = []) {
  return variants.reduce((lowest, variant) => {
    if (!variant?.price) return lowest;
    const amount = parseDisplayPriceAmount(variant.price);
    if (!Number.isFinite(amount)) return lowest;
    if (!lowest || amount < parseDisplayPriceAmount(lowest.price)) return variant;
    return lowest;
  }, null);
}

function parseDisplayPriceAmount(value = "") {
  const numeric = Number(String(value || "").replace(/[^0-9.,-]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function parseShopifyCustomizationMetafield(value = null) {
  const text = safeString(value?.value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeShopifyFeatures(product = {}) {
  const features = [];
  if (product.product_type || product.type) features.push(product.product_type || product.type);
  if (product.vendor) features.push(product.vendor);
  if (normalizeAvailable(product.available) === true) features.push("Available now");
  if (Array.isArray(product.tags)) features.push(...product.tags.slice(0, 3));
  return normalizeFeatures(features);
}

function normalizeShopifyAdminImages(product = {}) {
  const values = [extractProductImageUrl(product.featuredImage)];
  const imageEdges = Array.isArray(product.images?.edges) ? product.images.edges : [];
  for (const edge of imageEdges) {
    values.push(extractProductImageUrl(edge?.node || edge));
  }
  return [...new Set(values.map((value) => safeString(value)).filter(Boolean))].slice(0, 8);
}

function normalizeProductImageUrls(product = {}, { baseUrl = "" } = {}) {
  const values = [
    extractProductImageUrl(product.featured_image),
    extractProductImageUrl(product.image_url),
    extractProductImageUrl(product.imageUrl),
    extractProductImageUrl(product.image),
    extractProductImageUrl(product.thumbnail),
    extractProductImageUrl(product.cover_url),
    extractProductImageUrl(product.coverUrl),
  ];
  for (const key of ["image_urls", "imageUrls", "images", "media"]) {
    const rows = Array.isArray(product[key]) ? product[key] : [];
    for (const row of rows) {
      values.push(extractProductImageUrl(row));
    }
  }
  const normalized = values
    .map((value) => baseUrl ? normalizeExternalUrl(baseUrl, value) : safeString(value))
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 8);
}

function extractProductImageUrl(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return safeString(value.url || value.src || value.image_url || value.imageUrl || value.preview_image?.src);
}

function extractPrimarySku(variants = []) {
  if (!Array.isArray(variants)) return "";
  const match = variants.find((variant) => safeString(variant?.sku));
  return safeString(match?.sku);
}

function extractProductIdFromUrl(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text, "https://example.test");
    const parts = url.pathname.split("/").filter(Boolean);
    return safeString(parts.at(-1));
  } catch {
    return "";
  }
}

function normalizeSizes(value, { currency = "" } = {}) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    if (typeof item === "string") return { label: clipText(item), available: true };
    if (!item || typeof item !== "object") return null;
    return {
      label: clipText(item.label || item.name || item.title || item.size || item.public_title),
      available: normalizeAvailable(item.available ?? item.inStock ?? item.is_available ?? item.isAvailable),
      sku: clipText(item.sku),
      price: formatDisplayPrice(item.price || item.priceNow || "", currency),
      priceWas: formatDisplayPrice(item.priceWas || item.price_was || item.compareAtPrice || item.compare_at_price || "", currency),
      variantId: normalizeShopifyVariantId(item.variantId || item.variant_id || item.id),
      buyUrl: safeString(item.buyUrl || item.buy_url || item.cartUrl || item.cart_url),
    };
  }).filter((item) => item?.label).slice(0, 12);
}

function normalizeShopifyVariantId(value = "") {
  const text = safeString(value);
  if (!text) return "";
  const gidMatch = text.match(/\/ProductVariant\/(\d+)(?:\D.*)?$/);
  if (gidMatch) return gidMatch[1];
  const numericMatch = text.match(/(\d{6,})/);
  return numericMatch ? numericMatch[1] : "";
}

function buildShopifyVariantCartUrl(productUrl = "", variantId = "") {
  const normalizedVariantId = normalizeShopifyVariantId(variantId);
  if (!productUrl || !normalizedVariantId) return "";
  try {
    const url = new URL(productUrl);
    return `${url.origin}/cart/${encodeURIComponent(normalizedVariantId)}:1`;
  } catch {
    return "";
  }
}

function normalizeFeatures(value) {
  const rows = Array.isArray(value) ? value : safeString(value) ? [value] : [];
  return rows.map((item) => {
    if (typeof item === "string") return clipText(item);
    if (!item || typeof item !== "object") return "";
    return clipText(item.label || item.name || item.value || item.text);
  }).filter(Boolean).slice(0, 6);
}

function normalizeAvailable(value) {
  if (value === true || value === false) return value;
  const text = safeString(value).toLowerCase();
  if (!text) return null;
  if (["true", "yes", "available", "in stock", "instock", "1"].includes(text)) return true;
  if (["false", "no", "sold out", "unavailable", "out of stock", "0"].includes(text)) return false;
  return null;
}

function normalizeProductDate(value = "") {
  const text = safeString(value);
  if (!text) return "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : clipText(text, 64);
}

function formatDisplayPrice(value, currency = "") {
  const text = safeString(value);
  if (!text) return "";
  if (hasCurrencyUnit(text)) return clipText(text);
  const normalizedCurrency = normalizeCurrency(currency);
  if (!normalizedCurrency || !isPlainPriceNumber(text)) return clipText(text);
  return `${currencyPrefix(normalizedCurrency)}${Number(text.replace(/,/g, "")).toFixed(2)}`;
}

function hasCurrencyUnit(value = "") {
  return /[$€£¥]|(?:^|\s)(?:GBP|USD|EUR|JPY|CNY|RMB|HKD|AUD|CAD|BRL|MXN)(?:\s|$)/i.test(value);
}

function isPlainPriceNumber(value = "") {
  return /^\d+(?:[.,]\d{1,2})?$/.test(safeString(value));
}

function currencyPrefix(currency = "") {
  const map = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    JPY: "¥",
    CNY: "¥",
    RMB: "¥",
    HKD: "HK$",
    AUD: "A$",
    CAD: "C$",
  };
  return map[normalizeCurrency(currency)] || `${normalizeCurrency(currency)} `;
}

function stripHtml(value = "") {
  return safeString(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function clipText(value) {
  const text = safeString(value).replace(/\s+/g, " ");
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH).trim()}...` : text;
}

function normalizeProductLimit(value = MAX_PRODUCTS) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return MAX_PRODUCTS;
  return Math.max(1, Math.min(16, Math.trunc(limit)));
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
