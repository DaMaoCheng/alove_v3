import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SERVER_CONFIG } from '../server/config.js';

// Explicit maintenance data, never imported by startup or a seed. Resolve site
// IDs from the local slug; production IDs must be resolved on that server.
export const LOYALTY_CUSTOMS_KNOWLEDGE = [
  {
    id: 'kb_global_points_redemption', sectionId: 'kbs_global_points_redemption',
    siteSlug: '', scope: 'global', category: 'customer_service',
    label: 'Store Points Redemption', title: 'Redeeming store loyalty points',
    summary: 'Store loyalty points: redeem in the store personal center, or email official store support with the desired jersey for staff follow-up.',
    keywords: ['points', 'loyalty', 'redeem', 'redemption', '积分', '兑换'],
    content: 'This guidance applies across all supported storefronts, using the current store and its own support contact. It concerns store loyalty points, not Alove platform credits. Customers can redeem store loyalty points themselves from the personal center of the store website. Alternatively, they can email the official store customer-service address, state which jersey they want to redeem, and staff will follow up. Use only a verified store support email address; this source does not provide an address. General redemption instructions do not require linking the store account to Alove. Personal point balances and an actual redemption require the store account or assistance from store support. This source does not specify a redemption rate, eligibility, minimum balance, stock, shipping costs or a guaranteed redemption result. Do not invent these details or claim that Alove has already redeemed points, sent an email or contacted support.',
  },
  {
    id: 'kb_general_customs_status', sectionId: 'kbs_general_customs_status',
    siteSlug: '', scope: 'global', category: 'customer_service',
    label: 'Customs Tracking Status Meaning', title: 'Meaning of awaiting customs clearance and customs delays',
    summary: 'Explains a user-reported customs tracking status conditionally; general delivery delays alone do not establish a customs cause.',
    keywords: ['awaiting customs clearance', 'customs', 'clearance', 'tracking status', '海关', '清关', '物流状态'],
    content: 'When a customer reports a tracking status such as "Awaiting customs clearance", explain that this status means the parcel is waiting for customs review and release arrangements. Customs processing can take time and tracking may temporarily show no new updates while that stage is pending. Explain the meaning of the reported status, not a live-verified location or a diagnosis of this parcel. Do not state that a parcel is currently at customs without current evidence, invent a reason for a hold, promise a release or delivery date, or assert that customs has already released it. A general complaint that delivery is slow does not establish a customs delay: do not attribute it to customs unless the customer or verified tracking provides that status. If a reported customs status remains unchanged, the customer can contact official store support or the carrier for investigation. General status explanations do not require linking an account to Alove. Looking up private order information or live tracking still follows the existing account-access requirements. This is a generic explanation, not a store-specific shipping policy, delivery estimate, tax rule or guarantee.',
  },
];

export async function applyLoyaltyCustomsKnowledge({ apply = false } = {}) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(SERVER_CONFIG.db.host) || SERVER_CONFIG.db.port !== 3307) {
    throw new Error('This knowledge change is restricted to local MySQL :3307.');
  }
  const db = await mysql.createConnection(SERVER_CONFIG.db);
  try {
    await db.beginTransaction();
    const changes = [];
    for (const item of LOYALTY_CUSTOMS_KNOWLEDGE) {
      const [[site]] = item.siteSlug
        ? await db.execute('SELECT id FROM sites WHERE slug=?', [item.siteSlug]) : [[null]];
      if (item.siteSlug && !site) throw new Error(`Required site missing: ${item.siteSlug}`);
      const [bases] = await db.execute('SELECT * FROM knowledge_bases WHERE id=? FOR UPDATE', [item.id]);
      const [sections] = await db.execute('SELECT * FROM knowledge_sections WHERE id=? OR knowledge_base_id=? FOR UPDATE', [item.sectionId, item.id]);
      const [bindings] = await db.execute('SELECT * FROM knowledge_base_bindings WHERE knowledge_base_id=? FOR UPDATE', [item.id]);
      if (bases.length || sections.length || bindings.length) {
        const unchanged = bases.length === 1 && sections.length === 1 && !bindings.length
          && bases[0].scope === item.scope && bases[0].site_id === (site?.id || null)
          && bases[0].category === item.category && bases[0].label === item.label
          && bases[0].summary === item.summary && bases[0].knowledge_status === 'active'
          && sections[0].id === item.sectionId && sections[0].knowledge_base_id === item.id
          && sections[0].content === item.content && sections[0].title === item.title
          && sections[0].summary === item.summary && sections[0].section_status === 'active';
        if (!unchanged) throw new Error(`Existing knowledge differs; review before replacing: ${item.id}`);
      }
      changes.push({ item, siteId: site?.id || null, bases, sections, bindings, insert: !bases.length });
    }
    const pending = changes.filter(change => change.insert);
    if (apply && pending.length) {
      const backup = new URL(`../.backups/loyalty-customs-knowledge-${Date.now()}/`, import.meta.url);
      await mkdir(backup, { recursive: true, mode: 0o700 });
      await writeFile(new URL('before.json', backup), JSON.stringify(changes, null, 2), { mode: 0o600, flag: 'wx' });
      for (const { item, siteId } of pending) {
        const keywords = JSON.stringify(item.keywords);
        await db.execute(`INSERT INTO knowledge_bases
          (id,label,summary,category,scope,site_id,language,priority,max_sections,max_chars_per_section,keywords_json,source_type,source_ref)
          VALUES (?,?,?,?,?,?,'English',100,1,1800,?,'manual',?)`,
        [item.id, item.label, item.summary, item.category, item.scope, siteId, keywords,
          'Project-owner confirmed support guidance 2026-10-22']);
        await db.execute(`INSERT INTO knowledge_sections
          (id,knowledge_base_id,section_key,title,summary,content,keywords_json)
          VALUES (?,?,?,?,?,?,?)`,
        [item.sectionId, item.id, item.sectionId, item.title, item.summary, item.content, keywords]);
      }
      await db.commit();
    }
    return { ok: true, applied: apply && pending.length > 0,
      items: changes.map(({ item, siteId, insert }) => ({ id: item.id, siteSlug: item.siteSlug,
        scope: item.scope, category: item.category, siteId, action: insert ? 'insert' : 'already_present' })) };
  } finally {
    await db.rollback();
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  console.log(JSON.stringify(await applyLoyaltyCustomsKnowledge({ apply: process.argv.includes('--apply') }), null, 2));
}
