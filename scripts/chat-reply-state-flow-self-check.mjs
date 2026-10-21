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
  assert.equal(child.status, 0, "isolated reply state flow must pass");
} else {
  await runStateChecks();
}

async function runStateChecks() {
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
    "db.js": { getDbPool: () => ({ getConnection: async () => db }) },
    "db-core.js": { getDbPool: () => ({ getConnection: async () => db }) },
    "chat-image-status-context-service.js": { resolveChatImageStatusContext: async (_db, options) => options.directive || null, refreshChatImageStatusContext: async (_db, context) => context },
    "chat-intent-turn-service.js": { prepareChatIntentTurn: async () => ({ decision: fixture.jevDecision || { ok: true, confident: true, orderIntent: "lookup" }, classify: async () => { fixture.classifications++; fixture.events.push("order_classify"); return { ok: true, confident: true, orderIntent: "lookup", unsupported: false }; } }) },
    "chat-factual-context-service.js": { resolveChatFactualContext: async (options) => { fixture.factualInputs ||= []; fixture.factualInputs.push(options); return fixture.factualContext || null; } },
    "ttmall-runtime-access-service.js": {
      resolveTtmallRuntimeAccess: async (slug) => { fixture.accessCalls++; fixture.events.push("order_resolve"); check(slug === "fixture", "order candidate uses the resolved current site"); return { mode: "ttmall", source: {} }; },
      isEnabledTtmallAccess: (access) => access.mode === "ttmall" && Boolean(access.source),
    },
    "config.js": { SERVER_CONFIG: { aiReply: { venice: { apiKey: "" } } } },
    "jev-intent-service.js": { classifyJevIntent: async () => { throw new Error("unexpected independent JEV call"); } },
    "chat-reply-boundary-service.js": {
      mergeReplyCommerceContext: (context) => context, applyReplyBoundaryToProductContext: identity,
      applyReplyBoundaryPromptPolicy: identity, applyCheckoutSupportPromptPolicy: identity, hasReplyBoundary: () => false,
      enforceReplyBoundary: async ({ replyResult, orderActionCandidate }) => { fixture.reviewedCandidate = orderActionCandidate; return replyResult; },
    },
    "ai-reply-service.js": { generateChatReply: noop },
    "ai-reply-fallback-service.js": { isAiTransportFallback: (reply) => reply?.sourceRef === "commerce-classification-unavailable", buildFallbackReplyResult: () => ({text:"Unavailable.",speechText:"Unavailable.",sourceType:"system",sourceRef:"commerce-classification-unavailable"}) },
    "chat-prompt-service.js": { buildChatReplyPrompt: (options) => { fixture.promptCandidate = options.orderActionCandidate;
      return fixture.imageRecovery ? { ...options, systemPrompt: "Original persona, history and permissions.",
        layers: [{ id: "original_fixture", title: "Original", content: "Original persona, history and permissions." }],
        messages: [{ role: "user", content: options.userText }], visionInputs: [{ id: "preserved_vision" }] }
        : { ...options, systemPrompt: "Original persona, history and permissions." }; } },
    "chat-memory-service.js": { indexChatMessage: noop },
    "chat-product-recommendation-service.js": { buildChatProductRecommendationContext: async () => { fixture.producerCalls = (fixture.producerCalls || 0) + 1; return fixture.productContext || null; }, resolveCurrentProductImageCardContext: async () => null },
    "product-recommendation-site-service.js": { resolveProductRecommendationSite: async () => ({ id: "site_fixture", slug: "fixture" }) },
    "commerce-routing-service.js": { resolveCommerceSearchIntent: async () => { fixture.commerceCalls = (fixture.commerceCalls || 0) + 1; return fixture.commerceIntent; }, applyCommerceQuestionPromptPolicy: identity },
    "ai-reply-log-service.js": { recordCommerceDecisionLog: noop,
      recordProviderCallLog: async event => { fixture.providerEvents.push(event); },
      recordReplyReviewLog: async event => { fixture.reviewDiagnostics.push(event); } },
    "knowledge-retrieval-service.js": { retrieveChatKnowledgeSections: async () => { fixture.knowledgeCalls = (fixture.knowledgeCalls || 0) + 1; return fixture.knowledgeContext || ({ items: [] }); } },
    "brave-search-service.js": { shouldTriggerBraveSearch: () => false, searchBraveLlmContext: async () => { throw new Error("unexpected web search"); } },
    "product-followup-sanitizer.js": { normalizeProductFollowupReply: () => { throw new Error("unexpected product followup"); } },
    "chat-product-reply-service.js": {
      suppressRepeatedProductCards: identity,
      selectProductsForMessage: (context) => fixture.allowScopeCards && context?.cardAllowed !== false ? context?.products || [] : [],
      // Keep the original fixture selector, with the shared post-review gates
      // now used by both production persistence entry points.
      selectProductsForReply: (context, reply = {}) => reply.productScopeVerified === false
        || context?.candidateContext && reply.candidateEvidenceVerified !== true
        || stubs["ai-reply-fallback-service.js"].isAiTransportFallback(reply) || reply.replyBoundary?.salesAllowed === false
        ? [] : stubs["chat-product-reply-service.js"].selectProductsForMessage(context),
      buildProductCardDeliveryContext: (context) => {
        if (!context?.products?.length) return null;
        const products = stubs["chat-product-reply-service.js"].selectProductsForMessage(context);
        return { count: products.length, cards: products.map(product => ({ id: product.id || product.productId || "", name: product.name || "", matchStatus: product.matchStatus })), unfulfilledVariants: [] };
      },
      insertProductReplyMessage: async () => { throw new Error("unexpected product card"); },
    },
    "chat-voice-asset-service.js": { createAiReplyVoiceAssetForDb: async () => ({ id: "voice_fixture", assetStatus: "disabled" }) },
    "chat-reply-speech-service.js": { resolveReplySpeechText: (reply) => reply.speechText },
    "chat-reply-voice-service.js": { resolveReplyVoiceMetaModel: identity, resolveReplyVoiceModel: () => ({ model: "fixture", reason: "fixture" }), VOICE_MODEL_MODE_REALTIME_CALL_FAST: "fixture" },
    "discount-code-eligibility-service.js": { resolveCharacterDiscountOffers: async () => ({ offers: [] }) },
    "chat-discount-offer-output-policy.js": { enforceDiscountOfferReplyPolicy: ({ replyResult }) => replyResult },
    "product-intent-service.js": {
      // These fixtures do not load matched catalogue results. Fail closed if
      // a future path unexpectedly tries to grant a match through this stub.
      filterProductsByIntent: () => { throw new Error("Unexpected catalogue filtering in state-flow fixture"); },
      filterProductsByRequestedSizes: () => { throw new Error("Unexpected size filtering in state-flow fixture"); },
      buildProductCorrectionClarificationReply: () => "", buildProductSearchIntent: () => ({}), extractRequirementClearFields: () => [], isAlternativeProductRequest: () => false, buildRecentProductContext: () => ({}), isProductImageCardRequest: () => false },
    "product-search-decision-service.js": { PRODUCT_CLARIFICATION_SOURCE_MARKER: "product-clarification" },
    "chat-feedback-action-service.js": { resolveChatFeedbackActionCandidate: () => null, resolveChatFeedbackAction: () => null, appendFeedbackFollowupCopy: identity },
    "chat-service-shared.js": {
      USER_SESSION_SOURCE_TYPE: "user", buildUserPromptContext: async () => ({}), attachVoiceAssetToMessage: noop,
      enqueueSummaryRefreshJobs: noop, enqueueUserMemoryExtractionJob: noop, getNextMessageOrder: async () => 20, mapSessionRow: identity,
      findCharacterById: async () => character, findLatestUserSessionForDb: async () => session,
      listUserTextMessagesSince: async () => fixture.pendingTextUsers || [{ id: "user_turn", text_content: fixture.userText, display_order: 10 }],
      buildPendingUserText: (messages) => messages.map((m) => m.text_content).join("\n"), listRecentMessagesBeforeOrder: async () => [],
      insertMessage: async (_db, options) => { fixture.inserted.push(options); return { ...options, id: `message_${fixture.inserted.length}` }; },
      buildAttachmentSummary: () => "", findOrCreateUserSession: async () => session, normalizeAttachmentPayload: identity,
      normalizeMessageText: identity, throwNotFound: () => { throw new Error("not found"); },
    },
    "chat-language-preference-service.js": { applySessionLanguagePreference: async () => ({ character, languageCode: character.profile.language, language: character.profile.language }) },
    "chat-history-image-retrieval-service.js": { findRelevantHistoryImageAttachments: async () => [] },
    "chat-vision-input-service.js": { collectVisionInputsForAttachments: async () => [], collectVisionInputsForMessages: async () => [] },
    "chat-image-generation-service.js": { resolveChatImageReplyDirective: async () => { fixture.imageDirectiveCalls = (fixture.imageDirectiveCalls || 0) + 1; return fixture.imageDirective || null; }, maybeCreateChatImagePlaceholder: async () => { fixture.imagePlaceholderCalls = (fixture.imagePlaceholderCalls || 0) + 1; return null; } },
    "chat-opening-message-service.js": { ensureOpeningMessageWithVoiceForSession: noop },
    "mascot-site-guard-service.js": { resolveStaleMascotGuard: async () => ({ stale: false }), completeStaleMascotReply: async () => { throw new Error("unexpected stale flow"); } },
    "public-error-utils.js": { createPublicError: (text) => new Error(text) },
  };
  stubs["chat-order-intent-service.js"] = { resolveTtmallOrderAction: async () => { fixture.orderCalls = (fixture.orderCalls || 0) + 1; return null; } };
  // Production state readers and reply/rights guards execute against memory only.
  const freshDb = { execute: async (sql, args) => memorySql(sql, args, true), getConnection: async () => db };
  db.execute = async (sql, args) => memorySql(sql, args, false);
  async function memorySql(sql, args, fresh) {
    fixture.sql.push(sql);
    const normalizedSql = sql.replace(/\s+/g, " ").trim();
    if (normalizedSql.startsWith("SELECT id, voice_asset_id FROM chat_messages")) {
      let rows = (fresh ? fixture.existingReplies : fixture.transactionReplies || fixture.existingReplies) || [];
      rows = rows.filter((row) => row.session_id === args[0] && args.slice(1).includes(row.source_ref));
      if (normalizedSql.includes("sender_type = 'character'")) rows = rows.filter((row) => row.sender_type === "character");
      if (normalizedSql.includes("content_type = 'text'")) rows = rows.filter((row) => row.content_type === "text");
      if (normalizedSql.includes("ORDER BY")) rows.sort((a, b) => Number(b.source_ref === args[1]) - Number(a.source_ref === args[1]) || a.display_order - b.display_order);
      return [rows.slice(0, 1)];
    }
    if (normalizedSql.includes("LEFT JOIN chat_messages reply")) {
      const recognizesMarker = args.includes(":product-clarification");
      const sessionId = args.at(-2), guestId = args.at(-1);
      return [(fixture.pendingVoiceUsers || []).filter((user) => user.session_id === sessionId && user.guest_session_id === guestId
        && ["voice-asr", "guest-call"].includes(user.source_ref) && user.client_message_id && user.content_type === "text" && user.sender_type === "user"
        && !(fixture.existingReplies || []).some((reply) => reply.session_id === user.session_id
          && (reply.source_ref === `guest-reply:${user.id}` || recognizesMarker && reply.source_ref === `guest-reply:${user.id}:product-clarification`)
          && (!normalizedSql.includes("reply.sender_type = 'character'") || reply.sender_type === "character")
          && (!normalizedSql.includes("reply.content_type = 'text'") || reply.content_type === "text")))
        .sort((a, b) => a.display_order - b.display_order).slice(0, 3)];
    }
    if (normalizedSql.startsWith("SELECT id, text_content, display_order, content_type, client_message_id, source_ref")) {
      return [(fixture.pendingVoiceUsers || []).filter((row) => row.id === args[0] && row.session_id === args[1] && row.guest_session_id === args[2] && row.source_ref === args[3])];
    }
    if (normalizedSql.startsWith("SELECT * FROM chat_sessions WHERE id")) return [[session]];
    if (normalizedSql.startsWith("SELECT session.character_id AS character_id")) return [[]];
    if (sql.includes("LEFT JOIN chat_image_assets")) {
      fixture.reads.push({ fresh, status: fixture.status, args });
      if (!fixture.image) return [[]];
      if (fixture.imageRecoveryReadFailureAfter && fixture.reads.length > fixture.imageRecoveryReadFailureAfter) throw new Error("isolated recovery refresh failed");
      if (fixture.readFailure) throw new Error("isolated read failed");
      return [[{ id: "image_fixture", content_type: "image_generation", display_order: fixture.imageOrder || 12, asset_id: "asset_fixture", image_status: fixture.status }]];
    }
    if (sql.startsWith("SELECT id, character_id, preferred_language FROM chat_sessions")) return [[{ id: session.id, character_id: character.id, preferred_language: "es" }]];
    if (/^SELECT id(?:, voice_asset_id)? FROM chat_messages WHERE session_id = \? AND source_ref = \? LIMIT 1$/.test(sql.replace(/\s+/g, " ").trim())) return [[]];
    if (sql.startsWith("SELECT slug FROM sites")) return [[{ slug: "fixture" }]];
    if (sql.startsWith("UPDATE chat_sessions")) return [{}];
    throw new Error("Unmocked SQL: " + sql);
  }
  Object.assign(session, { character_id: character.id, internal_uid: "user_fixture" });
  stubs["db.js"] = { getDbPool: () => freshDb, withTransaction: async (fn) => fn(db) };
  stubs["db-core.js"] = { getDbPool: () => freshDb };
  const reviewProvider = { id: "venice", apiKey: "test-only", baseUrl: "https://review.invalid", model: "fixture", apiMode: "chat_completions", timeoutMs: 3500 };
  stubs["config.js"] = { SERVER_CONFIG: { aiReply: { venice: reviewProvider, openai: reviewProvider, replyChain: [reviewProvider] } } };
  stubs["chat-language-quality-service.js"] = {
    LANGUAGE_REVIEW_TIMEOUT_MS: 20000,
    languageReviewerConfig: () => null,
    assessIndependentLanguageQuality: async (options) => {
      fixture.languageReviews ||= []; fixture.languageReviews.push(options);
      return { reviewStatus: "valid", confidence: .99, languageQualitySupported: !fixture.languageRejected && !(fixture.rejectInitialLanguage && fixture.languageReviews.length === 1),
        ...(fixture.languageRejected ? { languageIssues: [{ type: "unverifiable", severity: "major", field: "both", span: "" }] } : {}),
        retainedLanguageQualitySupported: options.retainedText ? fixture.verdict?.retainedLanguageQualitySupported : false,
        languageIssues: fixture.languageRejected ? [{ type: "unverifiable", severity: "major", field: "both", span: "" }] : [] };
    },
  };
  delete stubs["chat-reply-boundary-service.js"];
  delete stubs["chat-image-status-context-service.js"];
  stubs["chat-reply-structure-service.js"] = { parseStructuredChatReply: () => { throw new Error("JSON reviews must never use the chat reply contract"); } };
  stubs["tts-emotion-tag-service.js"] = { stripTtsControlTags: identity, removeTtsControlTags: identity, protectApprovedTtsControlTags: text => ({ text, placeholders: [] }) };
  stubs["product-sizing-copy.js"] = { buildProductSizingFallback: () => "Sizing unavailable." };
  stubs["support-guidance-copy.js"] = { buildSupportGuidanceUnavailableCopy: () => "Información no verificada." };
  stubs["guest-product-reply-copy.js"] = { buildGuestProductReplyCopy: () => "Not verified.", buildGuestProductSourceErrorReply: () => "Unavailable.", buildUnconfirmedProductStateReply: () => "Not verified.", buildGuestProductTonePrefix: () => "", resolveGuestProductReplyLanguage: () => "es" };
  stubs["chat-image-copy-service.js"] = { getChatImageStatusCopy: ({ status }) => status === "ready" ? "La imagen está lista." : "La imagen está pendiente.", getChatImageHistoricalReadyCopy: () => "La foto anterior está lista. No he enviado una nueva en este turno.", getChatImageUnverifiedStatusCopy: (_lang, failed) => failed ? "La imagen falló." : "No puedo confirmar el estado." };
  stubs["chat-feedback-action-service.js"].isTrackingReference = () => false;
  stubs["product-followup-sanitizer.js"].normalizeProductFollowupReply = ({ text }) => text;
  stubs["ai-reply-service.js"].generateChatReply = async (options) => {
    fixture.generations ||= []; fixture.generations.push(options); fixture.prompt = options.promptContext;
    fixture.status = options.regeneration && fixture.imageRecoveryFailAfterRegeneration ? "failed" : fixture.finalStatus;
    const text = options.regeneration && fixture.regeneratedBody ? fixture.regeneratedBody : fixture.body;
    const reply = { text, speechText: text, sourceType: "ai", aiProvider: "fixture", aiModel: "fixture-model" };
    fixture.generatedReplies ||= []; fixture.generatedReplies.push(reply);
    return reply;
  };
  stubs["chat-message-store.js"] = { ...stubs["chat-service-shared.js"], listRecentMessagesBeforeOrder: async () => [] };
  stubs["guest-chat-product-service.js"] = { resolveGuestProductRecommendation: async () => { fixture.producerCalls = (fixture.producerCalls || 0) + 1; return { requested: false, context: fixture.productContext || null, searchIntent: fixture.commerceIntent }; }, resolveGuestCurrentProductImageCardContext: async () => null };
  stubs["guest-session-service.js"] = {
    loadGuestCharacter: async () => character, requireGuestCharacter: async () => fixture.guest, requireGuestCharacterForDb: async () => fixture.guest,
    guestSessionForImage: (guest) => ({ id: session.id, guest_session_id: guest.id, character_id: character.id }), guestVoiceMeta: () => ({}),
  };
  stubs["guest-turn-service.js"] = { resolveGuestTurnStartDisplayOrder: async () => 10, resolveStoredGuestTurnText: async () => fixture.userText };
  stubs["guest-chat-attachment-service.js"] = { listGuestAttachmentsForRequest: async () => [] };
  stubs["external-source-context-service.js"] = { parseExternalSourceContext: () => null };
  stubs["chat-image-generation-service.js"].maybeCreateGuestChatImagePlaceholder = async () => null;
  stubs["chat-voice-asset-service.js"] = {
    createAiReplyVoiceAssetForDb: async (_db, options) => { fixture.speech.push(options.speechText); return { id: "voice_fixture", assetStatus: "disabled" }; },
    reserveAiReplyVoiceAssetForDb: async (_db, options) => { fixture.speech.push(options.speechText); return { id: "voice_fixture", assetStatus: "disabled" }; },
  };
  stubs["chat-service-shared.js"].findUserVoiceMessageForReply = async () => ({ id: fixture.voiceUserId || "user_turn", text_content: fixture.userText, display_order: 10 });
  stubs["chat-service-shared.js"].normalizeVoiceTranscriptText = identity;
  Object.assign(stubs["guest-session-service.js"], {
    GUEST_COOKIE_NAME: "fixture", GUEST_SESSION_MAX_AGE_SECONDS: 1, assertGuestBrowsingEnabled: noop,
    getOrCreateGuestSessionRecord: noop, mapGuest: identity, requireGuest: async () => fixture.guest, retryGuestVoiceAssets: noop,
    generateGuestVoiceWithoutFailingText: async (id) => { fixture.voiceRetries.push(id); },
  });
  Object.assign(stubs["chat-message-store.js"], { getMessagesForSession: async () => ({ items: [] }) });
  Object.assign(stubs["guest-chat-attachment-service.js"], { listPendingGuestAttachments: async () => [] });
  Object.assign(stubs["guest-turn-service.js"], { persistGuestTurn: async () => { throw new Error("unexpected new input"); } });
  stubs["security.js"] = { hashSessionToken: identity };
  stubs["chat-message-payload-utils.js"] = { normalizeMessageText: identity };
  stubs["db-advisory-lock-service.js"] = { acquireDedicatedDbAdvisoryLock: async () => { fixture.events.push("lock"); return async () => { fixture.events.push("unlock"); }; } };
  stubs["access-location-service.js"] = { recordGuestLastAccess: noop };
  stubs["guest-image-entitlement-service.js"] = { getGuestImageEntitlement: async () => ({}) };
  globalThis.__orderActionFlowStubs = stubs;
  const realModules = new Set(["chat-language-clarification-policy.js", "product-search-match-service.js", "product-candidate-source-proof.js", "chat-reply-purpose-service.js", "chat-prompt-utils.js", "chat-reply-review-outcome.js", "product-sizing-guidance-service.js", "chat-image-reply-recovery-service.js", "ai-independent-review-config.js", "business-claim-audit-service.js", "product-size-chart-catalog.js", "product-candidate-confirmation-service.js", "chat-product-routing-context-service.js", "chat-grounded-reply-repair-service.js", "ai-reply-quality-service.js", "ai-reply-quality-rules.js", "product-requirement-fields.js", "commerce-classification-failure-service.js","product-candidate-state-service.js", "product-candidate-context-service.js", "product-attribute-evidence-service.js", "product-edition-service.js", "product-search-decision-service.js", "product-request-scope-service.js", "product-request-scope-copy.js", "chat-factual-policy.js", "guest-chat-service.js", "guest-reply-service.js", "chat-reply-orchestrator-service.js", "chat-voice-message-service.js", "chat-text-message-service.js", "chat-reply-boundary-service.js", "chat-reply-review-outcome.js", "chat-reply-review-decision.js", "chat-reply-review-contracts.js", "chat-reply-language-recovery-service.js", "ai-json-provider-service.js", "ai-reply-provider-service.js", "ai-reply-contract-service.js", "chat-reply-language-quality.js", "chat-image-status-context-service.js", "guest-benefit-guidance-service.js", "guest-chat-output-policy.js", "discount-policy-explanation-service.js", "checkout-support-guidance.js", "checkout-support-copy.js", "chat-global-reply-policy.js", "product-response-sanitizer.js", "chat-feedback-action-service.js"]);
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
  globalThis.fetch = async (_url, options) => {
    fixture.reviews.push(JSON.parse(options.body));
    if (fixture.reviewTimeout) throw Object.assign(new Error("isolated review timeout"), { name: "TimeoutError" });
    if (fixture.reviewFailure) throw new Error("isolated review failed");
    const packet = JSON.parse(fixture.reviews.at(-1).messages.at(-1).content);
    const verdict = fixture.imageRecovery && fixture.reviews.length > 1 ? fixture.recoveryVerdict || { ...fixture.verdict, allowed: true, boundarySupported: true, imageStatusSupported: true } : fixture.verdict;
    const audit = packet.businessClaimContext ? packet.businessClaimContext.units.map(unit => ({
      unitId: unit.id, factual: true, referenceIds: [packet.businessClaimContext.references[0].id],
      supported: verdict.businessFactsSupported !== false, sourceAllowsException: false, replyPreservesException: true,
    })) : null;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ boundarySupported: true, ...verdict,
      ...(audit ? { businessClaimAudit: audit } : {}) }) } }] }) };
  };
  const { ensureGuestReply } = await import("../server/guest-reply-service.js");
  const { getGuestConversation, sendGuestReplyForMessage } = await import("../server/guest-chat-service.js");
  const { buildCharacterReplyGenerationForDb, persistCharacterReplyForDb } = await import("../server/chat-reply-orchestrator-service.js");
  const { createUserVoiceReply } = await import("../server/chat-voice-message-service.js");
  const { createUserReply } = await import("../server/chat-text-message-service.js");
  function reset(options = {}) {
    fixture = { expectsAction: false, guest: { id: "guest_fixture", chat_session_id: session.id, mascot_character_id: character.id, site_id: "site_fixture", site_slug: "fixture" },
      userText: "¿Está lista la imagen?", body: "Todavía se está generando.", status: "generating", finalStatus: "ready", image: true,
      events: [], sql: [], inserted: [], speech: [], reads: [], reviews: [], voiceRetries: [], providerEvents: [], reviewDiagnostics: [],
      commerceIntent: { commerceRoute: "chat", knowledgeScope: "general", replyBoundary: { salesAllowed: true, contactAllowed: true } },
      verdict: { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true }, ...options };
  }
  async function guestReply() {
    await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn", display_order: 10 }, text: fixture.userText, attachments: [], promptBeforeDisplayOrder: 10,
      ...(fixture.imageRecovery ? { imageResult: { directive: fixture.imageDirective, message: { id: "image_fixture", contentType: "image_generation" }, taskCreated: true, reason: "image_task_created" } } : {}) } });
    return fixture.inserted.find((m) => m.contentType === "text")?.text || "";
  }
  reset({ image: false, userText: "Hola", body: "Use SAVE20 for 20% off.", verdict: { allowed: true, confidence: .99, evidenceSupported: true, guidanceSupported: true } });
  const protectedGuestBody = await guestReply();
  check(protectedGuestBody === "Discounts are available after you create an account.", "guest policy removes unauthorized offer before independent review");
  check(fixture.languageReviews[0]?.speechText === protectedGuestBody, "guest reviewer sees protected speech rather than the discarded offer");
  check(fixture.speech.at(-1) === protectedGuestBody, "guest voice reservation uses protected body");
  for (const entry of ["guest", "member", "voice"]) {
    reset({ image: false, userText: "Busco la camiseta del Real Madrid", body: "Unsupported stock claim.", allowScopeCards: true,
      commerceIntent: { commerceRoute: "unclear", commerceClassificationUnavailable: true, commerceClassificationFailure: "timeout", shouldLoadProductContext: false, cardAllowed: false, replyBoundary: { salesAllowed: false, contactAllowed: false } },
      productContext: { cardAllowed: true, products: [{ id: "old", name: "Old unrelated shirt" }] } });
    if (entry === "guest") await guestReply();
    else if (entry === "voice") await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" });
    else {
      const generation = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [] });
      await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generation });
    }
    const reply = fixture.inserted.find(m => m.contentType === "text");
    check(reply?.text === "Unavailable.", entry + " persists only fixed processing failure");
    check(!fixture.prompt && fixture.reviews.length === 0, entry + " does not generate or review an unclassified product answer");
    check(fixture.inserted.every(m => m.contentType !== "product"), entry + " classification failure cannot show an old product");
    check(fixture.speech.every(t => t === reply.text), entry + " processing failure display and speech agree");
  }
  // Exercise the same persisted text exits used by guest text/call and member
  // text/voice, including the member override bypass found during the audit.
  const scopeState = { version: 1, status: "pending", siteId: "site_fixture", characterId: character.id,
    items: [{ evidence: "red Madrid shirt", sharedEvidence: "both M", text: "red Madrid shirt both M" },
      { evidence: "blue Barcelona shirt", sharedEvidence: "both M", text: "blue Barcelona shirt both M" }], selectedIndex: null, clarificationCount: 1 };
  for (const entry of ["guest", "member", "voice"]) {
    reset({ image: false, userText: "red Madrid shirt and blue Barcelona shirt both M", body: "Madrid no está disponible.",
      commerceIntent: { commerceRoute: "product_search", knowledgeScope: "business", answerRequired: true,
        productScopePending: true, productRequestState: scopeState, shouldLoadProductContext: false, cardAllowed: false,
        searchState: "needs_clarification", replyBoundary: { salesAllowed: true, contactAllowed: true } },
      productContext: { products: [], searchOutcome: "needs_clarification", searchIntent: { productScopePending: true, productRequestState: scopeState, answerRequired: true, cardAllowed: false, searchState: "needs_clarification" } },
      verdict: { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, languageQualitySupported: true, productScopeSupported: false } });
    let text;
    if (entry === "guest") text = await guestReply();
    else if (entry === "voice") { await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" }); text = fixture.inserted.find(m => m.contentType === "text")?.text; }
    else {
      const generation = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [],
        productContextOverride: { products: [{ id: "old", name: "Old unrelated shirt" }], cardAllowed: true } });
      check(fixture.producerCalls === 1 && !generation.productContext.products.length, "pending scope cannot use member productContextOverride");
      await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generation });
      text = fixture.inserted.find(m => m.contentType === "text")?.text;
    }
    check(text.includes("Madrid") && text.includes("Barcelona") && !text.includes("no está disponible"), entry + " unresolved scope retains both options without a false no-stock claim");
    check(fixture.inserted.filter(m => m.contentType === "text")[0]?.productRequestState === scopeState, entry + " state follows same text transaction");
    check(fixture.inserted.every(m => m.contentType !== "product"), entry + " unresolved scope sends no product card");
    check(fixture.speech.every(t => t === text), entry + " scope display and speech agree");
  }
  for (const entry of ["guest", "member", "voice"]) {
    const state = { ...scopeState, status: "selected", selectedIndex: 1 };
    const intent = { commerceRoute: "product_search", productRequestState: state, shouldLoadProductContext: true, cardAllowed: true,
      answerRequired: true, replyBoundary: { salesAllowed: true, contactAllowed: true } };
    reset({ image: false, allowScopeCards: true, userText: "second", body: "Esta camiseta roja está disponible.", commerceIntent: intent,
      productContext: { cardAllowed: true, products: [{ id: "wrong_colour", name: "Barcelona Red Shirt" }], searchOutcome: "matched", searchIntent: intent },
      verdict: { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, languageQualitySupported: true, productScopeSupported: false } });
    if (entry === "guest") await guestReply();
    else if (entry === "voice") await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" });
    else {
      const generation = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, recentMessages: [] });
      check(generation.replyResult.productScopeVerified === false, "failed selected-scope review reaches member persistence");
      await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generation });
    }
    check(fixture.inserted.every(m => m.contentType !== "product"), entry + " failed scope review suppresses catalogue cards as well as body claims");
    const text = fixture.inserted.find(m => m.contentType === "text")?.text || "";
    check(!text.includes("está disponible") && text.includes("Barcelona"), entry + " failed selected scope safely identifies only current item");
    check(fixture.speech.every(t => t === text), entry + " failed selected scope speech and display agree");
  }
  for (const entry of ["guest", "member", "voice"]) {
    reset();
    let text;
    if (entry === "guest") text = await guestReply();
    else if (entry === "voice") { await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" }); text = fixture.inserted.find((m) => m.contentType === "text")?.text; }
    else {
      const generation = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, userDisplayOrder: 10, recentMessages: [] });
      await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generation });
      text = fixture.inserted.find((m) => m.contentType === "text")?.text;
    }
    check(text === "La imagen está lista.", entry + " replaces stale generating claim with fresh ready state");
    check(fixture.reads.length === 2 && fixture.reads.every((r) => r.fresh), entry + " both image reads use the fresh pool");
    check(fixture.reviews.length === 1 && JSON.parse(fixture.reviews[0].messages.at(-1).content).imageStatusContext.status === "ready", entry + " single combined review receives refreshed status");
    check(fixture.speech.at(-1) === text, entry + " persisted speech equals visible text");
  }
  for (const entry of ["guest", "member", "voice"]) {
    reset({ finalStatus: "failed" });
    let text;
    if (entry === "guest") text = await guestReply();
    else if (entry === "voice") { await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" }); text = fixture.inserted.find((m) => m.contentType === "text")?.text; }
    else { const result = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, userDisplayOrder: 10, recentMessages: [] }); text = result.replyResult.text; }
    check(text === "La imagen falló.", entry + " failed final state cannot become pending or success");
    check(fixture.reviews.length === 1, entry + " failed-state correction shares one review");
  }
  reset({ imageOrder: 9, verdict: { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: false } });
  check((await guestReply()) === "No puedo confirmar el estado.", "ambiguous older-image reference cannot inherit the latest ready state");
  reset({ body: "La entrega no está verificada.\n\nTodavía se está generando.", verdict: { allowed: false, confidence: .99, languageQualitySupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true, evidenceSupported: true, guidanceSupported: true, retainedTextAllowed: true, retainedBoundarySupported: true, retainedImageStatusSupported: true, retainedLanguageQualitySupported: true, retainedText: "La entrega no está verificada." } });
  assert.equal(await guestReply(), "La entrega no está verificada.\n\nLa imagen está lista.", "mixed whole supported paragraph survives state correction"); checks++;
  reset({ body: "Oferta disponible.\n\nTodavía se está generando.", verdict: { allowed: false, confidence: .99, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true, evidenceSupported: true, guidanceSupported: false, retainedTextAllowed: true, retainedText: "Oferta disponible." } });
  check(!(await guestReply()).includes("Oferta disponible"), "a failed non-image guard cannot salvage an unsupported paragraph");
  reset({ reviewFailure: true });
  check((await guestReply()) === "La imagen está lista.", "review transport failure replaces stale text with only the confirmed current-turn server state");
  reset({ readFailure: true, body: "Ya está lista.", verdict: { allowed: false, confidence: .99, evidenceSupported: true, guidanceSupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true } });
  check((await guestReply()) === "No puedo confirmar el estado.", "status read failure cannot prove ready, pending or a task exists");
  reset({ body: "Charla normal.", verdict: { allowed: true, languageQualitySupported: true, confidence: .99, imageStatusSupported: true, imageStatusRelevant: false, imageReferenceMatched: false, evidenceSupported: true, guidanceSupported: true } });
  check((await guestReply()) === "Charla normal.", "unrelated chat stays unchanged even when a recent image exists");
  for (const language of ["es", "hu", "ja"]) {
    reset({ image: false, userText: "Give me a coupon", body: ({ es: "No puedo emitir un cupón aquí. Entrega no verificada.", hu: "Itt nem tudok kupont kiadni. A szállítás nincs igazolva.", ja: "ここではクーポンを発行できません。配送情報は未確認です。" })[language], verdict: { allowed: true, languageQualitySupported: true, confidence: .99, evidenceSupported: true, guidanceSupported: true, guestBenefitSupported: true } });
    character.profile.language = language;
    fixture.commerceIntent = { commerceRoute: "chat", knowledgeScope: "business", commerceConfidence: .96, promotionInquiry: { kind: "benefit_request", evidence: "coupon" }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
    const text = await guestReply();
    check(text.includes(fixture.body), language + " exact approved body retains concurrent answer");
    check(text !== fixture.body && !text.includes("Discounts are available after"), language + " guide uses guest context language and conditional account access");
    check(fixture.speech.at(-1) === text, language + " benefit guide and body have identical voice wording");
    reset({ image: false, userText: "Give me a coupon", body: "Use SAVE20 for 20% off", reviewFailure: true });
    fixture.commerceIntent = { commerceRoute: "chat", knowledgeScope: "business", commerceConfidence: .96, promotionInquiry: { kind: "benefit_request", evidence: "coupon" }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
    check(!/SAVE20|20%/.test(await guestReply()), language + " failed review cannot issue a benefit");
  }
  for (const entry of ["guest", "member", "voice"]) {
    for (const pass of [true, false]) {
      reset({ image: false, userText: "Szia!", body: pass ? "Jó újra beszélni veled!" : "írokmappingsz",
        languageRejected: !pass, verdict: { allowed: true, confidence: .99, evidenceSupported: true, guidanceSupported: true } });
      character.profile.language = "hu";
      let text;
      if (entry === "guest") text = await guestReply();
      else if (entry === "voice") { await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" }); text = fixture.inserted.find((m) => m.contentType === "text")?.text; }
      else {
        const generated = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, userDisplayOrder: 10, recentMessages: [], logContext: { languageCode: "hu" } });
        await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generated });
        text = fixture.inserted.find((m) => m.contentType === "text")?.text;
      }
      check(fixture.reviews.length === (pass ? 1 : 2) && fixture.languageReviews.length === (pass ? 1 : 2), entry + " clockless chat audits identity and language for each candidate and regenerates at most once");
      check(fixture.languageReviews[0].language === "hu", entry + " dedicated reviewer receives the active language");
      check(pass ? text === fixture.body : !text.includes("írokmappingsz") && text.includes("próbáld újra"), entry + " final persisted output applies quality verdict in Hungarian: " + JSON.stringify({pass, text, body:fixture.body}));
      check(fixture.speech.at(-1) === text, entry + " final visible and reserved speech wording agree");
    }
  }
  async function replyForEntry(entry) {
    if (entry === "guest") return guestReply();
    if (entry === "voice") {
      await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "user_turn" });
    } else {
      const generation = await buildCharacterReplyGenerationForDb(db, { promptCharacter: character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, userDisplayOrder: 10, recentMessages: [],
        ...(fixture.imageRecovery ? { chatImageContext: fixture.imageDirective } : {}) });
      await persistCharacterReplyForDb(db, { character, session, userId: "user_fixture", characterId: character.id, userText: fixture.userText, replyVoicePayloadBuilder: identity, ...generation });
    }
    return fixture.inserted.find((m) => m.contentType === "text")?.text || "";
  }

  // Actual entry callbacks generate once more from the exact same prompt and reuse
  // the already resolved turn. Boundary/recovery remain real; all I/O is memory-only.
  for (const entry of ["guest", "member", "voice"]) {
    reset({ image: false, userText: "Szia!", body: "Első válasz.", regeneratedBody: "Örülök neked!",
      rejectInitialLanguage: true, verdict: { allowed: true, confidence: .99, evidenceSupported: true, guidanceSupported: true } });
    character.profile.language = "hu";
    const text = await replyForEntry(entry);
    check(text === fixture.regeneratedBody, entry + " publishes the fully reviewed regenerated body");
    check(fixture.generations.length === 2 && !fixture.generations[0].regeneration && fixture.generations[1].regeneration === true,
      entry + " uses one initial generation and exactly one finite regeneration");
    check(fixture.generations[1].regenerationProvider?.aiProvider === fixture.generatedReplies[0].aiProvider
      && fixture.generations[1].regenerationProvider?.aiModel === fixture.generatedReplies[0].aiModel,
      entry + " forwards only the already successful provider metadata for regeneration");
    check(fixture.generations[1].regenerationUseAlternateProvider === false, entry + " existing language-only repair keeps its original provider selection");
    check(fixture.generations[0].promptContext === fixture.generations[1].promptContext,
      entry + " reuses the identical persona, policy, history and evidence prompt");
    check(fixture.generations[0].logContext === fixture.generations[1].logContext,
      entry + " reuses the same turn and voice log context");
    check(fixture.commerceCalls === 1 && fixture.knowledgeCalls === 1 && fixture.producerCalls === 1 && fixture.factualInputs.length === 1,
      entry + " does not repeat commerce classification or product/knowledge/factual retrieval");
    check((fixture.orderCalls || 0) <= 1, entry + " does not repeat order resolution");
    check(fixture.inserted.filter(row => row.contentType === "text").length === 1 && fixture.inserted.every(row => row.contentType !== "product"),
      entry + " persists only one final text and no duplicate cards");
    check(fixture.speech.length === 1 && fixture.speech[0] === text,
      entry + " reserves/generates audio only for the final text");
    check(fixture.languageReviews.length === 2 && fixture.languageReviews[1].text === fixture.regeneratedBody,
      entry + " audits the new candidate rather than repeating the old audit");
  }

  // Image text recovery exercises the production guest/member callbacks, including
  // the member voice entry, while the scoped status reader runs against memory.
  function resetImageRecovery(extra = {}) {
    reset({ imageRecovery: true, userText: "Mándame otra foto tuya.", status: "ready", finalStatus: "ready",
      body: "Estoy tomando otra foto ahora mismo.", regeneratedBody: "Aquí tienes otra foto de la galería. ¿Qué te parece?",
      commerceIntent: { commerceRoute: "unclear", knowledgeScope: "none", replyBoundary: { salesAllowed: false, contactAllowed: false } },
      factualContext: { required: false, status: "not_required", items: [], searched: false },
      imageDirective: { taskCreated: true, reason: "image_task_created", trigger: { hasIntent: true, allowed: true, classificationOutcome: "accepted", requestScope: "image_only" } },
      verdict: { allowed: false, boundarySupported: false, confidence: .99, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true, factualSupported: true, checkoutProblem: false }, ...extra });
    character.profile.language = "es";
  }
  for (const entry of ["guest", "member", "voice"]) {
    resetImageRecovery();
    const text = await replyForEntry(entry);
    check(text === fixture.regeneratedBody, entry + " image recovery publishes the fully reviewed fresh text");
    check(fixture.generations.length === 2 && fixture.generations[1].regeneration === true,
      entry + " image recovery invokes exactly one additional text generation");
    const [first, second] = fixture.generations.map(item => item.promptContext);
    check(second !== first && second.systemPrompt.startsWith(first.systemPrompt), entry + " image recovery appends to the original prompt");
    check(second.layers.at(-1).id === "image_reply_recovery" && second.layers[0] === first.layers[0], entry + " original persona layers survive image recovery");
    check(first.layers.every(layer => layer.id !== "image_reply_recovery"), entry + " appended recovery layer does not mutate the initial prompt");
    check(second.messages === first.messages && second.visionInputs === first.visionInputs,
      entry + " original conversation and vision inputs survive image recovery");
    check(second.systemPrompt.includes('"currentTurn":true') && second.systemPrompt.includes('"status":"ready"'),
      entry + " image recovery prompt uses fresh current-turn ready evidence");
    check(!second.systemPrompt.includes(fixture.body), entry + " rejected image-status candidate is not supplied to regeneration");
    check(fixture.reads.length === 4 && fixture.reads.every(read => read.fresh), entry + " image recovery refreshes before and after text generation using fresh pool");
    check(fixture.reads.slice(1).every(read => read.args.at(-2) === "image_fixture" && read.args.at(-1) === "asset_fixture"),
      entry + " recovery refreshes exactly the same image message and asset anchor");
    check(fixture.reads.every(read => JSON.stringify(read.args.slice(0, 4)) === JSON.stringify(fixture.reads[0].args.slice(0, 4))),
      entry + " recovery retains exact session, character and owner/guest scope");
    check(fixture.reviews.length === 2 && fixture.languageReviews.length === 2 && fixture.languageReviews[1].text === fixture.regeneratedBody,
      entry + " regenerated image reply receives full primary and independent language review");
    check(fixture.commerceCalls === 1 && fixture.knowledgeCalls === 1 && fixture.producerCalls === 1 && fixture.factualInputs.length === 1,
      entry + " image text recovery does not repeat resolved commerce, knowledge, product or factual work");
    check((fixture.orderCalls || 0) <= 1 && (fixture.imageDirectiveCalls || 0) === (entry === "voice" ? 1 : 0)
      && !(fixture.imagePlaceholderCalls || 0), entry + " recovery does not repeat image directives, placeholders or order actions");
    check(fixture.inserted.filter(row => row.contentType === "text").length === 1
      && fixture.inserted.every(row => !["product", "image_generation", "feedback_action", "order_action"].includes(row.contentType)),
      entry + " recovery persists one final reply without duplicate image or business actions");
    check(fixture.speech.length === 1 && fixture.speech[0] === text, entry + " only final image reply is voiced");
    check(fixture.reviewDiagnostics.at(-1)?.languageDiagnostics?.repairKind === "image", entry + " final review retains image recovery provenance");
    resetImageRecovery({ imageRecoveryReadFailureAfter: 2 });
    const unverified = await replyForEntry(entry);
    check(fixture.generations.length === 1 && fixture.reviews.length === 1, entry + " failed pre-generation fresh reader prevents image text recovery");
    check(unverified === "No puedo confirmar el estado.", entry + " failed recovery refresh cannot reuse previous ready state");
    resetImageRecovery({ imageRecoveryFailAfterRegeneration: true });
    const changed = await replyForEntry(entry);
    check(fixture.generations.length === 2 && fixture.reviews.length === 1, entry + " changed image state after generation prevents publishing candidate");
    check(changed === "No puedo confirmar el estado.", entry + " post-generation state change reports uncertainty instead of ready");
    resetImageRecovery({ recoveryVerdict: { allowed: false, boundarySupported: false, confidence: .99,
      imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true, factualSupported: true, checkoutProblem: false } });
    const rejectedAgain = await replyForEntry(entry);
    check(fixture.generations.length === 2 && fixture.reviews.length === 2, entry + " second rejected image reply cannot start another recovery");
    check(rejectedAgain === "La imagen está lista." && fixture.inserted.filter(row => row.contentType === "text").length === 1,
      entry + " second rejection uses only verified current image fallback and persists once");
  }

  // Empty ordinary searches reach the real combined review and all persisted exits.
  const singleProductIntent = { commerceRoute: "product_search", commerceConfidence: .96, knowledgeScope: "business", answerRequired: false,
    needsLiveProductData: false, shouldLoadProductContext: true, cardAllowed: true, searchState: "ready_to_search",
    productRequest: { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
  const singleEvidenceBody = "Card payments are accepted online.\n\nI selected several training tops. Click the products below.";
  const supportedParagraph = "Card payments are accepted online.";
  const retainedSingleVerdict = { allowed: false, confidence: .99, languageQualitySupported: true, evidenceSupported: false,
    retainedTextAllowed: true, retainedText: supportedParagraph, retainedEvidenceSupported: true, retainedBoundarySupported: true,
    retainedLanguageQualitySupported: true, imageStatusSupported: true, imageStatusRelevant: false, retainedImageStatusSupported: true };
  for (const entry of ["guest", "member", "voice"]) {
    for (const outcome of ["not_searched", "needs_clarification", "clarification_exhausted", "no_match", "source_error", "unknown"]) {
      character.profile.language = "en";
      reset({ image: false, userText: "Show me training tops", body: "I selected several training tops. Click the products below.",
        productContext: { products: [], cardAllowed: true, searchOutcome: outcome, searchIntent: singleProductIntent }, commerceIntent: singleProductIntent,
        verdict: { allowed: false, confidence: .99, evidenceSupported: false, languageQualitySupported: true } });
      const text = await replyForEntry(entry);
      const request = JSON.parse(fixture.reviews[0]?.messages.at(-1).content || "{}");
      check(fixture.reviews.length === 1 && request.evidenceRequired === true, `${entry}/${outcome} ordinary caption receives one evidence review`);
      check(request.evidence.catalogueProducts.length === 0, `${entry}/${outcome} review sees actual empty catalogue`);
      check(request.evidence.searchOutcome === (outcome === "unknown" ? "not_searched" : outcome), `${entry}/${outcome} review sees canonical actual search outcome`);
      check(request.proposedSpeech.includes("I selected several training tops"), `${entry}/${outcome} evidence review includes the generated speech claim`);
      check(!text.includes("I selected") && !text.includes("Click the products"), `${entry}/${outcome} unsupported selection is not persisted`);
      check(fixture.inserted.filter(row => row.contentType === "text").length === 1 && fixture.inserted.every(row => row.contentType !== "product"), `${entry}/${outcome} persists one text and no phantom card`);
      check(fixture.speech.at(-1) === text, `${entry}/${outcome} final speech and persisted text agree`);
    }
    const badRetainedVerdicts = [
      ...["retainedTextAllowed", "retainedEvidenceSupported", "retainedBoundarySupported", "retainedLanguageQualitySupported"].flatMap(field =>
        [undefined, false, "true"].map(value => ({ ...retainedSingleVerdict, [field]: value }))),
      { ...retainedSingleVerdict, confidence: "0.99" },
      { ...retainedSingleVerdict, retainedText: "payments are accepted online." },
      { ...retainedSingleVerdict, retainedText: singleEvidenceBody },
    ];
    if (entry === "guest") {
      // Guest normalization now preserves real paragraphs. Supply a genuinely
      // single-paragraph input here to keep the original no-slice-retention
      // negative; the unchanged following matrix covers real whole paragraphs.
      reset({ image: false, userText: "Show me training tops; do you accept card payments?", body: singleEvidenceBody.replace(/\n\n/g, " "),
        productContext: { products: [], searchOutcome: "no_match", searchIntent: singleProductIntent }, commerceIntent: singleProductIntent, verdict: retainedSingleVerdict });
      const flattened = await replyForEntry(entry);
      const request = JSON.parse(fixture.reviews[0].messages.at(-1).content);
      check(!request.proposedResponse.includes("\n\n"), "guest single-paragraph input has no verified whole-paragraph boundary left");
      check(!flattened.includes(supportedParagraph) && !flattened.includes("I selected"), "guest preprocessed slice cannot acquire retention permission");
      check(fixture.speech.at(-1) === flattened, "guest preprocessed fallback remains canonical for speech");
      badRetainedVerdicts.push(...[undefined, false, "true"].map(value => ({ ...retainedSingleVerdict, retainedImageStatusSupported: value })));
      // Normal no-image guest path must retain the independently approved
      // whole policy paragraph now that normalization preserves its boundary.
      reset({ image: false, userText: "Show me training tops; do you accept card payments?", body: singleEvidenceBody,
        productContext: { products: [], cardAllowed: true, searchOutcome: "no_match", searchIntent: singleProductIntent }, commerceIntent: singleProductIntent,
        knowledgeContext: { items: [{ id: "payment_fixture", scope: "business", siteId: "site_fixture", content: supportedParagraph }] }, verdict: retainedSingleVerdict });
      const wholeParagraphText = await replyForEntry(entry);
      const wholeParagraphRequest = JSON.parse(fixture.reviews[0].messages.at(-1).content);
      check(wholeParagraphRequest.proposedResponse.includes("\n\n"), "guest no-image review preserves real paragraph boundaries");
      check(wholeParagraphRequest.evidence.knowledge.some(item => item.id === "payment_fixture" && item.content === supportedParagraph), "guest no-image retention audit receives actual payment knowledge");
      check(wholeParagraphText.includes(supportedParagraph) && wholeParagraphText.includes("Not verified."), "guest no-image keeps the independently approved whole policy paragraph with evidence fallback");
      check(!wholeParagraphText.includes("I selected") && !wholeParagraphText.includes("Click the products"), "guest no-image cannot retain rejected catalogue promises");
      check(fixture.inserted.filter(row => row.contentType === "text").length === 1 && fixture.inserted.every(row => row.contentType !== "product"), "guest no-image retention persists one text without a phantom product card");
      check(fixture.speech.at(-1) === wholeParagraphText, "guest no-image whole-paragraph reply and final speech agree");
    }
    for (const [index, verdict] of [retainedSingleVerdict, ...badRetainedVerdicts].entries()) {
      character.profile.language = "en";
      reset({ image: entry === "guest", userText: "Show me training tops; do you accept card payments?", body: singleEvidenceBody,
        productContext: { products: [], cardAllowed: true, searchOutcome: "no_match", searchIntent: singleProductIntent }, commerceIntent: singleProductIntent,
        knowledgeContext: { items: [{ id: "payment_fixture", scope: "business", siteId: "site_fixture", content: supportedParagraph }] }, verdict });
      const text = await replyForEntry(entry);
      const label = `${entry}/ordinary-retention/${index}`;
      check(fixture.reviews.length === (typeof verdict.confidence === "number" ? 1 : 2), label + " audits one candidate per attempt, including one regeneration for invalid confidence");
      check(index === 0 ? text.includes(supportedParagraph) && text.includes("Not verified.") : !text.includes(supportedParagraph), label + " retains only independently approved whole paragraphs with fallback: " + JSON.stringify({ text }));
      check(!text.includes("I selected") && !text.includes("Click the products"), label + " evidence rejection never approves the whole body");
      check(fixture.inserted.filter(row => row.contentType === "text").length === 1 && fixture.inserted.every(row => row.contentType !== "product"), label + " no empty-result card is persisted");
      check(fixture.speech.at(-1) === text, label + " final canonical text feeds voice reservation");
    }
    for (const verdict of [{ allowed: true, confidence: .99 }, { allowed: true, confidence: .99, evidenceSupported: "true" }, null]) {
      reset({ image: false, userText: "Find a rain jacket", body: "Click the rain jackets below.", productContext: { products: [], searchOutcome: "not_searched" },
        commerceIntent: singleProductIntent, verdict });
      const text = await replyForEntry(entry);
      check(!text.includes("Click the rain jackets"), entry + " generic non-training product requires strict evidence flag");
      check(fixture.speech.at(-1) === text, entry + " malformed review cannot diverge voice and text");
    }
    reset({ image: false, userText: "Show me training tops", body: "Which kind of training top would you like?", productContext: { products: [], searchOutcome: "needs_clarification" },
      commerceIntent: singleProductIntent, verdict: { allowed: true, confidence: .99, evidenceSupported: true, languageQualitySupported: true } });
    check(await replyForEntry(entry) === fixture.body, entry + " supported honest clarification survives ordinary empty-product review");
    check(fixture.speech.at(-1) === fixture.body, entry + " honest clarification has the same speech");
    reset({ image: false, userText: "Show me training tops", body: "Click the products below.", productContext: { products: [], searchOutcome: "source_error" }, commerceIntent: singleProductIntent, reviewTimeout: true });
    const timeoutText = await replyForEntry(entry);
    check(!timeoutText.includes("Click the products"), entry + " review timeout cannot release phantom-product promises");
    check(fixture.speech.at(-1) === timeoutText, entry + " timeout fallback has canonical speech");
  }
  const policyEvidence = { id: "policy_fixture", scope: "business", siteId: "site_fixture", title: "Verified return policy", content: "Returns are accepted within 30 days, subject to the stated conditions.", evidenceQuote: "Returns are accepted within 30 days" };
  for (const entry of ["guest", "member", "voice"]) {
    for (const pass of [true, false]) {
      character.profile.language = "es";
      reset({ image: false, userText: "¿Qué eliminación de este año te dio pena?", body: pass ? "Perder con ilusión puede doler mucho." : "Argentina fue eliminada en esa final.",
        verdict: { allowed: pass, confidence: .99, languageQualitySupported: true, evidenceSupported: true, guidanceSupported: true, factualSupported: pass } });
      fixture.jevDecision = { ok: true, confident: true, webSearchIntent: false, orderIntent: "none" };
      fixture.factualContext = { required: false, status: "not_required", asOfUtc: "2026-10-10T06:00:00.000Z", searched: false, items: [] };
      const text = await replyForEntry(entry);
      check(fixture.factualInputs.length === 1 && fixture.factualInputs[0].jevDecision === fixture.jevDecision, entry + " companionship preserves existing non-search JEV decision");
      check(fixture.reviews.length === (pass ? 1 : 2), entry + " companionship preserves acceptance or reviews one fresh candidate after factual-only rejection");
      if (!pass) check(fixture.generations[1].regenerationUseAlternateProvider === true, entry + " only new conversation correction opts into a single configured alternate");
      const request = JSON.parse(fixture.reviews[0].messages.at(-1).content);
      check(request.factualRequired === true && request.factualContext.required === false && request.factualContext.searched === false, entry + " current-event guard does not change search demand");
      check(pass ? text === fixture.body : !text.includes("Argentina"), entry + " rejects volunteered outcome while allowing empathy");
      check(fixture.speech.at(-1) === text, entry + " companionship speech agrees with final text");
    }
  }
  for (const entry of ["guest", "member", "voice"]) {
    for (const status of ["disabled", "matched", "no_result", "error", "blocked"]) {
      for (const pass of [true, false]) {
        character.profile.language = "es";
        reset({ image: false, userText: "¿Qué pasó en el mundial 2026?", body: pass ? "No puedo confirmar ese resultado aquí." : "El mundial 2026 todavía no se ha celebrado.",
          verdict: { allowed: pass, confidence: .99, languageQualitySupported: true, evidenceSupported: true, guidanceSupported: true, factualSupported: pass } });
        fixture.jevDecision = { ok: true, confident: true, webSearchIntent: true, orderIntent: "none" };
        fixture.factualContext = { required: true, status, asOfUtc: "2026-10-10T06:00:00.000Z", timeZone: "UTC", searched: ["matched", "no_result", "error"].includes(status), items: status === "matched" ? [{ title: "Fixture schedule", content: "The final took place on July 19, 2026.", url: "https://example.com/schedule" }] : [] };
        fixture.knowledgeContext = { items: [policyEvidence] };
        const text = await replyForEntry(entry);
        const scenario = `${entry}/factual/${status}/${pass ? "accepted" : "rejected"}`;
        check(fixture.factualInputs?.length === 1, scenario + " invokes shared factual resolver exactly once");
        check(fixture.factualInputs[0].jevDecision === fixture.jevDecision, scenario + " consumes the current existing JEV decision");
        check(fixture.prompt.factualContext === fixture.factualContext && fixture.prompt.knowledgeContext === fixture.knowledgeContext, scenario + " keeps factual state separate from existing knowledge");
        check(fixture.reviews.length === 1, scenario + " shares one language and factual review");
        const request = JSON.parse(fixture.reviews[0].messages.at(-1).content);
        check(request.factualRequired === true && request.factualContext?.status === status && request.factualContext?.asOfUtc === fixture.factualContext.asOfUtc, scenario + " sends trusted time and actual state to review");
        check(pass ? text === fixture.body : !text.includes("todavía no se ha celebrado") && text !== "Entendido.", scenario + " enforces factual verdict using a specific uncertainty response");
        check(fixture.speech.at(-1) === text, scenario + " persisted speech matches final visible reply");
      }
    }
    reset({ image: false, userText: "¿Qué pasó en el mundial 2026?", body: "El mundial 2026 todavía no se ha celebrado.", reviewTimeout: true });
    fixture.factualContext = { required: true, status: "disabled", asOfUtc: "2026-10-10T06:00:00.000Z", timeZone: "UTC", items: [], searched: false };
    check(!(await replyForEntry(entry)).includes("todavía no se ha celebrado"), entry + " factual review timeout cannot release unsupported claims");
  }
  const catalogueProduct = { id: "product_fixture", name: "Current catalogue jersey", summary: "Cotton jersey", price: 29, currency: "USD", sizes: [{ label: "M" }] };
  for (const entry of ["guest", "member", "voice"]) {
    for (const matchedProduct of [false, true]) {
      for (const verdictKind of ["accepted", "rejected", "timeout"]) {
        const pass = verdictKind === "accepted";
        character.profile.language = "en";
        reset({ image: false, userText: matchedProduct ? "What is the return policy for this jersey?" : "What is your store return policy?",
          body: pass ? "Returns are accepted within 30 days, subject to the stated conditions." : "All jerseys are officially licensed.",
          reviewTimeout: verdictKind === "timeout",
          productContext: matchedProduct ? { sourceRef: "matched-catalogue-product", products: [catalogueProduct] } : null,
          knowledgeContext: { customerServiceIntent: false, items: [policyEvidence] },
          commerceIntent: { commerceRoute: matchedProduct ? "product_question" : "store_policy", commerceTopic: "authenticity", knowledgeScope: "business", answerRequired: true, needsLiveProductData: matchedProduct, replyBoundary: { salesAllowed: true, contactAllowed: true } },
          verdict: { allowed: pass, confidence: .99, languageQualitySupported: true, evidenceSupported: true, guidanceSupported: true, businessFactsSupported: pass } });
        const text = await replyForEntry(entry);
        const scenario = `${entry}/${matchedProduct ? "matching product" : "store policy"}/${verdictKind}`;
        check(fixture.reviews.length === (verdictKind === "timeout" ? 2 : 1), scenario + " audits once per candidate and permits one fresh generation after review timeout");
        const request = JSON.parse(fixture.reviews[0].messages.at(-1).content);
        check(request.businessFactsRequired === true && request.evidenceRequired === false
          && request.evidence.knowledge[0].id === policyEvidence.id && request.evidence.knowledge[0].content === policyEvidence.content,
          scenario + " includes actual site knowledge despite existing catalogue evidence");
        check(matchedProduct ? request.evidence.catalogueProducts[0]?.name === catalogueProduct.name && request.evidence.catalogueProducts[0]?.summary === catalogueProduct.summary : request.evidence.catalogueProducts.length === 0,
          scenario + " passes matching catalogue evidence only when actually present");
        check(pass ? text === fixture.body : !/officially licensed/i.test(text) && text.length > 0,
          scenario + " preserves supported answers and suppresses unsupported licensing on rejection/timeout");
        check(fixture.speech.at(-1) === text, scenario + " final speech equals visible text");
      }
    }
    for (const reason of ["missing_knowledge", "customization"]) {
      character.profile.language = "en";
      reset({ image: false, userText: reason === "customization" ? "Can I customize a football jersey?" : "Can you verify your store authorization?",
        body: "I cannot confirm that here.", knowledgeContext: { customerServiceIntent: true, customerServiceTopic: "authenticity", items: [] },
        commerceIntent: { commerceRoute: reason === "customization" ? "product_question" : "store_policy", commerceTopic: "authenticity", knowledgeScope: "business", answerRequired: true, replyBoundary: { salesAllowed: true, contactAllowed: true } },
        verdict: { allowed: true, confidence: .99, languageQualitySupported: true, businessFactsSupported: true, evidenceSupported: true, guidanceSupported: true } });
      const text = await replyForEntry(entry);
      check(text.startsWith(fixture.body) && text.includes("open the form, then submit") && text.includes("for the team to review"), entry + "/" + reason + " persists the real form submission explanation after the supported answer");
      check(!/leave.*email|follow.?up|contact you/i.test(text), entry + "/" + reason + " appends no chat-email or automatic contact promise");
      check(fixture.inserted.filter((m) => m.contentType === "feedback_action").length === 1, entry + "/" + reason + " retains exactly one existing feedback action");
      check(fixture.speech.at(-1) === text, entry + "/" + reason + " real form copy is also used for speech");
    }
  }
  const { buildGuestBenefitContext, approveGuestBenefitContext, appendGuestBenefitGuide, isGuestBenefitReplyReviewed } = await import("../server/guest-benefit-guidance-service.js");
  const rights = buildGuestBenefitContext({ isGuest: true, userText: "coupon", languageCode: "es", searchIntent: { commerceConfidence: .96, promotionInquiry: { kind: "benefit_request", evidence: "coupon" } } });
  check(approveGuestBenefitContext(rights, { text: "No puedo emitir un cupón.", allowed: true, confidence: .99, guidanceSupported: true }), "trusted test assessment may approve one exact body");
  check(!isGuestBenefitReplyReviewed(rights, "No puedo emitir un cupón. Use SAVE20"), "changing an approved body invalidates exact approval");
  check(!appendGuestBenefitGuide("No puedo emitir un cupón. Use SAVE20", rights).includes("SAVE20"), "unapproved mutation cannot receive preservation permission");
  check(buildGuestBenefitContext({ isGuest: false, userText: "coupon", searchIntent: { commerceConfidence: .96, promotionInquiry: { kind: "benefit_request", evidence: "coupon" } } }) === null, "member identity cannot acquire guest-only context");
  const existingReply = (sourceRef, overrides = {}) => ({ id: "existing_reply", session_id: session.id, sender_type: "character", content_type: "text",
    source_ref: sourceRef, display_order: 30, voice_asset_id: "existing_voice", ...overrides });
  const pendingUser = (sourceRef, overrides = {}) => ({ id: "user_turn", session_id: session.id, guest_session_id: "guest_fixture", sender_type: "user", content_type: "text",
    source_ref: sourceRef, client_message_id: "fixture_request", text_content: "Szia!", display_order: 10, ...overrides });
  const acceptedChat = { image: false, body: "Szia!", verdict: { allowed: true, confidence: .99, languageQualitySupported: true } };
  for (const suffix of [":product-clarification", ""]) {
    reset({ ...acceptedChat, existingReplies: [existingReply(`guest-reply:user_turn${suffix}`)] });
    const voice = await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn" }, text: fixture.userText } });
    check(voice === "existing_voice" && fixture.inserted.length === 0 && fixture.reviews.length === 0,
      "completed " + (suffix || "base") + " reply is reused before generation");
    reset({ ...acceptedChat, existingReplies: [], transactionReplies: [existingReply(`guest-reply:user_turn${suffix}`)] });
    const transactionVoice = await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn", display_order: 10 }, text: fixture.userText, attachments: [], promptBeforeDisplayOrder: 10 } });
    check(transactionVoice === "existing_voice" && fixture.inserted.length === 0 && fixture.speech.length === 0,
      "transaction recheck recognizes completed " + (suffix || "base") + " reply without duplicate side effects");
  }
  reset({ ...acceptedChat, existingReplies: [existingReply("guest-reply:user_turn:product-clarification", { display_order: 20, voice_asset_id: "older_voice" }),
    existingReply("guest-reply:user_turn", { display_order: 40, voice_asset_id: "final_voice" })] });
  check(await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn" } } }) === "final_voice",
    "historical base and marker replies prefer the existing base deterministically");
  reset({ ...acceptedChat, existingReplies: [existingReply("guest-reply:user_turn:product-clarification", { display_order: 40, voice_asset_id: "later_voice" }),
    existingReply("guest-reply:user_turn:product-clarification", { display_order: 20, voice_asset_id: "first_voice" })] });
  check(await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn" } } }) === "first_voice",
    "historical duplicate marker rows reuse the earliest completed reply without changing history");
  reset({ ...acceptedChat, existingReplies: [existingReply("guest-reply:user_turn:product-clarification", { voice_asset_id: null })] });
  check(await ensureGuestReply({ token: "fixture", prepared: { guest: fixture.guest, message: { id: "user_turn" } } }) === "" && fixture.inserted.length === 0 && fixture.reviews.length === 0,
    "completed text without an audio asset is still complete and cannot regenerate its body");
  for (const invalid of [existingReply("guest-reply:user_turn:product-clarification:extra"), existingReply("guest-reply:user_turn_other"),
    existingReply("guest-reply:user_turn", { session_id: "another_session" }), existingReply("guest-reply:user_turn", { sender_type: "user" }),
    existingReply("guest-reply:user_turn", { content_type: "product" })]) {
    reset({ ...acceptedChat, existingReplies: [invalid] });
    await guestReply();
    check(fixture.inserted.filter((row) => row.contentType === "text").length === 1, "only a same-session character text with an exact lawful ref completes a reply: " + JSON.stringify(invalid));
  }
  for (const sourceRef of ["voice-asr", "guest-call"]) {
    for (const suffix of ["", ":product-clarification"]) {
      reset({ ...acceptedChat, pendingVoiceUsers: [pendingUser(sourceRef)], existingReplies: [existingReply(`guest-reply:user_turn${suffix}`)] });
      await getGuestConversation("fixture");
      check(fixture.reviews.length === 0 && fixture.inserted.length === 0 && fixture.events.length === 0,
        sourceRef + " completed " + (suffix || "base") + " text is not recovered as an unanswered turn");
      await sendGuestReplyForMessage({ token: "fixture", messageId: "user_turn", expectedSourceRef: sourceRef });
      check(fixture.voiceRetries.join() === "existing_voice" && fixture.inserted.length === 0 && fixture.reviews.length === 0,
        sourceRef + " retries the existing audio asset without regenerating completed text");
      check(fixture.events.join() === "lock,unlock", sourceRef + " keeps the original lock around reply reuse");
    }
    reset({ ...acceptedChat, pendingVoiceUsers: [pendingUser(sourceRef)], existingReplies: [] });
    await getGuestConversation("fixture");
    check(fixture.inserted.filter((row) => row.contentType === "text").length === 1 && fixture.voiceRetries.join() === "voice_fixture",
      sourceRef + " truly unanswered turn still recovers and generates its audio");
  }
  for (const invalid of [existingReply("guest-reply:user_turn:product-clarification:extra"), existingReply("guest-reply:user_turn", { session_id: "another_session" }),
    existingReply("guest-reply:user_turn", { sender_type: "user" }), existingReply("guest-reply:user_turn", { content_type: "product" })]) {
    reset({ ...acceptedChat, pendingVoiceUsers: [pendingUser("voice-asr")], existingReplies: [invalid] });
    await getGuestConversation("fixture");
    check(fixture.inserted.filter((row) => row.contentType === "text").length === 1, "recovery does not mistake an unrelated row for a completed voice reply: " + JSON.stringify(invalid));
  }
  reset({ ...acceptedChat, pendingVoiceUsers: [pendingUser("guest-input")], existingReplies: [] });
  await getGuestConversation("fixture");
  check(fixture.inserted.length === 0, "voice recovery does not begin regenerating ordinary text inputs");
  reset({ ...acceptedChat, productContext: { products: [], searchOutcome: "needs_clarification" } });
  await guestReply();
  check(fixture.inserted.find((row) => row.contentType === "text")?.sourceRef === "guest-reply:user_turn:product-clarification",
    "new clarification replies keep the marker used by existing clarification counts");
  // Real member entry points bind a semantic review to the persisted input,
  // including aggregated text (last input), without using an arbitrary UI anchor.
  for (const entry of ["text", "voice"]) {
    for (const pass of [true, false]) {
      const expectedInputId = entry === "text" ? "last_pending_input" : "voice_input";
      character.profile.language = "hu";
      reset({ image: false, userText: "Szia!", body: pass ? "Szia, itt vagyok." : "írokmappingsz",
        pendingTextUsers: [{ id: "first_pending_input", text_content: "Szia!", display_order: 10 },
          { id: "last_pending_input", text_content: "Hallgass meg.", display_order: 20 }], voiceUserId: "voice_input",
        factualContext: { asOfUtc: "2026-10-12T00:00:00Z", required: false, status: "not_required" },
        languageRejected: !pass, verdict: { allowed: true, confidence: .99, factualSupported: true } });
      if (entry === "text") await createUserReply({ characterId: character.id, userId: "user_fixture", sinceMessageId: "earlier_ui_anchor" });
      else await createUserVoiceReply({ characterId: character.id, userId: "user_fixture", messageId: "voice_input" });
      check(fixture.providerEvents.length === (pass ? 1 : 2) && fixture.reviews.length === (pass ? 1 : 2), `${entry}/${pass} uses one actual provider review per generated candidate`);
      check(fixture.providerEvents[0].requestId === expectedInputId && fixture.providerEvents[0].sessionId === session.id,
        `${entry}/${pass} provider diagnostic uses persisted input and exact session`);
      check(fixture.reviewDiagnostics.length === 1 && fixture.reviewDiagnostics[0].logContext.requestId === expectedInputId
        && fixture.reviewDiagnostics[0].logContext.sessionId === session.id, `${entry}/${pass} semantic diagnostic uses the same persisted input/session`);
      check(fixture.reviewDiagnostics[0].reviewStatus === "valid" && fixture.reviewDiagnostics[0].guardApplied === !pass,
        `${entry}/${pass} semantic result separates approval from language rejection`);
      const persisted = fixture.inserted.find(row => row.contentType === "text");
      check(pass ? !persisted.replyRecoveryState : persisted.replyRecoveryState?.guardApplied === true
        && persisted.replyRecoveryState.failedContracts.includes("language"), `${entry}/${pass} only actual guard output receives recovery metadata`);
    }
  }
  // Existing-candidate identity is persisted after whole review without a new
  // product bubble. The private proof comes from the actual source context maker.
  const { buildCandidateConfirmationContext } = await import("../server/product-candidate-confirmation-service.js");
  for (const entry of ["member", "guest", "voice"]) {
    for (const accepted of [true, false]) {
      const priorProduct = { id: "confirmation_shirt", name: "Real Madrid Away Shirt", siteId: "site_fixture", siteSlug: "fixture", matchStatus: "candidate" };
      const priorState = { version: 1, status: "active", siteId: "site_fixture", characterId: character.id, owner: "single", targetEvidence: "Real Madrid shirt",
        requirements: { requestedTeam: "Real Madrid", requestedProductType: "shirt", requestedPrinting: "none" },
        proposal: { status: "displayed", candidateId: priorProduct.id, name: priorProduct.name, reply: "Is this the shirt you mean?" } };
      const staged = { ...priorState, proposal: { ...priorState.proposal, status: "confirmed", confirmationEvidence: "Yes, that is the shirt." } };
      const commerceIntent = { commerceRoute: "product_question", commerceConfidence: .99, knowledgeScope: "business", answerRequired: true,
        shouldLoadProductContext: false, needsLiveProductData: false, cardAllowed: false, candidateConfirmationOnly: true, candidateSearchAllowed: false,
        confirmedCandidateId: priorProduct.id, productCandidateState: staged, replyBoundary: { salesAllowed: true, contactAllowed: false } };
      const context = await buildCandidateConfirmationContext({ site: { id: "site_fixture", slug: "fixture" }, characterId: character.id,
        userText: "Yes, that is the shirt.", searchIntent: commerceIntent, recentMessages: [
          { senderType: "character", characterId: character.id, contentType: "product", product: priorProduct },
          { senderType: "character", productCandidateState: priorState } ],
        resolveProduct: async () => ({ resolvedFromSource: true, site: { id: "site_fixture", slug: "fixture" }, sourceItem: priorProduct }),
        buildCandidateContext: products => ({ entityConfirmed: true, requiresConfirmation: false, entityConfirmationEvidence: "Yes, that is the shirt.",
          priorConfirmationQuestion: priorState.proposal.reply, products: products.map(product => ({ ...product, unknownFields: [] })) }) });
      reset({ image: false, userText: "Yes, that is the shirt.", body: "I understand which catalogue shirt you mean.",
        productContext: context, commerceIntent, verdict: { allowed: accepted, confidence: .99, boundarySupported: true,
          evidenceSupported: accepted, businessFactsSupported: true, guidanceSupported: true } });
      await replyForEntry(entry);
      const saved = fixture.inserted.find(row => row.contentType === "text");
      check(fixture.inserted.every(row => row.contentType !== "product"), `${entry}/${accepted}: confirming an existing candidate inserts no card`);
      check(accepted ? saved.productCandidateState?.proposal?.status === "confirmed" : saved.productCandidateState?.proposal === null,
        `${entry}/${accepted}: identity finalization uses only the fully reviewed same-source product`);
      const reviewed = JSON.parse(fixture.reviews[0].messages.at(-1).content);
      check(reviewed.candidateContext.products[0].id === priorProduct.id && reviewed.candidateContext.entityConfirmationEvidence === "Yes, that is the shirt.",
        `${entry}/${accepted}: whole review receives the exact existing product and current assent`);
    }
  }
  console.log(`Chat reply state flow self-check passed (${checks} assertions; production guest/member/voice entry points, memory only, no DB/network/models)`);
}
