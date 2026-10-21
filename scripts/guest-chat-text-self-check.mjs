import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSourceBundle } from "./source-bundle.mjs";

const guestRouteSource = readFileSync("server/guest-chat-routes.js", "utf8");
const guestServiceSource = readSourceBundle([
  "server/guest-chat-service.js",
  "server/guest-session-service.js",
  "server/guest-message-quota-policy.js",
  "server/guest-turn-service.js",
  "server/guest-reply-service.js",
]);
const productRouteSource = readFileSync("server/product-search-routes.js", "utf8");
const navigationSource = readFileSync("src/app/app-navigation.js", "utf8");
const mainSource = readFileSync("src/app/main.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const siteCopySource = readFileSync("src/i18n/site-copy.js", "utf8");
const chatTextActionsSource = readFileSync("src/app/chat-text-actions.js", "utf8");
const searchStateSource = readFileSync("src/features/search/search-product-state.js", "utf8");
const analyticsSource = readFileSync("src/services/product-analytics-service.js", "utf8");
const originSource = readFileSync("server/request-origin-service.js", "utf8");
const networkLimitSource = readFileSync("server/guest-network-rate-limit-service.js", "utf8");
const memoryRunnerSource = readFileSync("server/memory-job-runner-service.js", "utf8");
const productSanitizerSource = readFileSync("server/guest-product-sanitizer.js", "utf8");
const outputPolicySource = readFileSync("server/guest-chat-output-policy.js", "utf8");
const { toGuestSafeProductSearchResult, toGuestSafeResolvedProduct } = await import("../server/guest-product-sanitizer.js");
const { normalizeGuestReplyText, sanitizeGuestReplyText } = await import("../server/guest-chat-output-policy.js");
const {
  GUEST_MESSAGE_LIMIT,
  GUEST_RATE_LIMIT,
  resolveGuestMessageQuotaState,
} = await import("../server/guest-message-quota-policy.js");

assert.match(guestRouteSource, /\/api\/guest\/capability/, "guest capability endpoint should exist");
assert.match(guestRouteSource, /\/api\/guest\/session/, "guest session endpoint should exist");
assert.match(guestRouteSource, /\/api\/guest\/messages/, "guest message endpoint should exist");
assert.match(guestRouteSource, /assertPublicAppOrigin/, "guest writes should enforce public-app origin checks");
assert.match(guestRouteSource, /GET[\s\S]*\/api\/guest\/session[\s\S]*assertPublicAppOrigin/, "guest session creation should enforce public-app origin checks");
assert.match(originSource, /SERVER_CONFIG\.publicBaseUrl/, "guest origin checks should use the configured public app origin");
assert.match(guestRouteSource, /maxAgeSeconds: 0/, "invalid guest cookies should be revoked");

assert.match(guestServiceSource, /const GUEST_MESSAGE_LIMIT = 30/, "guest text quota should be 30 messages");
assert.match(guestServiceSource, /const GUEST_RATE_LIMIT = 10/, "guest short-window rate limit should be 10 messages");
assert.match(guestServiceSource, /FOR UPDATE/, "guest quota mutation should lock the guest row");
assert.match(guestServiceSource, /client_message_id = \?/, "guest sends should deduplicate by client message id");
assert.match(guestServiceSource, /acquireDedicatedDbAdvisoryLock\(lockName, 30\)/, "guest AI replies should use a dedicated single-generation lock pool");
assert.match(guestServiceSource, /guest-reply:\$\{prepared\.message\.id\}/, "guest replies should be addressable by the user message");
assert.match(guestServiceSource, /s\.slug = \?/, "guest cookie recovery should remain bound to the requested site");
assert.match(guestServiceSource, /windowExpired \? 0/, "expired rolling message windows should reopen the composer");
assert.match(guestServiceSource, /s\.site_status = 'active'/, "existing guest sessions should stop when their site is inactive");
assert.match(guestServiceSource, /normalizeMessageText/, "guest text should reuse the formal chat input normalizer");
assert.match(guestServiceSource, /guest_character_sessions/, "guest roles should keep independent session and quota rows");
assert.match(guestServiceSource, /loadGuestCharacterForDb/, "guest role activation should revalidate the selected role on the server");
assert.match(guestServiceSource, /category_id <> 'creator' OR site_id = \?/, "creator guest roles should remain site-scoped");
assert.match(guestServiceSource, /listGuestConversationContacts/, "guest refresh should restore only server-derived conversation contacts");
assert.match(guestRouteSource, /x-guest-character-id/, "guest media writes should be scoped to the active role");
assert.match(guestRouteSource, /assertGuestRequest/, "signed-in users should be rejected by guest session and message routes");
assert.match(networkLimitSource, /SESSION_CREATE_LIMIT = 12/, "guest session creation should have a hashed-network cost guard");
assert.match(networkLimitSource, /MESSAGE_LIMIT = 60/, "guest messages should have a hashed-network cost guard");
assert.match(networkLimitSource, /createHash\("sha256"\)/, "guest network identifiers should be irreversibly hashed");
assert.match(networkLimitSource, /cleanupExpiredGuestNetworkLimits/, "guest network cost rows should have an explicit retention cleanup");
assert.match(memoryRunnerSource, /MAINTENANCE_ENQUEUE_INTERVAL_MS/, "guest network cleanup should be re-enqueued while the service remains running");
assert.match(memoryRunnerSource, /enqueuePeriodicMemoryMaintenanceJobs/, "guest network cleanup should use the periodic maintenance runner");
assert.match(outputPolicySource, /Never provide, invent, reveal, or promise a discount code/, "guest prompts should forbid promotion entitlements");

assert.equal(GUEST_MESSAGE_LIMIT, 30);
assert.equal(GUEST_RATE_LIMIT, 10);
const quotaNow = new Date("2026-07-13T10:00:00.000Z");
const activeQuota = resolveGuestMessageQuotaState({
  id: "guest_quota_check",
  db_now: quotaNow,
  message_window_started_at: new Date("2026-07-13T09:00:00.000Z"),
  message_window_count: 29,
  rate_window_started_at: new Date("2026-07-13T09:55:00.000Z"),
  rate_window_count: 9,
}, { reservedCount: 1 });
assert.equal(activeQuota.messageLimitReached, true, "reserved voice/call turns should count toward the shared limit");
assert.equal(activeQuota.rateLimitReached, true, "reserved turns should count toward the short-window limit");
const resetQuota = resolveGuestMessageQuotaState({
  id: "guest_quota_reset_check",
  db_now: quotaNow,
  message_window_started_at: new Date("2026-07-12T09:59:59.000Z"),
  message_window_count: 30,
  rate_window_started_at: new Date("2026-07-13T09:49:59.000Z"),
  rate_window_count: 10,
});
assert.equal(resetQuota.messageLimitReached, false, "expired message windows should reopen the shared quota");
assert.equal(resetQuota.rateLimitReached, false, "expired short windows should reopen the rate quota");
assert.deepEqual(resetQuota.updateValues, [quotaNow, 1, quotaNow, 1, "guest_quota_reset_check"]);

assert.match(navigationSource, /\["discover", "search", "kitshop", "chat"\]/, "guest navigation should allow only the approved public browse and chat views");
assert.doesNotMatch(navigationSource, /guestRestrictedCharacter/, "guest navigation should not reintroduce the obsolete mascot-only role gate");
assert.match(mainSource, /getGuestChatCapability/, "app startup should probe the site guest-chat switch");
assert.match(mainSource, /\["login", "register", "forgot-password", "discover", "search", "kitshop", "create", "chat"\]\.includes\(initialView\)/, "guest capability should survive auth-view refresh and approved public guest views");
assert.match(mainSource, /sessionResult\?\.authenticated[\s\S]*activateGuestCapability/, "guest capability should activate only after the auth probe confirms an anonymous visitor");

assert.match(chatPageSource, /messageCount < 20/, "registration prompt should remain hidden before message 20");
assert.match(chatPageSource, /copy\.t\("chat\.freeUsed", \{ count: messageLimit \}\)/, "hard-limit prompt should use the site-language copy registry");
assert.match(siteCopySource, /"chat\.freeUsed": "You've used your \{count\} free messages\."/, "English hard-limit copy should explain the exhausted allowance");
assert.match(chatPageSource, /guestLimitReached/, "chat composer should disable at the guest limit");
assert.match(chatTextActionsSource, /guestPendingRequestByCharacterId/, "failed guest sends should retain their request id for retry");
assert.match(chatTextActionsSource, /sendingByCharacterId\[normalizedCharacterId\]/, "guest double submits should be locked in the client");
assert.match(chatTextActionsSource, /scheduleGuestLimitReset\?\./, "normal guest sends should schedule rolling-window recovery at the hard limit");
assert.match(chatTextActionsSource, /refreshed\?\.guest[\s\S]*scheduleGuestLimitReset\?\./, "hard-limit recovery after a 429 should schedule rolling-window recovery");
const guestSubmitBranch = chatTextActionsSource.split("if (appState.chat.guest?.active && !appState.session.authenticated)")[1]?.split("const productPanelMountGuard")[0] || "";
const guestBeforeSend = guestSubmitBranch.split("try {")[0] || "";
assert.doesNotMatch(guestBeforeSend, /mountApp\(\);/, "guest submit should preserve the composer optimistic message until the response arrives");
assert.equal((guestSubmitBranch.match(/mountApp\(\);/g) || []).length, 1, "guest submit should remount exactly once after the request settles");
assert.match(guestSubmitBranch, /appState\.chat\.scrollRestore = null[\s\S]*mountApp\(\);/, "guest submit should clear stale scroll restoration before its final remount");

assert.match(productRouteSource, /assertGuestBrowsingEnabled/, "anonymous product search should require an enabled guest site");
assert.match(productRouteSource, /toGuestSafeProductSearchResult/, "anonymous product search should return a guest-safe DTO");
assert.match(productRouteSource, /toGuestSafeResolvedProduct/, "anonymous product resolve should return a guest-safe DTO");
assert.match(productSanitizerSource, /return \{[\s\S]*productId:/, "guest product DTO should be rebuilt from a whitelist");
assert.match(searchStateSource, /guestMode/, "guest product search should use silent unauthorized handling");
assert.match(analyticsSource, /notifyUnauthorized = true/, "formal product analytics should preserve normal auth-expiry behavior");

const guestProductResult = toGuestSafeProductSearchResult({
  ok: true,
  query: "shirt",
  site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com", paymentMethods: ["visa"] },
  items: [{
    id: "shirt-1",
    name: "Blue shirt",
    price: "$59.99",
    priceWas: "$119.99",
    url: "https://footballkituk.com/products/blue-shirt",
    code: "SAVE20",
    discountCode: "SAVE20",
    campaignId: "campaign-1",
    tag: "20% off",
    summary: "Use code SAVE20",
    features: ["Code: SAVE20"],
  }],
});
const serializedGuestProduct = JSON.stringify(guestProductResult);
assert.doesNotMatch(serializedGuestProduct, /SAVE20|campaign-1|priceWas|discountCode|features/, "guest product DTO should not expose promotion fields");
assert.equal(guestProductResult.items[0].url, "https://footballkituk.com/products/blue-shirt", "guest product links should remain on the frozen storefront");
assert.doesNotMatch(sanitizeGuestReplyText("Use promo code SAVE20 today."), /SAVE20/, "guest replies should strip generated promotion codes");
assert.doesNotMatch(sanitizeGuestReplyText("SAVE20 gets you 20% off."), /SAVE20/, "guest replies should strip leading promotion codes");
assert.doesNotMatch(sanitizeGuestReplyText("Your discount is SAVE20."), /SAVE20/, "guest replies should strip discount-value promotion codes");
assert.equal(sanitizeGuestReplyText("This shirt is 20% off today."), "Discounts are available after you create an account.", "guest replies should strip generic percentage offers");
assert.equal(sanitizeGuestReplyText("I can get you a member-only benefit."), "Discounts are available after you create an account.", "guest replies should strip generic member benefits");
assert.equal(sanitizeGuestReplyText("Discounts are available after you create an account."), "Discounts are available after you create an account.", "guest replies should preserve the approved registration notice");
assert.equal(sanitizeGuestReplyText("At the moment I can only see 2XXL in that listing."), "At the moment I can only see 2XXL in that listing.", "size tokens must not be mistaken for discount codes");
assert.equal(
  normalizeGuestReplyText({ text: "Yes, please send the tracking code.", userText: "Can I send you the tracking code they sent me?" }),
  "Thanks for sending it. I’m sorry, but I can’t check live tracking or verify a tracking number in this chat yet. Please use the carrier’s tracking page or contact the store support team with your order number and delivery address. If you share the tracking status text, I can help explain it.",
  "guest tracking questions should receive the official live-tracking capability boundary instead of a discount notice"
);
assert.match(
  normalizeGuestReplyText({
    text: "",
    languageCode: "Hungarian",
    userText: "Fuvarlevélszám CR436184236DE rendelés iránt érdeklődnék",
  }),
  /Sajnos innen még nem tudom élőben ellenőrizni/i,
  "Hungarian tracking references must use the controlled Hungarian boundary instead of an English fallback"
);
assert.match(
  normalizeGuestReplyText({ text: "Thanks, I have it.", userText: "GV634408625GB" }),
  /can’t check live tracking/i,
  "tracking-number-only messages must not be mistaken for discount codes"
);
for (const leakedCode of [
  "SAVE20",
  "Use SAVE20",
  "SAVE20 for you.",
  "Here: ABC10",
  "优惠码 SAVE20",
  "使用 MILLIE20",
  "First sentence is safe. Use SAVE20 on the next one.",
]) {
  assert.equal(sanitizeGuestReplyText(leakedCode), "Discounts are available after you create an account.", `guest replies should strip coupon-shaped output: ${leakedCode}`);
}

const safeResolvedProduct = toGuestSafeResolvedProduct({
  ok: true,
  site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
  item: { name: "Blue shirt", url: "https://evil.example/checkout", imageUrl: "https://evil.example/shirt.jpg" },
  sourceItem: { name: "Blue shirt", url: "https://footballkituk.com/products/blue-shirt", imageUrl: "https://footballkituk.com/images/blue-shirt.jpg" },
  resolvedFromSource: true,
});
assert.equal(safeResolvedProduct.item.url, "https://footballkituk.com/products/blue-shirt", "guest resolve should use only the source-owned product URL");
assert.equal(safeResolvedProduct.item.imageUrl, "https://footballkituk.com/images/blue-shirt.jpg", "guest resolve should use only the source-owned product image");
const unmatchedGuestProduct = toGuestSafeResolvedProduct({
  ok: true,
  site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
  item: { name: "Fake shirt", url: "https://evil.example/checkout", imageUrl: "https://evil.example/shirt.jpg" },
  resolvedFromSource: false,
});
assert.equal(unmatchedGuestProduct.item.url, "", "unmatched guest resolve should not echo a client product URL");
assert.equal(unmatchedGuestProduct.item.imageUrl, "", "unmatched guest resolve should not echo a client product image");

console.log("guest chat text self-check passed");
