import { createPublicError } from "./public-error-utils.js";
import { SERVER_CONFIG } from "./config.js";

const MAX_DRAFT_LINES = 20;
const POLL_ATTEMPTS = 4;

export async function createShopifyDraftOrder({ source, customerId = "", lines = [], attemptTag = "", discounts = null, discount = null, expectedDiscountAmount = null, presentmentCurrencyCode = "", fetchImpl = fetch } = {}) {
  const normalizedLines = normalizeLines(lines);
  const customerGid = asGid("Customer", customerId);
  if (!customerGid || !normalizedLines.length) throw createPublicError("Your Shopify cart is no longer available. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_REQUIRED");
  const data = await adminGraphql(source, CREATE_DRAFT_ORDER_MUTATION, {
    input: buildShopifyDraftOrderInput({ customerId: customerGid, lines: normalizedLines, attemptTag, discounts, discount, presentmentCurrencyCode }),
  }, fetchImpl);
  const result = data?.draftOrderCreate;
  if (!result?.draftOrder || result?.userErrors?.length) throw createPublicError("Shopify could not create your payment checkout. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_CREATE_FAILED");
  return await waitForUsableDraftOrder(source, result.draftOrder.id, { customerId: customerGid, lines: normalizedLines, discounts, discount, expectedDiscountAmount, presentmentCurrencyCode }, fetchImpl);
}

export function buildShopifyDraftOrderInput({ customerId = "", lines = [], attemptTag = "", discounts = null, discount = null, presentmentCurrencyCode = "" } = {}) {
  const customerGid = asGid("Customer", customerId);
  const normalizedLines = normalizeLines(lines);
  if (!customerGid || !normalizedLines.length) return {};
  const input = {
    purchasingEntity: { customerId: customerGid },
    lineItems: normalizedLines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    tags: attemptTag ? [attemptTag] : [],
  };
  const codes = normalizeDraftOrderDiscountCodes(discounts, discount);
  if (codes.length) input.discountCodes = codes;
  const currencyCode = normalizeCurrencyCode(presentmentCurrencyCode);
  if (currencyCode) input.presentmentCurrencyCode = currencyCode;
  return input;
}

/**
 * Shopify calculates native code restrictions (targets, customer eligibility,
 * usage, thresholds) here without creating a Draft Order. Never replace this
 * with an order-level appliedDiscount for a Shopify-managed code.
 */
export async function calculateShopifyDraftOrder({ source, customerId = "", lines = [], discounts = null, discount = null, presentmentCurrencyCode = "", fetchImpl = fetch } = {}) {
  const normalizedLines = normalizeLines(lines);
  const customerGid = asGid("Customer", customerId);
  if (!customerGid || !normalizedLines.length) throw createPublicError("Your Shopify cart is no longer available. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_REQUIRED");
  const input = buildShopifyDraftOrderInput({ customerId: customerGid, lines: normalizedLines, discounts, discount, presentmentCurrencyCode });
  const data = await adminGraphql(source, CALCULATE_DRAFT_ORDER_MUTATION, { input }, fetchImpl);
  const result = data?.draftOrderCalculate;
  if (!result?.calculatedDraftOrder || result?.userErrors?.length) throw createPublicError("Shopify could not calculate this discount. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_CALCULATE_FAILED");
  return normalizeCalculatedDraftOrder(result.calculatedDraftOrder, { discounts, discount });
}

export async function readShopifyDraftOrderPayment({ source, draftOrderId = "", customerId = "", lines = [], discounts = null, discount = null, expectedDiscountAmount = null, presentmentCurrencyCode = "" } = {}) {
  const normalizedLines = normalizeLines(lines);
  const customerGid = asGid("Customer", customerId);
  if (!draftOrderId || !customerGid || !normalizedLines.length) throw createPublicError("Your payment checkout is no longer available. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_REQUIRED");
  return waitForUsableDraftOrder(source, draftOrderId, { customerId: customerGid, lines: normalizedLines, discounts, discount, expectedDiscountAmount, presentmentCurrencyCode });
}

export async function readShopifyDraftOrderSettlement({ source, draftOrderId = "", customerId = "", fetchImpl = fetch } = {}) {
  const customerGid = asGid("Customer", customerId);
  if (!draftOrderId || !customerGid) throw createPublicError("Your payment checkout is no longer available. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_REQUIRED");
  const data = await adminGraphql(source, READ_DRAFT_ORDER_SETTLEMENT_QUERY, { id: draftOrderId }, fetchImpl);
  const draftOrder = validateDraftOrderIdentity(data?.draftOrder, { customerId: customerGid });
  const lines = normalizeLines((draftOrder?.lineItems?.nodes || []).map((line) => ({ variantId: line?.variant?.id, quantity: line?.quantity })));
  if (!lines.length) throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
  return {
    id: draftOrder.id,
    lines,
    orderId: asGid("Order", draftOrder?.order?.id),
    financialStatus: String(draftOrder?.order?.displayFinancialStatus || "").trim().toUpperCase(),
  };
}

