import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { selectBusinessKnowledgeReferences, requestBusinessKnowledgeSelection } = await import("../server/business-knowledge-selection-service.js");
const { retrieveKnowledgeSections, retrieveChatKnowledgeSections } = await import("../server/knowledge-retrieval-service.js");
const skipped = await retrieveChatKnowledgeSections({ query: "Find a shirt", knowledgeScope: "none", userId: "test", db: { execute: () => { throw new Error("pure shopping must not load knowledge"); } } });
assert.equal(skipped.strategy, "not_requested");
const reference = { id: "brand-new-topic", title: "Payment", summary: "Store payment options", content: "Only card payments are supported. Cash is not supported.",
  category: "customer_service", scope: "site", siteId: "store-a", knowledgeBaseId: "new-kb", keywords: [] };
const select = async (input) => input.stage === "directory" ? { ids: ["invented-id", reference.id] } : {
  matches: [{ id: reference.id, quote: reference.content, confidence: .95, answersQuestion: true }] };
const result = await selectBusinessKnowledgeReferences({ query: "¿Puedo pagar en efectivo?", sections: [reference], siteId: "store-a", select });
assert.equal(result.items[0].content, reference.content);
assert.equal(result.items[0].id, reference.id, "new IDs/topics need no code registration");
const qualified = { ...reference, content: "Cash is supported only for local pickup in region A. International orders require card payment." };
const qualification = await selectBusinessKnowledgeReferences({ query: "cash?", sections: [qualified], select: async (input) => input.stage === "directory" ? { ids: [reference.id] }
  : { matches: [{ id: reference.id, quote: "Cash is supported", confidence: .95, answersQuestion: true }] } });
assert.equal(qualification.items[0].content, qualified.content, "keep region/payment restrictions even if the selected quote omits them");
const longSection = { ...reference, content: `${"Unrelated background paragraph.\n".repeat(230)}\n${qualified.content}` };
const lateAnswer = await selectBusinessKnowledgeReferences({ query: "cash?", sections: [longSection], select: async (input) => {
  if (input.stage === "directory") return { ids: [input.sections.at(-1).id] };
  return { matches: [{ id: input.sections[0].id, quote: qualified.content, confidence: .95, answersQuestion: true }] };
} });
assert(lateAnswer.items[0].content.includes(qualified.content), "long documents must expose later passages, not just their first 6000 characters");
for (const match of [
  { id: "outside-authorized-pool", quote: reference.content, confidence: 1, answersQuestion: true },
  { id: reference.id, quote: "Cash is supported everywhere.", confidence: 1, answersQuestion: true },
  { id: reference.id, quote: reference.content, confidence: .2, answersQuestion: true },
  { id: reference.id, quote: reference.content, confidence: .99, answersQuestion: false },
  { id: reference.id, quote: reference.content, answersQuestion: true },
]) {
  const out = await selectBusinessKnowledgeReferences({ query: "cash?", sections: [reference], select: async (input) => input.stage === "directory" ? { ids: [reference.id] } : { matches: [match] } });
  assert.equal(out.items.length, 0);
}
for (const select of [async () => { throw new Error("timeout"); }, async () => null]) {
  assert.equal((await selectBusinessKnowledgeReferences({ query: "unseen question", sections: [reference], select })).items.length, 0);
}
let queries = [];
const db = { execute: async (sql, params) => {
  queries.push({ sql, params });
  assert(params.includes("customer_service"));
  assert(params.includes("store-a"));
  assert(params.includes("character-a"));
  assert.match(sql, /knowledge_status = 'active'/);
  assert.match(sql, /binding_status = 'active'/);
  return [[{ section_id: reference.id, title: reference.title, content: reference.content, category: "customer_service",
    knowledge_base_id: "new-kb", scope: "site", site_id: "store-a" }]];
} };
const retrieved = await retrieveKnowledgeSections({ db, query: "質問", topicHint: "other", knowledgeScope: "business", siteId: "store-a", characterId: "character-a",
  selectBusinessReferences: (input) => selectBusinessKnowledgeReferences({ ...input, select }) });
assert.equal(queries.length, 1, "unknown business topic must not fall back to football retrieval");
assert.equal(retrieved.customerServiceIntent, true);
assert.equal(retrieved.items[0].id, reference.id);
assert.equal(retrieved.strategy, "business_verified_reference");
assert.equal(retrieved.selectionDiagnostics.outcome, 'verified');
assert.equal(retrieved.selectionDiagnostics.counts.accepted, 1);
assert(retrieved.items[0].evidenceQuote && retrieved.items[0].content.includes(retrieved.items[0].evidenceQuote), "selected exact quote survives retrieval mapping for grounded correction");
const partialPolicy = { ...reference, id: "new-policy", title: "Shipping policy", content: "Standard shipping is listed as free. Processing normally takes 1–3 business days. Delivery estimates for region A are 5–13 days. Final destination, cost and delivery time must be checked at checkout." };
const partial = await selectBusinessKnowledgeReferences({ query: "What is the shipping policy for region B?", sections: [partialPolicy], select: async input => input.stage === "directory"
  ? { ids: [partialPolicy.id] } : { matches: [{ id: partialPolicy.id, quote: "Final destination, cost and delivery time must be checked at checkout.", confidence: .95, answersQuestion: true }] } });
