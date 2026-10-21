import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// A first guest session reserves an opening voice asset. Keep this focused
// database-chain check deterministic and free of paid provider calls.
process.env.ELEVENLABS_API_KEY = "";

const { getDbPool, closeDbPool } = await import("../server/db.js");
const {
  createExternalSourceHandoffToken,
  normalizeExternalSourcePage,
  parseExternalSourceContext,
} = await import("../server/external-source-context-service.js");
const { getOrCreateGuestSessionRecord } = await import("../server/guest-session-service.js");
const { buildGuestNetworkHash } = await import("../server/guest-network-rate-limit-service.js");
const { createToken, hashSessionToken } = await import("../server/security.js");
const { assertLocalMutatingSelfCheckEnvironment } = await import("./self-check-environment-guard.mjs");

await assertLocalMutatingSelfCheckEnvironment({ label: "external source guest session self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const testIp = `198.51.100.${(Number.parseInt(suffix.slice(0, 2), 16) % 200) + 1}`;
const networkHash = buildGuestNetworkHash({
  socket: { remoteAddress: "127.0.0.1" },
  headers: { "x-forwarded-for": testIp },
});
const rawToken = createToken();
let site = null;
let createdGuestId = "";
let createdSessionId = "";

try {
  const [[siteRow]] = await db.execute(`
    SELECT s.id, s.slug, COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id
    FROM sites s
    LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
    WHERE s.slug = 'camisetasfutbol'
      AND s.site_status = 'active'
      AND s.guest_chat_enabled = 1
    LIMIT 1
  `);
  site = siteRow || null;
  assert.ok(site?.id && site.slug && site.mascot_character_id, "需要 camisetasfutbol 的游客前台配置");

  const sourceOrigin = "https://www.camisetasfutbol.mx";
  const page = normalizeExternalSourcePage({
    sourceUrl: `${sourceOrigin}/productdetail/Runtime-Shirt/623621?self_check=1`,
    sourceTitle: "Runtime Shirt",
    expectedOrigin: sourceOrigin,
  });
  const handoff = createExternalSourceHandoffToken({
    publicId: `self-check-${suffix}`,
    siteId: site.id,
    siteSlug: site.slug,
    mascotCharacterId: site.mascot_character_id,
    sourceOrigin,
    page,
  });
  assert.ok(handoff);

  const result = await getOrCreateGuestSessionRecord({
    token: "",
    siteSlug: site.slug,
    handoff,
    networkHash,
    access: { ip: testIp, region: "ZZ" },
    recoverExistingGuest: async () => {},
  });
  assert.equal(result.created, true);
  createdGuestId = result.guest.id;
  createdSessionId = result.guest.chat_session_id;

  const [[stored]] = await db.execute(
    "SELECT external_source_context_json FROM guest_sessions WHERE id = ? LIMIT 1",
    [createdGuestId]
  );
  const context = parseExternalSourceContext(stored?.external_source_context_json);
  assert.equal(context?.sourceProductId, "623621");
  assert.equal(context?.sourcePageUrl, `${sourceOrigin}/productdetail/Runtime-Shirt/623621`);

  const refreshedPage = normalizeExternalSourcePage({
    sourceUrl: `${sourceOrigin}/productdetail/Refreshed-Shirt/987654?self_check=1`,
    sourceTitle: "Refreshed Shirt",
    expectedOrigin: sourceOrigin,
  });
  const refreshedHandoff = createExternalSourceHandoffToken({
    publicId: `self-check-refresh-${suffix}`,
    siteId: site.id,
    siteSlug: site.slug,
    mascotCharacterId: site.mascot_character_id,
    sourceOrigin,
    page: refreshedPage,
  });
  const refreshed = await getOrCreateGuestSessionRecord({
    token: result.token,
    siteSlug: site.slug,
    handoff: refreshedHandoff,
    networkHash,
    access: { ip: testIp, region: "ZZ" },
    recoverExistingGuest: async () => {},
  });
  assert.equal(refreshed.created, false, "re-entry with the same guest cookie must reuse the session");
  const [[refreshedStored]] = await db.execute(
    "SELECT external_source_context_json FROM guest_sessions WHERE id = ? LIMIT 1",
    [createdGuestId]
  );
  const refreshedContext = parseExternalSourceContext(refreshedStored?.external_source_context_json);
  assert.equal(refreshedContext?.sourceProductId, "987654", "每次重新进入都必须更新来源商品");
  assert.equal(refreshedContext?.sourcePageUrl, `${sourceOrigin}/productdetail/Refreshed-Shirt/987654`);
  console.info("[external-source-guest-session-self-check] passed");
} finally {
  const [guestRows] = await db.execute(
    "SELECT id, chat_session_id FROM guest_sessions WHERE id = ? OR token_hash = ?",
    [createdGuestId || "", hashSessionToken(rawToken)]
  ).catch(() => [[]]);
  const rows = guestRows.length ? guestRows : (createdGuestId ? [{ id: createdGuestId, chat_session_id: createdSessionId }] : []);
  for (const row of rows) {
    await db.execute(
      "DELETE FROM character_voice_assets WHERE message_id IN (SELECT id FROM chat_messages WHERE guest_session_id = ?)",
      [row.id]
    ).catch(() => {});
    await db.execute("DELETE FROM mascot_greeting_message_deliveries WHERE session_id = ?", [row.chat_session_id]).catch(() => {});
    await db.execute("DELETE FROM chat_messages WHERE guest_session_id = ?", [row.id]).catch(() => {});
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [row.id]).catch(() => {});
    await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id = ?", [row.id]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE id = ?", [row.chat_session_id]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [row.id]).catch(() => {});
  }
  if (site?.id) {
    await db.execute("DELETE FROM guest_network_rate_limits WHERE network_hash = ? AND site_id = ?", [networkHash, site.id]).catch(() => {});
  }
  await closeDbPool();
}
