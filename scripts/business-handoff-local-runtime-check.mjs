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
await assertLocalMutatingSelfCheckEnvironment({ label: "business handoff local reply runtime check" });
configureNetworkProxy();
const db = getDbPool();
const suffix = randomUUID();
const guestId = `guest_business_check_${suffix}`;
const sessionId = `chat_business_check_${suffix}`;
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
  await db.execute("INSERT INTO chat_sessions (id,internal_uid,guest_session_id,character_id,session_title,session_status,source_type,source_ref,preferred_language,last_message_at) VALUES (?,NULL,?,?,'Business runtime check','active','guest','business-runtime-check','Spanish',NOW(3))",
    [sessionId, guestId, site.mascot_character_id]);
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
  const guest = await requireGuestCharacter(token);
  for (const [index, text] of [
    "¿Cómo se determinan los descuentos para pedidos al por mayor? Quiero información sobre la política, no que me des un código.",
    "Quiero negociar las condiciones de dropshipping para mi tienda online. ¿Cómo funciona y puedo hablar con una persona del equipo?",
    "No quiero que me contacten ni recibir recomendaciones. Solo quiero saber si las condiciones de dropshipping están documentadas.",
  ].entries()) {
    const displayOrder = (index + 1) * 100;
    const message = await insertMessage(db, { sessionId, guestSessionId: guestId, characterId: guest.mascot_character_id,
      senderType: "user", senderLabel: "You", contentType: "text", text, displayOrder, sourceType: "guest", sourceRef: "business-runtime-check" });
    const releaseLock = await acquireDedicatedDbAdvisoryLock(`guest_reply:${guestId}`.slice(0, 64), 30);
    const startedAt = Date.now();
    try {
      await ensureGuestReply({ token, prepared: { guest, message, text, attachments: [], promptBeforeDisplayOrder: displayOrder } });
    } finally { await releaseLock(); }
    const [rows] = await db.execute("SELECT m.content_type,m.text_content,v.transcript AS speech_text,v.asset_status FROM chat_messages m LEFT JOIN character_voice_assets v ON v.id=m.voice_asset_id WHERE m.session_id=? AND m.display_order>? AND m.sender_type='character' ORDER BY m.display_order", [sessionId, displayOrder]);
    const reply = rows.find((row) => row.content_type === "text");
    assert(reply?.text_content, "reply must persist");
    assert(!rows.some((row) => row.content_type === "product"), "no unsolicited card for policy or refused shopping");
    if (index === 0) {
      assert.doesNotMatch(reply.text_content, /Discounts are available after|I don.t have a discount code|Use (?:promo )?code/i, "policy explanation must not become a registration/coupon reply");
    }
    if (index === 1) assert.equal(rows.filter((row) => row.content_type === "feedback_action").length, 1, "explicit human business request persists one real form action");
    if (index === 2) assert(!rows.some((row) => row.content_type === "feedback_action"), "contact withdrawal must not add a contact form");
    assert.doesNotMatch(reply.text_content, /menú superior|esquina superior|formulario al final de la página|conectado con|ya he enviado|ya he remitido/i, "no invented navigation or completed human connection");
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
if (process.env.BUSINESS_RUNTIME_REPORT) await writeFile(process.env.BUSINESS_RUNTIME_REPORT, JSON.stringify({ results, cleanup: "passed", audioGenerated: false }, null, 2));
console.log("business handoff local reply runtime check passed; temporary guest, messages and voice reservations cleaned");
