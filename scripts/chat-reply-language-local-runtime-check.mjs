import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

if (!process.argv.includes("--real")) {
  console.log("Skipped: --real enables local DB/text-provider verification; no audio/image generation.");
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
await assertLocalMutatingSelfCheckEnvironment({ label: "reply language local runtime check" });
configureNetworkProxy();
const db = getDbPool(), results = [], guests = [], decisions = [];
let runtimeError = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const response = await originalFetch(url, options);
  try {
    const input = JSON.parse(options.body || "{}");
    const instruction = input.messages?.[0]?.content || "";
    if (instruction.startsWith("Interpret only the commerce purpose") || instruction.startsWith("Review a proposed response")) {
      const payload = await response.clone().json();
      const reviewInput = instruction.startsWith("Review") ? JSON.parse(input.messages?.at(-1)?.content || "{}") : null;
      decisions.push({ type: instruction.startsWith("Interpret") ? "commerce" : "review", proposedResponse: reviewInput?.proposedResponse, result: JSON.parse((payload.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) });
    }
  } catch { /* Read-only diagnostics never change a request or response. */ }
  return response;
};
async function createGuest(site) {
  const suffix = randomUUID(), id = `guest_language_check_${suffix}`, sessionId = `chat_language_check_${suffix}`, token = randomUUID();
  const fixture = { id, sessionId, token, order: 100 };
  guests.push(fixture);
  await db.execute("INSERT INTO guest_sessions (id,token_hash,site_id,mascot_character_id,chat_session_id,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))", [id, hashSessionToken(token), site.id, site.mascot_character_id, sessionId]);
  await db.execute("INSERT INTO chat_sessions (id,internal_uid,guest_session_id,character_id,session_title,session_status,source_type,source_ref,preferred_language,last_message_at) VALUES (?,NULL,?,?,'Reply language runtime fixture','active','guest','reply-language-runtime-fixture','Spanish',NOW(3))", [sessionId, id, site.mascot_character_id]);
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [id]);
  fixture.guest = await requireGuestCharacter(token);
  return fixture;
}
async function turn(fixture, text, label) {
  const order = fixture.order; fixture.order += 100;
  const message = await insertMessage(db, { sessionId: fixture.sessionId, guestSessionId: fixture.id, characterId: fixture.guest.mascot_character_id,
    senderType: "user", senderLabel: "You", contentType: "text", text, displayOrder: order, sourceType: "guest", sourceRef: "reply-language-runtime-fixture" });
  const unlock = await acquireDedicatedDbAdvisoryLock(`guest_reply:${fixture.id}`.slice(0, 64), 30), start = Date.now();
  try { await ensureGuestReply({ token: fixture.token, prepared: { guest: fixture.guest, message, text, attachments: [], promptBeforeDisplayOrder: order } }); }
  finally { await unlock(); }
  const [rows] = await db.execute("SELECT m.content_type,m.text_content,m.source_ref,v.transcript AS speech_text,v.asset_status FROM chat_messages m LEFT JOIN character_voice_assets v ON v.id=m.voice_asset_id WHERE m.session_id=? AND m.display_order>? AND m.sender_type='character' ORDER BY m.display_order", [fixture.sessionId, order]);
  const reply = rows.find((r) => r.content_type === "text");
  assert(reply?.text_content, "actual reply must persist");
  assert.equal(stripTtsControlTags(reply.speech_text).replace(/\s+/g, " "), reply.text_content.replace(/\s+/g, " "), "voice reservation must contain the same answer without generating audio");
  assert.equal(reply.asset_status, "pending", "audio generation is outside this test");
  const result = { label, text, reply: reply.text_content, contentTypes: rows.map((r) => r.content_type), elapsedMs: Date.now() - start, decisions: decisions.splice(0) };
  results.push(result); console.log(JSON.stringify(result));
  return { rows, reply: reply.text_content };
}
try {
  const [[site]] = await db.execute("SELECT s.id,s.mascot_character_id,c.name AS mascot_name FROM sites s JOIN ai_characters c ON c.id=s.mascot_character_id WHERE s.slug='projerseyshop' AND s.guest_chat_enabled=1 LIMIT 1");
  assert(site?.mascot_character_id, "PJ local mascot is required");
  const guest = await createGuest(site);
  for (const [text, language] of [["English", "English"], ["Hola, hoy quiero charlar sobre cómo ha ido mi día.", "English"], ["Magyar", "Hungarian"], ["Ma kicsit fáradt vagyok, de örülök, hogy beszélgethetünk.", "Hungarian"]]) {
    await turn(guest, text, `language-${language}`);
    const [[session]] = await db.execute("SELECT preferred_language FROM chat_sessions WHERE id=?", [guest.sessionId]);
    assert.equal(session.preferred_language, language, "short selection persists; ordinary foreign input does not switch");
    const result = results.at(-1), reviewed = result.decisions.find((d) => d.type === "review");
    assert(reviewed?.result?.languageQualitySupported === true && reviewed.result.allowed === true && reviewed.result.confidence >= .8,
      "a normal real conversation must pass output-language review rather than only prove fallback safety");
    assert(!result.contentTypes.includes("product"), "language selection and social chat do not request merchandise");
  }
} catch (error) {
  runtimeError = { name: error.name, message: error.message };
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  for (const fixture of guests) {
    const [assets] = await db.execute("SELECT v.id FROM character_voice_assets v INNER JOIN chat_messages m ON m.id=v.message_id WHERE m.session_id=?", [fixture.sessionId]);
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id=?", [fixture.id]);
    await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id=?", [fixture.id]);
    await db.execute("DELETE FROM chat_sessions WHERE id=?", [fixture.sessionId]);
    for (const asset of assets) await db.execute("DELETE FROM character_voice_assets WHERE id=?", [asset.id]);
    await db.execute("DELETE FROM guest_sessions WHERE id=?", [fixture.id]);
    const [[remaining]] = await db.execute("SELECT (SELECT COUNT(*) FROM chat_sessions WHERE id=?) + (SELECT COUNT(*) FROM guest_sessions WHERE id=?) + (SELECT COUNT(*) FROM chat_image_assets WHERE session_id=?) AS n", [fixture.sessionId, fixture.id, fixture.sessionId]);
    assert.equal(Number(remaining.n), 0, "temporary messages, guests, images and voice reservations must be cleaned");
  }
  await closeDbPool(); await closeDbAdvisoryLockPool();
  if (process.env.REPLY_LANGUAGE_RUNTIME_REPORT) await writeFile(process.env.REPLY_LANGUAGE_RUNTIME_REPORT, JSON.stringify({ results, status: runtimeError ? "failed" : "passed", error: runtimeError, cleanup: "passed", audioGenerated: false, imageGenerated: false }, null, 2), { mode: 0o600 });
}
console.log("reply language local runtime check passed; temporary fixtures removed; no audio/image generation");
