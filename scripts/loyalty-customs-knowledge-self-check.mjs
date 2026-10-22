import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { SERVER_CONFIG } from '../server/config.js';
import { retrieveKnowledgeSections } from '../server/knowledge-retrieval-service.js';
import { LOYALTY_CUSTOMS_KNOWLEDGE } from './apply-loyalty-customs-knowledge.mjs';

const [points, customs] = LOYALTY_CUSTOMS_KNOWLEDGE;
assert.equal(points.siteSlug, '');
assert.equal(points.scope, 'global');
assert.equal(points.category, 'customer_service');
assert.equal(customs.scope, 'global');
assert.equal(customs.siteSlug, '');
assert.equal(customs.category, 'customer_service');
assert.equal(new Set(LOYALTY_CUSTOMS_KNOWLEDGE.map(item => item.id)).size, 2);
assert.equal(new Set(LOYALTY_CUSTOMS_KNOWLEDGE.map(item => item.sectionId)).size, 2);
for (const item of LOYALTY_CUSTOMS_KNOWLEDGE) {
  assert.ok(item.content.length <= 1800, 'full source including limitations fits the retrieval content cap');
  assert.ok(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(item.content), 'no invented support email');
}
assert.match(points.content, /across all supported storefronts/);
assert.match(points.content, /current store and its own support contact/);
assert.match(points.content, /not Alove platform credits/);
assert.doesNotMatch(points.content, /BestSoccerStore|Club BS/);
assert.match(points.content, /personal center/);
assert.match(points.content, /email the official store customer-service address/);
assert.match(points.content, /do not require linking/);
assert.match(points.content, /does not specify a redemption rate/);
assert.match(customs.content, /A general complaint that delivery is slow does not establish a customs delay/);
assert.match(customs.content, /not a live-verified location/);
assert.match(customs.content, /do not require linking/);

if (process.argv.includes('--db')) {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(SERVER_CONFIG.db.host));
  assert.equal(SERVER_CONFIG.db.port, 3307);
  const db = await mysql.createConnection(SERVER_CONFIG.db);
  try {
    const [sites] = await db.query('SELECT id,slug FROM sites');
    assert.ok(sites.length > 1, 'verify shared knowledge across multiple stores');
    for (const item of LOYALTY_CUSTOMS_KNOWLEDGE) {
      const [[row]] = await db.execute(`SELECT kb.scope,kb.category,kb.site_id,ks.content
        FROM knowledge_bases kb JOIN knowledge_sections ks ON ks.knowledge_base_id=kb.id
        WHERE kb.id=? AND ks.id=?`, [item.id, item.sectionId]);
      assert.ok(row, `knowledge applied: ${item.id}`);
      assert.equal(row.scope, item.scope);
      assert.equal(row.category, item.category);
      assert.equal(row.site_id, null, 'shared policy is not bound to another store');
      assert.equal(row.content, item.content);
    }
    // Real retrieval SQL and access control; injected selector observes only the
    // authorized pool and does not contact a model or pretend semantic selection.
    for (const site of sites) {
      let authorized;
      const select = async ({ sections }) => {
        authorized = sections;
        return { items: [], reason: 'scope_self_check' };
      };
      await retrieveKnowledgeSections({ db, siteId: site.id, query: 'store loyalty points redemption',
        knowledgeScope: 'business', selectBusinessReferences: select });
      assert.ok(authorized.some(section => section.id === points.sectionId),
        `shared points policy visible for ${site.slug}`);
      assert.ok(!authorized.some(section => section.id === 'kbs_bss_points_redemption'),
        `superseded BSS-only draft absent for ${site.slug}`);
      await retrieveKnowledgeSections({ db, siteId: site.id, query: 'meaning of awaiting customs clearance',
        knowledgeScope: 'business',
        selectGeneralReferences: select, selectBusinessReferences: select });
      assert.ok(authorized.some(section => section.id === customs.sectionId), `customs meaning visible for ${site.slug}`);
      await retrieveKnowledgeSections({ db, siteId: site.id, query: 'what does customs mean',
        knowledgeScope: 'general', selectGeneralReferences: select });
      assert.ok(!authorized.some(section => [points.sectionId, customs.sectionId].includes(section.id)),
        `general scope still excludes store support FAQ for ${site.slug}`);
    }
    console.log(`Read-only local scope checks passed for ${sites.length} sites.`);
  } finally { await db.end(); }
}
console.log('Loyalty/customs knowledge content checks passed.');