export async function recoverShopifyDraftOrder({ source, attemptTag = "", customerId = "", lines = [], discounts = null, discount = null, expectedDiscountAmount = null, presentmentCurrencyCode = "" } = {}) {
  const normalizedLines = normalizeLines(lines);
  const customerGid = asGid("Customer", customerId);
  if (!attemptTag || !customerGid || !normalizedLines.length) return null;
  const data = await adminGraphql(source, FIND_DRAFT_ORDER_BY_TAG_QUERY, { query: `tag:${attemptTag}` });
  const rows = Array.isArray(data?.draftOrders?.nodes) ? data.draftOrders.nodes : [];
  if (rows.length !== 1) return null;
  return validateDraftOrder(rows[0], { customerId: customerGid, lines: normalizedLines, discounts, discount, expectedDiscountAmount, presentmentCurrencyCode });
}

export async function resolveShopifyDraftOrderPaymentUrl({ source, draftOrder = {} } = {}) {
  const invoiceUrl = String(draftOrder?.invoiceUrl || "").trim();
  if (!invoiceUrl) throw createPublicError("Shopify payment checkout is still being prepared. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_PROCESSING");
  const hosts = await getTrustedPaymentHosts(source);
  if (!isTrustedInvoiceUrl(invoiceUrl, hosts)) throw createPublicError("Shopify payment checkout is unavailable. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_PAYMENT_URL_INVALID");
  return invoiceUrl;
}

async function waitForUsableDraftOrder(source, draftOrderId, expected, fetchImpl = fetch) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const data = await adminGraphql(source, READ_DRAFT_ORDER_QUERY, { id: draftOrderId }, fetchImpl);
    const draftOrder = validateDraftOrder(data?.draftOrder, expected);
    if (draftOrder.invoiceUrl) return draftOrder;
    if (attempt < POLL_ATTEMPTS - 1) await wait(500 * (attempt + 1));
  }
  throw createPublicError("Shopify payment checkout is still being prepared. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_PROCESSING");
}

function validateDraftOrder(draftOrder, { customerId, lines, discounts = null, discount = null, expectedDiscountAmount = null, presentmentCurrencyCode = "" }) {
  validateDraftOrderIdentity(draftOrder, { customerId });
  if (draftOrder?.order?.id) throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
  const actual = normalizeLines((draftOrder?.lineItems?.nodes || []).map((line) => ({ variantId: line?.variant?.id, quantity: line?.quantity })));
  if (!sameLines(actual, lines)) throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
  if (!sameDraftOrderDiscounts(draftOrder, discounts, discount, expectedDiscountAmount, presentmentCurrencyCode)) throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
  return draftOrder;
}

function validateDraftOrderIdentity(draftOrder, { customerId }) {
  if (!draftOrder?.id || String(draftOrder?.customer?.id || "") !== String(customerId || "")) {
    throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
  }
  return draftOrder;
}

function normalizeLines(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  if (!rows.length || rows.length > MAX_DRAFT_LINES) return [];
  const merged = new Map();
  for (const line of rows) {
    const variantId = asGid("ProductVariant", line?.variantId);
    const quantity = Math.trunc(Number(line?.quantity || 0));
    if (!variantId || quantity < 1 || quantity > 99) return [];
    merged.set(variantId, (merged.get(variantId) || 0) + quantity);
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity })).sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function sameLines(actual, expected) {
  return actual.length === expected.length && actual.every((line, index) => line.variantId === expected[index].variantId && line.quantity === expected[index].quantity);
}

function asGid(type, value) {
  const id = String(value || "").replace(new RegExp(`^gid://shopify/${type}/`), "");
  return /^\d+$/.test(id) ? `gid://shopify/${type}/${id}` : "";
}

function normalizeDraftOrderDiscountCode(value = null) {
  const source = value && typeof value === "object" ? value : {};
  const code = String(source.code || "").trim().toUpperCase().slice(0, 64);
  return /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code) ? code : "";
}

export function normalizeDraftOrderDiscountCodes(discounts = null, legacyDiscount = null) {
  const values = Array.isArray(discounts) ? discounts : legacyDiscount ? [legacyDiscount] : [];
  return [...new Set(values.map(normalizeDraftOrderDiscountCode).filter(Boolean))].sort().slice(0, 5);
}

