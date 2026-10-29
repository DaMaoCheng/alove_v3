import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { createChatIntentTurn, prepareChatIntentTurn } = await import("../server/chat-intent-turn-service.js");
const { classifyProductIntent } = await import("../server/product-intent-classifier-service.js");
const { classifyOrderLookup } = await import("../server/chat-order-intent-service.js");
let calls = [];
const expected = { ok: true, confident: true, primaryIntent: "try_on", productIntent: "search", productAction: 1,
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
// Ignore only the additional current-user-text argument used for exact repeated-order evidence.
baselineSource = baselineSource.replace("export function normalizeJevResponse(payload = {}, capabilities = {}, conversationContext = {}, userText = '') {", "export function normalizeJevResponse(payload = {}, capabilities = {}, conversationContext = {}) {");
// Reverse only the explicitly authorized order-evidence changes before the
// immutable hashes. Other routing fields stay in the original comparison.
const oldOrderCriteria = '  order_lookup: "Wants to inspect an existing order, shipment, delivery status, or tracking reference.",';
const newOrderCriteria = '  order_lookup: "Wants to inspect an actual existing personal order, shipment or tracking reference; general delivery times, shipping policy or hypothetical purchases are not an order lookup.",';
assert.equal(baselineSource.split(newOrderCriteria).length - 1, 1);
baselineSource = baselineSource.replace(newOrderCriteria, oldOrderCriteria);
const newQuestionHeader = 'export function buildQuestions(_capabilities = {}, conversationContext = {}) {\n  const priorUsers = orderPriorUsers(conversationContext);';
assert.equal(baselineSource.split(newQuestionHeader).length - 1, 1);
baselineSource = baselineSource.replace(newQuestionHeader, 'export function buildQuestions() {');
const orderQuestionStart = baselineSource.indexOf('    order_request_kind: {');
const orderQuestionEnd = baselineSource.indexOf('    web_search: {', orderQuestionStart);
assert(orderQuestionStart > 0 && orderQuestionEnd > orderQuestionStart);
assert(baselineSource.slice(orderQuestionStart, orderQuestionEnd).includes('order_evidence_source:'));
baselineSource = baselineSource.slice(0, orderQuestionStart) + '    order_lookup: {\n      type: "noul",\n      instructions: "Does the user want to inspect an existing order, shipment, delivery status, or tracking reference?",\n    },\n' + baselineSource.slice(orderQuestionEnd);
assert.equal(baselineSource.split('  let primaryIntent = normalizeRoute(routeAnswer.choice);').length - 1, 1);
baselineSource = baselineSource.replace('  let primaryIntent = normalizeRoute(routeAnswer.choice);', '  const primaryIntent = normalizeRoute(routeAnswer.choice);');
assert.equal(baselineSource.split('  const webSearch = readNoul(answers.web_search);').length - 1, 1);
baselineSource = baselineSource.replace('  const webSearch = readNoul(answers.web_search);', '  const orderLookup = readNoul(answers.order_lookup);\n  const webSearch = readNoul(answers.web_search);');
const orderNormalizeStart = baselineSource.indexOf('  const kind = answers.order_request_kind?.choice;');
const orderNormalizeEnd = baselineSource.indexOf('  const supported = resolveSupport(', orderNormalizeStart);
assert(orderNormalizeStart > 0 && orderNormalizeEnd > orderNormalizeStart);
baselineSource = baselineSource.slice(0, orderNormalizeStart) + '  const orderIntent = primaryIntent === "order_lookup" || orderLookup === 1 ? "lookup" : "none";\n' + baselineSource.slice(orderNormalizeEnd);
const orderOutputStart = baselineSource.indexOf('    orderRequestKind:');
const orderOutputEnd = baselineSource.indexOf('    webSearchIntent:', orderOutputStart);
assert(orderOutputStart > 0 && orderOutputEnd > orderOutputStart);
baselineSource = baselineSource.slice(0, orderOutputStart) + baselineSource.slice(orderOutputEnd);
// Undo reviewed route distinction changes only when auditing the previous baseline.
baselineSource = baselineSource.replace("  daily_chat: \"Normal conversation, a general question, a compliment, a question about the status of an earlier image, or a comment about an earlier character image or message that does not ask the system to perform a specialized action. Product mentions used as comments such as 'Bonito bikini', 'Nice shirt', or a bare team name belong here.\",", "  daily_chat: \"Normal conversation, a general question, a compliment, or a comment about an earlier character image or message that does not ask the system to perform a specialized action. Product mentions used as comments such as 'Bonito bikini', 'Nice shirt', or a bare team name belong here.\",");
baselineSource = baselineSource.replace("  new_image: \"Wants a new image of the AI character, or explicitly asks to create a supported new image. A standalone photo request in the character conversation may mean the character; do not use this route for viewing a catalogue product image, asking about an existing image's status, or an image of a third person.\",", "  new_image: \"Wants one new image or explicitly asks the character or system to create, generate, make, render, take, or compose a new image or photo. A standalone request such as 'send me one picture' counts as a new-image request; do not use this route when the user asks to see existing character photos.\",");
baselineSource = baselineSource.replace("  try_on: \"Wants the AI character to wear, try on, or model a product or outfit, including an item shown in an earlier image or message. A product image or third person wearing an outfit does not identify the AI character. This route has priority over image inspection.\",", "  try_on: \"Wants the character to wear, try on, or model a product or outfit, including asking the character to wear an item shown in an earlier image or message. This route has priority over image inspection.\",");
baselineSource = baselineSource.replace("  product_request: \"Wants to find, view a catalogue product or its existing image, recommend, compare, price, size, or check availability of a merchandise product.\",", "  product_request: \"Wants to find, recommend, compare, price, size, or check availability of a merchandise product.\",");
baselineSource = baselineSource.replace("      instructions: \"What is the user's primary requested action? First distinguish an action request from a comment or compliment. Comments such as 'Bonito bikini', 'Nice shirt', or a bare team name are daily_chat even when they mention a product. Generic or plural requests to see existing character photos go to character_photo and use the existing library first. A standalone request for one picture can count as new_image in character context, but viewing an existing catalogue product or its photo is product_request; asking whether a previous image is ready is daily_chat, not a new image request. Do not treat a third person or product as the AI character. Requests for the character to wear or try on an item from an earlier image go to try_on and override image inspection. Use unsupported_request when the user clearly asks for an unavailable specialized function. Use unclear only when the meaning is genuinely ambiguous.\",", "      instructions: \"What is the user's primary requested action? First distinguish an action request from a comment or compliment. Comments such as 'Bonito bikini', 'Nice shirt', or a bare team name are daily_chat even when they mention a product. Generic or plural requests to see existing character photos go to character_photo and use the existing library first. A standalone request for one picture counts as new_image even without the word generate. Requests to wear or try on an item from an earlier image go to try_on and override image inspection. Use unsupported_request when the user clearly asks for an unavailable specialized function. Use unclear only when the meaning is genuinely ambiguous.\",");
// The user explicitly authorized changing binary intent questions to choice.
// Undo only that mechanical protocol conversion for the original prompt audit.
baselineSource = baselineSource.replace('  const questions = {\n    route: {', '  return {\n    route: {');
baselineSource = baselineSource.replace("  for (const [key, question] of Object.entries(questions)) {\n    if (question.type === 'noul') questions[key] = { type: 'choice', instructions: question.instructions,\n      criteria: { yes: 'Yes, this applies to the current request.', no: 'No, this does not apply to the current request.' } };\n  }\n  return questions;\n", '');
baselineSource = baselineSource.replace("    confident: primaryIntent !== 'unclear',", '    confident: confidence >= MIN_ROUTE_CONFIDENCE,');
baselineSource = baselineSource.replace('  // The binary product action choice is distinct from the primary route.', '  // Older Jev responses do not contain product_action. Preserve their behavior\n  // by using the existing product_request score only when the route itself is\n  // explicitly product_request; new responses use the stricter action signal.');
for (const [current, previous] of [
  ['readNoul(answers.image_wants_no_clothing) === 1', 'readNoul(answers.image_wants_no_clothing) >= 0.7'],
  ['readNoul(answers.image_wants_clothing) === 1', 'readNoul(answers.image_wants_clothing) >= 0.7'],
  ['productAction === 1', 'productAction >= MIN_PRODUCT_ACTION_CONFIDENCE'],
  ['orderLookup === 1', 'orderLookup >= 0.7'],
  ['webSearch === 1', 'webSearch >= 0.7'],
]) {
  assert.equal(baselineSource.split(current).length - 1, 1, `authorized binary delta missing: ${current}`);
  baselineSource = baselineSource.replace(current, previous);
}
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
  'if (!text || text.length > 1200) return unavailableDecision("invalid_input");',
]) assert.ok(source.includes(unchangedLine), `approved Jev threshold/deadline changed: ${unchangedLine}`);
// The retry transport/cache now has a dedicated module; preserve the original
// routing-rule hash checks above and assert the moved cache/deadline separately.
const evaluationSource = await readFile(new URL('../server/jev-evaluation-service.js', import.meta.url), 'utf8');
assert.ok(evaluationSource.includes('const CACHE_TTL_MS = 15_000;'));
assert.ok(evaluationSource.includes('Number(config.timeoutMs)'));
assert.ok(evaluationSource.includes('const timeout = setTimeout(() => controller.abort(), timeoutMs);'));
console.log("chat intent turn self-check passed (request parity, isolation, reuse, mixed signals, immutable decisions, Jev baseline)");
