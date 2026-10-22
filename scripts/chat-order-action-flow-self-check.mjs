import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// A fresh process runs the production entry points. Every side-effect dependency
// is replaced before ESM imports; unknown server dependencies fail closed.
if (process.argv[2] !== "--worker") {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker"], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, VENICE_API_KEY: "", TYPESAFE_API_KEY: "", ELEVENLABS_API_KEY: "", AIOVE_PROVIDER_LOG_WRITE_ENABLED: "false" },
  });
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  if (child.error) throw child.error;
  assert.equal(child.status, 0, "isolated order action flow must pass");
} else {
  await runFlowChecks();
}

async function runFlowChecks() {
  let checks = 0, fixture;
  const check = (value, label) => { assert.ok(value, label); checks++; };
  const identity = (value) => value;
  const noop = async () => {};
  const character = { id: "mascot_fixture", category_id: "mascot", name: "Fixture", site_id: "site_fixture", profile: { language: "es" } };
  const session = { id: "session_fixture" };
  const db = {
    beginTransaction: async () => { fixture.events.push("begin"); },
    commit: async () => { fixture.events.push("commit"); }, rollback: async () => { fixture.events.push("rollback"); }, release() {},
    execute: async (sql) => {
      fixture.sql.push(sql);
      if (sql === "SELECT slug FROM sites WHERE id = ? LIMIT 1") return [[{ slug: "fixture" }]];
      if (/^SELECT id FROM chat_messages WHERE session_id = \? AND source_ref = \? LIMIT 1$/.test(sql)) return [[]];
      if (/^UPDATE chat_sessions SET last_message_at/.test(sql)) return [{}];
      throw new Error(`Unexpected SQL; order/binding access forbidden: ${sql}`);
    },
  };
  const stubs = {
    "ai-json-provider-service.js": { isAiJsonProviderConfigured: () => false, requestAiJsonWithProviderFallback: async () => { throw new Error("unexpected secondary intent classifier"); } },
    "db.js": { getDbPool: () => ({ getConnection: async () => db }) },
    "db-core.js": { getDbPool: () => ({ getConnection: async () => db }) },
    "chat-image-status-context-service.js": { resolveChatImageStatusContext: async (_db, options) => options.directive || null, refreshChatImageStatusContext: async (_db, context) => context },
    "chat-image-reply-recovery-service.js": { buildImageReplyRecoveryPrompt: () => { throw new Error("order flow must not regenerate image text"); } },
    "chat-intent-turn-service.js": { prepareChatIntentTurn: async () => ({ decision: { ok: true, confident: true, orderIntent: "lookup" }, classify: async () => { fixture.classifications++; fixture.events.push("order_classify"); return { ok: true, confident: true, orderIntent: "lookup", unsupported: false }; } }) },
    "ttmall-runtime-access-service.js": {
      resolveTtmallRuntimeAccess: async (slug) => { fixture.accessCalls++; fixture.events.push("order_resolve"); check(slug === "fixture", "order candidate uses the resolved current site"); return { mode: "ttmall", source: {} }; },
      isEnabledTtmallAccess: (access) => access.mode === "ttmall" && Boolean(access.source),
    },
    "config.js": { SERVER_CONFIG: { aiReply: { venice: { apiKey: "" } } } },
    "jev-intent-service.js": { normalizeConversationContext: () => { throw new Error("fixture has no conversation context to normalize"); }, classifyJevIntent: async () => { throw new Error("unexpected independent JEV call"); } },
    "chat-reply-boundary-service.js": {
      mergeReplyCommerceContext: (context) => context, applyReplyBoundaryToProductContext: identity,
      applyReplyBoundaryPromptPolicy: identity, applyCheckoutSupportPromptPolicy: identity, hasReplyBoundary: () => false,
      enforceReplyBoundary: async ({ replyResult, orderActionCandidate }) => { fixture.reviewedCandidate = orderActionCandidate; return replyResult; },
    },
    "ai-reply-service.js": { generateChatReply: async ({ promptContext }) => {
      fixture.events.push("generate"); fixture.generatedCandidate = promptContext.orderActionCandidate;
      check(fixture.accessCalls === (fixture.expectsAction ? 1 : 0), "order candidate is resolved exactly once before generation, or deliberately skipped");
      check(Boolean(promptContext.orderActionCandidate) === fixture.expectsAction, "generator receives only the available order action");
      return { text: "Respuesta de prueba", speechText: "Respuesta de prueba", sourceType: "ai", sourceRef: "fixture-reply" };
    } },
    "ai-reply-fallback-service.js": { isAiTransportFallback: () => false, buildFallbackReplyResult: () => ({text:"Unavailable.",speechText:"Unavailable.",sourceType:"system",sourceRef:"commerce-classification-unavailable"}) },
    "chat-prompt-service.js": { buildChatReplyPrompt: (options) => { fixture.promptCandidate = options.orderActionCandidate; return options; } },
    "chat-memory-service.js": { indexChatMessage: noop },
    "chat-product-recommendation-service.js": { buildChatProductRecommendationContext: async () => null, resolveCurrentProductImageCardContext: async () => null },
    "product-recommendation-site-service.js": { resolveProductRecommendationSite: async () => ({ id: "site_fixture", slug: "fixture" }) },
    "commerce-routing-service.js": { resolveCommerceSearchIntent: async () => fixture.commerceIntent, applyCommerceQuestionPromptPolicy: identity },
    "ai-reply-log-service.js": { recordCommerceDecisionLog: noop, recordProviderCallLog: noop },
    "knowledge-retrieval-service.js": { retrieveChatKnowledgeSections: async () => ({ items: [] }) },
    "brave-search-service.js": { shouldTriggerBraveSearch: () => false, searchBraveLlmContext: async () => { throw new Error("unexpected web search"); } },
    "chat-factual-context-service.js": { resolveChatFactualContext: async () => null },
    "product-followup-sanitizer.js": { normalizeProductFollowupReply: () => { throw new Error("unexpected product followup"); } },
    "chat-product-reply-service.js": { suppressRepeatedProductCards: identity, selectProductsForReply: () => [], insertProductReplyMessage: async () => { throw new Error("unexpected product card"); } },
    "chat-voice-asset-service.js": { createAiReplyVoiceAssetForDb: async () => ({ id: "voice_fixture", assetStatus: "disabled" }) },
    "chat-reply-speech-service.js": { resolveReplySpeechText: (reply) => reply.speechText },
    "chat-reply-voice-service.js": { resolveReplyVoiceMetaModel: identity, resolveReplyVoiceModel: () => ({ model: "fixture", reason: "fixture" }), VOICE_MODEL_MODE_REALTIME_CALL_FAST: "fixture" },
    "discount-code-eligibility-service.js": { resolveCharacterDiscountOffers: async () => ({ offers: [] }) },
    "chat-discount-offer-output-policy.js": { enforceDiscountOfferReplyPolicy: ({ replyResult }) => replyResult },
    "product-intent-service.js": { buildProductCorrectionClarificationReply: () => "", buildProductSearchIntent: () => ({}), extractRequirementClearFields: () => [], isAlternativeProductRequest: () => false, buildRecentProductContext: () => ({}), isProductImageCardRequest: () => false },
    "product-search-decision-service.js": { PRODUCT_CLARIFICATION_SOURCE_MARKER: "fixture" },
    "chat-feedback-action-service.js": { resolveChatFeedbackActionCandidate: () => null, resolveChatFeedbackAction: () => null, appendFeedbackFollowupCopy: identity },
    "chat-service-shared.js": {
      USER_SESSION_SOURCE_TYPE: "user", buildUserPromptContext: async () => ({}), attachVoiceAssetToMessage: noop,
      enqueueSummaryRefreshJobs: noop, enqueueUserMemoryExtractionJob: noop, getNextMessageOrder: async () => 20, mapSessionRow: identity,
      findCharacterById: async () => character, findLatestUserSessionForDb: async () => session,
      listUserTextMessagesSince: async () => [{ id: "user_turn", text_content: fixture.userText, display_order: 10 }],
      buildPendingUserText: (messages) => messages.map((m) => m.text_content).join("\n"), listRecentMessagesBeforeOrder: async () => [],
      insertMessage: async (_db, options) => { fixture.inserted.push(options); return { ...options, id: `message_${fixture.inserted.length}` }; },
      buildAttachmentSummary: () => "", findOrCreateUserSession: async () => session, normalizeAttachmentPayload: identity,
      normalizeMessageText: identity, throwNotFound: () => { throw new Error("not found"); },
    },
    "chat-language-preference-service.js": { applySessionLanguagePreference: async () => ({ character, languageCode: "es", language: "Spanish" }) },
    "chat-history-image-retrieval-service.js": { findRelevantHistoryImageAttachments: async () => [] },
    "chat-vision-input-service.js": { collectVisionInputsForAttachments: async () => [], collectVisionInputsForMessages: async () => [] },
    "chat-image-generation-service.js": { resolveChatImageReplyDirective: async () => null, maybeCreateChatImagePlaceholder: async () => null },
    "chat-opening-message-service.js": { ensureOpeningMessageWithVoiceForSession: noop },
    "mascot-site-guard-service.js": { resolveStaleMascotGuard: async () => ({ stale: false }), completeStaleMascotReply: async () => { throw new Error("unexpected stale flow"); } },
    "public-error-utils.js": { createPublicError: (text) => new Error(text) },
  };
  globalThis.__orderActionFlowStubs = stubs;
  stubs["guest-product-reply-copy.js"] = { buildGuestProductReplyCopy: () => "Unavailable." };
  const realModules = new Set(["product-candidate-source-proof.js", "chat-reply-purpose-service.js", "chat-reply-recovery-state.js", "chat-language-clarification-policy.js", "chat-prompt-utils.js", "chat-reply-review-outcome.js", "product-sizing-guidance-service.js", "product-size-chart-catalog.js", "product-candidate-confirmation-service.js", "chat-product-routing-context-service.js", "product-requirement-fields.js", "commerce-classification-failure-service.js","product-search-decision-service.js", "product-request-scope-service.js", "product-candidate-state-service.js", "product-candidate-context-service.js", "product-attribute-evidence-service.js", "product-edition-service.js", "product-request-scope-service.js", "product-request-scope-copy.js", "chat-reply-orchestrator-service.js", "chat-text-message-service.js", "chat-order-intent-service.js", "checkout-support-guidance.js", "chat-global-reply-policy.js"]);
  const serverUrl = new URL("../server/", import.meta.url).href;
  // Async loaders run in another thread. Transfer only serializable export
  // names; the generated modules read function stubs in the worker's realm.
  const loaderSource = `
    let serverUrl, realModules, stubExportNames;
    export function initialize(data) {
      serverUrl = data.serverUrl;
      realModules = new Set(data.realModules);
      stubExportNames = data.stubExportNames;
    }
    export async function resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(serverUrl) && specifier.startsWith("./")) {
        const filename = specifier.slice(2);
        if (filename === "product-intent-service.js" && context.parentURL.endsWith("/product-candidate-confirmation-service.js")) return nextResolve(specifier, context);
        if (!realModules.has(filename)) {
          if (!stubExportNames[filename]) throw new Error("Unmocked server dependency: " + filename);
          return { url: "order-flow:" + filename, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    }
    export async function load(url, context, nextLoad) {
      if (url.startsWith("order-flow:")) {
        const filename = url.slice("order-flow:".length);
        const source = stubExportNames[filename].map((name) =>
          "export const " + name + " = globalThis.__orderActionFlowStubs[" + JSON.stringify(filename) + "][" + JSON.stringify(name) + "];").join("\\n");
        return { format: "module", source, shortCircuit: true };
      }
      return nextLoad(url, context);
    }
  `;
  register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url, {
    data: { serverUrl, realModules: [...realModules], stubExportNames: Object.fromEntries(Object.entries(stubs).map(([filename, exports]) => [filename, Object.keys(exports)])) },
  });
  globalThis.fetch = async () => { throw new Error("Network/model calls are forbidden in order action flow checks"); };
  const { buildCharacterReplyGenerationForDb } = await import("../server/chat-reply-orchestrator-service.js");
  const { createUserReply } = await import("../server/chat-text-message-service.js");
  const { normalizeCheckoutIssue } = await import("../server/checkout-support-guidance.js");
  function reset({ expectsAction = true, bound = false, checkout = false } = {}) {
    const userText = checkout ? "Checkout cannot finish. No order was placed. Help only with checkout." : "Where is my order?";
    fixture = { expectsAction, bound, userText, accessCalls: 0, classifications: 0, events: [], inserted: [], sql: [], commerceIntent: { commerceRoute: "store_policy", knowledgeScope: "business", replyBoundary: { salesAllowed: false, contactAllowed: true } } };
    if (checkout) fixture.commerceIntent.checkoutIssue = normalizeCheckoutIssue({ active: true, evidence: "Checkout cannot finish.", requestScope: "checkout_only", orderPlaced: false, orderEvidence: "No order was placed.", lookupRequested: false, lookupEvidence: "Help only with checkout." }, { userText, confidence: .95 });
  }
  for (const bound of [false, true]) {
    reset({ bound });
    const result = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [], orderLookupSiteSlug: "fixture" });
    check(result.orderAction === fixture.promptCandidate && result.orderAction === fixture.generatedCandidate && result.orderAction === fixture.reviewedCandidate, `${bound ? "bound" : "unbound"} generation returns precisely the candidate given to prompt and review`);
    check(fixture.accessCalls === 1 && fixture.classifications === 1 && fixture.events.indexOf("order_resolve") < fixture.events.indexOf("generate"), "real resolver/classification runs once and precedes generation");
    check(fixture.sql.length === 0 && fixture.inserted.length === 0, "generation never reads orders, binding status or creates bindings");
    reset({ bound });
    const response = await createUserReply({ characterId: character.id, userId: "user_fixture", sinceMessageId: "user_turn" });
    const persisted = fixture.inserted.filter((m) => m.contentType === "order_action");
    const returned = response.items.filter((m) => m.contentType === "order_action");
    check(fixture.accessCalls === 1 && fixture.classifications === 1, `${bound ? "bound" : "unbound"} text reply resolves order action only once`);
    check(persisted.length === 1 && returned.length === 1 && persisted[0].product === fixture.promptCandidate && returned[0].product === fixture.promptCandidate, "same generated candidate is persisted and returned without a second resolution");
    check(fixture.events.at(-1) === "commit" && !fixture.events.includes("rollback"), "real text reply commits the in-memory message flow");
    check(!fixture.sql.some((sql) => /orders|bindings|INSERT/i.test(sql)), "signed-in flow cannot inspect orders or read/write account bindings");
  }
  reset({ expectsAction: false });
  const voice = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [] });
  check(voice.orderAction === null && fixture.accessCalls === 0 && fixture.classifications === 0 && fixture.promptCandidate === null, "voice-style caller omitting orderLookupSiteSlug has no order candidate or resolution");
  for (const entry of ["generation", "text"]) {
    reset({ expectsAction: false, checkout: true });
    const result = entry === "generation"
      ? await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [], orderLookupSiteSlug: "fixture" })
      : await createUserReply({ characterId: character.id, userId: "user_fixture", sinceMessageId: "user_turn" });
    check(fixture.accessCalls === 0 && fixture.classifications === 0 && fixture.promptCandidate === null, `${entry} preserves the real validated checkout-only skip predicate`);
    check(entry === "generation" ? result.orderAction === null : !result.items.some((m) => m.contentType === "order_action"), "checkout help does not persist or advertise an order lookup action");
  }
  console.log(`Chat order action flow self-check passed (${checks} assertions; isolated child process, production orchestration/resolver/persistence, memory stubs, no DB/network/models)`);
}
