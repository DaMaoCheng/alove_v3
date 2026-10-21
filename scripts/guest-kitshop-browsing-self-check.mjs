import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toGuestSafeKitshopResult } from "../server/guest-product-sanitizer.js";

const sourceResult = {
  ok: true,
  site: {
    id: "site_fkk",
    name: "Football Kit UK",
    slug: "footballkituk",
    siteUrl: "https://footballkituk.com",
    storefrontUrl: "https://footballkituk.com",
    currency: "GBP",
  },
  shelves: [{
    key: "recommended",
    title: "Recommended",
    items: [{
      id: "shirt_1",
      name: "Home Shirt",
      priceNow: "£49.99",
      priceWas: "£69.99",
      code: "GUEST-MUST-NOT-SEE",
      features: ["20% off with code SECRET"],
      url: "https://footballkituk.com/products/home-shirt",
      imageUrl: "https://footballkituk.com/cdn/home-shirt.jpg",
      siteId: "site_fkk",
      siteSlug: "footballkituk",
    }, {
      id: "shirt_unsafe",
      name: "Unsafe Shirt",
      stock: "Use voucher SECRET20",
      url: "https://footballkituk.com/products/unsafe?voucher=SECRET20",
      imageUrl: "https://evil.example/tracker.png",
      sizes: [{ label: "Code SECRET20", buyUrl: "/\\evil.example/cart" }],
    }],
  }],
  cache: { refreshed: true, stale: false, lastSyncedAt: "2026-07-12T00:00:00.000Z" },
  adminWarning: "销量数据暂时不可用，已显示最近销量缓存",
};
const result = toGuestSafeKitshopResult(sourceResult);

assert.equal(result.shelves[0].items.length, 1);
assert.equal(result.shelves[0].items[0].name, "Home Shirt");
assert.equal(result.shelves[0].items[0].url, "https://footballkituk.com/products/home-shirt");
assert.equal(result.cache.refreshed, false, "guest response must not imply that the public request refreshed the source");
assert.equal(JSON.stringify(result).includes("GUEST-MUST-NOT-SEE"), false);
assert.equal(JSON.stringify(result).includes("SECRET"), false);
assert.equal(JSON.stringify(result).includes("evil.example"), false);
assert.equal("adminWarning" in result, false, "guest Kitshop responses must not expose sales operations warnings");

const unsafeUrlResult = toGuestSafeKitshopResult({
  site: sourceResult.site,
  shelves: [{ key: "unsafe", title: "Unsafe", items: [{
    id: "shirt_unsafe_url",
    name: "Unsafe URL Shirt",
    url: "//evil.example/phish",
    imageUrl: "https://evil.example/tracker.png",
    sizes: [{ label: "M", buyUrl: "/\\evil.example/cart" }],
  }] }],
});
assert.equal(unsafeUrlResult.shelves[0].items[0].url, "");
assert.equal(unsafeUrlResult.shelves[0].items[0].imageUrl, "");
assert.equal(unsafeUrlResult.shelves[0].items[0].sizes[0].buyUrl, "");

for (const promotionKey of ["discount_code", "promo_code", "coupon_code", "voucher_code", "discountCode", "voucherCode"]) {
  const promotionResult = toGuestSafeKitshopResult({
    site: sourceResult.site,
    shelves: [{ key: "promotion", title: "Promotion", items: [{
      id: `shirt_${promotionKey}`,
      name: "Promotion URL Shirt",
      url: `https://footballkituk.com/products/promotion?${promotionKey}=SECRET20`,
    }] }],
  });
  assert.equal(promotionResult.shelves[0].items.length, 0, `${promotionKey} must not enter the guest response`);
}

const routeSource = await readFile(new URL("../server/kitshop-routes.js", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("../server/kitshop-service.js", import.meta.url), "utf8");
const authRouteSource = await readFile(new URL("../server/auth-routes.js", import.meta.url), "utf8");
assert.match(routeSource, /authToken \? await requireAuth\(req, readAuthToken\) : null/, "an invalid formal auth token must not silently downgrade to guest");
assert.match(routeSource, /guestRequested[\s\S]*if \(!guestRequested && !user\) await requireAuth/, "the formal Kitshop endpoint must require auth unless the client explicitly requests guest mode");
assert.match(routeSource, /consumeGuestNetworkQuota/, "anonymous Kitshop reads should use the guest network cost guard");
assert.match(routeSource, /strictSite: true/, "all Kitshop requests should disable default-site fallback");
assert.match(serviceSource, /allowDefault: !strictSite/, "strict Kitshop lookup should reach the site resolver");
assert.match(authRouteSource, /statusCode[\s\S]*=== 401\) clearAuthCookie/, "the auth probe should clear an expired cookie before guest Kitshop loads");

console.log("guest kitshop browsing self-check passed");
