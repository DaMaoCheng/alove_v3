import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { createSiteExternalEmbedsTableIfMissing } from "../server/db-bootstrap-external-embed-tables.js";
import { createExternalEmbedHandoff, getPublicExternalEmbed, installerSnippet, listAdminExternalEmbeds, saveAdminExternalEmbed } from "../server/external-embed-service.js";
import { parseExternalSourceHandoffToken } from "../server/external-source-context-service.js";

await createSiteExternalEmbedsTableIfMissing();
const db = getDbPool();
const [titleColumns] = await db.execute(`
  SELECT COLUMN_DEFAULT
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'site_external_embeds' AND column_name = 'title'
  LIMIT 1
`);
assert.equal(titleColumns[0]?.COLUMN_DEFAULT, "Chat with AIOVE", "已有表必须兼容迁移到统一的标题默认值");
const [sites] = await db.execute(`
  SELECT s.id, s.site_url
  FROM sites s
  LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
  LEFT JOIN ai_characters mascot ON mascot.id = COALESCE(ms.character_id, s.mascot_character_id)
  WHERE s.site_status = 'active'
    AND s.guest_chat_enabled = 1
    AND s.product_api_url LIKE 'ttmall:%'
    AND mascot.category_id = 'mascot'
    AND mascot.visibility = 'public'
    AND mascot.character_status = 'published'
  ORDER BY s.created_at ASC
  LIMIT 1
`);
const siteId = sites[0]?.id;
const originalSiteUrl = sites[0]?.site_url ?? null;
assert.ok(siteId, "需要至少一个启用了游客聊天的公开前台站点才能执行外嵌链路自检");

