import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertLocalMutatingSelfCheckEnvironment } from './self-check-environment-guard.mjs';
import { getDbPool, closeDbPool } from '../server/db-core.js';
import { saveAdminExternalEmbed } from '../server/external-embed-service.js';
import { createSiteExternalEmbedsTableIfMissing } from '../server/db-bootstrap-external-embed-tables.js';
import { defaultExternalPromotion, normalizeExternalPromotion, getAdminExternalPromotion, saveAdminExternalPromotion, getPublicExternalPromotion } from '../server/external-promotion-service.js';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const defaults=defaultExternalPromotion('projerseyshop');
assert.ok(defaults.popupImageUrl.endsWith('pj-black-friday-2026.png'));
assert.equal(defaultExternalPromotion('another-site').popupImageUrl,'');
assert.deepEqual(normalizeExternalPromotion(defaults),defaults);
for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg/>','/server/config.js','/uploads/avatars/../config.svg','/assets/promotions/../../secret.png','//evil.test/x.png','http://example.test/x.png']) {
  assert.throws(()=>normalizeExternalPromotion({...defaults,popupImageUrl:url}),undefined,'Unsafe image URL rejected');
}
assert.ok(normalizeExternalPromotion({...defaults,popupImageUrl:'/uploads/carousel/self-check.png'}));
assert.ok(normalizeExternalPromotion({...defaults,popupImageUrl:'https://example.test/banner.png'}));
assert.throws(()=>normalizeExternalPromotion({...defaults,popupImageUrl:''},{complete:true}));
assert.throws(()=>normalizeExternalPromotion({...defaults,autoAvoid:'true'}));
assert.throws(()=>normalizeExternalPromotion({...defaults,desktopRightPx:-1}));
assert.throws(()=>normalizeExternalPromotion({...defaults,mobileBottomPx:Infinity}));
assert.equal(normalizeExternalPromotion({...defaults,html:'<script>bad()</script>'}).html,undefined);

