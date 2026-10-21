import { readJson, readAuthToken, sendJson } from "./http-utils.js";
import { requireAuth } from "./auth-service.js";
import { getDbPool } from "./db.js";
import { resolveProductCheckoutProduct } from "./product-checkout-resolver-service.js";
import { resolveSearchSite } from "./product-search-site-service.js";
import { isShopifyAdminProductSource, isShopifyPublicProductSource } from "./product-source-service.js";
import { resolveCharacterDiscountOffers } from "./discount-code-eligibility-service.js";
import { buildShopifyDiscountLink, buildShopifyNoDiscountLink, resolveSameOriginTarget } from "./shopify-discount-link-service.js";
import { validateShopifyDiscountCode } from "./shopify-discount-validation-service.js";
import { createPublicError } from "./public-error-utils.js";

export async function handleProductCheckoutRoute(req, res, { path } = {}) {
  if (path !== "/api/products/checkout-link" || req.method !== "POST") return false;
  const user = await requireAuth(req, readAuthToken);
  const body = await readJson(req, 128 * 1024).catch(() => ({}));
  const siteSlug = String(body.siteSlug || body.site_slug || body.product?.siteSlug || "").trim();
  const characterId = String(body.characterId || body.character_id || "").trim();
  const messageId = String(body.messageId || body.message_id || "").trim();
  const discountOfferId = String(body.discountOfferId || body.discount_offer_id || "").trim();
  const selectedSizeIndex = normalizeIndex(body.selectedSizeIndex ?? body.selected_size_index);
  if (!siteSlug || !characterId || !messageId || !discountOfferId) {
    throw createPublicError("缺少购买折扣上下文", 400, "DISCOUNT_CODE_CONTEXT_REQUIRED");
  }

  const resolved = await resolveProductCheckoutProduct({
    siteSlug,
    product: body.product,
    strictSite: true,
  });
  if (resolved?.resolvedFromSource !== true) {
    throw createPublicError("当前商品暂时无法生成付款链接", 409, "PRODUCT_VARIANT_UNAVAILABLE");
  }
  const sourceSite = await resolveSearchSite(siteSlug, { allowDefault: false });
  if (!isShopifyAdminProductSource(sourceSite?.product_api_url) && !isShopifyPublicProductSource(sourceSite?.product_api_url)) {
    throw createPublicError("当前站点不支持自动带码购买", 409, "DISCOUNT_LINK_UNSUPPORTED");
  }
  const item = resolved?.item && typeof resolved.item === "object" ? resolved.item : {};
  const storefrontUrl = resolved?.site?.storefrontUrl || resolved?.site?.siteUrl || "";
  const targetUrl = resolveSelectedTarget(item, selectedSizeIndex, storefrontUrl);
  const offers = await resolveCharacterDiscountOffers(getDbPool(), {
    userId: user.id,
    characterId,
    messageId,
    siteId: resolved?.site?.id || user.site_id || "",
  });
  const offer = offers.offers.find((candidate) => candidate.id === discountOfferId);
  if (!offer) throw createPublicError("折扣码已失效或无权使用", 409, "DISCOUNT_CODE_UNAVAILABLE");
  const validation = await validateShopifyDiscountCode(sourceSite, offer.code);
  const checkoutUrl = validation.valid
    ? buildShopifyDiscountLink({ code: offer.code, targetUrl, storefrontUrl })
    : buildShopifyNoDiscountLink({ targetUrl, storefrontUrl });

  sendJson(res, 200, {
    ok: true,
    mode: validation.valid ? "discount_link" : "standard_link",
    url: checkoutUrl,
    discountOfferId: offer.id,
  });
  return true;
}

function resolveSelectedTarget(product, selectedSizeIndex, storefrontUrl) {
  const sizes = Array.isArray(product?.sizes) ? product.sizes : [];
  const hasVariantCheckout = sizes.some((size) => size?.variantId && size?.buyUrl);
  if (!hasVariantCheckout) {
    throw createPublicError("当前商品暂时无法生成付款链接", 409, "PRODUCT_VARIANT_UNAVAILABLE");
  }
  const selected = selectedSizeIndex >= 0 ? sizes[selectedSizeIndex] : null;
  if (!selected?.variantId || !selected?.buyUrl || selected.available === false) {
    throw createPublicError("请选择可购买的尺码", 400, "PRODUCT_SIZE_REQUIRED");
  }
  return resolveSameOriginTarget(selected.buyUrl, storefrontUrl).toString();
}

function normalizeIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) ? index : -1;
}
