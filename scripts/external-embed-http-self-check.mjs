import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool } from "../server/db.js";
import { addGuestExternalSourceContextColumnIfMissing } from "../server/db-column-migrations.js";
import { saveAdminExternalEmbed } from "../server/external-embed-service.js";
import { parseExternalSourceContext, parseExternalSourceHandoffToken } from "../server/external-source-context-service.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { GUEST_COOKIE_NAME } from "../server/guest-session-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

const baseUrl = String(process.env.EXTERNAL_EMBED_BASE_URL || "http://127.0.0.1:4175").replace(/\/+$/, "");
const allowedOrigin = "http://127.0.0.1:4174";
await assertLocalMutatingSelfCheckEnvironment({ label: "external embed HTTP self-check", baseUrl });
await addGuestExternalSourceContextColumnIfMissing();
const db = getDbPool();
const [sites] = await db.execute(`
  SELECT s.id, s.slug, COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id
  FROM sites s
  LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
  LEFT JOIN ai_characters mascot ON mascot.id = COALESCE(ms.character_id, s.mascot_character_id)
  WHERE s.site_status = 'active' AND s.guest_chat_enabled = 1
    AND mascot.category_id = 'mascot' AND mascot.visibility = 'public' AND mascot.character_status = 'published'
    AND s.product_api_url LIKE 'ttmall:%'
  ORDER BY s.created_at ASC LIMIT 1
`);
const siteId = sites[0]?.id;
const siteSlug = sites[0]?.slug;
const mascotCharacterId = sites[0]?.mascot_character_id;
assert.ok(siteId, "需要一个启用了游客聊天的公开前台站点");
const [backupRows] = await db.execute("SELECT * FROM site_external_embeds WHERE site_id = ? LIMIT 1", [siteId]);
const backup = backupRows[0] || null;
const suffix = randomUUID().replaceAll("-", "");
const guestId = `guest_embed_source_${suffix}`.slice(0, 64);
const chatSessionId = `chat_embed_source_${suffix}`.slice(0, 64);
const guestToken = createToken();

