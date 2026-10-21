import { createHash } from "node:crypto";
import { getDbPool } from "./db.js";
import { createId, decryptSecret, encryptSecret } from "./security.js";
import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";
import { resolveProductCheckoutProduct } from "./product-checkout-resolver-service.js";
import { resolveSearchSite } from "./product-search-site-service.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";
import { readShopifyCustomerBinding } from "./shopify-customer-sync-service.js";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { createShopifyDraftOrder, recoverShopifyDraftOrder, readShopifyDraftOrderPayment, resolveShopifyDraftOrderPaymentUrl } from "./shopify-draft-order-service.js";
import { createPendingShopifyDraftOrderAttempt, markShopifyDraftOrderAttemptFailed, readShopifyDraftOrderAttempt, saveShopifyDraftOrderAttempt } from "./shopify-draft-order-attempt-service.js";
import { resolveCharacterDiscountOffers, resolveSiteDiscountOffers } from "./discount-code-eligibility-service.js";
import { evaluateShopifyCartDiscount, unavailableDiscountEvaluation } from "./shopify-discount-cart-eligibility-service.js";
import { resolveShopifyMarketContext, resolveShopifyMarketPricingContext } from "./shopify-market-context-service.js";
import { areShopifyDiscountsPairwiseCombinable } from "../shared/shopify-discount-combination.js";
import { assertSiteCommerceEnabled } from "./site-commerce-policy.js";

const MAX_LINES = 20;
const MAX_QUANTITY = 99;

export async function syncShopifyCart({ userId = "", siteSlug = "", items = [], buyerIp = "", userSiteId = "", userSiteSlug = "" } = {}) {
  const access = await resolveShopifyCartAccess({ userId, siteSlug, userSiteId, userSiteSlug });
  if (Array.isArray(items) && items.length) assertSiteCommerceEnabled(access.site);
  const binding = await requireShopifyCustomerBinding(access);
  return withShopifyCartLock(access, async () => {
    const { lines, discountSelections } = await resolveLines(access, binding, items);
    const session = await readShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
    const existingCartId = decryptShopifyCartId(session?.cart_id_encrypted || "");
    if (existingCartId) {
      const existing = await readShopifyStorefrontCart(access, buyerIp, existingCartId);
      if (existing) {
        const lineIds = (existing.lines?.nodes || []).map((line) => String(line?.id || "")).filter(Boolean);
        if (lineIds.length) await removeLines(access, buyerIp, existingCartId, lineIds);
        if (!lines.length) {
          const cleared = await readShopifyStorefrontCart(access, buyerIp, existingCartId);
          if (!cleared || Number(cleared.totalQuantity || 0) !== 0) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
          await deleteShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
          return { ok: true, mode: "synced", itemCount: 0, discountEvaluation: unavailableDiscountEvaluation() };
        }
        const updated = await addLines(access, buyerIp, existingCartId, toStorefrontLines(lines));
        if (!updated || !matchesCart(updated, lines)) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
        await markShopifyCartSynchronized(session.id, access, discountSelections);
        return { ok: true, mode: "synced", itemCount: updated.totalQuantity, discountEvaluation: await evaluateCartDiscount(access, binding, lines, discountSelections) };
      }
    }
    if (!lines.length) return { ok: true, mode: "synced", itemCount: 0, discountEvaluation: unavailableDiscountEvaluation() };
    const cart = await storefront(access, buyerIp, `mutation Create($input: CartInput!) { cartCreate(input: $input) { cart { ${cartFields()} } userErrors { message } } }`, { input: { lines: toStorefrontLines(lines) } });
    const result = cart?.cartCreate;
    if (!result?.cart || result.userErrors?.length || !matchesCart(result.cart, lines)) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
    await upsertSession({ userId: access.userId, siteId: access.site.id, sourceCacheKey: access.source.cacheKey, cartId: result.cart.id, discountSelections });
    return { ok: true, mode: "synced", itemCount: result.cart.totalQuantity, discountEvaluation: await evaluateCartDiscount(access, binding, lines, discountSelections) };
  });
}

export async function readShopifyStorefrontCart(access, buyerIp, cartId) {
  const data = await storefront(access, buyerIp, `query Cart($id: ID!) { cart(id: $id) { ${cartFields()} } }`, { id: cartId });
  return data?.cart || null;
}
async function removeLines(access, buyerIp, cartId, lineIds) {
  const data = await storefront(access, buyerIp, `mutation Remove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${cartFields()} } userErrors { message } } }`, { cartId, lineIds });
  const result = data?.cartLinesRemove;
  if (!result?.cart || result.userErrors?.length) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
  return result.cart;
}