assert.equal(partial.reason, "business_verified_reference");
assert.equal(partial.items[0].content, partialPolicy.content, "a supported policy limitation retains surrounding partial terms without promoting other-region estimates");
assert(!partial.items[0].content.includes("region B is covered"), "missing destination coverage is never synthesized");
const noPartialAnswer = await selectBusinessKnowledgeReferences({ query: "What is the shipping policy for region B?", sections: [partialPolicy], select: async input => input.stage === "directory"
  ? { ids: [partialPolicy.id] } : { matches: [{ id: partialPolicy.id, quote: "Region B delivery takes 5–13 days.", confidence: 1, answersQuestion: true }] } });
assert.equal(noPartialAnswer.items.length, 0, "partial answers still reject fabricated destination quotes");
const excerptPolicy = { ...reference, content: "Standard shipping is available. Only region A has a published delivery estimate. Final destination and cost must be confirmed at checkout." };
const firstQuote = "Standard shipping is available.", lastQuote = "Final destination and cost must be confirmed at checkout.";
for (const gap of ['...', '…']) {
  const excerpt = await selectBusinessKnowledgeReferences({ query: 'Shipping to an unlisted destination?', sections: [excerptPolicy], select: async input => input.stage === 'directory'
    ? { ids: [excerptPolicy.id] } : { matches: [{ id: excerptPolicy.id, quote: firstQuote + gap + lastQuote, confidence: .95, answersQuestion: true }] } });
  assert.equal(excerpt.items.length, 1, 'verbatim ordered excerpts can locate one complete original policy span');
  assert.equal(excerpt.items[0].evidenceQuote, excerptPolicy.content, 'restore omitted applicability limits from the source, never concatenate model fragments as policy');
  assert.equal(excerpt.items[0].content, excerptPolicy.content);
}
for (const quote of [lastQuote + '...' + firstQuote, firstQuote + '...Shipping to region B is confirmed.', 'Shipping is free...' + lastQuote,
  firstQuote + '...Only...' + lastQuote, '...', '...' + lastQuote, firstQuote + '...', Array(9).fill(firstQuote).join('...')]) {
  const unsafe = await selectBusinessKnowledgeReferences({ query: 'Shipping?', sections: [excerptPolicy], select: async input => input.stage === 'directory'
    ? { ids: [excerptPolicy.id] } : { matches: [{ id: excerptPolicy.id, quote, confidence: 1, answersQuestion: true }] } });
  assert.equal(unsafe.items.length, 0, 'reordered, fabricated, rewritten or vague excerpts cannot establish source evidence');
}
const literalEllipsis = { ...reference, content: 'The product label literally reads "Wait... hold this item." Keep it unchanged.' };
const literalResult = await selectBusinessKnowledgeReferences({ query: 'What is the label?', sections: [literalEllipsis], select: async input => input.stage === 'directory'
  ? { ids: [literalEllipsis.id] } : { matches: [{ id: literalEllipsis.id, quote: 'Wait... hold this item.', confidence: .9, answersQuestion: true }] } });
assert.equal(literalResult.items[0].evidenceQuote, 'Wait... hold this item.', 'contiguous original ellipses remain literal source text');
const ambiguousPolicy = { ...excerptPolicy, content: excerptPolicy.content + ' ' + firstQuote };
const ambiguous = await selectBusinessKnowledgeReferences({ query: 'Shipping?', sections: [ambiguousPolicy], select: async input => input.stage === 'directory'
  ? { ids: [ambiguousPolicy.id] } : { matches: [{ id: ambiguousPolicy.id, quote: firstQuote + '...' + lastQuote, confidence: .95, answersQuestion: true }] } });
