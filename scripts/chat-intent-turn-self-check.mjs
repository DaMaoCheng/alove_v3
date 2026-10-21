import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { createChatIntentTurn, prepareChatIntentTurn } = await import("../server/chat-intent-turn-service.js");
const { classifyProductIntent } = await import("../server/product-intent-classifier-service.js");
const { classifyOrderLookup } = await import("../server/chat-order-intent-service.js");
let calls = [];
const expected = { ok: true, confident: true, primaryIntent: "try_on", productIntent: "search", productAction: .95,
  orderIntent: "lookup", imageIntent: "try_on", unsupported: false, confidence: .95, imageConditions: { wants_clothing: true } };
const classify = async (options) => { calls.push(options); return expected; };
const turn = createChatIntentTurn({ classify });
const options = { userText: "Try  this on", capabilities: { canLookupOrder: false }, conversationContext: { hasRecentImage: true } };
const [a, b] = await Promise.all([turn.classify(options), turn.classify({ ...options, userText: "Try this on" })]);
assert.equal(calls.length, 1);
assert.strictEqual(calls[0], options, "provider input must be forwarded unchanged");
assert.strictEqual(a, b);
assert.equal(a.orderIntent, "lookup", "do not discard independent mixed-intent signals");
assert.throws(() => { a.imageConditions.wants_clothing = false; }, TypeError);
assert.equal(expected.imageConditions.wants_clothing, true, "do not mutate provider data");
await turn.classify({ ...options, capabilities: { canLookupOrder: true } });
await turn.classify({ ...options, conversationContext: { hasRecentImage: false } });
assert.equal(calls.length, 3, "different legacy inputs must not be collapsed");
await turn.classify({ ...options, forceRefresh: true });
assert.equal(calls.length, 4);
let failures = 0;
const failed = createChatIntentTurn({ classify: async () => { failures++; return { ok: false, confident: false, fallbackReason: "timeout" }; } });
await Promise.all([failed.classify(options), failed.classify(options)]);
assert.equal(failures, 1, "failed request is also reused, without converting it into no intent");
calls = [];
const prepared = await prepareChatIntentTurn({ execute: async () => [[{ sender_type: "user", content_type: "attachment", text_content: "photo", product_payload_json: {} }]] },
  { session: { id: "test-session" }, character: { category_id: "mascot" }, userText: "wear this", userDisplayOrder: 20, classify, classifyCommerce: async () => ({ confident: true, confidence: .95, route: "chat" }) });
assert.deepEqual(calls[0].capabilities, { canGenerateImage: true, canRecommendProducts: true, canLookupOrder: false, canSearchWeb: true });
assert.equal(prepared.conversationContext.recentConversation[0].kind, "attachment", "retain full context for target verification");
assert.equal(prepared.decision.primaryIntent, "try_on");
const recoveryHistory = [
  { senderType: 'user', text: 'Why do these styles have different prices?', characterId: 'fixture-character' },
  { senderType: 'character', text: 'Rejected explanation', characterId: 'fixture-character', replyRecoveryState: {
    version: 1, kind: 'boundary', reviewStatus: 'valid', failedContracts: ['product_scope'], guardApplied: true,
  } },
];
calls = [];
await prepareChatIntentTurn({ execute: async () => [[]] }, { session: { id: 'fixture-session' }, character: { id: 'fixture-character', category_id: 'mascot' },
  userText: 'Please answer my question', userDisplayOrder: 40, recentMessages: recoveryHistory, siteId: 'fixture-site', classify,
  classifyCommerce: async () => ({ confident: true, confidence: .95, route: 'store_policy' }) });
