import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('No network in knowledge relevance regression'); };
const { retrieveKnowledgeSections } = await import('../server/knowledge-retrieval-service.js');
const section = (id, title, content = title) => ({ knowledge_base_id: 'kb_football', knowledge_base_label: 'Football', category: 'football', scope: 'global', priority: 80,
  section_id: id, section_key: id, title, summary: title, content, base_keywords_json: '[]', base_fuzzy_keywords_json: '[]', keywords_json: '[]', fuzzy_keywords_json: '[]', display_order: 1 });
const noisy = [section('azteca', 'Estadio Azteca, Pedro Ramírez Vázquez', 'Historic stadium in Mexico.'),
  section('napoli', 'Maradona and Núñez in Brazil', 'A football transfer.'), section('maracana', 'Fluminense in Brazil'), section('bern', 'Miracle of Bern in Brazil')];
let queries = [];
const db = rows => ({ execute: async (sql, params) => { queries.push({ sql, params }); return [rows]; } });
const result = await retrieveKnowledgeSections({ db: db(noisy), query: 'Mi ez az alove', knowledgeScope: 'general',
  selectGeneralReferences: async ({ query, sections }) => { assert.equal(query, 'Mi ez az alove'); assert.equal(sections.length, 4); return { items: [], reason: 'general_no_relevant_section' }; } });
assert.deepEqual(result.items, [], 'An unrelated general query must not retain short substring matches');
assert.equal(result.strategy, 'general_no_relevant_section');
console.log('General knowledge relevance regression passed');
const { selectGeneralKnowledgeReferences, requestBusinessKnowledgeSelection } = await import('../server/business-knowledge-selection-service.js');
const football = section('new-unregistered', '歴史資料', 'Azteca is a stadium in Mexico. Its original opening was in 1966.');
let stages = [];
const choose = async input => {
  stages.push(input.stage);
  return input.stage === 'directory' ? { ids: ['not-authorized', football.section_id, football.section_id] }
    : { matches: [{ id: football.section_id, quote: football.content, confidence: .95, answersQuestion: true }] };
};
queries = [];
const general = await retrieveKnowledgeSections({ db: db([football]), query: 'Mesélj az Azteca stadionról', knowledgeQuery: 'Azteca history', knowledgeScope: 'general', siteId: 'site-a', characterId: 'char-a',
  selectGeneralReferences: input => { assert(input.query.includes('Mesélj')); assert(input.query.includes('Azteca history')); return selectGeneralKnowledgeReferences({ ...input, select: choose }); } });