export async function clearShopifyCartForSettlement({ access, buyerIp = "", cartId = "" } = {}) {
  const current = await readShopifyStorefrontCart(access, buyerIp, cartId);
  if (!current) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
  const lineIds = (current.lines?.nodes || []).map((line) => String(line?.id || "")).filter(Boolean);
  if (lineIds.length) await removeLines(access, buyerIp, cartId, lineIds);
  const cleared = await readShopifyStorefrontCart(access, buyerIp, cartId);
  if (!cleared || Number(cleared.totalQuantity || 0) !== 0) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
  await deleteShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
  return true;
}
async function addLines(access, buyerIp, cartId, lines) {
  const data = await storefront(access, buyerIp, `mutation Add($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${cartFields()} } userErrors { message } } }`, { cartId, lines });
  const result = data?.cartLinesAdd;
  if (!result?.cart || result.userErrors?.length) throw createPublicError("Shopify cart could not be verified. Please try again.", 422, "SHOPIFY_CART_SYNC_FAILED");
  return result.cart;
}

export async function startShopifyCheckout({ userId = "", siteSlug = "", buyerIp = "", userSiteId = "", userSiteSlug = "" } = {}) {
  const access = await resolveShopifyCartAccess({ userId, siteSlug, userSiteId, userSiteSlug });
  assertSiteCommerceEnabled(access.site);
  const binding = await requireShopifyCustomerBinding(access);
  return withShopifyCartLock(access, async () => {
    const session = await readShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
    const cartId = decryptShopifyCartId(session?.cart_id_encrypted || "");
    if (!cartId) throw createPublicError("Your Shopify cart is no longer available. Please try again.", 409, "SHOPIFY_CART_REQUIRED");
    const cart = await readShopifyStorefrontCart(access, buyerIp, cartId);
    const lines = draftLinesFromCart(cart);
    if (!cart || !lines.length) throw createPublicError("Your Shopify cart is no longer available. Please try again.", 409, "SHOPIFY_CART_REQUIRED");
    const selectedDiscounts = await resolveShopifyCartSessionDiscounts(access, binding, session);
    const discountEvaluation = await evaluateCartDiscount(access, binding, lines, selectedDiscounts);
    const discounts = selectedDiscounts.filter((selection) => discountEvaluation.appliedCodes.includes(selection.code));
    const expectedDiscountAmount = discountEvaluation.discount?.amount;
    const presentmentCurrencyCode = access.site.currency;
    const snapshotHash = draftOrderSnapshotHash(binding, lines, discounts, presentmentCurrencyCode);
    let attemptId = session?.draft_order_snapshot_hash === snapshotHash
      ? String(session?.draft_order_attempt_id || "").trim()
      : "";
    let draftOrder = await resolveExistingDraftOrder(access, binding, session, snapshotHash, lines, discounts, expectedDiscountAmount, presentmentCurrencyCode);
    if (!draftOrder) {
      // A recovered-or-expired creating attempt deliberately returns null. Its
      // original tag must not be reused for a new payment intent.
      attemptId = createId("sdo");
      const cartRevision = await ensureShopifyCartRevision(session, access);
      await createPendingShopifyDraftOrderAttempt({
        id: attemptId,
        userId: access.userId,
        siteId: access.site.id,
        sourceCacheKey: access.source.cacheKey,
        cartIdHash: hashShopifyCartId(cartId),
        cartRevision,
        snapshotHash,
        discount: discounts,
      });
      await saveDraftOrderAttempt({ access, session, attemptId, snapshotHash });
      try {
        draftOrder = await createShopifyDraftOrder({ source: access.source, customerId: binding.shopify_customer_id, lines, attemptTag: draftOrderTag(attemptId), discounts, expectedDiscountAmount, presentmentCurrencyCode });
      } catch (error) {
        let recovered;
        try {
          recovered = await recoverShopifyDraftOrder({ source: access.source, attemptTag: draftOrderTag(attemptId), customerId: binding.shopify_customer_id, lines, discounts, expectedDiscountAmount, presentmentCurrencyCode });
        } catch {
          // The creation outcome is unknown when the recovery read itself
          // fails. Keep the pointer so a later checkout cannot duplicate it.
          throw error;
        }
        if (!recovered) throw error;
        draftOrder = recovered;
      }
      await saveDraftOrderReady({ access, session, attemptId, snapshotHash, draftOrderId: draftOrder.id });
      await saveShopifyDraftOrderAttempt({ id: attemptId, userId: access.userId, siteId: access.site.id, draftOrderId: draftOrder.id });
    } else {
      const cartRevision = await ensureShopifyCartRevision(session, access);
      await createPendingShopifyDraftOrderAttempt({
        id: attemptId,
        userId: access.userId,
        siteId: access.site.id,
        sourceCacheKey: access.source.cacheKey,
        cartIdHash: hashShopifyCartId(cartId),
        cartRevision,
        snapshotHash,
        discount: discounts,
      });
      await saveDraftOrderReady({ access, session, attemptId, snapshotHash, draftOrderId: draftOrder.id });
      await saveShopifyDraftOrderAttempt({ id: attemptId, userId: access.userId, siteId: access.site.id, draftOrderId: draftOrder.id });
    }
    return { ok: true, mode: "redirect", redirectUrl: `/api/product-cart/shopify/payment?siteSlug=${encodeURIComponent(access.site.slug)}` };
  });
}