function sameDraftOrderDiscounts(actual = null, discounts = null, legacyDiscount = null, expectedDiscountAmount = null, presentmentCurrencyCode = "") {
  const expectedCodes = normalizeDraftOrderDiscountCodes(discounts, legacyDiscount);
  const codes = [...new Set((Array.isArray(actual?.discountCodes) ? actual.discountCodes : [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean))].sort();
  if (codes.length !== expectedCodes.length || codes.some((code, index) => code !== expectedCodes[index])) return false;
  const actualMoney = normalizeMoney(actual?.totalDiscountsSet?.presentmentMoney);
  const expectedCurrency = normalizeCurrencyCode(presentmentCurrencyCode);
  if (expectedCurrency && actualMoney?.currencyCode !== expectedCurrency) return false;
  const expectedAmount = expectedDiscountAmount == null || expectedDiscountAmount === "" ? NaN : Number(expectedDiscountAmount);
  const actualAmount = Number(actualMoney?.amount);
  return !Number.isFinite(expectedAmount) || expectedAmount < 0 || (Number.isFinite(actualAmount) && Math.abs(actualAmount - expectedAmount) < 0.0001);
}

function normalizeCalculatedDraftOrder(value = {}, { discounts = null, discount = null } = {}) {
  const requestedCodes = normalizeDraftOrderDiscountCodes(discounts, discount);
  const discountCodes = Array.isArray(value?.discountCodes)
    ? value.discountCodes.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const subtotal = normalizeMoney(value?.subtotalPriceSet?.presentmentMoney);
  const calculatedTotal = normalizeMoney(value?.totalPriceSet?.presentmentMoney);
  const discountAmount = normalizeMoney(value?.totalDiscountsSet?.presentmentMoney);
  // Cart footer is a merchandise subtotal, not a shipping/tax-inclusive order
  // total. Derive its post-discount value from the same Shopify calculation.
  const total = subtotal && discountAmount && subtotal.currencyCode === discountAmount.currencyCode
    ? { amount: Math.max(0, roundMoney(subtotal.amount - discountAmount.amount)), currencyCode: subtotal.currencyCode }
    : calculatedTotal;
  return {
    code: requestedCodes[0] || "",
    applied: discountCodes.some((code) => requestedCodes.includes(code)) && moneyAmount(value?.totalDiscountsSet?.presentmentMoney) > 0,
    discountCodes,
    subtotal,
    discount: discountAmount,
    total,
  };
}

function normalizeMoney(value = {}) {
  const amount = Number(value?.amount);
  const currencyCode = normalizeCurrencyCode(value?.currencyCode);
  return Number.isFinite(amount) && amount >= 0 && currencyCode ? { amount, currencyCode } : null;
}

function moneyAmount(value = {}) { return Number(normalizeMoney(value)?.amount || 0); }
function normalizeCurrencyCode(value = "") { const code = String(value || "").trim().toUpperCase(); return /^[A-Z]{3}$/.test(code) ? code : ""; }
function roundMoney(value) { return Math.round(Number(value || 0) * 100) / 100; }

async function adminGraphql(source, query, variables, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(SERVER_CONFIG.productApi.timeoutMs || 8000)));
  try {
    const response = await fetchImpl(source.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "AIOVE Shopify Draft Order", "X-Shopify-Access-Token": source.token },
      body: JSON.stringify({ query, variables }), signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) throw createPublicError("Shopify payment checkout is temporarily unavailable. Please try again.", 502, "SHOPIFY_DRAFT_ORDER_UPSTREAM_FAILED");
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

async function getTrustedPaymentHosts(source) {
  const data = await adminGraphql(source, SHOP_PRIMARY_DOMAIN_QUERY, {});
  return new Set([String(source?.shopDomain || "").toLowerCase(), String(data?.shop?.primaryDomain?.host || "").toLowerCase()].filter(Boolean));
}

function isTrustedInvoiceUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && hosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const MONEY_BAG_FIELDS = "presentmentMoney { amount currencyCode } shopMoney { amount currencyCode }";
const DRAFT_ORDER_FIELDS = `id invoiceUrl order { id } customer { id } discountCodes totalDiscountsSet { ${MONEY_BAG_FIELDS} } lineItems(first: 50) { nodes { quantity variant { id } } }`;
const CREATE_DRAFT_ORDER_MUTATION = `mutation AioveDraftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${DRAFT_ORDER_FIELDS} } userErrors { field message } } }`;
const CALCULATE_DRAFT_ORDER_MUTATION = `mutation AioveDraftOrderCalculate($input: DraftOrderInput!) { draftOrderCalculate(input: $input) { calculatedDraftOrder { discountCodes subtotalPriceSet { ${MONEY_BAG_FIELDS} } totalDiscountsSet { ${MONEY_BAG_FIELDS} } totalPriceSet { ${MONEY_BAG_FIELDS} } } userErrors { field message } } }`;
const READ_DRAFT_ORDER_QUERY = `query AioveDraftOrder($id: ID!) { draftOrder(id: $id) { ${DRAFT_ORDER_FIELDS} } }`;
const READ_DRAFT_ORDER_SETTLEMENT_QUERY = `query AioveDraftOrderSettlement($id: ID!) { draftOrder(id: $id) { id customer { id } lineItems(first: 50) { nodes { quantity variant { id } } } order { id displayFinancialStatus } } }`;
const FIND_DRAFT_ORDER_BY_TAG_QUERY = `query AioveDraftOrderRecovery($query: String!) { draftOrders(first: 2, query: $query) { nodes { ${DRAFT_ORDER_FIELDS} } } }`;
const SHOP_PRIMARY_DOMAIN_QUERY = "query AioveShopPrimaryDomain { shop { primaryDomain { host } } }";