assert.deepEqual(stages, ['directory', 'evidence']);
assert.equal(general.items.length, 1);
assert.equal(general.items[0].id, football.section_id);
assert.equal(general.items[0].content, football.content);
assert.equal(general.items[0].evidenceQuote, football.content);
assert.equal(general.strategy, 'general_relevant_reference');
assert.equal(general.customerServiceIntent, false);
assert.deepEqual(general.items[0].reasons, ['general_semantic_relevance']);
assert.equal(queries.length, 1, 'General references use one authorized section read, no per-section queries');
assert(queries[0].sql.includes("kb.category <> 'customer_service'"));
assert(queries[0].sql.includes("binding_status = 'active'"));
assert(queries[0].params.includes('site-a') && queries[0].params.includes('char-a'));
assert(queries[0].sql.includes("knowledge_status = 'active'") && queries[0].sql.includes("section_status = 'active'"));
const source = { id: 'source', title: 'Football culture', content: 'Football shirts have a cultural history. This does not establish current stock.', keywords: [], knowledgeBaseId: 'new' };
for (const match of [
  { id: 'foreign', quote: source.content, answersQuestion: true, confidence: .99 },
  { id: 'source', quote: 'Invented source quotation.', answersQuestion: true, confidence: .99 },
  { id: 'source', quote: source.content, answersQuestion: true, confidence: .79 },
  { id: 'source', quote: source.content, answersQuestion: false, confidence: .99 },
]) {
  const rejected = await selectGeneralKnowledgeReferences({ query: 'football history', sections: [source], select: async input => input.stage === 'directory' ? { ids: ['source'] } : { matches: [match] } });
  assert.equal(rejected.items.length, 0);
  assert.equal(rejected.reason, 'general_no_verified_answer');
}
for (const [select, failure] of [[async () => { throw Object.assign(Error('PRIVATE_SOURCE'), { code: 'AI_REPLY_TIMEOUT' }); }, 'timeout'], [async () => ({}), 'missing_fields']]) {
  const out = await selectGeneralKnowledgeReferences({ query: 'question', sections: [source], select });
  assert.equal(out.reason, 'general_selection_unavailable'); assert.equal(out.selectionFailure.kind, failure);
  assert.deepEqual(out.items, []); assert(!JSON.stringify(out).includes('PRIVATE_SOURCE'));
}
let emptyCalls = 0;
const empty = await selectGeneralKnowledgeReferences({ query: 'unrelated intro', sections: [source], select: async () => { emptyCalls++; return { ids: [] }; } });
assert.equal(emptyCalls, 1); assert.equal(empty.reason, 'general_no_relevant_section');
let largeCalls = 0;
const tooLarge = await selectGeneralKnowledgeReferences({ query: 'history', sections: Array.from({ length: 513 }, (_, i) => ({ ...source, id: `id-${i}` })), select: async () => { largeCalls++; return { ids: [] }; } });
assert.equal(tooLarge.reason, 'general_directory_limit'); assert.equal(largeCalls, 0, 'Directory growth cannot silently truncate or produce unbounded calls');
for (const query of ['Mi ez az alove', 'az', 'mi', 'ez']) {
  const lexical = await retrieveKnowledgeSections({ db: db(noisy), query });
  assert.equal(lexical.items.length, 0, `Whole-token legacy matching excludes substring noise: ${query}`);
}
for (const [query, row] of [['Azteca', noisy[0]], ['Núñez', noisy[1]], ['球场历史', section('cjk', '传奇球场历史')], ['xG', section('xg', 'xG and PPDA')]]) {
  const lexical = await retrieveKnowledgeSections({ db: db([row]), query });
  assert.equal(lexical.items.length, 1, `Retain complete names, accents, CJK and meaningful short terms: ${query}`);
}
const fuzzy = { ...section('shirt', 'Apparel', 'A useful garment description.'), fuzzy_keywords_json: '["shirt"]' };
assert.equal((await retrieveKnowledgeSections({ db: db([fuzzy]), query: 'shirts' })).items.length, 1, 'Explicit fuzzy prefix preserves inflection');
let businessCalls = 0;
const business = await retrieveKnowledgeSections({ db: db([football]), query: 'Shipping and refund?', knowledgeScope: 'business', knowledgeQuery: 'both questions',
  selectGeneralReferences: async () => { throw Error('Business must not enter general relevance'); },
  selectBusinessReferences: async input => { businessCalls++; assert(input.query.includes('both questions')); return { items: [], reason: 'business_no_relevant_section' }; } });
