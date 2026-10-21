import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const policy = await import("../server/proactive-content-policy-service.js");
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const { createProactiveCharacterMessage, createProactivePromotionCampaignMessages } = await import("../server/chat-proactive-message-service.js");
const { getDbPool, closeDbPool } = await import("../server/db.js");
const { buildProactivePrompt, listRecentMessagesForPrompt } = await import("../server/proactive-message-context-service.js");
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
const userMessages = [{ id: "last-user", senderType: "user", text: "My parcel has not arrived." }];
const care = "Just checking in. How are you feeling today?";
for (const state of ["unresolved_after_sales", "unknown"]) {
  const blocked = policy.resolveProactiveCandidate({ text: "Want to shop for another jersey?", speechText: "Buy one now!", decision: { state, candidateKind: "shopping" }, recentMessages: userMessages, language: "Hungarian" });
  check(blocked.replaced && blocked.text === policy.buildProactiveCareFallback("hu") && blocked.speechText === blocked.text, `${state} sales becomes localized care in display and voice`);
  check(!policy.allowsProactiveShopping({ state }), `${state} cannot send a campaign`);
}
for (const state of ["neutral", "resolved", "shopping"]) {
  const result = policy.resolveProactiveCandidate({ text: "Would you like to browse a new jersey?", decision: { state, candidateKind: "shopping" } });
  check(!result.replaced && policy.allowsProactiveShopping({ state }), `${state} permits shopping`);
}
const caring = policy.resolveProactiveCandidate({ text: care, decision: { state: "unresolved_after_sales", candidateKind: "care" }, recentMessages: userMessages });
check(caring.text === care && !caring.replaced, "after-sales care remains available");
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const text = policy.buildProactiveCareFallback(language.label);
  check(Boolean(text) && (language.code === "en" || text !== policy.buildProactiveCareFallback("en")), `${language.code} has localized controlled care`);
}
for (const invalid of [null, [], {}, { state: "neutral", candidateKind: "shopping", confidence: .2 }, { state: "injected", candidateKind: "injected", confidence: 1 }, { state: "shopping", candidateKind: "shopping", confidence: Infinity }, { state: "shopping", candidateKind: "shopping", confidence: "Infinity" }]) {
  const decision = policy.normalizeProactiveContentDecision(invalid);
  check(!policy.allowsProactiveShopping(decision), "malformed or uncertain assessment fails closed for shopping");
}
const config = { apiKey: "isolated-key", model: "test", baseUrl: "https://classifier.invalid" };
for (const [text, state] of [["The complaint is still pending", "unresolved_after_sales"], ["The parcel arrived, thank you", "resolved"], ["Please help me choose a new Arsenal jersey", "shopping"], ["How many days is your standard delivery before I order?", "neutral"], ["まだ荷物を待っています", "unresolved_after_sales"]]) {
  const decision = await policy.classifyProactiveContent({ recentMessages: [{ senderType: "user", text }], candidateText: care, config, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    check(body.messages[0].content.includes("An assistant's reassurance") && body.messages[0].content.includes("General delivery"), "semantic contract distinguishes personal unresolved state from general policy");
    assert.equal(JSON.parse(body.messages[1].content).recentConversation[0].text, text);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ state, candidateKind: "care", confidence: .95 }) } }] }) };
  } });
  check(decision.state === state, "validated semantic state is usable without language-specific matching");
}
for (const [latestText, expectedState] of [["Now help me choose a new Arsenal shirt.", "shopping"], ["Okay", "unresolved_after_sales"]]) {
  const recentMessages = [{ senderType: "user", text: "My order has still not arrived." }, { senderType: "user", text: latestText }];
  const decision = await policy.classifyProactiveContent({ recentMessages, candidateText: "Would you like to browse our new shirts?", config, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const contract = body.messages[0].content;
    check(contract.includes("most recent explicit user intent") && contract.includes("takes precedence over an earlier unresolved after-sales concern"), "prompt gives current explicit shopping priority over earlier after-sales");
    check(contract.includes("Neutral acknowledgments, casual conversation and assistant reassurance do not release") && contract.includes("proposed proactive message cannot establish shopping intent"), "prompt prevents neutral acknowledgments or generated sales copy from restoring shopping");
    const context = JSON.parse(body.messages[1].content).recentConversation;
    check(context[0].text === recentMessages[0].text && context[1].text === latestText, "classifier receives user intent in chronological order");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ state: expectedState, candidateKind: "shopping", confidence: .95 }) } }] }) };
  } });
  const candidate = policy.resolveProactiveCandidate({ text: "Would you like to browse our new shirts?", decision });
  check(decision.state === expectedState && candidate.replaced === (expectedState !== "shopping"), "new explicit shopping permits sales while ordinary acknowledgment retains after-sales protection");
}
for (const classify of [async () => { throw new Error("timeout"); }, async () => ({ state: "neutral", confidence: .3 })]) {
  const result = await policy.assessProactiveContent(classify, { recentMessages: userMessages });
  check(result.state === "unknown", "semantic failure uses unknown state");
  const fallback = policy.resolveProactiveCandidate({ text: "buy now", decision: result, language: "es" });
  check(fallback.text === policy.buildProactiveCareFallback("es"), "failure preserves a care message, not sales or total shutdown");
}
const noKey = await policy.classifyProactiveContent({ recentMessages: userMessages, config: { apiKey: "" }, fetchImpl: async () => { throw new Error("must not call provider"); } });
check(noKey.state === "unknown", "missing key requires no paid call");
const windowRows = Array.from({ length: 21 }, (_, index) => ({ id: String(index), sender_type: "user", text_content: index === 0 ? "My order is still missing" : "Just talking about football" }));
const truncatedContext = await listRecentMessagesForPrompt({ execute: async (sql) => { check(sql.includes("LIMIT 21"), "context queries one extra message to detect omitted history"); return [windowRows]; } }, "test-session", { includeContextStatus: true });
check(truncatedContext.contextTruncated && truncatedContext.recentMessages.length === 20 && truncatedContext.recentMessages[0].id === "1", "older personal concern can leave model window without losing truncation signal");
for (const state of ["neutral", "unresolved_after_sales", "shopping", "resolved"]) {
  const decision = await policy.assessProactiveContent(async () => ({ state, candidateKind: "care", confidence: .99 }), truncatedContext);
  check(state === "neutral" ? decision.state === "unknown" : decision.state === state, "truncated neutral is conservative; explicit shopping or resolution can restore permission");
  check(policy.allowsProactiveShopping(decision) === ["shopping", "resolved"].includes(state), "truncated or personal after-sales history cannot auto-permit sales");
}
const emptyDecision = await policy.assessProactiveContent(async () => { throw new Error("must not classify without user context"); }, { recentMessages: [{ senderType: "character", text: "Hello" }] });
check(emptyDecision.state === "unknown", "no visible user context keeps shopping disabled");
const clippedDecision = await policy.assessProactiveContent(async () => ({ state: "neutral", confidence: .99 }), { recentMessages: [{ senderType: "user", text: "a".repeat(601) }] });
check(clippedDecision.state === "unknown", "clipped user text also cannot grant neutral sales permission");
check(policy.areProactiveTextsNearDuplicate("Hello! How is your day?", "hello — how is your day?"), "normalization handles punctuation and case");
check(policy.areProactiveTextsNearDuplicate("Hi! Just popping by to see how your day's going. Fancy a little football banter or maybe a browse through some of our latest kits?", "Hi there! Just popping by to see how your day is going. Fancy a quick bit of football banter or maybe a browse through some of our latest kits?"), "historic highly similar nudges are detected");
check(!policy.areProactiveTextsNearDuplicate("Hope your week is going well. I'm here if you'd like to chat.", "Did you watch the final last night? What did you think of that goal?"), "different check-ins remain allowed");
check(policy.areProactiveTextsNearDuplicate("Szia! Hogy vagy ma?", "SZIA, hogy vagy ma"), "short exact normalized repeated greetings are detected");
const prompt = buildProactivePrompt({ character: {}, recentMessages: [], userContext: {}, shoppingAllowed: false });
check(prompt.systemPrompt.includes("Do not suggest products, shopping"), "generation receives proactive-only care restriction");