try {
  const saved = await saveAdminExternalEmbed(siteId, {
    externalOrigin: allowedOrigin,
    status: "published",
    title: "HTTP verification",
    titleRichText: [{ start: 5, end: 9, color: "#00E95C" }],
    description: "Verify a published external widget over the running server.",
    descriptionRichText: [{ start: 7, end: 16, color: "#ABCDEF" }],
    ctaText: "Start chat",
    accentColor: "#00E95C",
    surfaceColor: "#101312",
    textColor: "#FFFFFF",
  });
  const publicId = saved.item.config.publicId;
  const allowed = await fetch(`${baseUrl}/api/embed/config?embed=${encodeURIComponent(publicId)}`, {
    headers: { Origin: allowedOrigin, Accept: "application/json" },
  });
  const allowedPayload = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(allowed.headers.get("vary"), "Origin");
  assert.equal(allowedPayload.widget.content.title, "HTTP verification");
  assert.deepEqual(allowedPayload.widget.content.titleRichText, [{ start: 5, end: 9, color: "#00E95C" }]);
  assert.ok(allowedPayload.widget.ctaUrl.startsWith(`${baseUrl}/`), "CTA 必须使用运行中 ALOVE 公共地址");
  assert.equal(Object.hasOwn(allowedPayload.widget, "externalOrigin"), false);

  const preflight = await fetch(`${baseUrl}/api/embed/handoff`, {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.match(preflight.headers.get("access-control-allow-methods") || "", /POST/);

  const sourceUrl = `${allowedOrigin}/productdetail/Runtime-Shirt/623621?utm_source=self-check#sizes`;
  const handoffResponse = await fetch(`${baseUrl}/api/embed/handoff`, {
    method: "POST",
    headers: { Origin: allowedOrigin, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ embed: publicId, sourceUrl, sourceTitle: "Runtime Shirt" }),
  });
  const handoffPayload = await handoffResponse.json();
  assert.equal(handoffResponse.status, 200);
  assert.equal(handoffResponse.headers.get("access-control-allow-origin"), allowedOrigin);
  const decodedHandoff = parseExternalSourceHandoffToken(handoffPayload.handoff);
  assert.equal(decodedHandoff?.siteId, siteId);
  assert.equal(decodedHandoff?.sourceProductId, "623621");
  assert.equal(decodedHandoff?.sourcePageUrl, `${allowedOrigin}/productdetail/Runtime-Shirt/623621`);

  const deniedHandoff = await fetch(`${baseUrl}/api/embed/handoff`, {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4176", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ embed: publicId, sourceUrl, sourceTitle: "Runtime Shirt" }),
  });
  assert.equal(deniedHandoff.status, 404, "错误 Origin 不能签发来源 handoff");
  assert.equal(deniedHandoff.headers.get("access-control-allow-origin"), null);

  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guestId, hashSessionToken(guestToken), siteId, mascotCharacterId, chatSessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'External source HTTP check', 'active', 'guest', 'external-source-http-check', NOW(3))`,
    [chatSessionId, guestId, mascotCharacterId]
  );
  await db.execute(
    `INSERT INTO guest_character_sessions (
       guest_session_id, character_id, chat_session_id,
       message_window_started_at, message_window_count, rate_window_started_at, rate_window_count
     ) VALUES (?, ?, ?, NULL, 0, NULL, 0)`,
    [guestId, mascotCharacterId, chatSessionId]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);

  const guestSessionResponse = await fetch(
    `${baseUrl}/api/guest/session?siteSlug=${encodeURIComponent(siteSlug)}&characterId=${encodeURIComponent(mascotCharacterId)}&handoff=${encodeURIComponent(handoffPayload.handoff)}`,
    {
      headers: {
        Origin: baseUrl,
        Accept: "application/json",
        Cookie: `${GUEST_COOKIE_NAME}=${encodeURIComponent(guestToken)}`,
      },
    }
  );
  const guestSessionPayload = await guestSessionResponse.json();
  assert.equal(guestSessionResponse.status, 200, JSON.stringify(guestSessionPayload));
  assert.equal(guestSessionPayload.guest?.siteSlug, siteSlug);
  const [[storedGuest]] = await db.execute(
    "SELECT external_source_context_json FROM guest_sessions WHERE id = ? LIMIT 1",
    [guestId]
  );
  const storedContext = parseExternalSourceContext(storedGuest?.external_source_context_json);
  assert.equal(storedContext?.sourceProductId, "623621", "访客会话必须落库经验证的来源商品上下文");
  assert.equal(storedContext?.sourcePageUrl, `${allowedOrigin}/productdetail/Runtime-Shirt/623621`);

  const denied = await fetch(`${baseUrl}/api/embed/config?embed=${encodeURIComponent(publicId)}`, {
    headers: { Origin: "http://127.0.0.1:4175", Accept: "application/json" },
  });
  assert.equal(denied.status, 404, "错误 Origin 不能读取公开配置");
  assert.equal(denied.headers.get("access-control-allow-origin"), null);

  const loader = await fetch(`${baseUrl}/embed/v1.js`);
  const source = await loader.text();
  assert.equal(loader.status, 200);
  assert.match(loader.headers.get("content-type") || "", /text\/javascript/);
  assert.match(source, /data-aiove-external-widget/);
} finally {
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [chatSessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [chatSessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM site_external_embeds WHERE site_id = ?", [siteId]);
  if (backup) {
    await db.execute(`
      INSERT INTO site_external_embeds (
        id, public_id, site_id, external_origin, embed_status, launcher_image_url, show_badge,
        desktop_right_px, desktop_bottom_px, mobile_right_px, mobile_bottom_px,
        accent_color, surface_color, text_color, corner_radius_px, title, show_beta, beta_text,
        title_rich_text, description, description_rich_text, cta_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [backup.id, backup.public_id, backup.site_id, backup.external_origin, backup.embed_status, backup.launcher_image_url,
        backup.show_badge, backup.desktop_right_px, backup.desktop_bottom_px, backup.mobile_right_px, backup.mobile_bottom_px,
        backup.accent_color, backup.surface_color, backup.text_color, backup.corner_radius_px, backup.title, backup.show_beta,
        backup.beta_text, backup.title_rich_text, backup.description, backup.description_rich_text, backup.cta_text,
        backup.created_at, backup.updated_at]
    );
  }
  await closeDbPool();
}

console.info("[external-embed-http-self-check] passed");
