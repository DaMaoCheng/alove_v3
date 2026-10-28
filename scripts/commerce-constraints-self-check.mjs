// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const edition = await import("../server/product-edition-service.js");
const { normalizeCommerceDecision, classifyCommerceIntentFallback: classifyCommerceIntent } = await import("../server/product-intent-classifier-service.js");
const { buildProductSearchIntent, filterProductsByIntent } = await import("../server/product-intent-service.js");
const { resolveCommerceSearchIntent, applyCommerceQuestionPromptPolicy } = await import("../server/commerce-routing-service.js");
const { executeProductSearch } = await import("../server/product-search-execution-service.js");
const { normalizeProducts, normalizeShopifyAdminProduct } = await import("../server/product-normalizer.js");
const { toGuestSafeProduct } = await import("../server/guest-product-sanitizer.js");
const { selectProductsForMessage } = await import("../server/chat-product-reply-service.js");
const { resolveGuestExternalSourceProductContext } = await import("../server/guest-chat-product-service.js");
const { closeDbPool } = await import("../server/db.js");
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const shopping = (extra = {}) => ({ route: "product_search", confident: true, confidence: .99, searchQuery: "Brazil shirt", productRequest: singleProductRequest, ...extra });
try {
  for (const confidence of [Infinity, "Infinity", NaN, .4]) {
    const value = normalizeCommerceDecision({ route: "product_search", confidence });
    check(!value.confident && !value.replyBoundary.salesAllowed && !value.replyBoundary.contactAllowed, "uncertain metadata cannot grant invitations");
  }
  check(normalizeCommerceDecision({ route: "product_search", confidence: .99, commerceConstraints: { edition: { value: "player", evidence: "invented" } } }, { userText: "Version jugador" }).commerceConstraints.edition === null, "invented user edition evidence is rejected");
  check(normalizeCommerceDecision({ route: "product_search", confidence: .99, commerceConstraints: { edition: { value: "player", evidence: "player version" } } }, { recentMessages: [{ senderType: "character", text: "player version" }] }).commerceConstraints.edition === null, "assistant cannot establish a user constraint");
  const mixedText = "Quiero la version jugador; puedo pagar en efectivo?";
  const mixed = await resolveCommerceSearchIntent({ userText: mixedText, searchIntent: buildProductSearchIntent(mixedText), classifyCommerce: async () => shopping({ searchQuery: "player version shirt", knowledgeScope: "business", knowledgeQuery: "pagar en efectivo", answerRequired: true, commerceConstraints: { edition: { value: "player", evidence: "version jugador" } } }) });
  check(mixed.requestedEdition === "player" && mixed.requestedFeatures.includes("authentic"), "non-English explicit evidence normalizes to existing hard feature");
  check(mixed.answerRequired && mixed.customerServiceKnowledgeRequest && mixed.knowledgeScope === "business" && mixed.cardAllowed, "mixed shopping and payment preserves answer and matching card");
  check(applyCommerceQuestionPromptPolicy({ systemPrompt: "", layers: [] }, mixed).systemPrompt.includes("must never replace or truncate"), "mixed question has answer priority over card caption");
  const targetText = "I live in Argentina. Please show me Brazil shirts.";
  const targeted = await resolveCommerceSearchIntent({ userText: targetText, searchIntent: { requestedTeam: "Argentina", requestedSizes: ["M"], requestedColor: "black" }, classifyCommerce: async () => shopping({ commerceConstraints: { team: { value: "Brazil", role: "product_target", evidence: "Brazil shirts" } } }) });
  check(targeted.requestedTeam === "Brazil" && targeted.requestedSizes[0] === "M" && targeted.requestedColor === "black", "actual target replaces locality while unrelated constraints survive");
  const conflictingTarget = await resolveCommerceSearchIntent({ userText: targetText, searchIntent: { requestedTeam: "Argentina" }, classifyCommerce: async () => shopping({ commerceConstraints: { team: { value: "Brazil", role: "product_target", evidence: "I live in Argentina" } } }) });
  check(!conflictingTarget.cardAllowed && !conflictingTarget.shouldLoadProductContext && conflictingTarget.searchState === "needs_clarification", "contradictory target evidence never falls back to the original locality");
  const localText = "I live in Argentina and want a shirt.";
  const local = await resolveCommerceSearchIntent({ userText: localText, searchIntent: { requestedTeam: "Argentina", requestedSizes: ["L"] }, classifyCommerce: async () => shopping({ searchQuery: "shirt", commerceConstraints: { team: { value: "Argentina", role: "location", evidence: "I live in Argentina" } } }) });
  check(local.requestedTeam === "" && !local.requestedKeywords.includes("argentina") && local.requestedSizes[0] === "L", "location clears scalar and recall keyword without erasing size");
  const unknown = await resolveCommerceSearchIntent({ userText: "Find Brazil shirt", searchIntent: { requestedTeam: "Brazil" }, classifyCommerce: async () => shopping() });
  check(unknown.requestedTeam === "Brazil", "absent structured constraint does not clear existing requirement");
  for (const primaryIntent of ["daily_chat", "new_image", "order_lookup", "unsupported_request"]) {
    const primary = { ok: true, confident: true, primaryIntent, productIntent: "none" };
    const result = await resolveCommerceSearchIntent({ userText: "shirt", classifyCommerce: async () => shopping({ answerRequired: true }), jevDecision: primary });
    check(!result.shouldLoadProductContext && !result.cardAllowed && result.answerRequired, "commerce cannot override primary action but retains questions");
    check(primary.primaryIntent === primaryIntent && primary.productIntent === "none", "JEV object is unchanged");
  }
  const facts = await resolveCommerceSearchIntent({ userText: "What size is this?", classifyCommerce: async () => shopping({ route: "product_question", needsLiveProductData: true, replyBoundary: { salesAllowed: false } }), jevDecision: { ok: true, confident: true, primaryIntent: "daily_chat", unsupported: true } });
  check(facts.shouldLoadProductContext && !facts.cardAllowed, "fact lookup survives no-sales boundary and unsupported action flag");
  const tryOn = await resolveCommerceSearchIntent({ userText: "Try on this shirt", classifyCommerce: async () => shopping(), jevDecision: { ok: true, confident: true, primaryIntent: "try_on", productIntent: "search" } });
  check(tryOn.shouldLoadProductContext, "try-on keeps the original product context ability");
  for (const productDecision of [
    { productIntent: "none", productAction: .4 },
    { productIntent: "search", productAction: .71 },
    { productIntent: "search", productAction: Infinity },
    { productIntent: "search", productAction: null },
    { productIntent: "search", productAction: .99, unsupported: true, unsupportedIntent: "product_request" },
  ]) {
    const result = await resolveCommerceSearchIntent({ userText: "shirt", classifyCommerce: async () => shopping(), jevDecision: { ok: true, confident: true, primaryIntent: "product_request", ...productDecision } });
    check(!result.shouldLoadProductContext && !result.cardAllowed, "commercial enrichment cannot override JEV product action threshold or unsupported product capability");
  }
  for (const productDecision of [{ productIntent: "search" }, { productIntent: "search", productAction: .72 }, { productIntent: "search", productAction: .9, unsupported: true, unsupportedIntent: "order_lookup" }]) {
    const result = await resolveCommerceSearchIntent({ userText: "shirt", classifyCommerce: async () => shopping(), jevDecision: { ok: true, confident: true, primaryIntent: "product_request", ...productDecision } });
    check(result.shouldLoadProductContext && result.cardAllowed, "verified JEV product search and legacy explicit search retain permission; unrelated unsupported action does not veto it");
  }
  const withdrawn = await resolveCommerceSearchIntent({ userText: "Stop contacting me", searchIntent: { nonShoppingReason: "stock_notification" }, enrichAllTurns: true, classifyCommerce: async () => shopping({ route: "chat", answerRequired: true, knowledgeScope: "business", replyBoundary: { salesAllowed: false, contactAllowed: false } }) });
  check(withdrawn.boundaryRequired && withdrawn.answerRequired && !withdrawn.cardAllowed && withdrawn.nonShoppingReason, "chat and fast deterministic non-shopping paths carry withdrawal metadata");
  const failed = await resolveCommerceSearchIntent({ classifyCommerce: async () => { throw new Error("failure"); }, searchIntent: { requestedTeam: "Brazil", cardAllowed: true } });
  check(failed.commerceRoute === "unclear" && !failed.cardAllowed && !failed.replyBoundary.contactAllowed, "failed classification cannot restore previous permissions");
  const quick = await resolveCommerceSearchIntent({ explicitTrigger: true, enrichAllTurns: true, searchIntent: { explicitProductTrigger: true }, classifyCommerce: async () => shopping({ route: "chat" }) });
  check(quick.shouldLoadProductContext && quick.cardAllowed, "explicit quick search retains its existing action permission");
  const rows = [{ id: "player", name: "Brazil Player Version Shirt" }, { id: "fan", name: "Brazil Fan Version Shirt" }, { id: "unknown", name: "Brazil Shirt" }, { id: "conflict", name: "Brazil Player Version Fan Version Shirt" }];
  check(filterProductsByIntent(rows, { requestedFeatures: ["authentic"] }).map((row) => row.id).join() === "player", "hard edition excludes wrong, unknown and conflicted merchandise");
  check(filterProductsByIntent(rows, {}).length === 4, "no edition requirement leaves normal recall untouched");
  check(filterProductsByIntent([rows[1]], { requestedFeatures: ["authentic"], commerceRoute: "product_question", cardAllowed: false }).length === 1, "existing card facts can explain a different edition without recommending it");
  check(edition.resolveCanonicalProductEdition({ name: "Brazil authentic original quality shirt" }) === "unknown", "quality/authenticity adjective does not establish player edition");
  check(!buildProductSearchIntent("Is this Brazil shirt authentic?").requestedFeatures.includes("authentic") && !buildProductSearchIntent("Find an authentic Brazil shirt").requestedFeatures.includes("authentic"), "authenticity question and request do not create player edition requirements");
  for (const phrase of ["player version", "player issue"]) {
    const explicitEdition = buildProductSearchIntent(`Find Brazil ${phrase} shirt`);
    check(explicitEdition.requestedFeatures.includes("authentic") && filterProductsByIntent(rows, explicitEdition).map((row) => row.id).join() === "player", "explicit player edition remains a hard merchandise constraint");
  }
  check(edition.resolveCanonicalProductEdition({ name: "Fan Version Shirt", canonicalEdition: "player" }) === "conflict", "canonical metadata cannot override conflicting source text");
  check(edition.requestedProductEdition({ requestedFeatures: ["authentic", "fan_version"] }) === "conflict", "conflicting hard requirements cannot become either edition");
  for (const name of ["Brasil Versión Jugador", "ブラジル 選手版", "Brazil játékos változat", "البرازيل نسخة اللاعبين"]) {
    const [product] = await edition.resolveProductEditions([{ name }], { searchIntent: { requestedFeatures: ["authentic"] }, classifyEditions: async () => [{ index: 0, edition: "player", evidenceField: "name", evidence: name, confidence: .95 }] });
    check(product.canonicalEdition === "player" && filterProductsByIntent([product], { requestedFeatures: ["authentic"] }).length === 1, "semantic evidence works without language alias tables");
  }
  for (const classifyEditions of [async () => { throw new Error("timeout"); }, async () => [{ index: 0, edition: "player", evidenceField: "name", evidence: "fabricated", confidence: .99 }], async () => [{ index: 0, edition: "player", evidenceField: "name", evidence: "Versión", confidence: Infinity }]]) {
    const products = await edition.resolveProductEditions([{ name: "Versión Jugador" }], { searchIntent: { requestedEdition: "player" }, classifyEditions });
    check(filterProductsByIntent(products, { requestedEdition: "player" }).length === 0, "supplier or interpretation failure stays unknown and cannot satisfy hard edition");
  }
  let calls = 0, interpreted = 0;
  const assessment = { remaining: 10, cache: new Map() };
  const many = Array.from({ length: 15 }, (_, index) => ({ name: `Catalogue garment ${index}` }));
  const classify = async (products) => { calls++; interpreted += products.length; return []; };
  await edition.resolveProductEditions(many, { searchIntent: { requestedEdition: "player" }, classifyEditions: classify, assessment });
  await edition.resolveProductEditions(many, { searchIntent: { requestedEdition: "player" }, classifyEditions: classify, assessment });
  check(calls === 1 && interpreted === 10, "bounded assessment and cached failures prevent repeated provider calls");
  const untouched = await edition.resolveProductEditions(many, { classifyEditions: async () => { throw new Error("must not call"); } });
  check(untouched === many, "ordinary search performs no extra edition interpretation");
  const searched = await executeProductSearch({ query: "Brazil shirt", searchIntent: { shouldLoadProductContext: true, requestedTeam: "Brazil", requestedFeatures: ["authentic"], requestedKeywords: [] }, includePublicSearchFallback: false,
    fetchProducts: async () => [{ name: "Brazil Versión Jugador" }, { name: "Brazil Versión Hincha" }], classifyEditions: async (products) => products.map((product, index) => ({ index, edition: product.name.includes("Jugador") ? "player" : "fan", evidenceField: "name", evidence: product.name, confidence: .95 })) });
  check(searched.length === 1 && searched[0].canonicalEdition === "player", "real recall/filter pipeline enforces two-sided normalized edition");
  check(toGuestSafeProduct({ name: "Brazil", canonicalEdition: "player" }).canonicalEdition === "player" && toGuestSafeProduct({ name: "Brazil", canonicalEdition: "injected" }).canonicalEdition === "unknown", "guest canonical field uses enum whitelist");
  check(normalizeProducts([{ name: "Player Version Shirt", url: "https://shop.invalid/item" }])[0].canonicalEdition === "player", "generic normalizer propagates edition");
  check(normalizeShopifyAdminProduct({ title: "Fan Version Shirt", id: "sku", status: "ACTIVE", variants: { nodes: [] } }).canonicalEdition === "fan", "Shopify normalizer propagates edition");
  for (const sourceRef of ["site-product-cache", "site-product-cache-stale-fallback", "current-product-image-card", "promotion-campaign-product", "guest-external-source-product"]) {
    const context = { sourceRef, products: rows, searchIntent: { requestedEdition: "player" } };
    const selected = selectProductsForMessage(context);
    check(selected.length === 1 && selected[0].id === "player" && selected[0].canonicalEdition === "player", "final card selection enforces edition across cached/pinned/promotional/image routes and preserves the descriptor");
    check(context.products.length === 4, "card filtering never mutates the factual product context");
  }
  const sourceOrigin = "https://shop.invalid";
  const sourceContext = { verified: true, siteId: "site_test", siteSlug: "shop", mascotCharacterId: "mascot_test", sourceOrigin, sourcePageUrl: `${sourceOrigin}/productdetail/shirt/623621`, sourcePageTitle: "Shirt", sourcePageType: "product", sourceProductId: "623621", capturedAt: new Date().toISOString() };
  const sourceOptions = { guest: { mascot_character_id: "mascot_test", external_source_context_json: JSON.stringify(sourceContext) }, site: { id: "site_test", slug: "shop", product_api_url: "ttmall://api.shop.invalid?websiteId=1" }, userText: "I want this one in player version", searchIntent: { shouldLoadProductContext: true, requestedFeatures: ["authentic"], commerceRoute: "product_search", cardAllowed: true } };
  for (const name of ["Fan Version Shirt", "Shirt"]) {
    const pinned = await resolveGuestExternalSourceProductContext({ ...sourceOptions, fetchProductById: async () => ({ id: "623621", name, url: `${sourceOrigin}/productdetail/shirt/623621` }) });
    check(pinned === null, "direct pinned source cannot issue a wrong or unknown edition card");
  }
  const pinnedFacts = await resolveGuestExternalSourceProductContext({ ...sourceOptions, searchIntent: { ...sourceOptions.searchIntent, commerceRoute: "product_question", cardAllowed: false }, fetchProductById: async () => ({ id: "623621", name: "Fan Version Shirt", url: `${sourceOrigin}/productdetail/shirt/623621` }) });
  check(pinnedFacts.context.products[0].name === "Fan Version Shirt", "reading an existing item for facts is not rejected as a new edition recommendation");
  const geoText = "Vivo en Argentina. Quiero una camiseta en versión jugador. ¿Puedo pagar en efectivo?";
  const geoDecision = await classifyCommerceIntent(geoText, { config: { apiKey: "mock", baseUrl: "https://mock.invalid", model: "mock" }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    check(JSON.parse(body.messages[1].content).teamCandidates[0] === "Argentina" && body.messages[0].content.includes("must not be null"), "model receives a mandatory role review of detected place/team candidates");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(shopping({ searchQuery: "camiseta", answerRequired: true, commerceConstraints: { team: null, edition: { value: "player", evidence: "versión jugador" } } })) } }] }) };
  } });
  const geoResult = await resolveCommerceSearchIntent({ userText: geoText, searchIntent: buildProductSearchIntent(geoText), classifyCommerce: async () => geoDecision });
  check(geoDecision.teamConstraintUnverified && !geoResult.requestedTeam && !geoResult.cardAllowed && geoResult.requestedEdition === "player" && geoResult.answerRequired, "missing role review cannot keep location as a new hard team requirement; edition and substantive question survive");
  const decision = await classifyCommerceIntent(mixedText, { config: { apiKey: "mock", baseUrl: "https://mock.invalid", model: "mock" }, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); check(body.messages[0].content.includes("residence, nationality") && body.messages[0].content.includes("shopping and questions can coexist"), "classifier contract separates geographic role and mixed answer");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(shopping({ answerRequired: true, commerceConstraints: { edition: { value: "player", evidence: "version jugador" } } })) } }] }) };
  } });
  check(decision.commerceConstraints.edition.value === "player", "classifier validates user evidence before publishing metadata");
  for (const replyBoundary of [undefined, { salesAllowed: "true", contactAllowed: false }, { salesAllowed: false, contactAllowed: "false" }]) {
    const malformed = await classifyCommerceIntent("Please answer my concern", { config: { apiKey: "mock", baseUrl: "https://mock.invalid", model: "mock" }, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ route: "chat", confidence: .95, answerRequired: true, knowledgeScope: "business", knowledgeQuery: "my concern", replyBoundary }) } }] }) }) });
    check(malformed.confident && !malformed.boundaryVerified && !malformed.replyBoundary.salesAllowed && !malformed.replyBoundary.contactAllowed && malformed.answerRequired && malformed.knowledgeQuery === "my concern", "production parse rejects missing or nonboolean boundary grants while preserving valid questions");
  }
  const verifiedBoundary = await classifyCommerceIntent("Find a shirt", { config: { apiKey: "mock", baseUrl: "https://mock.invalid", model: "mock" }, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(shopping({ replyBoundary: { salesAllowed: true, contactAllowed: false } })) } }] }) }) });
  check(verifiedBoundary.boundaryVerified && verifiedBoundary.replyBoundary.salesAllowed && !verifiedBoundary.replyBoundary.contactAllowed, "production parse keeps explicit boolean permissions independently");
  // Typed target and team metadata represent one USER fact; contradictory
  // interpretations must never be picked opportunistically to permit a card.
  const unifiedText = "Find a Real Madrid shirt.";
  const unifiedRequirement = (evidence = unifiedText) => ({ action: "new", evidence, priorTargetEvidence: "", suspectedTerm: null,
    updates: [{ field: "requestedTeam", value: "Real Madrid", evidence: "Real Madrid" },
      { field: "requestedProductType", value: "shirt", evidence: "shirt" }] });
  const unifiedDecision = (extra = {}, text = unifiedText) => ({ route: "product_search", confidence: .99,
    replyBoundary: { salesAllowed: true, contactAllowed: true }, searchQuery: "Real Madrid shirt",
    productRequest: singleProductRequest, productRequirement: unifiedRequirement(text),
    commerceConstraints: { team: null, edition: null }, ...extra });
  const unifiedJev = { ok: true, confident: true, primaryIntent: "product_request", productIntent: "search", productAction: .95 };
  const unifiedErrors = [];
  const unifiedCases = [
    { name: "typed target supplies missing duplicate team", extra: {}, expectedTeam: "Real Madrid", search: true },
    { name: "legacy undefined duplicate team", extra: { commerceConstraints: {} }, expectedTeam: "Real Madrid", search: true },
    { name: "exact typed continuation supplies missing duplicate", extra: { productRequirement: { ...unifiedRequirement(), action: "continue" } },
      recentMessages: [{ senderType: "character", productCandidateState: { version: 1, status: "active", siteId: "unified-site", characterId: "unified-character", owner: "single", targetEvidence: unifiedText, requirements: { requestedTeam: "Real Madrid", requestedProductType: "shirt" }, suspectedTerm: null, proposal: null } }], expectedTeam: "Real Madrid", search: true },
    { name: "same team explicitly location cannot be reintroduced", extra: { commerceConstraints: { team: { value: "Real Madrid", role: "location", evidence: "Real Madrid" } } }, conflict: true, search: false },
    { name: "same team explicitly other cannot be reintroduced", extra: { commerceConstraints: { team: { value: "Real Madrid", role: "other", evidence: "Real Madrid" } } }, conflict: true, search: false },
    { name: "location evidence without duplicate name cannot be reintroduced", extra: { commerceConstraints: { team: { value: "", role: "location", evidence: "Real Madrid" } } }, conflict: true, search: false },
    { name: "two explicit target fields disagree", text: "I live in Barcelona. Find a Real Madrid shirt.", extra: { commerceConstraints: { team: { value: "Barcelona", role: "product_target", evidence: "Barcelona" } } }, conflict: true, search: false },
    { name: "different location preserves actual typed target", text: "I live in Argentina. Find a Real Madrid shirt.", extra: { commerceConstraints: { team: { value: "Argentina", role: "location", evidence: "I live in Argentina" } } }, expectedTeam: "Real Madrid", search: true },
    { name: "invalid supplied quote cannot be repaired", extra: { commerceConstraints: { team: { value: "Real Madrid", role: "product_target", evidence: "real madrid" } } }, search: false },
    { name: "mismatched typed quote cannot establish target", extra: { productRequirement: { ...unifiedRequirement(), updates: [{ field: "requestedTeam", value: "Barcelona", evidence: "Real Madrid" }] } }, search: false },
    { name: "duplicate typed fields fail closed", extra: { productRequirement: { ...unifiedRequirement(), updates: [...unifiedRequirement().updates, unifiedRequirement().updates[0]] } }, search: false },
    { name: "typed none grants no target", extra: { productRequirement: { ...unifiedRequirement(), action: "none" } }, search: false },
    { name: "typed cancel grants no target", extra: { productRequirement: { ...unifiedRequirement(), action: "cancel" } }, search: false },
    { name: "empty typed clear is not a target", extra: { productRequirement: { ...unifiedRequirement(), updates: [{ field: "requestedTeam", value: "", evidence: "Real Madrid" }] } }, search: false },
    { name: "low confidence grants no target", extra: { confidence: .5 }, search: false },
    { name: "lexical detection alone is not target role evidence", extra: { productRequirement: null }, search: false },
    { name: "invalid independent scope remains blocked", extra: { productRequest: { ...singleProductRequest, items: [{ evidence: "Real Madrid" }] } }, search: false },
    { name: "multiple unselected scope remains blocked", text: "Find a Real Madrid shirt and a Barcelona shirt.", extra: { productRequest: { relation: "multiple", action: "new", items: [{ evidence: "Real Madrid shirt", sharedEvidence: "" }, { evidence: "Barcelona shirt", sharedEvidence: "" }], selectedIndex: null, selectionEvidence: "" } }, search: false },
    { name: "JEV primary action still blocks search", jevDecision: { ...unifiedJev, primaryIntent: "chat", productIntent: "none" }, extra: {}, search: false },
    { name: "JEV score still blocks search", jevDecision: { ...unifiedJev, productAction: .5 }, extra: {}, search: false },
    { name: "sales boundary still blocks search", extra: { replyBoundary: { salesAllowed: false, contactAllowed: true } }, search: false },
  ];
  for (const test of unifiedCases) {
    try {
      const text = test.text || unifiedText;
      const decision = normalizeCommerceDecision(unifiedDecision(test.extra, text), { userText: text, detectedTeam: buildProductSearchIntent(text).requestedTeam, requireBoundaryVerdict: true });
      const intent = await resolveCommerceSearchIntent({ userText: text, siteId: "unified-site", characterId: "unified-character",
        recentMessages: test.recentMessages || [], searchIntent: buildProductSearchIntent(text),
        classifyCommerce: async () => decision, jevDecision: test.jevDecision || unifiedJev });
      assert.equal(intent.shouldLoadProductContext, test.search, `${test.name}: search`);
      assert.equal(intent.cardAllowed, test.search, `${test.name}: card`);
      if (!test.search) assert.notEqual(intent.candidateSearchAllowed, true, `${test.name}: candidate state cannot restore permission`);
      if (test.search) assert.equal(intent.requestedTeam, test.expectedTeam, `${test.name}: target`);
      if (test.conflict) {
        assert.equal(decision.teamConstraintUnverified, true, `${test.name}: team guard`);
        assert.equal(intent.searchState, "needs_clarification", `${test.name}: clarify contradiction`);
      }
      if (["location", "other"].includes(test.extra.commerceConstraints?.team?.role)) {
        assert.equal(decision.commerceConstraints.team.role, test.extra.commerceConstraints.team.role, `${test.name}: explicit role remains intact`);
      }
      checks++;
    } catch (error) { unifiedErrors.push(`${test.name}: ${error.message}`); }
  }
  assert.deepEqual(unifiedErrors, [], "typed and commerce team normalization cannot bypass scope, JEV or boundary guards");
  console.log(`Commerce constraints self-check passed (${checks} assertions; no external calls or database writes)`);
} finally { globalThis.fetch = savedFetch; await closeDbPool(); }
