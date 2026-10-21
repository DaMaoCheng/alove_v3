import assert from "node:assert/strict";
import { selectProductsForMessage } from "../server/chat-product-reply-service.js";
import { toClientProduct } from "../server/product-response-sanitizer.js";
import { toGuestSafeProduct, toGuestSafeProductSearchResult } from "../server/guest-product-sanitizer.js";
import { buildProductContextLayer } from "../server/chat-prompt-layers.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
import { buildReplyReviewFormat, buildReplyReviewMessages } from "../server/chat-reply-review-contracts.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";
import { buildDynamicProductPatch } from "../src/features/chat/chat-product-card-live-refresh.js";
import { renderProductCard } from "../src/features/chat/chat-product-card.js";
import { toCandidateReviewContext } from "../server/product-candidate-context-service.js";
import { approveReplyRemainder } from "../server/chat-reply-review-decision.js";
import { productCandidateContext } from "../server/product-search-execution-service.js";

const site = { id: "shop", slug: "shop", storefrontUrl: "https://shop.example" };
const product = { id: "shirt", name: "Club Away Fan Jersey", url: "https://shop.example/shirt", price: "$0",
  matchStatus: "candidate", giveaway: true, candidateUnknownFields: ["sleeve", "accessToken", "sleeve"],
  attributeEvidence: { edition: "fan", sleeve: "unknown", printing: "none", giveaway: true, accessToken: "secret" },
  sourceItem: { accessToken: "secret" } };
const context = { siteId: "shop", siteSlug: "shop", products: [product], searchOutcome: "candidate", cardAllowed: true,
  searchIntent: { requestedFeatures: ["short_sleeve"], correctionSuggestion: { corrected: true, correctedText: "fan" } },
  candidateContext: { requiresConfirmation: true, products: [{ ...product, unknownFields: ["sleeve", "secret"], unmatchedSearchTerms: ["fun"] }] } };
const selected = selectProductsForMessage(context)[0];
const namedCandidate = selectProductsForMessage({ ...context, searchIntent: { ...context.searchIntent, query: 'unverified user title' },
  products: [{ ...product, subtitle: 'Unverified marketing specification', summary: 'Unverified marketing specification' }] })[0];
assert.equal(namedCandidate.subtitle, '', 'A candidate card cannot present the search phrase or copied marketing as its catalogue subtitle');
assert.equal(namedCandidate.summary, '');
assert.equal(selected.matchStatus, "candidate");
assert.equal(selected.giveaway, true);
assert.deepEqual(selected.candidateUnknownFields, ["sleeve"]);
assert.equal(toClientProduct(selected).matchStatus, "candidate");
assert.equal(toClientProduct(product).attributeEvidence, undefined);
assert.equal(toGuestSafeProduct(product, site).attributeEvidence, undefined);
const guestInternal = toGuestSafeProductSearchResult({ site, items: [product] }, { includeAttributeEvidence: true });
assert.equal(guestInternal.items[0].attributeEvidence.printing, "none");
assert.equal(JSON.stringify(guestInternal).includes("secret"), false);
assert.equal(toGuestSafeProductSearchResult({ site, items: [{ ...product, code: "SAVE20", name: "Use discount code SAVE20" }] }).items.length, 0);
const evidence = toCandidateReviewContext(context);
assert.deepEqual(evidence.products[0].unknownFields, ["sleeve"]);
assert.equal(JSON.stringify(evidence).includes("secret"), false);
assert.deepEqual(toCandidateReviewContext({ ...context, cardAllowed: false }).products, []);
const layer = buildProductContextLayer({ id: "mascot_template", categoryId: "mascot" }, context, "Is it short sleeved?");
assert.equal(buildChatReplyPrompt({ character: { id: 'mascot_template' }, productContext: context, userText: 'Show the possible item.' }).structuredOutput, true, 'candidate generation opts into its native reply envelope');
assert.equal(buildChatReplyPrompt({ character: { id: 'mascot_template' }, knowledgeContext: { customerServiceIntent: true, items: [] }, userText: 'Shipping policy?' }).structuredOutput, true, 'support generation opts in even when evidence is unavailable');
assert.equal(buildChatReplyPrompt({ character: { id: 'mascot_template' }, userText: 'Let us talk football.' }).structuredOutput, false, 'ordinary conversation keeps its existing provider format');
assert.match(layer.content, /Ask explicitly whether/);
assert.doesNotMatch(layer.content, /Do not search.*until the user confirms/);
const confirmedContext = { ...context, candidateContext: { ...context.candidateContext, requiresConfirmation: false, entityConfirmed: true } };
assert.match(buildProductContextLayer({ id: "mascot_template" }, confirmedContext).content, /Do not ask whether this is the item again/);
assert.equal(toCandidateReviewContext(confirmedContext).entityConfirmed, true);
const confirmation = { status: 'confirmed', candidateId: 'shirt', name: product.name,
  reply: 'Could this be the item you mean?', confirmationEvidence: 'Yes, that is the item', secret: 'private-secret' };
const confirmedEvidenceContext = productCandidateContext([product], { confirmedCandidateId: 'shirt',
  productCandidateState: { proposal: confirmation, secret: 'private-secret' } });
