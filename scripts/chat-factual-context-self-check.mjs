import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
let realNetworkAttempts = 0;
globalThis.fetch = async () => { realNetworkAttempts += 1; throw new Error("Real network forbidden"); };
const { shouldTriggerBraveSearch, searchBraveLlmContext } = await import("../server/brave-search-service.js");
const config = { enabled: true, apiKey: "isolated-fixture-key", baseUrl: "https://search.example.test/v1", timeoutMs: 120, minIntervalMs: 0, maxResults: 5 };
const recordLog = async () => {};
let checks = 0;
const equal = (actual, expected) => { checks += 1; assert.deepEqual(actual, expected); };
const ok = (value) => { checks += 1; assert.ok(value); };
equal(shouldTriggerBraveSearch("world cup", { config }), true);
equal(shouldTriggerBraveSearch("world cup", { config: { enabled: false } }), false);
equal(shouldTriggerBraveSearch("world cup", { config, knowledgeItems: [{}] }), false);

const { resolveChatFactualContext } = await import("../server/chat-factual-context-service.js");
const { factualReviewRequired, toFactualReviewContext } = await import('../server/chat-factual-policy.js');
const now = new Date("2026-10-10T00:05:00.000Z");
const webDecision = { ok: true, confident: true, webSearchIntent: true, primaryIntent: "web_search" };
const calls = [];
const reference = { title: "Official fixture", content: "Only this excerpt is supplied.", url: "https://example.test/event" };
const search = async (query, options) => { calls.push({ query, options }); return { searched: true, items: [reference] }; };
const resolve = (options = {}) => resolveChatFactualContext({ userText: "¿Quién ganó el campeonato?", jevDecision: webDecision, now, config, search, recordLog, ...options });
let result = await resolve();
equal(result.decisionSource, "jev");
equal(result.status, "matched"); equal(result.required, true); equal(result.items, [reference]); equal(result.searched, true);
equal(result.asOfUtc, now.toISOString()); equal(result.timeZone, "UTC"); equal(calls.length, 1);
equal(calls[0].query, "¿Quién ganó el campeonato?");
ok(!("recentMessages" in calls[0].options));
equal((await resolve({ config: { ...config, enabled: false, apiKey: "" } })).status, "disabled");
equal((await resolve({ config: { ...config, apiKey: "" } })).required, true);
equal(calls.length, 1);
equal((await resolve({ userText: "" })).required, false);
const beforeControls = calls.length;
equal((await resolve({ userText: "\u0000\n\t\u007f" })).status, "not_required");
equal(calls.length, beforeControls);
equal((await resolve({ userText: "world cup", jevDecision: { ...webDecision, webSearchIntent: false } })).status, "not_required");
equal((await resolve({ userText: "world cup", jevDecision: { ok: false } })).status, "not_required");
equal((await resolve({ userText: "world cup", jevDecision: { ok: false } })).decisionSource, "jev_unavailable");
equal((await resolve({ jevDecision: { ...webDecision, webSearchScore: .93 } })).webSearchScore, .93);
equal((await resolve({ jevDecision: { ...webDecision, webSearchScore: "private" } })).webSearchScore, null);

equal((await resolve({ userText: "world cup", jevDecision: { ...webDecision, confident: false } })).status, "not_required");
equal((await resolve({ userText: "just chatting", jevDecision: { ok: false } })).status, "not_required");
equal((await resolve({ search: async () => ({ searched: true, items: [] }) })).status, "no_result");
equal((await resolve({ search: async () => ({ searched: true, items: [], error: "HTTP_429" }) })).status, "error");
equal((await resolve({ search: async () => { throw Error("secret provider detail"); } })).reason, "search_error");
equal((await resolve({ search: async () => ({ searched: false, items: [reference] }) })).status, "error");
equal((await resolve({ search: async () => ({ searched: true, items: [{ url: reference.url }] }) })).status, "no_result");
equal((await resolve({ search: async () => ({ searched: true, items: [{ ...reference, content: { private: "not evidence" } }] }) })).status, "no_result");
equal((await resolve({ search: async () => ({ searched: true, items: [{ ...reference, url: "javascript:alert(1)" }] }) })).status, "no_result");
equal((await resolve({ search: async () => ({ searched: true, items: [{ ...reference, url: "http://localhost/private" }] }) })).status, "no_result");
equal((await resolve({ search: async () => ({ searched: true, items: [{ ...reference, url: "http://0.0.0.0/private" }] }) })).status, "no_result");