assert.equal(businessCalls, 1); assert.equal(business.customerServiceIntent, true); assert.equal(business.strategy, 'business_no_relevant_section');
for (const stage of ['directory', 'evidence']) {
  let calls = 0;
  await requestBusinessKnowledgeSelection({ purpose: 'general', stage, query: 'Mixed cultural question', sections: [], limit: 4 }, {
    config: { id: 'fixture', apiKey: 'fixture', model: 'fixture', baseUrl: 'https://knowledge.invalid/v1', apiMode: 'chat_completions' },
    fetchImpl: async (url, options) => {
      calls++; assert(url.startsWith('https://knowledge.invalid/'));
      const body = JSON.parse(options.body); const contract = body.messages[0].content;
      assert(contract.includes('untrusted data')); assert(contract.includes('empty'));
      assert(!contract.includes('Find relevant business'));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(stage === 'directory' ? { ids: [] } : { matches: [] }) } }] }));
    },
  });
  assert.equal(calls, 1);
}
console.log('General relevance source, Unicode matching, zero-result, bounded failure and original business/access isolation checks passed (no network/DB)');
for (const options of [{ query: '', sections: [source] }, { query: 'ordinary conversation', sections: [] }]) {
  let calls = 0;
  const out = await selectGeneralKnowledgeReferences({ ...options, select: async () => { calls++; throw Error('No selection expected'); } });
  assert.equal(calls, 0); assert.equal(out.reason, 'general_no_reference');
}
let reads = 0;
const emptyQuery = await retrieveKnowledgeSections({ db: { execute: () => { reads++; throw Error('No DB for empty input'); } }, query: '', knowledgeScope: 'general' });
assert.equal(reads, 0); assert.equal(emptyQuery.strategy, 'empty_query');
console.log('Empty query/section pools make no selector call');
const { buildGeneralKnowledgeDirectory } = await import('../server/business-knowledge-selection-service.js');
const manySections = Array.from({ length: 212 }, (_, i) => ({ ...source, id: `section-${String(i).padStart(3, '0')}`, title: `Historical subject ${i}`, summary: 'A bounded directory summary, in any language.', keywords: ['history'], content: `${'Background paragraph. '.repeat(75)}Relevant detail for section ${i}.` }));
let largeStages = [];
const newest = manySections.at(-1);
const lastResult = await selectGeneralKnowledgeReferences({ query: 'Explain the last newly added subject', sections: manySections, select: async input => {
  largeStages.push(input.stage);
  if (input.stage === 'directory') {
    assert.equal(input.sections.length, 212, 'All authorized sections participate, including the last');
    assert(input.sections.every(s => !Object.hasOwn(s, 'content') && !Object.hasOwn(s, 'preview')));
    assert(JSON.stringify(input.sections).length <= 64000);
    return { ids: [newest.id] };
  }
  assert.equal(input.sections.length, 1);
  return { matches: [{ id: newest.id, quote: newest.content, answersQuestion: true, confidence: .95 }] };
} });
assert.equal(lastResult.reason, 'general_relevant_reference'); assert.equal(lastResult.items[0].id, newest.id);
assert.deepEqual(largeStages, ['directory', 'evidence'], '212 sections need one metadata selection and one bounded evidence stage, not 212 full-text prompts');
const boundedDirectory = buildGeneralKnowledgeDirectory(manySections);
assert.equal(boundedDirectory.batches.length, 1);
let longStageCount = 0;
const long = { ...source, id: 'long-212', content: `${'Earlier paragraph.\n'.repeat(350)}\nA unique final passage about this subject.` };
const late = await selectGeneralKnowledgeReferences({ query: 'Explain the final passage', sections: [...manySections, long], select: async input => {
  longStageCount++;
  if (input.stage === 'directory') return { ids: [input.sections.at(-1).id] };
  const row = input.sections.find(row => row.content.includes('A unique final passage about this subject.')); return { matches: [{ id: row.id, quote: 'A unique final passage about this subject.', answersQuestion: true, confidence: .95 }] };
} });
assert.equal(late.items[0].id, long.id); assert(late.items[0].content.includes('unique final passage'));
assert(longStageCount <= 3, 'Only selected long sources need a passage directory');
console.log('212-section real-shape regression passed: single compact metadata directory, last-source recall and bounded long-source evidence');
const twoBatchSections = Array.from({ length: 300 }, (_, i) => ({ ...source, id: `long-metadata-${i}`, title: 'T'.repeat(80), summary: 'S'.repeat(72), keywords: ['K'.repeat(24), 'L'.repeat(24), 'M'.repeat(24)] }));
const twoBatches = buildGeneralKnowledgeDirectory(twoBatchSections);
assert.equal(twoBatches.batches.length, 2); assert(twoBatches.batches.every(rows => JSON.stringify(rows).length <= 64000));
assert.equal(twoBatches.batches.flat().length, 300, 'Overflow batches retain all authorized metadata');
let directoryCalls = 0, evidenceCalls = 0;
const reranked = await selectGeneralKnowledgeReferences({ query: 'A question across sources', sections: twoBatchSections, select: async input => {
  if (input.stage === 'directory') {
    directoryCalls++;
    return { ids: directoryCalls <= 2 ? input.sections.slice(-8).map(row => row.id) : [input.sections.at(-1).id] };
  }
  evidenceCalls++; const row = input.sections[0]; return { matches: [{ id: row.id, quote: row.content, answersQuestion: true, confidence: .95 }] };
} });
assert.equal(directoryCalls, 3); assert.equal(evidenceCalls, 1);
assert.equal(reranked.items[0].id, twoBatchSections.at(-1).id, 'Global re-selection can retain the last source, never first-batch truncation');
assert.equal(buildGeneralKnowledgeDirectory([{ ...source, id: 'x'.repeat(64001) }]).reason, 'general_directory_limit');
console.log('Overflow remains at most two directory batches plus one finite global selection; no source prefix truncation');
const { retrieveChatKnowledgeSections } = await import('../server/knowledge-retrieval-service.js');
const weakRows = [section('spurious-es', 'La historia del fútbol y el estadio', 'Una historia del fútbol.')];
let implicitSelections = 0;
const weak = await retrieveChatKnowledgeSections({ db: db(weakRows), query: 'Ayuda con la camiseta', siteId: 'site-a', character: { id: 'char-a' },
  selectGeneralReferences: async input => { implicitSelections++; assert.equal(input.sections.length, 1); assert.equal(input.sections[0].id, 'spurious-es'); return { items: [], reason: 'general_no_relevant_section' }; } });