assert.deepEqual(calls[0].conversationContext.unansweredUserQuestion, { text: recoveryHistory[0].text }, 'Jev receives only the user question associated with the immediately prior failed answer');
assert.equal(JSON.stringify(calls[0].conversationContext).includes('Rejected explanation'), false);
const { normalizeConversationContext } = await import('../server/jev-intent-service.js');
assert.deepEqual(normalizeConversationContext({ unansweredUserQuestion: { text: 'question', salesAllowed: true } }).unansweredUserQuestion, { text: 'question' });
assert.equal(normalizeConversationContext({ unansweredUserQuestion: { text: 'x'.repeat(1201) } }).unansweredUserQuestion, undefined);
const contextCalls = [];
const contextTurn = createChatIntentTurn({ classify: async opts => { contextCalls.push(opts); return expected; } });
await contextTurn.classify({ ...options, conversationContext: { unansweredUserQuestion: { text: 'first question' } } });
await contextTurn.classify({ ...options, conversationContext: { unansweredUserQuestion: { text: 'second question' } } });
assert.equal(contextCalls.length, 2, 'unanswered questions must not share a cached decision');
calls = [];
assert.equal((await classifyProductIntent("shirt", { classifyJev: turn.classify })).isProductRequest, true);
assert.equal(await classifyOrderLookup("my order", { classifyJev: turn.classify }), true);
assert.equal(calls[0].capabilities.canLookupOrder, false);
assert.equal(calls[1].capabilities.canLookupOrder, true);
const before = calls.length;
assert.equal((await classifyProductIntent("a".repeat(501), { classifyJev: turn.classify })).isProductRequest, false);
assert.equal(calls.length, before, "preserve product adapter length boundary");
const core = await readFile(new URL("../server/jev-intent-service.js", import.meta.url));
const source = core.toString();
// The reviewed Oct18 correction changes only web/catalogue separation and exposes its score.
// Reverse ONLY these exact deltas before checking the original immutable baseline;
// every unrelated route, question, threshold and normalization rule stays protected.
let baselineSource = source;
const reviewedDeltas = [
  [
    "  web_search: \"Needs independently requested public-world facts that require external research, including public events, results, news or records. A current-site catalogue task such as choosing merchandise, checking price, size, customization or availability is not public web research by itself.\",",
    "  web_search: \"Needs current external facts that require live web research.\","
  ],
  [
    "      instructions: \"Does the user independently ask for public-world facts such as actual events, results, news, public identities or records that require external research? Finding or choosing merchandise, product specifications, price, size, customization, stock and store policies are catalogue or store tasks, not public web research by themselves, even when product names mention a player, team or event. Mark false when fresh information is needed only for those catalogue/store tasks. If the user ALSO asks an independent public-world question, mark true even when the primary route is product_request or another action. Do not confuse a request for help selecting products with asking for public facts.\",",
    "      instructions: \"Does answering this request require current external web information?\","
  ],
  [
    "    webSearchScore: webSearch,\n",
    ""
  ]
];
for (const [current, previous] of reviewedDeltas) {
  assert.equal(baselineSource.split(current).length - 1, 1, "reviewed Jev delta must occur exactly once");
  baselineSource = baselineSource.replace(current, previous);
}
// Independent optional language fields are additive; remove only their exact
// bounded regions before comparing every original route/action rule byte-for-byte.
const languageQuestionStart = baselineSource.indexOf('    reply_language: {');
const languageQuestionEnd = baselineSource.indexOf('    wants_character_image: {', languageQuestionStart);
assert(languageQuestionStart > 0 && languageQuestionEnd > languageQuestionStart);
const languageQuestions = baselineSource.slice(languageQuestionStart, languageQuestionEnd);
assert(languageQuestions.includes('reply_language_scope: {'));
baselineSource = baselineSource.replace(languageQuestions, '');
assert.equal(baselineSource.split('    languageDecision: normalizeReplyLanguageDecision(answers),\n').length - 1, 1);
baselineSource = baselineSource.replace('    languageDecision: normalizeReplyLanguageDecision(answers),\n', '');
// Preserve the exact approved rule source while allowing the separately tested
// bounded conversation-context adapter to transport an existing target/question.
const ruleRegions = [
  ["criteria", "const ROUTE_CRITERIA", "export async function classifyJevIntent", "afbb0b796aab0edc1e5b3dc6117d6fbcf1cb94c37255e1b33e8a1a63f4f22752"],
  ["questions", "export function buildQuestions", "export function normalizeJevResponse", "6c02191683fabd4940be5fde4618049d3f913ff71d33ba58f5a431b2a5c2e39f"],
  ["decision normalization", "export function normalizeJevResponse", "export function mapJevImageIntent", "1de62642ad75422893208df592dc424663c44c2fb1d24350b603bf8c75723863"],
];
for (const [label, start, end, expectedHash] of ruleRegions) {
  const startIndex = baselineSource.indexOf(start), endIndex = baselineSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing Jev ${label} rule region`);
  assert.equal(createHash("sha256").update(baselineSource.slice(startIndex, endIndex)).digest("hex"), expectedHash,
    `approved Jev ${label} baseline changed; do not update this baseline to hide a regression`);
}
for (const unchangedLine of [
  'const MIN_ROUTE_CONFIDENCE = 0.72;',
  'const MIN_PRODUCT_ACTION_CONFIDENCE = 0.72;',
  'const CACHE_TTL_MS = 15_000;',
  'if (!text || text.length > 1200) return unavailableDecision("invalid_input");',
  'const timeout = setTimeout(() => controller.abort(), config.timeoutMs);',
]) assert.ok(source.includes(unchangedLine), `approved Jev threshold/deadline changed: ${unchangedLine}`);
console.log("chat intent turn self-check passed (request parity, isolation, reuse, mixed signals, immutable decisions, Jev baseline)");