for (const searchIntent of [
  { knowledgeScope: "business" }, { commerceRoute: "store_policy" }, { commerceRoute: "product_question" },
  { commerceRoute: "product_search" }, { customerServiceKnowledgeRequest: true }, { businessInquiry: {} },
  { checkoutIssue: {} }, { humanHandoff: {} }, { promotionInquiry: {} },
]) {
  const before = calls.length; result = await resolve({ searchIntent });
  equal(result.status, "blocked"); equal(result.required, true); equal(calls.length, before);
}
equal((await resolve({ jevDecision: { ...webDecision, orderIntent: "lookup" } })).status, "blocked");
equal((await resolve({ jevDecision: { ...webDecision, primaryIntent: "order_lookup" } })).status, "blocked");
const pureShoppingIntent = { commerceRoute: 'product_search', knowledgeScope: 'business', commerceConfidence: .9, answerRequired: false };
const weakNoWeb = { ok: true, confident: false, primaryIntent: 'product_request', webSearchIntent: false, imageIntent: 'none', orderIntent: 'none' };
for (const userText of ['Find the Soccer Fun Jersey.', 'Find the World Cup fan shirt.', 'Find the Player edition jersey.', 'Find the History collection shirt.']) {
  const before = calls.length;
  result = await resolve({ userText, jevDecision: weakNoWeb, searchIntent: pureShoppingIntent });
  equal(result.required, false); equal(result.status, 'not_required'); equal(result.asOfUtc, now.toISOString()); equal(calls.length, before);
  equal(result.decisionSource, 'catalogue_scope');
  equal(factualReviewRequired(result), true); equal(toFactualReviewContext(result).required, false);
}
for (const patch of [{ answerRequired: true }, { answerRequired: undefined }, { commerceConfidence: .74 }, { commerceConfidence: 1.01 }, { commerceConfidence: '0.99' },
  { commerceClassificationUnavailable: true }, { commerceClassificationFailure: 'parse' }, { productScopePending: true }, { scopeUnverified: true },
  { productRequestState: { status: 'selected', items: [{}, {}] } }, { checkoutIssue: {} }, { humanHandoff: {} }, { businessInquiry: {} }, { promotionInquiry: {} }, { discountExplanationRequired: true }]) {
  const before = calls.length;
  result = await resolve({ userText: 'Find a World Cup jersey.', jevDecision: weakNoWeb, searchIntent: { ...pureShoppingIntent, ...patch } });
  equal(result.required, false); equal(result.status, 'not_required'); equal(calls.length, before);
}
for (const decision of [{ ...weakNoWeb, webSearchIntent: true }, { ...weakNoWeb, primaryIntent: 'web_search' }, { ...webDecision, primaryIntent: 'product_request' },
  { ...weakNoWeb, imageIntent: 'try_on' }, { ...weakNoWeb, orderIntent: 'lookup' }]) {
  const before = calls.length;
  result = await resolve({ userText: 'Find a World Cup jersey and tell me who won it.', jevDecision: decision, searchIntent: pureShoppingIntent });
  const reliable = decision.ok === true && decision.confident === true && decision.webSearchIntent === true;
  equal(result.required, reliable); equal(result.status, reliable ? 'blocked' : 'not_required'); equal(calls.length, before);
}
for (const userText of ['Find a jersey and tell me who won the current World Cup.', 'Find a jersey and tell me who won the 1998 World Cup.', 'Find a jersey and tell me who the current national team captain is.']) {
  const before = calls.length;
  result = await resolve({ userText, jevDecision: webDecision, searchIntent: { ...pureShoppingIntent, answerRequired: true } });
  equal(result.required, true); equal(result.status, 'blocked'); equal(calls.length, before);
}
equal((await resolve({ searchIntent: { knowledgeScope: "general", replyBoundary: { salesAllowed: false, contactAllowed: false } } })).status, "matched");
for (const userText of [
  "world cup and mail me at private@example.test", "world cup 123456789", "world cup +1 (555) 123-4567",
  "world cup Bearer fixture-secret-token", "world cup password=private", "world cup sk-isolatedsecret123",
  "world cup https://example.test/orders/abc", "world cup https://example.test/article?token=private",
  "world cup https://name:password@example.test/", "world cup http://127.0.0.1/private",
  "world cup https://example.test/#token=private", "world cup 123e4567-e89b-12d3-a456-426614174000",
  "world cup mail ｍｅ＠ｅｘａｍｐｌｅ．ｔｅｓｔ", "world cup ١٢٣٤٥٦٧٨٩", "world cup +١ (٥٥٥) ١٢٣-٤٥٦٧",
  "world cup cookie=private", "world cup abcdefghijklmnopqrstuvwxyz0123456789", "world cup http://0.0.0.0/private",
  "world cup http://internal-host/private", "world cup http://demo.localhost/private",
]) {
  const before = calls.length; result = await resolve({ userText });
  equal(result.status, "blocked"); equal(result.searched, false); equal(result.items, []); equal(calls.length, before);
}
equal((await resolve({ userText: "What happened on 2026-10-01?" })).status, "matched");
const longText = `world cup ${"publicword ".repeat(100)}`;
await resolve({ userText: longText });
ok(Array.from(calls.at(-1).query).length <= 600); ok(calls.at(-1).query.split(/\s+/).length <= 75);
const beforePrivateSuffix = calls.length;
equal((await resolve({ userText: `world cup ${"word ".repeat(200)} private@example.test` })).status, "blocked");
equal(calls.length, beforePrivateSuffix);

