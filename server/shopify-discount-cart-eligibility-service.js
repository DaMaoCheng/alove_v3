import { calculateShopifyDraftOrder } from "./shopify-draft-order-service.js";

/**
 * Shared, server-only eligibility layer for Shopify-native discount codes.
 * Product filtering is deliberately conservative; Shopify's calculation is
 * still the authority for customer, usage and automatic-discount conditions.
 */
export function filterShopifyDiscountOffersForProduct(offers = [], product = {}) {
  return (Array.isArray(offers) ? offers : []).filter((offer) => isShopifyDiscountOfferProductEligible(offer, product));
}

export function isShopifyDiscountOfferProductEligible(offer = {}, product = {}) {
  const rule = normalizeRule(offer?.shopifyRule);
  if (!isSupportedRule(rule)) return false;
  const scope = rule.targetScope;
  if (scope.type === "all") return true;
  const productId = normalizeGid(product?.id, "Product");
  const variantIds = new Set((Array.isArray(product?.sizes) ? product.sizes : []).map((size) => normalizeGid(size?.variantId, "ProductVariant")).filter(Boolean));
  if (scope.type === "products") {
    return scope.productIds.includes(productId) || scope.variantIds.some((id) => variantIds.has(id));
  }
  if (scope.type === "collections") {
    const collectionIds = new Set((Array.isArray(product?.collectionIds) ? product.collectionIds : []).map((id) => normalizeGid(id, "Collection")).filter(Boolean));
    return scope.collectionIds.some((id) => collectionIds.has(id));
  }
  return false;
}

export async function evaluateShopifyCartDiscount({ source, customerId = "", lines = [], discounts = null, discount = null, presentmentCurrencyCode = "", marketPricingContext = null, fetchImpl = fetch } = {}) {
  const requested = normalizeDiscountSelections(discounts, discount);
  if (!requested.length) return unavailableDiscountEvaluation();
  const calculated = await calculateShopifyDraftOrder({ source, customerId, lines, discounts: requested, presentmentCurrencyCode, fetchImpl });
  const appliedCodes = new Set(calculated.discountCodes);
  const evaluations = requested.map((selection) => {
    if (appliedCodes.has(selection.code)) return { state: "applied", code: selection.code };
    const threshold = thresholdEvaluation(selection.rule, calculated, lines, marketPricingContext);
    return threshold ? { ...threshold, code: selection.code } : { state: "not_eligible", code: selection.code };
  });
  const threshold = evaluations.find((item) => item.state === "threshold_not_met") || null;
  return {
    state: appliedCodes.size ? "applied" : (threshold ? "threshold_not_met" : "not_eligible"),
    code: threshold?.code || requested[0]?.code || "",
    subtotal: calculated.subtotal,
    discount: calculated.discount,
    total: calculated.total,
    appliedCodes: [...appliedCodes].sort(),
    evaluations,
    ...(threshold || {}),
  };
}

export function unavailableDiscountEvaluation() { return { state: "none", code: "", subtotal: null, discount: null, total: null }; }

function thresholdEvaluation(rule, calculated, lines, marketPricingContext = null) {
  const requirement = rule.minimumRequirement;
  if (!requirement) return null;
  if (requirement.type === "quantity") {
    const quantity = (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Math.max(0, Number(line?.quantity || 0)), 0);
    const remainingQuantity = Math.max(0, Math.ceil(requirement.value - quantity));
    return remainingQuantity > 0 ? { state: "threshold_not_met", code: calculated.code, thresholdType: "quantity", remainingQuantity, subtotal: calculated.subtotal, discount: calculated.discount, total: calculated.total } : null;
  }
  if (requirement.type === "subtotal") {
    const subtotal = Number(calculated?.subtotal?.amount || 0);
    const subtotalCurrency = String(calculated?.subtotal?.currencyCode || "").toUpperCase();
    const thresholdAmount = resolveThresholdAmountInSubtotalCurrency(requirement, subtotalCurrency, marketPricingContext);
    if (thresholdAmount == null) {
      return { state: "threshold_not_met", code: calculated.code, thresholdType: "subtotal", remainingAmount: null, currencyCode: "", subtotal: calculated.subtotal, discount: calculated.discount, total: calculated.total };
    }
    const remainingAmount = Math.max(0, roundMoney(thresholdAmount - subtotal));
    return remainingAmount > 0
      ? { state: "threshold_not_met", code: calculated.code, thresholdType: "subtotal", remainingAmount, currencyCode: subtotalCurrency, subtotal: calculated.subtotal, discount: calculated.discount, total: calculated.total }
      : null;
  }
  return null;
}

function resolveThresholdAmountInSubtotalCurrency(requirement, subtotalCurrency, marketPricingContext = null) {
  if (!subtotalCurrency) return null;
  if (requirement.currencyCode === subtotalCurrency) return requirement.value;
  const context = marketPricingContext && typeof marketPricingContext === "object" ? marketPricingContext : {};
  if (
    String(context.currency || "").toUpperCase() !== subtotalCurrency
    || String(context.shopCurrency || "").toUpperCase() !== requirement.currencyCode
  ) return null;
  const rate = Number(context.manualRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return roundMoney(requirement.value * rate);
}

function normalizeRule(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const target = source.targetScope && typeof source.targetScope === "object" ? source.targetScope : {};
  const requirement = source.minimumRequirement && typeof source.minimumRequirement === "object" ? source.minimumRequirement : null;
  return {
    type: String(source.type || "").toLowerCase(),
    appliesOnEachItem: source.appliesOnEachItem === true,
    customerContext: String(source.customerContext || "").trim(),
    targetScope: {
      type: String(target.type || "unknown").toLowerCase(),
      productIds: normalizeGidList(target.productIds, "Product"),
      variantIds: normalizeGidList(target.variantIds, "ProductVariant"),
      collectionIds: normalizeGidList(target.collectionIds, "Collection"),
    },
    minimumRequirement: requirement && ["subtotal", "quantity"].includes(String(requirement.type || "").toLowerCase())
      ? { type: String(requirement.type).toLowerCase(), value: Math.max(0, Number(requirement.value || 0)), currencyCode: String(requirement.currencyCode || "").toUpperCase() }
      : null,
  };
}

function normalizeDiscountSelections(discounts = null, legacyDiscount = null) {
  const values = Array.isArray(discounts) ? discounts : legacyDiscount ? [legacyDiscount] : [];
  const unique = new Map();
  for (const selection of values) {
    const code = String(selection?.code || "").trim().toUpperCase();
    const rule = normalizeRule(selection?.shopifyRule);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code) || !isSupportedRule(rule) || unique.has(code)) continue;
    unique.set(code, { ...selection, code, rule });
  }
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, 5);
}

function isSupportedRule(rule) {
  return ["percentage", "fixed_amount"].includes(rule.type)
    && rule.appliesOnEachItem !== true
    && /All$/i.test(rule.customerContext)
    && ["all", "products", "collections"].includes(rule.targetScope.type);
}

function normalizeGidList(values, type) { return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeGid(value, type)).filter(Boolean))].slice(0, 100); }
function normalizeGid(value, type) { const id = String(value || "").trim(); return new RegExp(`^gid://shopify/${type}/\\d+$`).test(id) ? id : ""; }
function roundMoney(value) { return Math.round(Number(value || 0) * 100) / 100; }
