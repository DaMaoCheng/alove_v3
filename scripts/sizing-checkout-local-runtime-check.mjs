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
await assertLocalMutatingSelfCheckEnvironment({ label: "sizing/checkout local reply runtime check" });
configureNetworkProxy();
const db = getDbPool();
const suffix = randomUUID();
const guestId = `guest_checkout_check_${suffix}`;
const sessionId = `chat_checkout_check_${suffix}`;
const token = randomUUID();
const results = [];
const measurementOnly = process.argv.includes("--measurement");
const providerDecisions = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  let response;
  try { response = await originalFetch(url, options); }
  catch (error) {
    try { if (JSON.parse(options.body || '{}').messages?.[0]?.content?.startsWith('Interpret only')) providerDecisions.push({ type: 'commerce', failed: error.name || 'request_error' }); } catch {}
    throw error;
  }
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
  await db.execute("INSERT INTO chat_sessions (id,internal_uid,guest_session_id,character_id,session_title,session_status,source_type,source_ref,preferred_language,last_message_at) VALUES (?,NULL,?,?,'Sizing/checkout runtime check','active','guest','sizing-checkout-runtime-check','Spanish',NOW(3))",
    [sessionId, guestId, site.mascot_character_id]);
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
  const guest = await requireGuestCharacter(token);
  for (const [index, text] of (measurementOnly ? [
    "¿Cómo se maneja el tamaño de las playeras? ¿Son un poco más pequeñas?",
    "Gracias, al parecer es 45 cm.",
    "Son 45 centímetros de lado a lado con la playera en plano, no el contorno de mi cuerpo. No tengo un modelo concreto todavía.",
  ] : [
    "No puedo completar la compra y no he enviado ningun pedido. Solo necesito terminar esta compra.",
    "Se bloquea despues de escribir la direccion al pulsar continuar; el pedido todavia no se ha enviado.",
    "Aparece Error 409. Ya cambie de navegador y volvi a escribir la direccion, pero el mismo error sigue. No quiero que me contacten ni recomendaciones.",
    "Ahora si quiero contactar al equipo: acepto enviar mi consulta por el formulario de comentarios para que una persona revise este error de compra.",
    "En la tabla de tallas de esta camiseta, cuanto mide el pecho de la talla M y en que unidad esta expresado?",
  ]).entries()) {
    if (process.argv.includes("--sizing-only") && index !== 4) continue;
    const displayOrder = (index + 1) * 100;
    if (index === 4) {
      await insertMessage(db, { sessionId, guestSessionId: guestId, characterId: guest.mascot_character_id,
        senderType: "character", senderLabel: "Test product fixture", contentType: "product", text: "",
        product: { id: "sizing_runtime_fixture", productId: "sizing_runtime_fixture", name: "Sizing runtime fixture shirt", siteId: site.id, siteSlug: "projerseyshop", url: "https://projerseyshop.cc/products/sizing-runtime-fixture", sizes: [{ label: "M", available: true }], sizeChartResolved: true,
          sizeChart: { title: "Garment chest circumference", unit: "CM", columns: ["Size", "Chest circumference"], rows: [["M", "104"]] } },
        displayOrder: displayOrder - 10, sourceType: "system", sourceRef: "sizing-runtime-fixture" });
    }
    const message = await insertMessage(db, { sessionId, guestSessionId: guestId, characterId: guest.mascot_character_id,
      senderType: "user", senderLabel: "You", contentType: "text", text, displayOrder, sourceType: "guest", sourceRef: "sizing-checkout-runtime-check" });
    const releaseLock = await acquireDedicatedDbAdvisoryLock(`guest_reply:${guestId}`.slice(0, 64), 30);
    const startedAt = Date.now();
    try {
      await ensureGuestReply({ token, prepared: { guest, message, text, attachments: [], promptBeforeDisplayOrder: displayOrder } });
    } finally { await releaseLock(); }
    const [rows] = await db.execute("SELECT m.content_type,m.text_content,v.transcript AS speech_text,v.asset_status FROM chat_messages m LEFT JOIN character_voice_assets v ON v.id=m.voice_asset_id WHERE m.session_id=? AND m.display_order>? AND m.sender_type='character' ORDER BY m.display_order", [sessionId, displayOrder]);
    const reply = rows.find((row) => row.content_type === "text");
    console.log(JSON.stringify({ index, reply: reply?.text_content, contentTypes: rows.map((row) => row.content_type), decisions: providerDecisions.splice(0) }));
    assert(reply?.text_content, "reply must persist");
    if (measurementOnly) {
      assert.doesNotMatch(reply.text_content, /esas condiciones|canal de atenci[oó]n|talla muy peque[nñ]a|un poco corta|quedarte (?:bastante )?ajustada/i, "sizing continuity cannot become unrelated support or an unsupported fit claim");
      assert(!rows.some(row => row.content_type === "feedback_action"), "ordinary sizing clarification does not require human handoff");
      if (index > 0) assert.match(reply.text_content, /45|cuarenta y cinco/i, "reply must acknowledge the reported measurement rather than restart or drop the question");
    }
    assert(!rows.some((row) => row.content_type === "product"), "no unsolicited card for policy or refused shopping");
    assert(!rows.some((row) => row.content_type === "order_action"), "checkout assistance must not require order binding");
    if (index === 2) {
      assert(!rows.some((row) => row.content_type === "feedback_action"), "contact refusal wins");
      assert.doesNotMatch(reply.text_content, /prueba (?:con )?otro navegador|lo m\u00e1s probable|es un problema t\u00e9cnico|indica un conflicto|puede deberse|es probable|tu direccion (?:es incorrecta|esta mal)|ya (?:he|hemos) (?:corregido|solucionado)/i, "no repeated failed suggestion or claimed diagnosis/fix");
    }
    if (index === 1) assert(!rows.some((row) => row.content_type === "feedback_action"), "normal continuation click is not a failed corrective attempt");
    if (index === 3) assert.equal(rows.filter((row) => row.content_type === "feedback_action").length, 1, "explicit human request persists real feedback form");
    if (index === 4) {
      assert(!rows.some((row) => row.content_type === "feedback_action"), "verified chart answer must not add unsolicited feedback");
      assert.match(reply.text_content, /104/, "real model must answer using supplied chart measurement");
      assert.match(reply.text_content, /cm|centimetro|cent\u00edmetro/i, "real model must preserve explicit chart unit");
    }
    assert.doesNotMatch(reply.text_content, /menu superior|esquina superior|conectado con|ya he enviado|ya he remitido/i, "no invented navigation or completed human connection");
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
if (process.env.SIZING_CHECKOUT_RUNTIME_REPORT) await writeFile(process.env.SIZING_CHECKOUT_RUNTIME_REPORT, JSON.stringify({ results, cleanup: "passed", audioGenerated: false }, null, 2));
console.log("sizing/checkout local reply runtime check passed; temporary guest, messages and voice reservations cleaned");