assert.equal(confirmedEvidenceContext.entityConfirmationEvidence, confirmation.confirmationEvidence);
assert.equal(confirmedEvidenceContext.priorConfirmationQuestion, confirmation.reply);
const projectedConfirmation = toCandidateReviewContext({ ...context, candidateContext: confirmedEvidenceContext });
assert.equal(projectedConfirmation.entityConfirmationEvidence, confirmation.confirmationEvidence);
assert.equal(projectedConfirmation.priorConfirmationQuestion, confirmation.reply);
assert.equal(JSON.stringify(projectedConfirmation).includes('private-secret'), false);
const privateProduct = { ...product, entityConfirmationEvidence: confirmation.confirmationEvidence,
  priorConfirmationQuestion: confirmation.reply, productCandidateState: { proposal: confirmation } };
for (const publicProduct of [toClientProduct(privateProduct), toGuestSafeProduct(privateProduct, site)]) {
  assert.equal(publicProduct.entityConfirmationEvidence, undefined);
  assert.equal(publicProduct.priorConfirmationQuestion, undefined);
  assert.equal(publicProduct.productCandidateState, undefined);
}
assert.equal(productCandidateContext([product], { confirmedCandidateId: 'shirt', productCandidateState: {
  proposal: { ...confirmation, candidateId: 'different' } } }).entityConfirmationEvidence, '', 'assent belongs only to the actual candidate');
assert.equal(toCandidateReviewContext({ ...context, candidateContext: { ...confirmedEvidenceContext,
  entityConfirmationEvidence: 'x'.repeat(241), priorConfirmationQuestion: 'x'.repeat(2001) } }).entityConfirmationEvidence, '',
  'oversized assent must not be truncated into a different meaning');
const options = { productContext: context, evidenceRequired: true };
const schema = buildReplyReviewFormat(options).json_schema.schema;
const retainedParagraph = 'This independent paragraph is supported.';
const candidateRejected = { allowed: false, confidence: .99, boundarySupported: true, evidenceSupported: false,
  candidateConfirmationSupported: false, retainedText: retainedParagraph, retainedTextAllowed: true,
  retainedBoundarySupported: true, retainedEvidenceSupported: true, retainedLanguageQualitySupported: true,
  retainedCandidateConfirmationSupported: false };
assert.equal(approveReplyRemainder(retainedParagraph + '\n\nUnsupported product claim.', candidateRejected, ['evidence', 'candidate_confirmation']), '',
  'The previous candidate contract requires a false retained confirmation vote, so compliant rejected answers cannot retain a paragraph');
assert.equal(approveReplyRemainder(retainedParagraph + '\n\nUnsupported product claim.', { ...candidateRejected, retainedCandidateConfirmationSupported: true }, ['evidence', 'candidate_confirmation']), '',
  'Even unexpected legacy or extra positive retained votes cannot approve a candidate-confirmation remainder');
assert.ok(!Object.keys(schema.properties).some(field => field.startsWith('retained')),
  'Candidate confirmation requests only the whole-response verdict; disabled retention must not add output work');
assert.ok(buildReplyReviewFormat({ ...options, productContext: confirmedContext }).json_schema.schema.properties.retainedText,
  'Entity-confirmed evidence review preserves the existing independent-paragraph retention path');
assert.equal(schema.properties.candidateConfirmationSupported.type, "boolean");
assert.ok(schema.required.includes("candidateConfirmationSupported"));
assert.equal(buildReplyReviewFormat({}).json_schema.schema.properties.candidateConfirmationSupported, undefined);
const review = buildReplyReviewMessages({ ...options, text: "Could this be it?", speechText: "Could this be it?" });
assert.ok(review.some(message => message.content.includes("each MUST explicitly ask")));
assert.deepEqual(JSON.parse(review.at(-1).content).candidateContext, evidence);
const confirmedReview = buildReplyReviewMessages({ productContext: { ...context, candidateContext: confirmedEvidenceContext },
  evidenceRequired: true, text: 'This is the candidate whose identity you confirmed.' });
assert.ok(confirmedReview.some(message => message.content.includes('entityConfirmationEvidence')
  && message.content.includes('display, link, comparison or specification request')),
  'existing whole evidence review must independently reject catalogue display as identity assent');
const marketingReview = buildReplyReviewMessages({ ...options, text: 'Could this be it?', productContext: { ...context,
  products: [{ ...product, summary: 'Unreliable copied Home/White marketing description' }] } });
assert.equal(JSON.parse(marketingReview.at(-1).content).evidence.catalogueProducts[0].summary, undefined,
  'Candidate review uses finite attribute evidence rather than copied marketing specifications');
const reply = "He encontrado una posible coincidencia. ¿Es esta la que buscas?";
assert.equal(normalizeGuestReplyText({ text: reply, product: selected, productRequested: true }), reply);
const panel = normalizeProductPanelPayload(selected);
const refreshed = { ...panel, ...buildDynamicProductPatch(panel, { price: "$5", matchStatus: "matched", giveaway: false }) };
assert.equal(refreshed.matchStatus, "candidate");
assert.equal(refreshed.giveaway, true);
assert.equal(refreshed.priceNow, "$5");
const escape = text => String(text).replaceAll("<", "&lt;");
const html = renderProductCard(selected, { pageLanguage: "Spanish", escapeHtml: escape, escapeAttribute: escape });
assert.match(html, /Posible coincidencia/);
assert.match(html, /Sujeto a condiciones/);
assert.match(html, /Ver detalles/);
assert.doesNotMatch(html, /Ver y comprar/);
console.log("product candidate presentation self-check passed");