export async function getShopifyDraftOrderPaymentUrl({ userId = "", siteSlug = "", buyerIp = "", userSiteId = "", userSiteSlug = "" } = {}) {
  const access = await resolveShopifyCartAccess({ userId, siteSlug, userSiteId, userSiteSlug });
  assertSiteCommerceEnabled(access.site);
  const binding = await requireShopifyCustomerBinding(access);
  return withShopifyCartLock(access, async () => {
    const session = await readShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
    const cartId = decryptShopifyCartId(session?.cart_id_encrypted || "");
    const cart = cartId ? await readShopifyStorefrontCart(access, buyerIp, cartId) : null;
    const lines = draftLinesFromCart(cart);
    const selectedDiscounts = await resolveShopifyCartSessionDiscounts(access, binding, session);
    const discountEvaluation = await evaluateCartDiscount(access, binding, lines, selectedDiscounts);
    const discounts = selectedDiscounts.filter((selection) => discountEvaluation.appliedCodes.includes(selection.code));
    const expectedDiscountAmount = discountEvaluation.discount?.amount;
    const presentmentCurrencyCode = access.site.currency;
    const snapshotHash = draftOrderSnapshotHash(binding, lines, discounts, presentmentCurrencyCode);
    if (!session?.draft_order_id || session.draft_order_snapshot_hash !== snapshotHash || !lines.length) throw createPublicError("Your payment checkout is no longer available. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_REQUIRED");
    const draftOrder = await readShopifyDraftOrderPayment({ source: access.source, draftOrderId: session.draft_order_id, customerId: binding.shopify_customer_id, lines, discounts, expectedDiscountAmount, presentmentCurrencyCode });
    return resolveShopifyDraftOrderPaymentUrl({ source: access.source, draftOrder });
  });
}

export async function getShopifyCartReadiness({ userId = "", siteSlug = "", userSiteId = "", userSiteSlug = "" } = {}) {
  let access;
  try {
    access = await resolveShopifyCartAccess({ userId, siteSlug, userSiteId, userSiteSlug });
  } catch (error) {
    if (error?.publicCode === "SHOPIFY_CART_NOT_SUPPORTED") return { ok: true, mode: "not_shopify", requiresBinding: false };
    throw error;
  }
  const binding = await readShopifyCustomerBinding({ userId: access.userId, siteId: access.site.id });
  return { ok: true, mode: "shopify", requiresBinding: !isActiveCustomerBinding(binding) };
}

export async function resolveShopifyCartAccess({ userId, siteSlug, userSiteId = "", userSiteSlug = "" }) {
  const site = await resolveSearchSite(siteSlug, { allowDefault: false });
  const source = parseShopifyAdminSource(site?.product_api_url || "");
  const token = source ? resolveShopifyAdminToken(source.tokenEnv, site?.product_access_token_encrypted || "") : "";
  if (!userId) throw createPublicError("Please sign in first.", 401, "AUTH_REQUIRED");
  if (!site || !source || !token) throw createPublicError("This site does not use Shopify checkout.", 409, "SHOPIFY_CART_NOT_SUPPORTED");
  if (userSiteId && String(site.id) !== String(userSiteId)) throw createPublicError("This cart belongs to a different site.", 403, "SHOPIFY_CART_SITE_MISMATCH");
  if (userSiteSlug && String(site.slug) !== String(userSiteSlug)) throw createPublicError("This cart belongs to a different site.", 403, "SHOPIFY_CART_SITE_MISMATCH");
  const marketContext = await resolveShopifyMarketContext({
    endpoint: source.endpoint,
    token,
    currency: site.currency,
    countryCode: site.market_country_code || site.marketCountryCode || "",
    timeoutMs: SERVER_CONFIG.productApi.timeoutMs,
  });
  return {
    userId: String(userId),
    site: {
      ...site,
      configuredCurrency: site.currency,
      currency: marketContext.currency,
      marketCountryCode: marketContext.countryCode,
    },
    source: { ...source, cacheKey: `${source.shopDomain}|${source.apiVersion}`, token },
  };
}

