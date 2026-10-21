import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { SERVER_CONFIG } from '../server/config.js';
import { retrieveChatKnowledgeSections as retrieveChatKnowledgeSectionsWithSelector, retrieveKnowledgeSections } from '../server/knowledge-retrieval-service.js';
import { buildKnowledgeContextLayer } from '../server/chat-prompt-layers.js';
import { buildReplyReviewMessages } from '../server/chat-reply-review-contracts.js';

assert(['127.0.0.1', 'localhost', '::1'].includes(SERVER_CONFIG.db.host), 'self-check is local-only');
const db = await mysql.createConnection(SERVER_CONFIG.db);
const prefix = `knowledge_check_${randomBytes(6).toString('hex')}`;
// This suite checks actual SQL access, not paid semantic quality. Return only
// authorized fixture rows that share the test marker; never call a model.
const retrieveChatKnowledgeSections = options => retrieveChatKnowledgeSectionsWithSelector({
  selectGeneralReferences: async ({ sections, query }) => {
    const items = query.includes(prefix) ? sections.filter(section => section.content.includes(prefix)) : [];
    return { items, reason: items.length ? 'general_relevant_reference' : 'general_no_relevant_section' };
  }, ...options });
const id = name => `${prefix}_${name}`;
let checks = 0;
async function policy(name, { scope = 'site', site = '', category = 'customer_service', content = 'We ship worldwide.', keyword = '', target = '' } = {}) {
  await db.execute(`INSERT INTO knowledge_bases (id,label,category,scope,site_id,priority,keywords_json)
    VALUES (?,?,?,?,?,999,?)`, [id(name), name, category, scope, site || null, JSON.stringify([keyword || name])]);
  await db.execute(`INSERT INTO knowledge_sections (id,knowledge_base_id,section_key,title,content,keywords_json)
    VALUES (?,?,?,?,?,?)`, [id(`${name}_section`), id(name), name, name, content, JSON.stringify([keyword || name])]);
  if (target) await db.execute(`INSERT INTO knowledge_base_bindings (id,knowledge_base_id,target_type,target_id)
    VALUES (?,?,'character',?)`, [id(`${name}_binding`), id(name), target]);
}
async function expectPolicy(options, expected) {
  const result = await retrieveChatKnowledgeSections({ db, query: 'Do you ship to Ukraine?', limit: 4, ...options });
  assert.equal(result.customerServiceTopic, 'delivery');
  assert.deepEqual([...new Set(result.items.map(x => x.knowledgeBaseId))], [id(expected)]);
  const prompt = buildKnowledgeContextLayer(result).content;
  assert.match(prompt, new RegExp(expected));
  checks++;
  return result;
}
try {
  // Connect actual retrieved source to generation and full business review;
  // these assertions check the wire, not semantic correctness of a model.
  const qualifiedSource = 'Coverage may apply under the selected option. Replacement may be arranged after review.';
  const qualifiedContext = { customerServiceIntent: true, items: [{ id: 'qualified_policy', content: qualifiedSource, evidenceQuote: qualifiedSource }] };
  const layer = buildKnowledgeContextLayer(qualifiedContext).content;
  assert(layer.includes(qualifiedSource));
  assert(layer.includes('Preserve the degree of certainty and authority of each source claim'));
  const reviewMessages = buildReplyReviewMessages({ text: 'Coverage is guaranteed.', speechText: 'Replacement is guaranteed.',
    userText: 'Explain the policy.', businessFactsRequired: true, independentLanguageReview: true, knowledgeContext: qualifiedContext });
  const packet = JSON.parse(reviewMessages.at(-1).content);
  assert.equal(packet.evidence.knowledge[0].content, qualifiedSource);
  assert.equal(packet.proposedSpeech, 'Replacement is guaranteed.');
  assert(reviewMessages.some(row => row.role === 'system' && row.content.includes('For each claimed outcome, check whether the reference permits a case')));
  checks++;
  await db.beginTransaction();
  for (const name of ['a', 'b', 'none']) await db.execute('INSERT INTO sites (id,name,slug) VALUES (?,?,?)', [id(name), name, id(name)]);
  // Transaction-only identity, never used to log in or committed.
  await db.execute(`INSERT INTO users (id,platform_uid,username,password_hash,email,site_id)
    VALUES (?,?,?,?,?,?)`, [id('user'), id('platform'), 'knowledge-self-check', '-', `${prefix}@example.invalid`, id('a')]);
  await policy('policy_a', { site: id('a') });
  await policy('policy_b', { site: id('b') });
  await policy('generic', { scope: 'global', content: 'shipping '.repeat(25) });
  const shared = { id: id('shared'), category_id: 'mascot', site_id: null };
  const foreign = { ...shared, site_id: id('b') };
  await expectPolicy({ character: shared, siteId: id('a') }, 'policy_a');
  await expectPolicy({ character: foreign, siteId: id('a') }, 'policy_a');
  await expectPolicy({ character: shared, siteId: id('b') }, 'policy_b');
  await expectPolicy({ character: shared, userId: id('user') }, 'policy_a');
  // A site-owned commerce character keeps its own site, matching existing commerce rules.
  await expectPolicy({ character: foreign, userId: id('user') }, 'policy_b');
  for (const query of ['Where do you ship?', 'Has it shipped?', 'What is your shipping policy?', 'Where are my shipments?', 'Hola en cuanto tiempo realizan entregas en mexico', 'When will I get delivery in Fresno?', 'cuanto tarda el envío?', 'Mennyi idő mire megérkezik a rendelésem?']) {
    await expectPolicy({ character: shared, siteId: id('a'), query }, 'policy_a');
  }
  for (const query of ['Our friendship matters', 'I am looking for sponsorship', 'I want a dropshipping business']) {
    const result = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('a'), query });
    assert.notEqual(result.customerServiceTopic, 'delivery', query);
    checks++;
  }
  for (const query of ['配達には何日かかりますか', 'Πότε θα παραδοθεί;', 'Mikor ér ide?']) {
    await expectPolicy({ character: shared, siteId: id('a'), query, topicHint: 'delivery' }, 'policy_a');
  }
  const invalidHint = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('a'), query: 'Our friendship matters', topicHint: 'DROP TABLE' });
  assert.notEqual(invalidHint.customerServiceTopic, 'delivery'); checks++;
  const fallback = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('none'), query: 'How long is shipping?' });
  assert(fallback.items.some(x => x.knowledgeBaseId === id('generic')));
  assert(!fallback.items.some(x => [id('policy_a'), id('policy_b')].includes(x.knowledgeBaseId)));
  checks++;
  const failure = { stage: 'directory', kind: 'timeout' };
  const failedKnowledge = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('a'),
    query: 'Why do these products have different prices?', knowledgeScope: 'business',
    selectBusinessReferences: async () => ({ items: [], reason: 'business_selection_unavailable', selectionFailure: failure }) });
  assert.deepEqual(failedKnowledge.selectionFailure, failure, 'finite failure provenance survives real SQL retrieval');
  assert.equal(failedKnowledge.strategy, 'business_selection_unavailable'); checks++;
  const [[cfSite]] = await db.execute('SELECT id FROM sites WHERE slug=?', ['camisetasfutbol']);
  if (cfSite) {
    const [[priceKnowledge]] = await db.execute('SELECT id FROM knowledge_bases WHERE id=? AND site_id=? AND scope=? AND knowledge_status=?',
      ['kb_site_cf_price_explanation', cfSite.id, 'site', 'active']);
    if (priceKnowledge) {
      for (const [siteId, expected] of [[cfSite.id, true], [id('b'), false]]) {
        await retrieveChatKnowledgeSections({ db, siteId, query: 'Why are prices different?', knowledgeScope: 'business',
          selectBusinessReferences: async ({ sections }) => {
            assert.equal(sections.some(s => s.knowledgeBaseId === priceKnowledge.id), expected, 'local price guidance is current-site only');
            return { items: [], reason: 'business_no_relevant_section' };
          } }); checks++;
      }
    }
  }
  await policy('general_definition', { scope: 'global', category: 'general', keyword: prefix, content: `${prefix} A tracking status is a carrier event label; this definition does not verify an individual parcel.` });
  for (const query of [`What does this shipping tracking label mean? ${prefix}`, `¿Qué significa este estado de envío? ${prefix}`, `这个物流状态是什么意思？${prefix}`]) {
    const explanation = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('a'),
      query, topicHint: 'delivery', knowledgeScope: 'general' });
    assert.equal(explanation.customerServiceIntent, false, 'explicit general interpretation cannot be pulled into customer-service policy by a topic hint or keyword');
    assert(explanation.items.some(item => item.knowledgeBaseId === id('general_definition')));
    assert(explanation.items.every(item => item.category !== 'customer_service'), 'policy and placeholder scripts cannot become generic-definition evidence');
    checks++;
  }
  const marker = `${prefix}ordinary`;
  await policy('ordinary_global', { scope: 'global', category: 'general', keyword: marker, content: `${marker} football context` });
  await policy('ordinary_target', { scope: 'targeted', target: shared.id, category: 'general', keyword: marker, content: `${marker} role context` });
  await policy('ordinary_private', { scope: 'targeted', target: id('other_role'), category: 'general', keyword: marker, content: `${marker} private context` });
  const ordinary = await retrieveChatKnowledgeSections({ db, character: shared, siteId: id('a'), query: marker });
  assert(ordinary.items.some(x => x.knowledgeBaseId === id('ordinary_global')));
  assert(ordinary.items.some(x => x.knowledgeBaseId === id('ordinary_target')));
  assert(!ordinary.items.some(x => x.knowledgeBaseId === id('ordinary_private')));
  checks++;
  assert.equal((await retrieveKnowledgeSections({ db, query: '' })).strategy, 'empty_query');
  checks++;
  console.log(`chat knowledge site self-check passed: ${checks} cases; real local SQL and prompt references; no provider calls`);
} finally {
  await db.rollback();
  const [rows] = await db.execute('SELECT COUNT(*) n FROM knowledge_bases WHERE id LIKE ?', [`${prefix}%`]);
  assert.equal(rows[0].n, 0, 'transaction fixtures must be removed');
  await db.end();
}
