import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const policy = await import("../server/proactive-content-policy-service.js");
const { loadRecentProactiveHistory, listRecentMessagesForPrompt } = await import("../server/proactive-message-context-service.js");
const { buildReviewedProactiveCandidate } = await import("../server/proactive-message-job-service.js");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("No external requests permitted"); };
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
const recentMessages = [{ id: "u", senderType: "user", text: "Please help me choose a new shirt", sentAt: "2026-10-09 10:00:00", sourceRef: "user" }];
const history = [{ id: "h", text: "Did you enjoy your weekend party?", sentAt: "2026-10-06 10:00:00", sourceRef: "proactive-nudge" }];
const state = { state: "shopping", confidence: .99 };
const good = { state: "shopping", candidateKind: "care", confidence: .99, quality: { natural: true, grounded: true, novel: true } };
try {
  const loaded = await loadRecentProactiveHistory({ execute: async (sql, args) => {
    check(sql.includes("INTERVAL 7 DAY") && sql.includes("LIMIT 30") && sql.includes("sessions.internal_uid = ?") && sql.includes("messages.character_id = ?"), "history is bounded and account/character scoped across sessions");
    assert.deepEqual(args, ["account", "character"]);
    return [[{ id: "h", text_content: history[0].text, sent_at: history[0].sentAt, source_ref: "proactive-nudge" }]];
  } }, { userId: "account", characterId: "character" });
  check(loaded[0].sentAt === history[0].sentAt && loaded[0].sourceRef === "proactive-nudge", "history carries timestamps and sources");
  const context = await listRecentMessagesForPrompt({ execute: async (sql) => {
    check(sql.includes("<> 'proactive-nudge'") && sql.includes("NOT LIKE 'promotion-campaign%'") && sql.includes("sender_type = 'user'") && sql.includes("delivery_status = 'sent'"), "automatic texts do not displace user conversation before SQL limit");
    return [[{ id: "u", sender_type: "user", text_content: "hello", sent_at: "2026-10-09 10:00:00", source_ref: "user" }]];
  } }, "session", { includeContextStatus: true });
  check(context.recentMessages[0].sentAt && !context.contextTruncated, "real conversation retains provenance");
  const decision = await policy.classifyProactiveContent({ recentMessages, proactiveHistory: history, language: "hu", candidateText: "hello", config: { apiKey: "isolated", baseUrl: "https://invalid.test", model: "mock" }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); const payload = JSON.parse(body.messages[1].content);
    check(payload.currentTimeUtc && payload.activeLanguage === "hu" && payload.recentProactiveMessages[0].id === "h" && payload.recentConversation[0].sentAt === recentMessages[0].sentAt, "existing candidate classifier receives language, chronology and bounded history");
    check(body.messages[0].content.includes("old user plans") && body.messages[0].content.includes("same invitation"), "semantic contract checks stale assumptions and paraphrase repetition");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...good, groundingEvidence: [] }) } }] }) };
  } });
  check(policy.inspectProactiveCandidateQuality({ text: "A distinct greeting", decision }).allowed, "verified new care passes");
  check(!policy.inspectProactiveCandidateQuality({ text: "hello", decision: policy.normalizeProactiveContentDecision({ state: "shopping", candidateKind: "care", confidence: .99 }) }).allowed, "old responses missing quality cannot claim quality acceptance");
  for (const key of ["natural", "grounded", "novel"]) check(!policy.inspectProactiveCandidateQuality({ text: "hello", decision: { ...good, quality: { ...good.quality, [key]: false } } }).allowed, `${key} failure blocks candidate`);
  check(policy.inspectProactiveCandidateQuality({ text: history[0].text, decision: good, proactiveHistory: history }).allowed, "cross-day wording can pass when semantic novelty verifies an explicit user revisit; 24h gate remains separate");
  let generations = 0, assessments = 0;
  const reviewed = await buildReviewedProactiveCandidate({ recentMessages, state, proactiveHistory: history, language: "hu", character: {},
    generateReply: async ({ promptContext }) => { generations++; if (generations === 2) check(promptContext.systemPrompt.includes("proactive_quality_grounded_unverified"), "rewrite receives precise rejection reason"); return { text: generations === 1 ? "How was the party?" : "I'm here if you want to talk.", speechText: "Buy another shirt" }; },
    classifyContent: async () => { assessments++; return { ...good, quality: { ...good.quality, grounded: assessments !== 1 } }; },
  });
  check(reviewed.allowed && generations === 2 && assessments === 2, "one bounded rewrite can recover a rejected candidate");
  check(reviewed.candidate.speechText === reviewed.candidate.text, "accepted speech cannot carry different sales content");
  generations = 0;
  const failed = await buildReviewedProactiveCandidate({ recentMessages, state, character: {}, generateReply: async () => { generations++; return { text: "hello" }; }, classifyContent: async () => { throw new Error("timeout"); } });
  check(!failed.allowed && generations === 2, "assessment failure terminates after two generations");
  const shopping = await buildReviewedProactiveCandidate({ recentMessages, contextTruncated: true, state, character: {}, generateReply: async () => ({ text: "I can help with your new shirt." }), classifyContent: async () => ({ ...good, candidateKind: "shopping" }) });
  check(shopping.allowed, "explicit new shopping survives earlier truncated support history");
  const revisited = await buildReviewedProactiveCandidate({ recentMessages: [{ ...recentMessages[0], text: "Please ask me again about that earlier party." }], state, proactiveHistory: history, character: {},
    generateReply: async () => ({ text: history[0].text }), classifyContent: async () => good });
  check(revisited.allowed, "explicit revisiting may restore a prior topic after the 24h restriction, using semantic novelty approval");
  const semanticRepeat = await buildReviewedProactiveCandidate({ recentMessages, state, proactiveHistory: history, character: {},
    generateReply: async () => ({ text: "Any more news about that gathering?" }), classifyContent: async () => ({ ...good, quality: { ...good.quality, novel: false } }) });
  check(!semanticRepeat.allowed, "same topic with different words still fails semantic novelty");
  const protectedState = await buildReviewedProactiveCandidate({ recentMessages, state: { state: "unresolved_after_sales" }, character: {}, generateReply: async () => ({ text: "Buy a new jersey" }), classifyContent: async () => ({ ...good, candidateKind: "shopping" }) });
  check(!protectedState.allowed, "candidate cannot independently restore sales permission");
  const unknown = await buildReviewedProactiveCandidate({ recentMessages: [], state: { state: "unknown" }, language: "es", generateReply: async () => { throw new Error("must not generate"); } });
  check(unknown.allowed && unknown.candidate.text === policy.buildProactiveCareFallback("es"), "missing context preserves localized controlled care");
  const repeatedFallback = await buildReviewedProactiveCandidate({ state: { state: "unknown" }, language: "es", proactiveHistory: [{ text: unknown.candidate.text }] });
  check(!repeatedFallback.allowed, "unknown context does not repeat the fixed fallback across days");
  const engagedFallback = await buildReviewedProactiveCandidate({ state: { state: "unknown" }, language: "es", recentMessages,
    proactiveHistory: [{ text: unknown.candidate.text, sentAt: history[0].sentAt }] });
  check(engagedFallback.allowed, "new user engagement restores controlled care without claiming shopping permission");
  const db = { execute: async (sql) => sql.includes("sender_type = 'user'") ? [[{ id: "u" }]] : [[{ id: "new-history", text_content: "Different wording", sent_at_epoch: Date.now() / 1000 }]] };
  const changed = await policy.inspectProactiveSendPolicy(db, { userId: "account", characterId: "character", sessionId: "session", text: "hello", policy: { state: "shopping", candidateKind: "care", latestUserMessageId: "u", candidateText: "hello", latestProactiveMessageId: "h" } });
  check(!changed.allowed && changed.reason === "proactive_history_changed", "concurrent history change invalidates semantic novelty proof inside lock");
  const olderHistory = await policy.inspectProactiveSendPolicy({ execute: async (sql) => {
    if (sql.includes("sender_type = 'user'")) return [[{ id: "u" }]];
    return sql.includes("UNIX_TIMESTAMP") ? [[]] : [[{ id: "h" }]];
  } }, { userId: "account", characterId: "character", sessionId: "session", text: "hello", policy: { state: "shopping", candidateKind: "care", latestUserMessageId: "u", candidateText: "hello", latestProactiveMessageId: "h" } });
  check(olderHistory.allowed, "unchanged historical proof older than the two-day duplicate query still passes");
  const userChanged = await policy.inspectProactiveSendPolicy(db, { sessionId: "session", text: "hello", policy: { state: "shopping", candidateKind: "care", latestUserMessageId: "old-user", candidateText: "hello", latestProactiveMessageId: "h" } });
  check(!userChanged.allowed && userChanged.reason === "proactive_context_changed", "new user response still invalidates old proof before send");
  const campaign = await policy.inspectProactiveSendPolicy(db, { sessionId: "session", text: "hello", isCampaign: true, policy: { state: "shopping", latestUserMessageId: "u", candidateText: "hello", latestProactiveMessageId: "h" } });
  check(campaign.allowed, "administrator campaigns keep their separate rotation/history boundary");
} finally { globalThis.fetch = originalFetch; }
console.log(`Proactive history quality self-check passed (${checks} assertions; isolated SQL/provider mocks, no database or external calls)`);