assert.equal(ambiguous.items.length, 0, 'ambiguous noncontiguous source locations are not guessed');
for (const patch of [{ confidence: .79 }, { confidence: undefined }, { answersQuestion: false }, { id: 'unselected-section' }]) {
  const gated = await selectBusinessKnowledgeReferences({ query: 'Shipping?', sections: [excerptPolicy], select: async input => input.stage === 'directory'
    ? { ids: [excerptPolicy.id] } : { matches: [{ id: excerptPolicy.id, quote: firstQuote + '...' + lastQuote, confidence: .95, answersQuestion: true, ...patch }] } });
  assert.equal(gated.items.length, 0, 'source excerpt restoration grants no confidence, relevance or section permission');
}
const splitSections = [{ ...reference, id: 'first', content: firstQuote }, { ...reference, id: 'last', content: lastQuote }];
const crossSection = await selectBusinessKnowledgeReferences({ query: 'Shipping?', sections: splitSections, select: async input => input.stage === 'directory'
  ? { ids: splitSections.map(section => section.id) } : { matches: [{ id: 'first', quote: firstQuote + '...' + lastQuote, confidence: .95, answersQuestion: true }] } });
assert.equal(crossSection.items.length, 0, 'separate authorized documents cannot be spliced into one evidence span');
const overlappingPolicy = { ...reference, content: 'ababababab is a repeated marker. ' + lastQuote };
const overlapping = await selectBusinessKnowledgeReferences({ query: 'Shipping?', sections: [overlappingPolicy], select: async input => input.stage === 'directory'
  ? { ids: [overlappingPolicy.id] } : { matches: [{ id: overlappingPolicy.id, quote: 'abababab...' + lastQuote, confidence: .95, answersQuestion: true }] } });
assert.equal(overlapping.items.length, 0, 'overlapping repetitions are also ambiguous source locators');

for (const [stage, error, kind] of [
  ["directory", Object.assign(new Error("private-token"), {code:"AI_REPLY_TIMEOUT"}), "timeout"],
  ["evidence", Object.assign(new SyntaxError("private-token"), {code:"AI_JSON_PARSE_ERROR"}), "parse"],
  ["evidence", Object.assign(new Error("private-token"), {statusCode:429}), "provider"],
]) {
  const failure = await selectBusinessKnowledgeReferences({query:"price differences",sections:[reference],select:async input=>{
    if(input.stage===stage) throw error;
    return {ids:[reference.id]};
  }});
  assert.equal(failure.reason,"business_selection_unavailable");
  assert.deepEqual(failure.selectionFailure,{stage,kind});
  assert(!JSON.stringify(failure).includes("private-token"));
}
const invalidDirectory = await selectBusinessKnowledgeReferences({query:"price differences",sections:[reference],select:async()=>({ids:"not-array"})});
assert.deepEqual(invalidDirectory.selectionFailure,{stage:"directory",kind:"missing_fields"});
const emptyDirectory = await selectBusinessKnowledgeReferences({query:"price differences",sections:[reference],select:async()=>({ids:[]})});
assert.equal(emptyDirectory.reason,"business_no_relevant_section");
assert.equal(emptyDirectory.selectionFailure,undefined,"valid no-result is not a technical failure");

const realNow=Date.now;
let clock=realNow(),providerCalls=[];
try {
 Date.now=()=>clock;
 const config=["venice","openai","deepseek"].map(id=>({id,apiKey:"fixture",model:"fixture",baseUrl:`https://${id}.example.test`,apiMode:"chat_completions",timeoutMs:100}));
 for(const stage of ["directory","evidence"]){
  const calls=[];
  const parsed=await requestBusinessKnowledgeSelection({stage,query:"fixture",sections:[],limit:1},{config,fetchImpl:async(url)=>{
   assert(url.includes(".example.test"),"no real network");calls.push(url);clock+=12000;
   return calls.length<3 ? new Response('{"error":"unavailable"}',{status:503})
    : new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(stage==="directory"?{ids:[]}:{matches:[]})}}]}));
  }});
  assert.equal(calls.length,3,"each backup and stage remains available after an earlier provider consumed its independent budget");
  assert.deepEqual(parsed,stage==="directory"?{ids:[]}:{matches:[]});providerCalls.push(...calls);
 }
} finally { Date.now=realNow; }
assert.equal(providerCalls.length,6,"only finite transport fallback attempts, never retry a valid empty result");
// Exercise the actual provider boundary: protocol failure may use a backup,
// whereas a valid semantic refusal must end the chain.
const protocolConfig = ['venice', 'openai'].map(id => ({ id, apiKey: 'fixture', model: 'fixture',
  apiMode: 'chat_completions', baseUrl: `https://${id}.example.test` }));