// Exercise the actual message/voice write orchestration with isolated SQL and
// the same serialized user-owner lock. No database init, network or real audio.
const pool = getDbPool(); const originalGetConnection = pool.getConnection;
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Unexpected network call"); };
let lockTail = Promise.resolve(); let messages = []; let voices = 0; let spoken = []; let latestUserId = "last-user";
const now = new Date();
function connection() {
  let releaseLock = null; let pending = [];
  const unlock = () => { if (releaseLock) { releaseLock(); releaseLock = null; } };
  return {
    beginTransaction: async () => {},
    commit: async () => { messages.push(...pending); pending = []; unlock(); },
    rollback: async () => { pending = []; unlock(); }, release: unlock,
    execute: async (sql, values = []) => {
      const query = String(sql);
      if (query.includes("SELECT id FROM users") && query.includes("FOR UPDATE")) {
        const previous = lockTail; lockTail = new Promise((resolve) => { releaseLock = resolve; }); await previous; return [[{ id: "test-user" }]];
      }
      if (query.includes("FROM ai_characters")) return [[{ id: "test-character", name: "Test", profile_json: { defaultLanguageCode: "en" } }]];
      if (query.includes("FROM chat_sessions")) return [[{ id: "test-session", character_id: "test-character", source_type: "user", session_status: "active" }]];
      if (query.includes("SELECT id FROM chat_messages") && query.includes("sender_type = 'user'")) return [latestUserId ? [{ id: latestUserId }] : []];
      if (query.includes("UNIX_TIMESTAMP")) return [messages.map((message, index) => ({ id: message.id || `history-${index}`, text_content: message.text, sent_at_epoch: message.time / 1000 })).sort((a, b) => b.sent_at_epoch - a.sent_at_epoch)];
      if (query.includes("SELECT messages.id") && query.includes("INTERVAL 7 DAY")) return [messages.length ? [{ id: messages.at(-1).id || `history-${messages.length - 1}` }] : []];
      if (query.includes("MAX(display_order)")) return [[{ next_order: 10 }]];
      if (query.includes("INSERT INTO chat_messages")) { pending.push({ id: values[0], text: values[7], time: now.getTime() }); return [{ affectedRows: 1 }]; }
      if (/^(?:\s*)(?:INSERT|UPDATE)/.test(query)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected isolated SQL: ${query.slice(0, 100)}`);
    },
  };
}
pool.getConnection = async () => connection();
const options = (text, proactivePolicy = { state: "neutral", candidateKind: "care", latestUserMessageId: "last-user", candidateText: text }) => ({ characterId: "test-character", userId: "test-user", sessionId: "test-session", text, timeZone: "UTC", proactivePolicy, generateVoiceAudio: async ({ speechText }) => { voices++; spoken.push(speechText); return { status: "ready", audioUrl: "/uploads/voice/ai/isolated.mp3", durationSeconds: 1 }; } });
try {
  const missingNudge = await createProactiveCharacterMessage(options(care, null));
  check(missingNudge.sent === false && missingNudge.reason === "proactive_policy_missing", "ordinary nudge cannot bypass assessment");
  const unsafe = await createProactiveCharacterMessage(options("Buy a new kit", { state: "unresolved_after_sales", candidateKind: "shopping", latestUserMessageId: "last-user", candidateText: "Buy a new kit" }));
  check(unsafe.sent === false && unsafe.reason === "proactive_content_unverified", "mismatched sale proof cannot bypass protected state");
  const fakeCare = await createProactiveCharacterMessage(options("Buy a new kit", { state: "unknown", candidateKind: "controlled_care", latestUserMessageId: "last-user", candidateText: "Buy a new kit" }));
  check(fakeCare.sent === false && voices === 0, "controlled fallback proof requires a real safe phrase");
  const concurrent = await Promise.all([createProactiveCharacterMessage(options(care)), createProactiveCharacterMessage(options(care))]);
  check(concurrent.filter((result) => result.sent === false && result.reason === "proactive_duplicate_recent").length === 1, "concurrent equal nudges produce one send");
  check(messages.length === 1 && voices === 1, "duplicate is rejected before insert and audio generation");
  const close = await createProactiveCharacterMessage(options("Just checking in! How are you feeling today?"));
  check(close.sent === false && voices === 1, "near duplicate also avoids audio generation");
  messages = [{ text: care, time: now.getTime() - 21.4 * 3600000 }];
  const midnight = await createProactiveCharacterMessage({ ...options(care), timeZone: "Europe/London" });
  check(midnight.sent === false && midnight.reason === "proactive_duplicate_recent", "rolling day catches 21-hour duplicates across calendar midnight");
  messages = [{ text: care, time: now.getTime() - 2 * 86400000 }];
  const nextDay = await createProactiveCharacterMessage({ ...options(care), speechText: "Buy a new kit now" });
  check(nextDay.items.length === 1, "duplicate restriction does not permanently block later-day care");
  check(spoken.at(-1) === care, "message primitive cannot speak an unreviewed sales script alongside care text");
  const stale = await createProactiveCharacterMessage(options("Hope you are doing well today.", { ...caring.policy, latestUserMessageId: "old-user", candidateText: "Hope you are doing well today." }));
  const voicesBefore = voices;
  check(stale.sent === false && stale.reason === "proactive_context_changed", "a changed user message invalidates stale interpretation");
  check(voicesBefore === 2, "stale policy is rejected before audio generation");
  const campaign = { id: "campaign-test", productTitle: "Arsenal Shirt", productUrl: "https://shop.invalid/arsenal", productSnapshot: { id: "p-test", name: "Arsenal Shirt", url: "https://shop.invalid/arsenal" } };
  const missingPolicy = await createProactivePromotionCampaignMessages({ ...options("Browse another jersey", null), campaign });
  check(missingPolicy.sent === false && missingPolicy.reason === "proactive_policy_missing", "campaign requires a semantic audit credential");
  const shoppingGate = await policy.inspectProactiveSendPolicy(connection(), { sessionId: "test-session", text: "Browse another jersey", policy: { state: "shopping", latestUserMessageId: "last-user", candidateText: "Browse another jersey" }, isCampaign: true });
  check(shoppingGate.allowed, "new user shopping permits campaign gate");
  const blockedCampaign = await createProactivePromotionCampaignMessages({ ...options("Browse another jersey", { state: "unresolved_after_sales", latestUserMessageId: "last-user", candidateText: "Browse another jersey" }), campaign });
  check(blockedCampaign.sent === false && blockedCampaign.reason === "proactive_after_sales_protected", "campaign obeys same after-sales state");
  check(voices === voicesBefore, "blocked campaign generates no voice");
  messages = [];
  const proof = (text) => ({ state: "neutral", candidateKind: "care", latestUserMessageId: "last-user", candidateText: text, latestProactiveMessageId: "" });
  const firstText = "Hope your day is going well. I'm here if you'd like to chat.";
  const secondText = "Sending a friendly hello today. I'd enjoy hearing from you.";
  const competing = await Promise.all([createProactiveCharacterMessage(options(firstText, proof(firstText))), createProactiveCharacterMessage(options(secondText, proof(secondText)))]);
  check(competing.filter((result) => result.sent === false && result.reason === "proactive_history_changed").length === 1, "different concurrent candidates invalidate the second historical novelty proof");
  check(messages.length === 1 && voices === voicesBefore + 1, "historical race is rejected before insert and TTS, not only literal duplicates");
} finally { pool.getConnection = originalGetConnection; globalThis.fetch = originalFetch; await closeDbPool(); }
console.log(`Proactive content policy self-check passed (${checks} assertions; isolated classifier, SQL and voice; no external requests)`);