const siteId='site_promo_check_'+Date.now(),slug='promo-check-'+Date.now();
let db;
try {
  await assertLocalMutatingSelfCheckEnvironment({label:'promotion isolated fixture'});
  await createSiteExternalEmbedsTableIfMissing();
  db=getDbPool();
  await db.execute("INSERT INTO sites (id,name,slug,site_url,site_status) VALUES (?,?,?,?,'active')",[siteId,'Promotion fixture',slug,'https://promo.example.test']);
  const [untouchedBefore]=await db.query('SELECT * FROM site_external_embeds WHERE site_id<>? ORDER BY id',[siteId]);
  const before=await getAdminExternalPromotion(siteId);
  assert.equal(before.item.publicId,'');assert.equal(before.item.published,null);
  assert.equal(before.item.draft.popupImageUrl,'');
  const[[reads]]=await db.execute('SELECT COUNT(*) n FROM site_external_embeds WHERE site_id=?',[siteId]);assert.equal(reads.n,0,'GET cannot seed any row');
  await assert.rejects(()=>saveAdminExternalPromotion(siteId,{action:'publish'}));
  assert.equal(await getPublicExternalPromotion('invalid','https://promo.example.test'),null);
  // Concurrent first writes remain one draft-only base row and do not publish.
  await Promise.all([saveAdminExternalPromotion(siteId,{action:'save_draft',config:defaults}),saveAdminExternalPromotion(siteId,{action:'save_draft',config:defaults})]);
  const[[created]]=await db.execute('SELECT * FROM site_external_embeds WHERE site_id=?',[siteId]);
  assert.equal(created.embed_status,'draft');assert.equal(created.promotion_published_json,null);
  await db.execute("UPDATE site_external_embeds SET title='Unchanged chat', embed_status='published', show_badge=0 WHERE site_id=?",[siteId]);
  const[[chatBefore]]=await db.execute('SELECT * FROM site_external_embeds WHERE site_id=?',[siteId]);
  const saved=await getAdminExternalPromotion(siteId),id=saved.item.publicId;
  assert.equal(saved.item.installerSnippet,'');
  assert.equal(await getPublicExternalPromotion(id,'https://promo.example.test'),null,'Draft is private');
  const published=await saveAdminExternalPromotion(siteId,{action:'publish'});
  assert.deepEqual(published.item.published,defaults,'Only transaction-locked saved draft can publish');
  assert.ok(published.item.installerSnippet.includes('data-aiove-promotion'));
  const exposed=await getPublicExternalPromotion(id,'https://promo.example.test');
  assert.ok(exposed.popupImageUrl.startsWith('http'));assert.equal(exposed.publicId,undefined);assert.equal(exposed.externalOrigin,undefined);
  for(const origin of ['', 'https://evil.test','https://promo.example.test/path','https://promo.example.test.evil.test','null']) assert.equal(await getPublicExternalPromotion(id,origin),null);
  const changed={...defaults,label:'New draft'};
  await saveAdminExternalPromotion(siteId,{action:'save_draft',config:changed});
  assert.equal((await getPublicExternalPromotion(id,'https://promo.example.test')).label,defaults.label,'Draft editing does not affect public snapshot');
  await saveAdminExternalPromotion(siteId,{action:'save_draft',config:{...defaults,popupImageUrl:''}});
  await assert.rejects(()=>saveAdminExternalPromotion(siteId,{action:'publish'}));
  assert.equal((await getPublicExternalPromotion(id,'https://promo.example.test')).label,defaults.label,'Invalid publish cannot erase current campaign');
  await saveAdminExternalPromotion(siteId,{action:'save_draft',config:changed});
  await Promise.all([saveAdminExternalPromotion(siteId,{action:'save_draft',config:{...changed,label:'Concurrent'}}),saveAdminExternalPromotion(siteId,{action:'publish'})]);
  assert.ok(['New draft','Concurrent'].includes((await getPublicExternalPromotion(id,'https://promo.example.test')).label));
  await db.execute("UPDATE sites SET site_status='inactive' WHERE id=?",[siteId]);
  assert.equal(await getPublicExternalPromotion(id,'https://promo.example.test'),null);
  await assert.rejects(()=>getAdminExternalPromotion(siteId));
  await db.execute("UPDATE sites SET site_status='active' WHERE id=?",[siteId]);
  const visible={...defaults,label:'Exact visible configuration'};
  await Promise.all([saveAdminExternalPromotion(siteId,{action:'save_draft',config:{...defaults,label:'Other admin draft'}}),saveAdminExternalPromotion(siteId,{action:'publish',config:visible})]);
  assert.deepEqual((await getAdminExternalPromotion(siteId)).item.published,visible,'Explicit publish atomically publishes exactly the visible configuration');
  const beforeInvalid=await getAdminExternalPromotion(siteId);
  await assert.rejects(()=>saveAdminExternalPromotion(siteId,{action:'publish',config:{...visible,popupImageUrl:''}}));
  assert.equal(fingerprint(await getAdminExternalPromotion(siteId)),fingerprint(beforeInvalid),'Invalid explicit publish changes neither snapshot');
  await saveAdminExternalPromotion(siteId,{action:'save_draft',config:{...defaults,label:'Concurrent'}});
  await saveAdminExternalPromotion(siteId,{action:'disable'});
  assert.equal(await getPublicExternalPromotion(id,'https://promo.example.test'),null);
  assert.equal((await getAdminExternalPromotion(siteId)).item.draft.label,'Concurrent');
  const[[chatAfter]]=await db.execute('SELECT * FROM site_external_embeds WHERE site_id=?',[siteId]);
  const chatOnly=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['promotion_draft_json','promotion_published_json','updated_at'].includes(k)));
  assert.equal(fingerprint(chatOnly(chatAfter)),fingerprint(chatOnly(chatBefore)),'Every existing chat column stays untouched');
  const [untouchedAfter]=await db.query('SELECT * FROM site_external_embeds WHERE site_id<>? ORDER BY id',[siteId]);
  assert.equal(fingerprint(untouchedAfter),fingerprint(untouchedBefore),'All other site configurations remain byte-for-byte unchanged');
  const promoBeforeLegacy=JSON.stringify((await getAdminExternalPromotion(siteId)).item.draft);
  await saveAdminExternalEmbed(siteId,{status:'draft'});
  assert.equal(JSON.stringify((await getAdminExternalPromotion(siteId)).item.draft),promoBeforeLegacy,'Existing chat editor must preserve promotion draft');
  assert.equal((await getAdminExternalPromotion(siteId)).item.published,null);
  // Reproduce a stale empty first read before an INSERT's duplicate-site branch.
  // Only the first read is injected; the transaction and surviving row are real MySQL.
  const execute=db.execute;
  let staleRead=true;
  db.execute=async function(sql,params){
    if(staleRead && sql==='SELECT * FROM site_external_embeds WHERE site_id = ? LIMIT 1' && params?.[0]===siteId){staleRead=false;return [[],[]];}
    return execute.call(this,sql,params);
  };
  try {
    const legacySaved=await saveAdminExternalEmbed(siteId,{status:'draft'});
    assert.equal(staleRead,false);
    assert.equal(legacySaved.item.config.publicId,id,'Legacy chat response must use the actual surviving public ID');
    assert.equal(legacySaved.item.config.id,created.id,'Legacy chat response must use the actual surviving row ID');
  } finally {db.execute=execute;}
  console.log('Promotion service: read-only defaults, isolated draft/publish/disable, concurrent transactions, exact Origin, URL validation and chat/other-site preservation passed');
} finally {
  if(db) await db.execute('DELETE FROM sites WHERE id=?',[siteId]);
  await closeDbPool();
}
