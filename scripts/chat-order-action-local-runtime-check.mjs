import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

if (!process.argv.includes("--real")) {
  console.log("Skipped: --real explicitly enables a bounded text-provider check against the local development DB. No audio/image generation.");
  process.exit(0);
}
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const { assertLocalMutatingSelfCheckEnvironment } = await import("./self-check-environment-guard.mjs");
const { configureNetworkProxy } = await import("../server/network-proxy.js");
const { getDbPool, closeDbPool } = await import("../server/db.js");
const { hashSessionToken } = await import("../server/security.js");
const { requireGuestCharacter } = await import("../server/guest-session-service.js");
const { insertMessage } = await import("../server/chat-message-store.js");
const { ensureGuestReply } = await import("../server/guest-reply-service.js");
const { stripTtsControlTags } = await import("../server/tts-emotion-tag-service.js");
const { acquireDedicatedDbAdvisoryLock, closeDbAdvisoryLockPool } = await import("../server/db-advisory-lock-service.js");
await assertLocalMutatingSelfCheckEnvironment({ label: "order action local reply runtime check" });
configureNetworkProxy();
const db = getDbPool();
const suffix = randomUUID();
const guestId = `guest_order_check_${suffix}`;
const sessionId = `chat_order_check_${suffix}`;
const token = randomUUID();
const results = [];
const providerDecisions = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const response = await originalFetch(url, options);
  try {
    const request = JSON.parse(options.body || '{}');
    const instruction = request.messages?.[0]?.content || '';
    if (instruction.startsWith('Interpret only the commerce purpose') || instruction.startsWith('Review a proposed response')) {
      const payload = await response.clone().json();
      const raw = payload.choices?.[0]?.message?.content || '';
      providerDecisions.push({ type: instruction.startsWith('Interpret') ? 'commerce' : 'review', result: JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) });
    }
  } catch { /* Diagnostics must not change the real provider request. */ }
  return response;
};
try {
  const [[site]] = await db.execute("SELECT id, mascot_character_id FROM sites WHERE slug = 'projerseyshop' AND guest_chat_enabled = 1 LIMIT 1");
  assert(site?.mascot_character_id, "local PJ mascot required");
  await db.execute("INSERT INTO guest_sessions (id,token_hash,site_id,mascot_character_id,chat_session_id,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
    [guestId, hashSessionToken(token), site.id, site.mascot_character_id, sessionId]);
  await db.execute("INSERT INTO chat_sessions (id,internal_uid,guest_session_id,character_id,session_title,session_status,source_type,source_ref,preferred_language,last_message_at) VALUES (?,NULL,?,?,'Order action runtime check','active','guest','order-action-runtime-check','Spanish',NOW(3))",
    [sessionId, guestId, site.mascot_character_id]);
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
  const guest = await requireGuestCharacter(token);
  for (const [index, text] of [
    "Hola, ¿dónde está mi pedido?",
    "Track my order, please. I only need to know where it is, not shopping recommendations or human contact.",
  ].entries()) {
    const displayOrder = (index + 1) * 100;
    const message = await insertMessage(db, { sessionId, guestSessionId: guestId, characterId: guest.mascot_character_id,
      senderType: "user", senderLabel: "You", contentType: "text", text, displayOrder, sourceType: "guest", sourceRef: "order-action-runtime-check" });
    const releaseLock = await acquireDedicatedDbAdvisoryLock(`guest_reply:${guestId}`.slice(0, 64), 30);
    const startedAt = Date.now();
    try {
      await ensureGuestReply({ token, prepared: { guest, message, text, attachments: [], promptBeforeDisplayOrder: displayOrder } });
    } finally { await releaseLock(); }
    const [rows] = await db.execute("SELECT m.content_type,m.text_content,m.source_ref,v.transcript AS speech_text,v.asset_status FROM chat_messages m LEFT JOIN character_voice_assets v ON v.id=m.voice_asset_id WHERE m.session_id=? AND m.display_order>? AND m.sender_type='character' ORDER BY m.display_order", [sessionId, displayOrder]);
    const reply = rows.find((row) => row.content_type === "text");
    console.log(JSON.stringify({ index, reply: reply?.text_content, sourceRef: reply?.source_ref, decisions: providerDecisions.splice(0) }));
    assert(reply?.text_content, "reply must persist");
    assert(!rows.some((row) => row.content_type === "product"), "no unsolicited card for policy or refused shopping");
    assert.equal(rows.filter((row) => row.content_type === "order_action").length, 1, "One actual login/order action must persist");
    assert(!rows.some((row) => row.content_type === "feedback_action"), "Order lookup alone must not add a generic contact handoff when its real entry is available");
    if (reply.source_ref === "reply-boundary-guard") {
      const { getChatOrderEntryCopy } = await import("../shared/chat-order-copy.js");
      assert.equal(reply.text_content, getChatOrderEntryCopy("es", "login_required"), "A rejected candidate must explain the real order action");
    }
    else assert.match(reply.text_content, /inicia(?:r)? sesi[oó]n|iniciar sesi[oó]n|acceder|entrar|con[eé]ctate|login/i, "Spanish body must explain the actual guest access step");
    assert.doesNotMatch(reply.text_content, /p[aá]gina (?:web )?(?:de|del) (?:transportista|seguimiento)|contacta(?:r)? (?:con |a )?(?:el |la )?(?:soporte|tienda)|direcci[oó]n de entrega|men[uú] superior|esquina superior/i, "No external tracking/support detour or invented navigation");
    if (index === 1) assert(!rows.some((row) => row.content_type === "feedback_action"), "Contact refusal remains respected");
    const beforeRetry = rows.length;
    const retryLock = await acquireDedicatedDbAdvisoryLock(`guest_reply:${guestId}`.slice(0, 64), 30);
    try { await ensureGuestReply({ token, prepared: { guest, message, text, attachments: [], promptBeforeDisplayOrder: displayOrder } }); }
    finally { await retryLock(); }
    const [[retryCount]] = await db.execute("SELECT COUNT(*) AS total FROM chat_messages WHERE session_id=? AND display_order>? AND sender_type='character'", [sessionId, displayOrder]);
    assert.equal(Number(retryCount.total), beforeRetry, "Same turn retry must not duplicate the order card or reply");
    assert.equal(stripTtsControlTags(reply.speech_text).replace(/\s+/g, " ").trim(), reply.text_content.replace(/\s+/g, " ").trim(), "stored voice wording must match the visible answer (delivery tags may differ)");
    assert.equal(reply.asset_status, "pending", "no audio generated in this check");
    results.push({ text, reply: reply.text_content, contentTypes: rows.map((row) => row.content_type), elapsedMs: Date.now() - startedAt });
    console.log(JSON.stringify(results.at(-1)));
    console.log(JSON.stringify({ decisions: providerDecisions.splice(0) }));
  }
} finally {
  globalThis.fetch = originalFetch;
  const [assets] = await db.execute("SELECT v.id FROM character_voice_assets v INNER JOIN chat_messages m ON m.id=v.message_id WHERE m.session_id=?", [sessionId]);
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id=?", [guestId]);
  await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id=?", [guestId]);
  await db.execute("DELETE FROM chat_sessions WHERE id=?", [sessionId]);
  for (const asset of assets) await db.execute("DELETE FROM character_voice_assets WHERE id=?", [asset.id]);
  await db.execute("DELETE FROM guest_sessions WHERE id=?", [guestId]);
  const [[remaining]] = await db.execute("SELECT (SELECT COUNT(*) FROM chat_sessions WHERE id=?) + (SELECT COUNT(*) FROM guest_sessions WHERE id=?) AS total", [sessionId, guestId]);
  assert.equal(Number(remaining.total), 0, "runtime fixtures must be removed");
  await closeDbPool();
  await closeDbAdvisoryLockPool();
}
if (process.env.ORDER_ACTION_RUNTIME_REPORT) await writeFile(process.env.ORDER_ACTION_RUNTIME_REPORT, JSON.stringify({ results, cleanup: "passed", audioGenerated: false }, null, 2));
console.log("order action local reply runtime check passed; temporary guest, messages and voice reservations cleaned");