const evidenceInput = { stage: 'evidence', query: 'Payment?', siteId: 'store-a', sections: [reference], limit: 4 };
const validEvidence = { matches: [{ id: reference.id, quote: reference.content, answersQuestion: true, confidence: .95 }] };
async function protocolProbe(input, first, second = validEvidence) {
  let calls = 0;
  const result = await requestBusinessKnowledgeSelection(input, { config: protocolConfig, fetchImpl: async url => {
    assert(url.includes('.example.test'), 'fixture must never reach real providers');
    calls++;
    const output = calls === 1 ? first : second;
    return new Response(JSON.stringify({ choices: [{ message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }] }));
  } });
  return { result, calls };
}
for (const invalid of ['{broken', { matches: 'bad' }, { matches: [{ ...validEvidence.matches[0], id: 'foreign' }] },
  { matches: [{ ...validEvidence.matches[0], quote: 'All payment methods are accepted everywhere.' }] },
  { matches: [{ ...validEvidence.matches[0], answersQuestion: 'true' }] },
  { matches: [{ ...validEvidence.matches[0], confidence: '0.95' }] },
  { matches: [{ ...validEvidence.matches[0], confidence: 1.1 }] },
  { matches: [validEvidence.matches[0], { ...validEvidence.matches[0], id: 'foreign' }] }]) {
  const probe = await protocolProbe(evidenceInput, invalid);
  assert.equal(probe.calls, 2, 'invalid source/protocol should allow the finite backup');
  assert.deepEqual(probe.result, validEvidence);
}
for (const semantic of [{ matches: [] }, { matches: [{ ...validEvidence.matches[0], answersQuestion: false }] },
  { matches: [{ ...validEvidence.matches[0], confidence: .79 }] }]) {
  const probe = await protocolProbe(evidenceInput, semantic);
  assert.equal(probe.calls, 1, 'valid semantic empty/refusal/low score must not shop for approval');
  assert.deepEqual(probe.result, semantic);
}
const directoryInput = { ...evidenceInput, stage: 'directory' };
assert.equal((await protocolProbe(directoryInput, { ids: ['foreign'] }, { ids: [reference.id] })).calls, 2);
assert.equal((await protocolProbe(directoryInput, { ids: [] }, { ids: [reference.id] })).calls, 1);
await assert.rejects(protocolProbe(evidenceInput, { matches: 'bad' }, { matches: 'bad' }),
  error => error.code === 'AI_JSON_INVALID_OUTPUT' && error.aiJsonProviderFailures.length === 2);
const generalUnchanged = await protocolProbe({ ...evidenceInput, purpose: 'general' }, { matches: 'bad' });
assert.equal(generalUnchanged.calls, 1, 'business opt-in must not change general protocol behavior');
const { buildCommerceDecisionLogEvent } = await import('../server/ai-reply-log-service.js');
const safeLog = buildCommerceDecisionLogEvent({ knowledgeContext: { ...retrieved,
  selectionFailure: { stage: 'evidence', kind: 'protocol_evidence', private: 'secret-fixture' },
  selectionDiagnostics: { stage: 'evidence', outcome: 'filtered', quote: 'secret-fixture',
    counts: { invalid_quote: 999999, not_relevant: 1, arbitrary: 'secret-fixture', shape: -1 } } } });
const details = JSON.parse(safeLog.errorMessage);
assert.deepEqual(details.knowledgeFailure, { stage: 'evidence', kind: 'protocol_evidence' });
assert.deepEqual(details.knowledgeSelection, { stage: 'evidence', outcome: 'filtered', counts: { not_relevant: 1, invalid_quote: 96 } });
assert(!safeLog.errorMessage.includes('secret-fixture'));
assert(safeLog.errorMessage.length <= 500, 'diagnostics must stay within existing log storage budget');
const maxLog = buildCommerceDecisionLogEvent({ knowledgeContext: { strategy: 'business_selection_unavailable',
  selectionFailure: { stage: 'evidence', kind: 'protocol_evidence' },
  selectionDiagnostics: { stage: 'evidence', outcome: 'filtered', counts: Object.fromEntries(
    ['selected', 'accepted', 'shape', 'unknown_id', 'not_relevant', 'low_confidence', 'invalid_quote'].map(key => [key, 96])) } },
  factualContext: { required: true, status: 'blocked', reason: 'search_not_completed', decisionSource: 'catalogue_scope', webSearchScore: .99 } });
assert(maxLog.errorMessage.length <= 500, 'maximum diagnostic/failure/factual combination remains valid JSON within storage limit');
assert.equal(JSON.parse(maxLog.errorMessage).knowledgeFailure.kind, 'protocol_evidence');
for (const strategy of ['general_no_reference', 'general_directory_limit', 'general_selection_unavailable',
  'general_no_relevant_section', 'general_no_verified_answer', 'general_relevant_reference']) {
  assert.equal(JSON.parse(buildCommerceDecisionLogEvent({ knowledgeContext: { strategy } }).errorMessage).knowledgeStrategy, strategy);
}
console.log("business knowledge selection self-check passed (scope, exact evidence, finite failures and independent directory/evidence provider budgets; no network/DB)");