export async function requireShopifyCustomerBinding(access) {
  const binding = await readShopifyCustomerBinding({ userId: access.userId, siteId: access.site.id });
  if (!isActiveCustomerBinding(binding)) throw createPublicError("Please finish linking your Shopify account first.", 409, "SHOPIFY_CUSTOMER_BINDING_REQUIRED");
  return binding;
}

function isActiveCustomerBinding(binding) {
  return Boolean(binding?.shopify_customer_id) && String(binding?.binding_status || "") === "active";
}

async function resolveLines(access, binding, items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length > MAX_LINES) throw createPublicError("Too many cart items.", 400, "SHOPIFY_CART_TOO_LARGE");
  const merged = new Map();
  const selections = [];
  for (const row of rows) {
    const product = row?.product && typeof row.product === "object" ? row.product : {};
    if (Object.values(product.customizationSelections || {}).some(Boolean)) throw createPublicError("This product is not supported in Shopify checkout yet.", 409, "SHOPIFY_CART_ITEM_UNSUPPORTED");
    const selectedOfferIds = normalizeSelectedOfferIds(product);
    for (const offerId of selectedOfferIds) {
      selections.push({
        offerId,
        characterId: String(product.characterId || "").trim(),
        messageId: String(product.messageId || "").trim(),
      });
    }
    const resolved = await resolveProductCheckoutProduct({ siteSlug: access.site.slug, product, strictSite: true });
    const index = Number(product.selectedSizeIndex || 0);
    const size = Array.isArray(resolved?.item?.sizes) ? resolved.item.sizes[index] : null;
    const variantId = String(size?.variantId || "").replace(/^gid:\/\/shopify\/ProductVariant\//, "");
    const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(Number(row?.quantity || 1))));
    if (!resolved?.resolvedFromSource || !size?.available || !/^\d+$/.test(variantId)) throw createPublicError("A cart item is no longer available. Please select it again.", 409, "SHOPIFY_CART_PRODUCT_UNAVAILABLE");
    const merchandiseId = `gid://shopify/ProductVariant/${variantId}`;
    const current = merged.get(merchandiseId);
    merged.set(merchandiseId, {
      merchandiseId,
      quantity: Math.min(MAX_QUANTITY, Number(current?.quantity || 0) + quantity),
      product: resolved.sourceItem || resolved.item || {},
    });
  }
  const discountSelections = await resolveShopifyCartDiscountSelections(access, binding, selections);
  return {
    lines: [...merged.values()],
    discountSelections,
  };
}

async function resolveShopifyCartDiscountSelections(access, binding, selections = []) {
  const requested = (Array.isArray(selections) ? selections : []).filter((selection) => selection?.offerId);
  if (!requested.length) return [];
  const ids = [...new Set(requested.map((selection) => String(selection.offerId).trim()).filter(Boolean))];
  if (ids.length > 5) throw createPublicError("You can use up to five Shopify discount codes.", 409, "SHOPIFY_CART_DISCOUNT_LIMIT");
  const resolved = [];
  for (const offerId of ids) {
    const selection = requested.find((item) => String(item.offerId).trim() === offerId) || {};
    const trusted = await resolveTrustedShopifyCartDiscount(access, binding, selection);
    if (trusted) resolved.push(trusted);
  }
  const trusted = normalizeTrustedShopifyCartDiscountSelections(resolved);
  if (!areShopifyDiscountsPairwiseCombinable(resolved)) {
    throw createPublicError("The selected Shopify discounts cannot be combined.", 409, "SHOPIFY_CART_DISCOUNT_COMBINATION_UNAVAILABLE");
  }
  return trusted;
}

async function resolveShopifyCartSessionDiscounts(access, binding, session) {
  const selections = parseShopifyCartDiscountSelections(session?.discount_context_json);
  return resolveShopifyCartDiscountSelections(access, binding, selections);
}

