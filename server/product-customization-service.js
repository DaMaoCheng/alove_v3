import { SERVER_CONFIG } from "./config.js";
import { fetchTextWithTimeout, safeString } from "./product-source-shared-service.js";

const MAX_OPTION_SETS = 8;
const MAX_OPTIONS = 24;
const MAX_VALUES = 100;

/**
 * Reads the public Avis/Aris option-set view exposed by a Shopify storefront.
 * This is intentionally read-only and returns an empty list for unknown data.
 */
export async function fetchShopifyCustomizationOptions(productUrl, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const handle = extractProductHandle(productUrl);
  const origin = extractPublicOrigin(productUrl);
  if (!handle || !origin) return [];
  try {
    const url = new URL("/search", origin);
    url.searchParams.set("view", "apo");
    url.searchParams.set("q", `handle:${handle}`);
    const text = await fetchTextWithTimeout(url.toString(), timeoutMs);
    const payload = parseJsonPayload(text);
    return normalizeAvisOptionSets(payload);
  } catch (error) {
    console.warn("[aiove] Shopify customization options unavailable:", error.message);
    return [];
  }
}

export function normalizeAvisOptionSets(payload) {
  const sets = findOptionSets(payload).slice(0, MAX_OPTION_SETS);
  const options = [];
  for (const set of sets) {
    if (set?.status === false || set?.status === "FALSE") continue;
    const rows = Array.isArray(set?.options) ? set.options : [];
    for (const row of rows) {
      const option = normalizeAvisOption(row);
      if (option) options.push(option);
    }
  }
  return options.slice(0, MAX_OPTIONS);
}

function normalizeAvisOption(row = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const type = normalizeOptionType(row.option_type || row.type || row.input_type);
  const name = safeString(row.label_product || row.label || row.name || row.title);
  const values = normalizeAvisValues(row.values || row.option_values || row.value_options || row.variants);
  if (!name || !type || ["heading", "paragraph", "divider", "modal", "size_chart", "hidden_field"].includes(type)) return null;
  if (["text", "textarea", "number", "date", "email", "phone", "file"].includes(type)) {
    return {
      id: normalizeId(row.option_id || row.id || name),
      name,
      type: type === "textarea" ? "text" : type,
      required: isTrue(row.required),
      placeholder: safeString(row.place_holder || row.placeholder),
      values: [],
      price: positiveNumber(row.price),
    };
  }
  if (!values.length) return null;
  return {
    id: normalizeId(row.option_id || row.id || name),
    name,
    type: mapChoiceType(type, values),
    required: isTrue(row.required),
    values,
    price: positiveNumber(row.price),
  };
}

function normalizeAvisValues(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((item) => {
    if (typeof item === "string") return { id: normalizeId(item), label: safeString(item), price: 0 };
    if (!item || typeof item !== "object") return null;
    const label = safeString(item.value || item.label || item.name || item.title);
    if (!label) return null;
    return {
      id: normalizeId(item.value_id || item.id || label),
      label,
      price: positiveNumber(item.price || item.add_price || item.price_addon),
      imageUrl: safePublicImageUrl(item.image || item.image_url || item.imageUrl || item.src),
    };
  }).filter((item) => item?.id && item.label).slice(0, MAX_VALUES);
}

function findOptionSets(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [payload.optionSets, payload.optionsets, payload.option_sets, payload.optionset, payload.data?.optionSets, payload.data?.optionsets, payload.data?.option_sets, payload.data?.optionset];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object" && Array.isArray(candidate.options)) return [candidate];
  }
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function parseJsonPayload(text = "") {
  const value = safeString(text);
  if (!value || value.startsWith("<")) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeOptionType(value = "") {
  const type = safeString(value).toLowerCase();
  return type.replace(/\s+/g, "_");
}

function mapChoiceType(type, values) {
  if (type === "radio" || type === "checkbox" || type === "switch") return "radio";
  if (type === "swatch_select_image" || type === "swatch_single_image") return "dropdown_thumbnail";
  return values.some((value) => value.imageUrl) ? "dropdown_thumbnail" : "dropdown";
}

function normalizeId(value = "") {
  return safeString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "customization-option";
}

function positiveNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isTrue(value) {
  return value === true || String(value || "").toUpperCase() === "TRUE";
}

function extractProductHandle(value = "") {
  try {
    const url = new URL(String(value));
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("products");
    return index >= 0 ? safeString(parts[index + 1]) : "";
  } catch { return ""; }
}

function extractPublicOrigin(value = "") {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch { return ""; }
}

function safePublicImageUrl(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}
