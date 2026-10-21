import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
if(!process.argv.includes('--real')){console.log('Skipped: --real uses a temporary local guest and real text providers; no audio/image generation.');process.exit(0)}
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {assertLocalMutatingSelfCheckEnvironment}=await import('./self-check-environment-guard.mjs');
const {configureNetworkProxy}=await import('../server/network-proxy.js');
const {getDbPool,closeDbPool}=await import('../server/db.js');
const {hashSessionToken}=await import('../server/security.js');
const {requireGuestCharacter}=await import('../server/guest-session-service.js');
const {insertMessage}=await import('../server/chat-message-store.js');
const {ensureGuestReply}=await import('../server/guest-reply-service.js');
const {stripTtsControlTags}=await import('../server/tts-emotion-tag-service.js');
const {acquireDedicatedDbAdvisoryLock,closeDbAdvisoryLockPool}=await import('../server/db-advisory-lock-service.js');
await assertLocalMutatingSelfCheckEnvironment({label:'multi-item local entry check'});configureNetworkProxy();
const suffix=randomUUID(),guestId=`guest_scope_check_${suffix}`,sessionId=`chat_scope_check_${suffix}`,token=randomUUID(),db=getDbPool(),report={};
try{
const [[site]]=await db.execute("SELECT s.id,s.mascot_character_id FROM sites s WHERE s.slug='projerseyshop' AND s.guest_chat_enabled=1 LIMIT 1");assert(site?.mascot_character_id);
await db.execute('INSERT INTO guest_sessions (id,token_hash,site_id,mascot_character_id,chat_session_id,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))',[guestId,hashSessionToken(token),site.id,site.mascot_character_id,sessionId]);
await db.execute("INSERT INTO chat_sessions (id,internal_uid,guest_session_id,character_id,session_title,session_status,source_type,source_ref,preferred_language,last_message_at) VALUES (?,NULL,?,?,'Product scope runtime fixture','active','guest','product-scope-runtime-fixture','Spanish',NOW(3))",[sessionId,guestId,site.mascot_character_id]);
await db.execute('INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)',[guestId]);
const guest=await requireGuestCharacter(token),text='Quiero una camiseta roja del Real Madrid y una azul del Barcelona, una de cada equipo en talla M.';
const message=await insertMessage(db,{sessionId,guestSessionId:guestId,characterId:guest.mascot_character_id,senderType:'user',senderLabel:'You',contentType:'text',text,displayOrder:100,sourceType:'guest',sourceRef:'product-scope-runtime-fixture'});
const unlock=await acquireDedicatedDbAdvisoryLock(`guest_reply:${guestId}`.slice(0,64),30);const started=Date.now();
try{await ensureGuestReply({token,prepared:{guest,message,text,attachments:[],promptBeforeDisplayOrder:100}})}finally{await unlock()}
const [rows]=await db.execute("SELECT m.content_type,m.text_content,m.product_payload_json,v.transcript AS speech_text,v.asset_status FROM chat_messages m LEFT JOIN character_voice_assets v ON v.id=m.voice_asset_id WHERE m.session_id=? AND m.display_order>100 AND m.sender_type='character' ORDER BY m.display_order",[sessionId]);
const reply=rows.find(r=>r.content_type==='text');assert(reply?.text_content);const payload=typeof reply.product_payload_json==='string'?JSON.parse(reply.product_payload_json):reply.product_payload_json;
Object.assign(report,{elapsedMs:Date.now()-started,text:reply.text_content,contentTypes:rows.map(r=>r.content_type),state:payload?._productRequestScope,voiceStatus:reply.asset_status});
assert.equal(rows.some(r=>r.content_type==='product'),false,'unselected multiple request must send no card');
assert.equal(payload?._productRequestScope?.status,'pending','real upstream commerce classification must persist pending scope');
assert.equal(payload._productRequestScope.items.length,2);assert(reply.text_content.includes('Madrid')&&reply.text_content.includes('Barcelona'),'both original targets must survive final response');
assert.equal(stripTtsControlTags(reply.speech_text).replace(/\s+/g,' ').trim(),reply.text_content.replace(/\s+/g,' ').trim());assert.equal(reply.asset_status,'pending','no generated audio');
console.log('Real guest entry passed: upstream classification, safe reply, same-transaction state, no card/audio/image.');
}finally{
const [assets]=await db.execute('SELECT v.id FROM character_voice_assets v INNER JOIN chat_messages m ON m.id=v.message_id WHERE m.session_id=?',[sessionId]);
await db.execute('DELETE FROM guest_image_entitlements WHERE guest_session_id=?',[guestId]);await db.execute('DELETE FROM guest_character_sessions WHERE guest_session_id=?',[guestId]);await db.execute('DELETE FROM chat_sessions WHERE id=?',[sessionId]);for(const asset of assets)await db.execute('DELETE FROM character_voice_assets WHERE id=?',[asset.id]);await db.execute('DELETE FROM guest_sessions WHERE id=?',[guestId]);
const [[remaining]]=await db.execute('SELECT (SELECT COUNT(*) FROM chat_sessions WHERE id=?) + (SELECT COUNT(*) FROM guest_sessions WHERE id=?) AS total',[sessionId,guestId]);assert.equal(Number(remaining.total),0);report.cleanup='passed';
if(process.env.PRODUCT_SCOPE_ENTRY_REPORT)await writeFile(process.env.PRODUCT_SCOPE_ENTRY_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await closeDbPool();await closeDbAdvisoryLockPool();
}