async function resolveTrustedShopifyCartDiscount(access, binding, selection = {}) {
  const offerId = String(selection.offerId || "").trim();
  if (!offerId) return null;
  const characterId = String(selection.characterId || "").trim();
  const messageId = String(selection.messageId || "").trim();
  const offers = characterId
    ? await resolveCharacterDiscountOffers(getDbPool(), {
      userId: access.userId,
      characterId,
      messageId,
      siteId: access.site.id,
    })
    : await resolveSiteDiscountOffers(getDbPool(), { userId: access.userId, siteId: access.site.id });
  const offer = (offers?.offers || []).find((candidate) => String(candidate?.id || "") === offerId);
  if (!offer || await wasSingleUseDiscountAlreadyRedeemed(access, binding, offer)) {
    throw createPublicError("The selected Shopify discount is no longer available.", 409, "SHOPIFY_CART_DISCOUNT_UNAVAILABLE");
  }
  return {
    offerId,
    characterId,
    messageId,
    code: String(offer.code || "").trim().toUpperCase(),
    shopifyRule: offer.shopifyRule,
  };
}

async function wasSingleUseDiscountAlreadyRedeemed(access, binding, offer = {}) {
  if (offer?.shopifyRule?.appliesOncePerCustomer !== true) return false;
  const customerId = String(binding?.shopify_customer_id || "").replace(/^gid:\/\/shopify\/Customer\//, "");
  const code = String(offer?.code || "").trim().toUpperCase();
  if (!/^\d+$/.test(customerId) || !code) return true;
  let after = null;
  try {
    for (let page = 0; page < 10; page += 1) {
      const data = await adminShopifyGraphql(access, CUSTOMER_DISCOUNT_ORDERS_QUERY, { first: 100, after, query: `customer_id:${customerId}` });
      const connection = data?.orders || {};
      const orders = Array.isArray(connection.nodes) ? connection.nodes : [];
      if (orders.some((order) => (Array.isArray(order?.discountCodes) ? order.discountCodes : []).some((item) => String(item || "").trim().toUpperCase() === code))) return true;
      if (connection?.pageInfo?.hasNextPage !== true || !connection?.pageInfo?.endCursor) return false;
      after = connection.pageInfo.endCursor;
    }
  } catch {
    return true;
  }
  // The rule promises one lifetime redemption. Avoid offering it if a bounded
  // read cannot establish a complete history for this customer.
  return true;
}

async function adminShopifyGraphql(access, query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, Number(SERVER_CONFIG.productApi.timeoutMs || 8000)));
  try {
    const response = await fetch(access.source.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "AIOVE Shopify Discount Eligibility", "X-Shopify-Access-Token": access.source.token },
      body: JSON.stringify({ query, variables }), signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) throw new Error("SHOPIFY_CUSTOMER_ORDER_LOOKUP_FAILED");
    return payload.data || {};
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateCartDiscount(access, binding, lines, selections = []) {
  if (!selections.length) return unavailableDiscountEvaluation();
  // Product-detail filtering already prevents selecting a code on an unrelated
  // product. Do not reject a later mixed cart here: Shopify may validly apply
  // a product-scoped code to its matching lines only, and calculate is the
  // source of truth for that exact allocation.
  const draftLines = (Array.isArray(lines) ? lines : []).map((line) => ({ variantId: line?.merchandiseId || line?.variantId, quantity: line?.quantity }));
  const marketPricingContext = await resolveCartDiscountMarketPricingContext(access, selections);
  return evaluateShopifyCartDiscount({
    source: access.source,
    customerId: binding.shopify_customer_id,
    lines: draftLines,
    discounts: selections,
    presentmentCurrencyCode: access.site.currency,
    marketPricingContext,
  });
}

async function resolveCartDiscountMarketPricingContext(access, selections = []) {
  const requirement = (Array.isArray(selections) ? selections : []).map((selection) => selection?.shopifyRule?.minimumRequirement)
    .find((item) => String(item?.type || "").toLowerCase() === "subtotal");
  if (
    String(requirement?.type || "").toLowerCase() !== "subtotal"
    || String(requirement?.currencyCode || "").toUpperCase() === String(access?.site?.currency || "").toUpperCase()
  ) return null;
  try {
    return await resolveShopifyMarketPricingContext({
      endpoint: access.source.endpoint,
      token: access.source.token,
      currency: access.site.currency,
      countryCode: access.site.marketCountryCode || access.site.market_country_code || "",
      timeoutMs: SERVER_CONFIG.productApi.timeoutMs,
    });
  } catch {
    // Shopify remains the calculation authority. Without a confirmed market
    // conversion the UI uses its generic threshold message instead of guessing.
    return null;
  }
}

