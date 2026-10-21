import { normalizeCurrency } from "./product-normalizer.js";
import { safeString } from "./product-source-shared-service.js";
import { buildTtmallAttributeEvidence } from "./product-attribute-evidence-service.js";

export function normalizeTtmallProduct(product = {}, {
  currency = "",
  source,
  website = {},
  sizeChart = null,
  sizeChartResolved = false,
} = {}) {
  const productId = normalizeTtmallProductId(product.product_id || product.id);
  const storefront = normalizePublicOrigin(website.WEBSITE_DOMAIN);
  const cdnBase = normalizePublicOrigin(website.CDN_LINK) || storefront || source?.apiBaseUrl || "";
  const allowedAssetOrigins = uniqueStrings([
    normalizePublicOrigin(website.CDN_LINK),
    storefront,
    normalizePublicOrigin(source?.apiBaseUrl),
  ]);
  const images = uniqueStrings([
    product.cover,
    ...(Array.isArray(product.image) ? product.image : []),
    ...(Array.isArray(product.media?.image) ? product.media.image.map((item) => item?.src) : []),
  ]).map((value) => normalizeAssetUrl(cdnBase, value, allowedAssetOrigins)).filter(Boolean).slice(0, 8);
  const money = normalizeTtmallMoney(product.price, currency, website);
  const compareAtMoney = normalizeTtmallMoney(product.regular_price, currency, website);
  const sizes = normalizeTtmallSizes(product, { currency: money.currency, website });
  const available = normalizeTtmallAvailable(product, sizes);
  const attributeEvidence = buildTtmallAttributeEvidence(product);
  return {
    id: productId,
    productId,
    sku: safeString(product.sku),
    name: safeString(product.title || product.name),
    subtitle: safeString(product.team_name || product.category || product.alias_category_name || product.short_title),
    price: money.formatted,
    priceWas: compareAtMoney.formatted,
    currency: money.currency,
    stock: available ? "Available" : "Sold out",
    url: buildTtmallProductUrl(storefront, product),
    imageUrl: images[0] || "",
    imageUrls: images,
    code: "",
    tag: safeString(product.tags?.[0]?.short_tag || product.tags?.[0]?.tag || (available ? "Recommended" : "Sold out")),
    summary: safeString(product.description_short || product.description_text || product.abstract),
    available,
    sizes,
    features: uniqueStrings([product.team_name, product.category, product.year, product.home_away, product.version, available ? "Available now" : ""]).slice(0, 6),
    attributeEvidence,
    canonicalEdition: attributeEvidence.edition,
    publishedAt: normalizeUnixDate(product.active_time || product.create_time),
    createdAt: normalizeUnixDate(product.create_time),
    updatedAt: normalizeUnixDate(product.update_time),
    customizationOptions: normalizeTtmallCustomizationOptions(product.attr_list, cdnBase, allowedAssetOrigins),
    sizeChart,
    sizeChartResolved: sizeChartResolved === true,
    purchaseMode: "product_detail",
  };
}

export function normalizeTtmallSizeChart(value) {
  const list = Array.isArray(value?.list) ? value.list : [];
  const first = list.find((item) => item && typeof item === "object" && Object.keys(item).length);
  if (!first) return null;
  const metrics = Object.keys(first);
  const sizes = uniqueStrings(metrics.flatMap((metric) => Object.keys(first[metric] || {}).map((size) => safeString(size))));
  if (!sizes.length) return null;
  return {
    columns: ["Size", ...metrics.map((metric) => safeString(metric))],
    rows: sizes.map((size) => [size, ...metrics.map((metric) => safeString(Object.entries(first[metric] || {}).find(([key]) => safeString(key) === size)?.[1]))]),
  };
}

export function extractTtmallFloorProducts(floor = {}, { limit = Number.POSITIVE_INFINITY, scanLimit = Number.POSITIVE_INFINITY, predicate = null } = {}) {
  const products = [];
  let scanned = 0;
  for (const group of Array.isArray(floor.product) ? floor.product : []) {
    for (const product of Array.isArray(group?.product_list) ? group.product_list : []) {
      if (scanned >= scanLimit || products.length >= limit) return products;
      scanned += 1;
      if (typeof predicate === "function" && !predicate(product)) continue;
      products.push(product);
    }
  }
  return products;
}