const providerCalls = [], logs = [];
const fetchImpl = async (url, options) => {
  providerCalls.push({ url: new URL(url), options });
  return { ok: true, json: async () => ({ web: { results: [{ title: reference.title, description: reference.content, url: reference.url }] } }) };
};
for (const [language, country, expected] of [["Spanish", "MX", "es"], ["zh", "CN", "zh-hans"], ["zh-Hant", "TW", "zh-hant"], ["Norwegian", "NO", "nb"], ["Portuguese", "BR", "pt-br"], ["pt", "PT", "pt-pt"], ["Japanese", "JP", "ja"], ["Indonesian", "ID", "en"], ["fake", "unknown", "en"]]) {
  result = await searchBraveLlmContext("world cup", { config, fetchImpl, recordLog: async (log) => logs.push(log), searchLang: language, country, logContext: { sessionId: "fixture-session", query: "must not log", email: "must not log" } });
  equal(result.searched, true); equal(providerCalls.at(-1).url.searchParams.get("search_lang"), expected);
  equal(providerCalls.at(-1).url.searchParams.get("country"), country === "unknown" ? "US" : country);
}
await searchBraveLlmContext(longText, { config, fetchImpl, recordLog });
const query = providerCalls.at(-1).url.searchParams.get("q");
ok(query.length <= 600); ok(query.split(/\s+/).length <= 75);
equal(providerCalls.at(-1).url.searchParams.get("safesearch"), "strict");
equal(providerCalls.at(-1).options.headers["X-Subscription-Token"], config.apiKey);
await Promise.resolve();
ok(logs.length > 0); ok(!JSON.stringify(logs).includes("must not log")); ok(!JSON.stringify(logs).includes(config.apiKey));
const beforeDisabled = providerCalls.length;
equal((await searchBraveLlmContext("world cup", { config: { ...config, enabled: false }, fetchImpl, recordLog })).searched, false);
equal((await searchBraveLlmContext("world cup", { config: { ...config, apiKey: "" }, fetchImpl, recordLog })).searched, false);
equal(providerCalls.length, beforeDisabled);
equal((await searchBraveLlmContext("world cup", { config, recordLog, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "SECRET" } }) }) })).error, "HTTP_429");
equal((await searchBraveLlmContext("world cup", { config, recordLog, fetchImpl: async () => { throw Error("PRIVATE"); } })).error, "NETWORK_ERROR");
const errorLogs = [];
await searchBraveLlmContext("world cup", { config, recordLog: async (log) => errorLogs.push(log), fetchImpl: async () => ({ ok: false, status: 429 }) });
await Promise.resolve(); equal(errorLogs.at(-1).error, { statusCode: 429 });

// A provider ignoring abort must not hold the queue or later start expired queued requests.
let blockedFetches = 0, lateFetches = 0;
const startedAt = Date.now();
const blocked = searchBraveLlmContext("first public fact", { config: { ...config, timeoutMs: 80 }, recordLog, fetchImpl: async () => { blockedFetches += 1; return new Promise(() => {}); } });
let skippedProviderLogs = 0;
const expired = searchBraveLlmContext("second public fact", { config: { ...config, timeoutMs: 20 }, recordLog: async () => { skippedProviderLogs += 1; }, fetchImpl: async () => { lateFetches += 1; return { ok: true, json: async () => ({}) }; } });
result = await expired; equal(result.error, "TIMEOUT"); equal(result.searched, false);
equal(skippedProviderLogs, 0);
ok(Date.now() - startedAt < 200);
equal((await blocked).error, "TIMEOUT");
await new Promise((resolve) => setTimeout(resolve, 35));
equal(blockedFetches, 1); equal(lateFetches, 0);
equal((await searchBraveLlmContext("third public fact", { config, fetchImpl, recordLog })).searched, true);
// The rate-limit wait consumes the same budget and must not fetch after expiry.
await searchBraveLlmContext("rate-limit anchor", { config: { ...config, minIntervalMs: 90 }, fetchImpl, recordLog });
const duringWait = providerCalls.length;
result = await searchBraveLlmContext("expire during wait", { config: { ...config, timeoutMs: 20 }, fetchImpl, recordLog });
equal(result.error, "TIMEOUT"); equal(result.searched, false);
await new Promise((resolve) => setTimeout(resolve, 100)); equal(providerCalls.length, duringWait);
const independentWeb = await resolve({ jevDecision: { ...webDecision, confident: false, webSearchScore: .98 } });
equal(independentWeb.required, true); equal(independentWeb.decisionSource, 'jev');
equal(realNetworkAttempts, 0);
console.log(`chat factual context isolated checks passed (${checks} assertions, no real network/database/provider, queue deadlines included)`);