const [backupRows] = await db.execute("SELECT * FROM site_external_embeds WHERE site_id = ? LIMIT 1", [siteId]);
const backup = backupRows[0] || null;
try {
  await db.execute(
    "UPDATE sites SET site_url = ? WHERE id = ?",
    ["https://embed-autofill.example.test/catalog?source=self-check", siteId]
  );
  await db.execute("DELETE FROM site_external_embeds WHERE site_id = ?", [siteId]);
  const draft = (await listAdminExternalEmbeds()).items.find((item) => item.siteId === siteId);
  assert.ok(draft?.config, "无配置站点也必须由服务端返回完整草稿配置");
  assert.equal(draft.config.status, "draft");
  assert.equal(draft.config.title, "Chat with AIOVE");
  assert.deepEqual(draft.config.titleRichText, []);
  assert.equal(draft.config.installerSnippet, "");
  assert.equal(draft.config.externalOrigin, "https://embed-autofill.example.test", "草稿 Origin 必须从网站链接的根域名自动提取");
  assert.equal(draft.config.externalOriginSource, "site_url");
  const saved = await saveAdminExternalEmbed(siteId, {
    externalOrigin: "https://0.0.0.1",
    status: "published",
    launcherImageUrl: "",
    showBadge: true,
    title: "Local external chat",
    titleRichText: [
      { start: 6, end: 14, color: "#00E95C" },
      { start: 0, end: 3, color: "not-a-color" },
      { start: 12, end: 30, color: "#ABCDEF" },
    ],
    showBeta: true,
    betaText: "BETA",
    description: "A safe local external-widget verification.",
    descriptionRichText: [{ start: 2, end: 6, color: "#ABCDEF" }, { start: 4, end: 8, color: "#00E95C" }],
    ctaText: "Start chat",
    accentColor: "#00E95C",
    surfaceColor: "#101312",
    textColor: "#FFFFFF",
    cornerRadiusPx: 22,
    desktopRightPx: 24,
    desktopBottomPx: 84,
    mobileRightPx: 16,
    mobileBottomPx: 84,
  });
  assert.equal(saved.item.config.status, "published");
  assert.equal(saved.item.config.externalOrigin, "https://embed-autofill.example.test", "临时地址保存时必须回退为本站网站链接 Origin");
  assert.ok(saved.item.config.publicId);
  assert.equal(saved.item.config.installerSnippet, installerSnippet(saved.item.config.publicId));
  assert.match(saved.item.config.installerSnippet, /^<script>\n\(function \(\) \{\n  var s = document\.createElement\("script"\);\n  s\.src = "https?:\/\/[^\"]+\/embed\/v1\.js";\n  s\.async = true;\n  s\.setAttribute\("data-aiove-embed", "[^\"]+"\);\n  document\.head\.appendChild\(s\);\n\}\)\(\);\n<\/script>$/);
  assert.match(saved.item.config.installerSnippet, /document\.head\.appendChild\(s\)/, "安装代码必须通过 document.head 动态注入，兼容 GTM 自定义 HTML");
  assert.equal(saved.item.config.installerSnippet.includes("\\/script"), false, "安装代码不能包含转义反斜杠，必须可直接粘贴到 HTML");

  const widget = await getPublicExternalEmbed(saved.item.config.publicId, "https://embed-autofill.example.test");
  assert.ok(widget, "绑定 Origin 必须能读取已发布挂件");
  assert.equal(widget.content.title, "Local external chat");
  assert.equal(widget.sourceContextEnabled, true, "TTMall 标准挂件必须启用来源交接");
  assert.deepEqual(widget.content.titleRichText, [{ start: 6, end: 14, color: "#00E95C" }]);
  assert.deepEqual(widget.content.descriptionRichText, [{ start: 2, end: 6, color: "#ABCDEF" }]);
  assert.match(widget.ctaUrl, /\/chat\?agent=/);
  assert.equal(Object.hasOwn(widget, "externalOrigin"), false, "公开配置不能回传外站配置或后台字段");
  assert.equal(await getPublicExternalEmbed(saved.item.config.publicId, "https://embed-other.example.test"), null, "错误 Origin 不能读取配置");
  const handoff = await createExternalEmbedHandoff({
    publicId: saved.item.config.publicId,
    requestOrigin: "https://embed-autofill.example.test",
    sourceUrl: "https://embed-autofill.example.test/productdetail/Runtime-Shirt/623621?utm_source=self-check#sizes",
    sourceTitle: "Runtime Shirt",
  });
  const decodedHandoff = parseExternalSourceHandoffToken(handoff?.token);
  assert.equal(decodedHandoff?.siteId, siteId);
  assert.equal(decodedHandoff?.sourcePageUrl, "https://embed-autofill.example.test/productdetail/Runtime-Shirt/623621", "来源上下文不得保存查询参数或 hash");
  assert.equal(decodedHandoff?.sourceProductId, "623621");
  assert.equal(await createExternalEmbedHandoff({
    publicId: saved.item.config.publicId,
    requestOrigin: "https://embed-autofill.example.test",
    sourceUrl: "https://evil.example/productdetail/Runtime-Shirt/623621",
  }), null, "来源 URL 与配置 Origin 不一致时不能签发 handoff");
  await assert.rejects(
    () => saveAdminExternalEmbed(siteId, { externalOrigin: "http://192.168.0.10", status: "draft" }),
    /外部站点/
  );
  await assert.rejects(
    () => saveAdminExternalEmbed(siteId, { externalOrigin: "http://[fc00::1]", status: "draft" }),
    /外部站点/
  );
  await assert.rejects(
    () => saveAdminExternalEmbed(siteId, { externalOrigin: "http://127.0.0.1:4174", launcherImageUrl: "http://example.com/widget.png", status: "draft" }),
    /挂件图标/
  );
  await assert.rejects(
    () => saveAdminExternalEmbed(siteId, { externalOrigin: "http://127.0.0.1:4174", status: "invalid" }),
    /挂件状态/
  );
  const manuallyConfigured = await saveAdminExternalEmbed(siteId, {
    externalOrigin: "https://manual-embed-origin.example.test",
    status: "draft",
  });
  assert.equal(manuallyConfigured.item.config.externalOrigin, "https://manual-embed-origin.example.test", "有效手动 Origin 不能被网站链接覆盖");
  const manualDraft = (await listAdminExternalEmbeds()).items.find((item) => item.siteId === siteId);
  assert.equal(manualDraft?.config.externalOrigin, "https://manual-embed-origin.example.test");
  assert.equal(manualDraft?.config.externalOriginSource, "saved");
} finally {
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
  await db.execute("UPDATE sites SET site_url = ? WHERE id = ?", [originalSiteUrl, siteId]);
  await closeDbPool();
}

console.info("[external-embed-service-self-check] passed");