export function normalizePublicOrigin(value = "") {
  try {
    const url = new URL(safeString(value));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

export function normalizeTtmallProductId(value = "") {
  const text = safeString(value);
  return /^\d{1,20}$/.test(text) ? text : "";
}

function normalizeTtmallSizes(product = {}, { currency = "", website = {} } = {}) {
  const groups = Array.isArray(product.sup_attr) ? product.sup_attr : [];
  const sizeGroup = groups.find((group) => /size/i.test(safeString(group?.name))) || groups[0];
  const values = sizeGroup?.value && typeof sizeGroup.value === "object" ? sizeGroup.value : {};
  const inventory = product.sku_list && typeof product.sku_list === "object" ? product.sku_list : {};
  return Object.entries(values).map(([label, skuValues]) => {
    const skus = Array.isArray(skuValues) ? skuValues.map(safeString).filter(Boolean) : [safeString(skuValues)].filter(Boolean);
    const available = skus.some((sku) => Number(inventory[sku] || 0) > 0);
    return {
      label: safeString(label),
      available,
      sku: skus[0] || "",
      price: normalizeTtmallMoney(product.price, currency, website).formatted,
      priceWas: normalizeTtmallMoney(product.regular_price, currency, website).formatted,
      currency,
      variantId: "",
      buyUrl: "",
    };
  }).filter((item) => item.label).slice(0, 100);
}

function normalizeTtmallCustomizationOptions(value, baseUrl, allowedOrigins) {
  const groups = Array.isArray(value) ? value.flat(3) : [];
  const options = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const values = Array.isArray(group.attr_value) ? group.attr_value : [];
    if (safeString(group.mode).toLowerCase() === "input") {
      for (const field of values) {
        const name = safeString(field.attr_value || group.name);
        if (!name) continue;
        options.push({
          id: `ttmall-attr-${safeString(field.attr_id) || slugify(name)}`,
          name,
          type: /number/i.test(name) ? "number" : "text",
          required: Number(group.is_require || 0) === 1,
          placeholder: safeString(group.placeholder),
          price: positiveNumber(field.attr_price),
          values: [],
        });
      }
      continue;
    }
    const optionValues = values.map((field) => ({
      id: safeString(field.attr_id || field.attr_value),
      label: safeString(field.attr_value),
      price: positiveNumber(field.attr_price),
      imageUrl: normalizeAssetUrl(baseUrl, field.attr_image, allowedOrigins),
    })).filter((field) => field.id && field.label);
    if (!optionValues.length) continue;
    options.push({
      id: `ttmall-group-${safeString(group.attr_tag_id) || slugify(group.name)}-${options.length + 1}`,
      name: safeString(group.placeholder || group.name || "Customization"),
      type: "dropdown",
      required: Number(group.is_require || 0) === 1,
      placeholder: safeString(group.placeholder),
      price: 0,
      values: optionValues,
    });
  }
  return options.slice(0, 20);
}

function normalizeTtmallAvailable(product = {}, sizes = []) {
  if (Number(product.is_stock) === 0 || Number(product.sell_out) === 1) return false;
  if (sizes.length) return sizes.some((size) => size.available !== false);
  return Number(product.is_stock) === 1;
}

function buildTtmallProductUrl(storefront, product = {}) {
  if (!storefront) return "";
  const productId = normalizeTtmallProductId(product.product_id || product.id);
  if (!productId) return storefront;
  const alias = safeString(product.alias_title) || slugify(product.title || product.name) || "product";
  return `${storefront}/productdetail/${encodeURIComponent(alias).replaceAll("%2F", "-")}/${encodeURIComponent(productId)}`;
}

function normalizeAssetUrl(baseUrl, value = "", allowedOrigins = []) {
  const text = safeString(value);
  if (!text || !baseUrl) return "";
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text, `${baseUrl}/`);
    if (url.protocol !== "https:") return "";
    const allowed = new Set(allowedOrigins.map(normalizePublicOrigin).filter(Boolean));
    return allowed.has(url.origin) ? url.toString() : "";
  } catch {
    return "";
  }
}

function formatPrice(value, currency = "") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const code = normalizeCurrency(currency);
  const prefixes = { GBP: "£", USD: "$", EUR: "€", JPY: "¥", CNY: "¥", HKD: "HK$", AUD: "A$", CAD: "C$" };
  return `${prefixes[code] || (code ? `${code} ` : "")}${amount.toFixed(2)}`;
}

function normalizeTtmallMoney(value, currency = "", website = {}) {
  const amount = Number(value);
  const code = normalizeCurrency(currency);
  if (!Number.isFinite(amount) || !code) return { formatted: "", currency: "" };
  if (code === "USD") return { formatted: formatPrice(amount, code), currency: code };
  const rates = Array.isArray(website.exchange_rate) ? website.exchange_rate : [];
  const rate = Number(rates.find((item) => normalizeCurrency(item?.name) === code)?.rate);
  if (!Number.isFinite(rate) || rate <= 0) return { formatted: "", currency: "" };
  return { formatted: formatPrice(amount * rate, code), currency: code };
}

function normalizeUnixDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toISOString();
}

function positiveNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => safeString(value)).filter(Boolean))];
}

function slugify(value = "") {
  return safeString(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