assert.equal(implicitSelections, 1, 'Implicit chat knowledge scope must validate legacy nonbusiness hits once');
assert.equal(weak.items.length, 0, 'Weak merchandise phrasing must not retain unrelated lexical history');
let implicitReads = 0;
const trueReference = section('culture', 'Football shirts', 'Football shirts carry team colours and supporter identity.');
const implicitUseful = await retrieveChatKnowledgeSections({ db: { execute: async () => { implicitReads++; return [[trueReference]]; } }, query: 'Football shirts', siteId: 'site-a', character: { id: 'char-a' },
  selectGeneralReferences: input => selectGeneralKnowledgeReferences({ ...input, select: async stage => stage.stage === 'directory'
    ? { ids: ['culture'] } : { matches: [{ id: 'culture', quote: trueReference.content, confidence: .95, answersQuestion: true }] } }) });
assert.equal(implicitUseful.strategy, 'general_relevant_reference'); assert.equal(implicitUseful.items[0].id, 'culture');
assert.equal(implicitReads, 2, 'Implicit validation reuses original authorized candidate content, no second full-pool read');
for (const options of [{ knowledgeScope: 'business', selectBusinessReferences: async () => ({ items: [], reason: 'business_no_relevant_section' }) }, { topicHint: 'delivery', query: 'shipping' }]) {
  let calls = 0;
  const out = await retrieveChatKnowledgeSections({ db: db([section('shipping', 'shipping', 'We provide shipping.')]), query: 'delivery', siteId: 'site-a', ...options,
    selectGeneralReferences: async () => { calls++; throw Error('Business must not use general relevance'); } });
  assert.equal(calls, 0); assert.equal(out.customerServiceIntent, true);
}
const directLegacy = await retrieveKnowledgeSections({ db: db(weakRows), query: 'Ayuda con la camiseta' });
assert.equal(directLegacy.items.length, 1, 'Admin/low-level lexical API is not turned into semantic selection');
console.log('Implicit chat scope closes legacy lexical bypass, retains useful general sources and avoids extra business/model reads');