async function storefront(access, buyerIp, query, variables) {
  const resolvedBuyerIp = await resolveBuyerIp(buyerIp);
  const response = await fetch(`https://${access.source.shopDomain}/api/${access.source.apiVersion}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "Shopify-Storefront-Private-Token": access.source.token, "Shopify-Storefront-Buyer-IP": resolvedBuyerIp }, body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.errors?.length) throw createPublicError("Shopify cart is temporarily unavailable. Please try again.", 502, "SHOPIFY_CART_UPSTREAM_FAILED");
  return payload.data;
}

function cartFields() { return "id totalQuantity lines(first: 50) { nodes { id quantity merchandise { ... on ProductVariant { id } } } }"; }
function matchesCart(cart, lines) {
  if (Number(cart?.totalQuantity || 0) !== lines.reduce((total, line) => total + line.quantity, 0)) return false;
  const actual = new Map((cart?.lines?.nodes || []).map((line) => [line?.merchandise?.id, Number(line?.quantity || 0)]));
  return lines.length === actual.size && lines.every((line) => actual.get(line.merchandiseId) === line.quantity);
}
function toStorefrontLines(lines = []) { return (Array.isArray(lines) ? lines : []).map((line) => ({ merchandiseId: line.merchandiseId, quantity: line.quantity })); }
export async function readShopifyCartSession(userId, siteId, sourceCacheKey) { const [rows] = await getDbPool().execute("SELECT id, cart_id_encrypted, discount_context_json, draft_order_attempt_id, draft_order_snapshot_hash, draft_order_id, cart_revision FROM shopify_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? LIMIT 1", [userId, siteId, sourceCacheKey]); return rows[0] || null; }
async function upsertSession({ userId, siteId, sourceCacheKey, cartId, discountSelections = [] }) { const current = await readShopifyCartSession(userId, siteId, sourceCacheKey); await getDbPool().execute(`INSERT INTO shopify_cart_sessions (id, user_id, site_id, source_cache_key, cart_id_encrypted, discount_context_json, draft_order_attempt_id, draft_order_snapshot_hash, draft_order_id, cart_revision) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1) ON DUPLICATE KEY UPDATE cart_id_encrypted = VALUES(cart_id_encrypted), discount_context_json = VALUES(discount_context_json), draft_order_attempt_id = NULL, draft_order_snapshot_hash = NULL, draft_order_id = NULL, cart_revision = GREATEST(cart_revision + 1, 1), updated_at = NOW(3)`, [current?.id || createId("scs"), userId, siteId, sourceCacheKey, encryptSecret(cartId, SERVER_CONFIG.productApi.secretKey), serializeShopifyCartDiscountSelections(discountSelections)]); }
export async function deleteShopifyCartSession(userId, siteId, sourceCacheKey) { await getDbPool().execute("DELETE FROM shopify_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ?", [userId, siteId, sourceCacheKey]); }
export function decryptShopifyCartId(value) { try { return decryptSecret(value, SERVER_CONFIG.productApi.secretKey); } catch { return ""; } }
async function resolveBuyerIp(value) {
  const candidate = String(value || "").trim();
  if (/^(?!127\.)(?!10\.)(?!192\.168\.)(?!172\.(1[6-9]|2\d|3[0-1])\.)(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return candidate;
  const response = await fetch("https://api.ipify.org?format=json");
  const payload = await response.json().catch(() => ({}));
  const ip = String(payload?.ip || "").trim();
  if (!response.ok || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) throw createPublicError("Shopify cart is temporarily unavailable. Please try again.", 502, "SHOPIFY_CART_IP_UNAVAILABLE");
  return ip;
}
export async function withShopifyCartLock(access, callback) {
  const releaseLock = await acquireDedicatedDbAdvisoryLock(shopifyCartLockName(access), 10);
  try {
    return await callback();
  } finally {
    await releaseLock();
  }
}

function shopifyCartLockName(access) {
  const key = [access?.userId, access?.site?.id, access?.source?.cacheKey].map((value) => String(value || "")).join("\n");
  return `shopify_cart:${createHash("sha256").update(key).digest("hex")}`.slice(0, 64);
}

export function draftLinesFromCart(cart) {
  const rows = cart?.lines?.nodes || [];
  const lines = rows.map((line) => ({ variantId: line?.merchandise?.id, quantity: line?.quantity }));
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const valid = lines.length > 0
    && total === Number(cart?.totalQuantity || 0)
    && lines.every((line) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(line.variantId || "")) && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && Number(line.quantity) <= MAX_QUANTITY);
  return valid ? lines.sort((left, right) => String(left.variantId).localeCompare(String(right.variantId))) : [];
}

export function draftOrderSnapshotHash(binding, lines, discounts = null, presentmentCurrencyCode = "") {
  const normalizedDiscounts = normalizeShopifyCartDiscounts(discounts);
  const currencyCode = normalizeShopifyPresentmentCurrency(presentmentCurrencyCode);
  const value = [
    String(binding?.shopify_customer_id || ""),
    `presentment_currency:${currencyCode || "none"}`,
    ...(normalizedDiscounts.length ? normalizedDiscounts.map((discount) => `discount:${discount.offerId}:${discount.code}`) : ["discount:none"]),
    ...lines.map((line) => `${line.variantId}:${line.quantity}`),
  ].join("\n");
  return lines.length && binding?.shopify_customer_id ? createHash("sha256").update(value).digest("hex") : "";
}

function normalizeShopifyPresentmentCurrency(value = "") {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

async function resolveExistingDraftOrder(access, binding, session, snapshotHash, lines, discounts, expectedDiscountAmount = null, presentmentCurrencyCode = "") {
  if (!session?.draft_order_snapshot_hash || session.draft_order_snapshot_hash !== snapshotHash) return null;
  if (session.draft_order_id) {
    return readShopifyDraftOrderPayment({ source: access.source, draftOrderId: session.draft_order_id, customerId: binding.shopify_customer_id, lines, discounts, expectedDiscountAmount, presentmentCurrencyCode });
  }
  if (!session.draft_order_attempt_id) return null;
  const recovered = await recoverShopifyDraftOrder({ source: access.source, attemptTag: draftOrderTag(session.draft_order_attempt_id), customerId: binding.shopify_customer_id, lines, discounts, expectedDiscountAmount, presentmentCurrencyCode });
  if (!recovered) {
    const attempt = await readShopifyDraftOrderAttempt({ id: session.draft_order_attempt_id, userId: access.userId, siteId: access.site.id });
    if (isExpiredUnknownDraftCreation(attempt)) {
      const expired = await markShopifyDraftOrderAttemptFailed({ id: attempt.id, userId: access.userId, siteId: access.site.id });
      if (expired) await clearFailedShopifyDraftOrderAttemptPointer({ access, session, attemptId: attempt.id });
      return null;
    }
    throw createPublicError("Shopify payment checkout is still being prepared. Please try again.", 409, "SHOPIFY_DRAFT_ORDER_PROCESSING");
  }
  await saveDraftOrderReady({ access, session, attemptId: session.draft_order_attempt_id, snapshotHash, draftOrderId: recovered.id });
  return recovered;
}

function isExpiredUnknownDraftCreation(attempt = {}, now = Date.now()) {
  if (String(attempt?.attempt_status || "") !== "creating" || String(attempt?.shopify_draft_order_id || "")) return false;
  const createdAt = new Date(attempt?.created_at || 0).getTime();
  return Number.isFinite(createdAt) && createdAt > 0 && now - createdAt >= 15 * 60 * 1000;
}

async function clearFailedShopifyDraftOrderAttemptPointer({ access, session, attemptId = "" } = {}) {
  if (!access?.userId || !access?.site?.id || !session?.id || !attemptId) return false;
  const [result] = await getDbPool().execute(
    `UPDATE shopify_cart_sessions
        SET draft_order_attempt_id = NULL, draft_order_snapshot_hash = NULL, draft_order_id = NULL, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ? AND draft_order_attempt_id = ?
        AND (draft_order_id IS NULL OR draft_order_id = '')`,
    [session.id, access.userId, access.site.id, attemptId],
  );
  return Number(result?.affectedRows || 0) === 1;
}

async function saveDraftOrderAttempt({ access, session, attemptId, snapshotHash }) {
  await getDbPool().execute("UPDATE shopify_cart_sessions SET draft_order_attempt_id = ?, draft_order_snapshot_hash = ?, draft_order_id = NULL, updated_at = NOW(3) WHERE id = ? AND user_id = ? AND site_id = ?", [attemptId, snapshotHash, session.id, access.userId, access.site.id]);
}

async function saveDraftOrderReady({ access, session, attemptId, snapshotHash, draftOrderId }) {
  await getDbPool().execute("UPDATE shopify_cart_sessions SET draft_order_attempt_id = ?, draft_order_snapshot_hash = ?, draft_order_id = ?, updated_at = NOW(3) WHERE id = ? AND user_id = ? AND site_id = ?", [attemptId, snapshotHash, draftOrderId, session.id, access.userId, access.site.id]);
}

async function markShopifyCartSynchronized(sessionId, access, discountSelections = []) {
  if (!sessionId) return;
  await getDbPool().execute("UPDATE shopify_cart_sessions SET discount_context_json = ?, draft_order_attempt_id = NULL, draft_order_snapshot_hash = NULL, draft_order_id = NULL, cart_revision = GREATEST(cart_revision + 1, 1), updated_at = NOW(3) WHERE id = ? AND user_id = ? AND site_id = ?", [serializeShopifyCartDiscountSelections(discountSelections), sessionId, access.userId, access.site.id]);
}

async function ensureShopifyCartRevision(session, access) {
  const current = Math.trunc(Number(session?.cart_revision || 0));
  if (current > 0) return current;
  await getDbPool().execute("UPDATE shopify_cart_sessions SET cart_revision = 1, updated_at = NOW(3) WHERE id = ? AND user_id = ? AND site_id = ? AND cart_revision = 0", [session.id, access.userId, access.site.id]);
  return 1;
}

export function hashShopifyCartId(cartId = "") { return createHash("sha256").update(String(cartId || "")).digest("hex"); }

export function normalizeShopifyCartDiscount(value = null) {
  const source = value && typeof value === "object" ? value : {};
  const code = String(source.code || "").trim().toUpperCase().slice(0, 64);
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code)) return null;
  return {
    offerId: String(source.offerId || "").trim().slice(0, 128),
    code,
  };
}

export function normalizeShopifyCartDiscounts(values = null) {
  const rows = Array.isArray(values) ? values : values ? [values] : [];
  const unique = new Map();
  for (const row of rows) {
    const discount = normalizeShopifyCartDiscount(row);
    if (discount && !unique.has(discount.code)) unique.set(discount.code, discount);
  }
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, 5);
}

// Cart calculation needs the Shopify rule as well as the durable code/id
// snapshot. Keep the rule only after the offer was re-resolved on the server.
export function normalizeTrustedShopifyCartDiscountSelections(values = null) {
  const rows = Array.isArray(values) ? values : values ? [values] : [];
  const unique = new Map();
  for (const row of rows) {
    const discount = normalizeShopifyCartDiscount(row);
    if (!discount || unique.has(discount.code)) continue;
    unique.set(discount.code, { ...row, ...discount });
  }
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, 5);
}

export function parseShopifyCartDiscountSnapshot(value = null) {
  if (!value) return null;
  try {
    return normalizeShopifyCartDiscounts(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return [];
  }
}

function normalizeSelectedOfferIds(product = {}) {
  const ids = Array.isArray(product?.selectedDiscountOfferIds) && product.selectedDiscountOfferIds.length
    ? product.selectedDiscountOfferIds
    : product?.selectedDiscountOfferId ? [product.selectedDiscountOfferId] : [];
  return [...new Set(ids.map((value) => String(value || "").trim()).filter(Boolean))].sort().slice(0, 5);
}

function serializeShopifyCartDiscountSelections(values = []) {
  const selections = normalizeShopifyCartDiscountSelections(values);
  return selections.length ? JSON.stringify({ selections }) : null;
}

function parseShopifyCartDiscountSelections(value = null) {
  if (!value) return null;
  try {
    const source = typeof value === "string" ? JSON.parse(value) : value;
    return normalizeShopifyCartDiscountSelections(Array.isArray(source?.selections) ? source.selections : [source]);
  } catch {
    return [];
  }
}

function normalizeShopifyCartDiscountSelections(values = []) {
  const unique = new Map();
  for (const source of Array.isArray(values) ? values : []) {
    const offerId = String(source?.offerId || "").trim().slice(0, 128);
    if (!offerId || unique.has(offerId)) continue;
    unique.set(offerId, {
      offerId,
      characterId: String(source?.characterId || "").trim().slice(0, 128),
      messageId: String(source?.messageId || "").trim().slice(0, 128),
    });
  }
  return [...unique.values()].sort((left, right) => left.offerId.localeCompare(right.offerId)).slice(0, 5);
}

function draftOrderTag(attemptId) { return `aiove-draft-${String(attemptId || "").slice(-24)}`; }

const CUSTOMER_DISCOUNT_ORDERS_QUERY = `
query AioveCustomerDiscountHistory($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { discountCodes }
  }
}`;
