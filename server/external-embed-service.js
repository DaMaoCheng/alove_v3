import { getDbPool, withTransaction } from "./db.js";
import { SERVER_CONFIG } from "./config.js";
import { createId } from "./security.js";
import { parseBoolean, safeString, throwNotFound, throwUserError } from "./admin-site-shared.js";
import { createExternalSourceHandoffToken, normalizeExternalSourcePage } from "./external-source-context-service.js";
import { isTtmallProductSource } from "./product-source-service.js";

const EMBED_STATUS = new Set(["draft", "published"]);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULTS = Object.freeze({
  showBadge: true,
  desktopRightPx: 24,
  desktopBottomPx: 84,
  mobileRightPx: 16,
  mobileBottomPx: 84,
  accentColor: "#00E95C",
  surfaceColor: "#101312",
  textColor: "#FFFFFF",
  cornerRadiusPx: 22,
  title: "Chat with AIOVE",
  showBeta: true,
  betaText: "BETA",
  description: "Talk football. Share life. Anytime, anywhere—with your ALOVE companion.",
  ctaText: "Start chat",
});

const SITE_WITH_MASCOT_SQL = `
  SELECT s.id AS site_id,
         s.name AS site_name,
         s.slug AS site_slug,
         s.site_url AS site_url,
         s.site_status,
         s.guest_chat_enabled,
         COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id,
         mascot.name AS mascot_name,
         mascot.avatar_url AS mascot_avatar_url,
         mascot.visibility AS mascot_visibility,
         mascot.character_status AS mascot_status
  FROM sites s
  LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
  LEFT JOIN ai_characters mascot ON mascot.id = COALESCE(ms.character_id, s.mascot_character_id)
`;

export async function listAdminExternalEmbeds() {
  const [rows] = await getDbPool().execute(`
    SELECT site.*, embed.id, embed.public_id, embed.external_origin, embed.embed_status,
           embed.launcher_image_url, embed.show_badge, embed.desktop_right_px, embed.desktop_bottom_px,
           embed.mobile_right_px, embed.mobile_bottom_px, embed.accent_color, embed.surface_color,
           embed.text_color, embed.corner_radius_px, embed.title, embed.show_beta, embed.beta_text,
           embed.title_rich_text, embed.description, embed.description_rich_text, embed.cta_text,
           embed.created_at, embed.updated_at
    FROM (${SITE_WITH_MASCOT_SQL}) site
    LEFT JOIN site_external_embeds embed ON embed.site_id = site.site_id
    WHERE site.site_status = 'active'
    ORDER BY site.site_name ASC, site.site_id ASC
  `);
  return { ok: true, items: rows.map(mapAdminEmbedRow) };
}

export async function saveAdminExternalEmbed(siteId, payload = {}) {
  const site = await getExternalEmbedSite(siteId);
  const existing = await getExternalEmbedBySiteId(site.site_id);
  const fields = normalizeEmbedPayload(payload, { existing, site });
  assertCanPublish(site, fields.status);
  const id = existing?.id || createId("embed");
  const publicId = existing?.public_id || createId("embed_public");

  await withTransaction(async (db) => {
    await db.execute(
      `INSERT INTO site_external_embeds (
        id, public_id, site_id, external_origin, embed_status, launcher_image_url, show_badge,
        desktop_right_px, desktop_bottom_px, mobile_right_px, mobile_bottom_px,
        accent_color, surface_color, text_color, corner_radius_px, title, show_beta, beta_text,
        title_rich_text, description, description_rich_text, cta_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        external_origin = VALUES(external_origin), embed_status = VALUES(embed_status),
        launcher_image_url = VALUES(launcher_image_url), show_badge = VALUES(show_badge),
        desktop_right_px = VALUES(desktop_right_px), desktop_bottom_px = VALUES(desktop_bottom_px),
        mobile_right_px = VALUES(mobile_right_px), mobile_bottom_px = VALUES(mobile_bottom_px),
        accent_color = VALUES(accent_color), surface_color = VALUES(surface_color), text_color = VALUES(text_color),
        corner_radius_px = VALUES(corner_radius_px), title = VALUES(title), show_beta = VALUES(show_beta),
        beta_text = VALUES(beta_text), title_rich_text = VALUES(title_rich_text), description = VALUES(description),
        description_rich_text = VALUES(description_rich_text), cta_text = VALUES(cta_text),
        updated_at = NOW(3)`,
      [
        id, publicId, site.site_id, fields.externalOrigin, fields.status, fields.launcherImageUrl,
        fields.showBadge ? 1 : 0, fields.desktopRightPx, fields.desktopBottomPx, fields.mobileRightPx,
        fields.mobileBottomPx, fields.accentColor, fields.surfaceColor, fields.textColor, fields.cornerRadiusPx,
        fields.title, fields.showBeta ? 1 : 0, fields.betaText, JSON.stringify(fields.titleRichText),
        fields.description, JSON.stringify(fields.descriptionRichText), fields.ctaText,
      ]
    );
  });

  return { ok: true, item: mapAdminEmbedRow({ ...site, ...fields, id, public_id: publicId }) };
}

export async function getPublicExternalEmbed(publicId, requestOrigin = "") {
  const row = await findPublishedExternalEmbedRow(publicId);
  if (!row || !isSameOrigin(requestOrigin, row.external_origin) || !isPublicGuestMascot(row)) return null;
  return mapPublicEmbedRow(row);
}

export async function createExternalEmbedHandoff({
  publicId = "",
  requestOrigin = "",
  sourceUrl = "",
  sourceTitle = "",
} = {}) {
  const row = await findPublishedExternalEmbedRow(publicId);
  if (!row || !isTtmallProductSource(row.product_api_url) || !isSameOrigin(requestOrigin, row.external_origin) || !isPublicGuestMascot(row)) return null;
  const page = normalizeExternalSourcePage({
    sourceUrl,
    sourceTitle,
    expectedOrigin: row.external_origin,
  });
  if (!page) return null;
  const token = createExternalSourceHandoffToken({
    publicId: row.public_id,
    siteId: row.site_id,
    siteSlug: row.site_slug,
    mascotCharacterId: row.mascot_character_id,
    sourceOrigin: row.external_origin,
    page,
  });
  if (!token) return null;
  return { token };
}

export function installerSnippet(publicId = "") {
  const normalizedPublicId = safeString(publicId).slice(0, 64);
  if (!normalizedPublicId) return "";
  const loaderUrl = JSON.stringify(`${SERVER_CONFIG.publicBaseUrl}/embed/v1.js`);
  const embedId = JSON.stringify(normalizedPublicId);
  return `<script>\n(function () {\n  var s = document.createElement("script");\n  s.src = ${loaderUrl};\n  s.async = true;\n  s.setAttribute("data-aiove-embed", ${embedId});\n  document.head.appendChild(s);\n})();\n</script>`;
}

function mapAdminEmbedRow(row = {}) {
  const status = safeString(row.embed_status || row.status) || "draft";
  const savedExternalOrigin = safeString(row.external_origin || row.externalOrigin);
  const siteUrlOrigin = deriveExternalOriginFromSiteUrl(row.site_url || row.siteUrl);
  const externalOrigin = shouldPreferSiteUrlOrigin(savedExternalOrigin, siteUrlOrigin)
    ? siteUrlOrigin
    : savedExternalOrigin;
  const mascotReady = isPublicGuestMascot(row);
  const config = {
    ...draftExternalEmbedConfig(),
    id: row.id || "",
    publicId: row.public_id || row.publicId || "",
    externalOrigin,
    externalOriginSource: externalOrigin === siteUrlOrigin && Boolean(siteUrlOrigin) ? "site_url" : "saved",
    status,
    launcherImageUrl: row.launcher_image_url || row.launcherImageUrl || "",
    showBadge: row.id ? Boolean(row.show_badge ?? row.showBadge) : DEFAULTS.showBadge,
    desktopRightPx: numberOrDefault(row.desktop_right_px ?? row.desktopRightPx, DEFAULTS.desktopRightPx),
    desktopBottomPx: numberOrDefault(row.desktop_bottom_px ?? row.desktopBottomPx, DEFAULTS.desktopBottomPx),
    mobileRightPx: numberOrDefault(row.mobile_right_px ?? row.mobileRightPx, DEFAULTS.mobileRightPx),
    mobileBottomPx: numberOrDefault(row.mobile_bottom_px ?? row.mobileBottomPx, DEFAULTS.mobileBottomPx),
    accentColor: row.accent_color || row.accentColor || DEFAULTS.accentColor,
    surfaceColor: row.surface_color || row.surfaceColor || DEFAULTS.surfaceColor,
    textColor: row.text_color || row.textColor || DEFAULTS.textColor,
    cornerRadiusPx: numberOrDefault(row.corner_radius_px ?? row.cornerRadiusPx, DEFAULTS.cornerRadiusPx),
    title: row.title || DEFAULTS.title,
    titleRichText: parseRichText(row.title_rich_text ?? row.titleRichText, row.title || DEFAULTS.title),
    showBeta: row.id ? Boolean(row.show_beta ?? row.showBeta) : DEFAULTS.showBeta,
    betaText: row.beta_text || row.betaText || "",
    description: row.description || DEFAULTS.description,
    descriptionRichText: parseRichText(row.description_rich_text ?? row.descriptionRichText, row.description || DEFAULTS.description),
    ctaText: row.cta_text || row.ctaText || DEFAULTS.ctaText,
    installerSnippet: status === "published" ? installerSnippet(row.public_id || row.publicId) : "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
  return {
    siteId: row.site_id || row.siteId || "",
    siteName: row.site_name || row.siteName || "",
    siteSlug: row.site_slug || row.siteSlug || "",
    mascotCharacterId: row.mascot_character_id || row.mascotCharacterId || "",
    mascotName: row.mascot_name || row.mascotName || "",
    mascotAvatarUrl: absoluteAssetUrl(row.mascot_avatar_url || row.mascotAvatarUrl || ""),
    guestChatEnabled: Boolean(row.guest_chat_enabled ?? row.guestChatEnabled),
    canPublish: mascotReady,
    publishBlockReason: mascotReady ? "" : "该站点需要先启用游客聊天，并绑定一个公开、已发布的前台角色。",
    config,
  };
}

function draftExternalEmbedConfig() {
  return {
    id: "",
    publicId: "",
    externalOrigin: "",
    status: "draft",
    launcherImageUrl: "",
    ...DEFAULTS,
    titleRichText: [],
    descriptionRichText: [],
    installerSnippet: "",
    createdAt: null,
    updatedAt: null,
  };
}

function mapPublicEmbedRow(row) {
  return {
    sourceContextEnabled: isTtmallProductSource(row.product_api_url),
    launcherImageUrl: absoluteAssetUrl(row.launcher_image_url || row.mascot_avatar_url || ""),
    showBadge: Boolean(row.show_badge),
    desktop: { rightPx: Number(row.desktop_right_px), bottomPx: Number(row.desktop_bottom_px) },
    mobile: { rightPx: Number(row.mobile_right_px), bottomPx: Number(row.mobile_bottom_px) },
    theme: {
      accentColor: row.accent_color,
      surfaceColor: row.surface_color,
      textColor: row.text_color,
      cornerRadiusPx: Number(row.corner_radius_px),
    },
    content: {
      title: row.title,
      titleRichText: parseRichText(row.title_rich_text, row.title),
      showBeta: Boolean(row.show_beta),
      betaText: row.beta_text || "",
      description: row.description,
      descriptionRichText: parseRichText(row.description_rich_text, row.description),
      ctaText: row.cta_text,
    },
    ctaUrl: `${SERVER_CONFIG.publicBaseUrl}/${encodeURIComponent(row.site_slug)}/chat?agent=${encodeURIComponent(row.mascot_character_id)}`,
  };
}

async function findPublishedExternalEmbedRow(publicId = "") {
  const normalizedPublicId = safeString(publicId).slice(0, 64);
  if (!normalizedPublicId) return null;
  const [rows] = await getDbPool().execute(`
    SELECT embed.*, site.id AS site_id, site.name AS site_name, site.slug AS site_slug,
           site.site_url, site.product_api_url, site.currency, site.site_status, site.guest_chat_enabled,
           COALESCE(ms.character_id, site.mascot_character_id) AS mascot_character_id,
           mascot.avatar_url AS mascot_avatar_url, mascot.visibility AS mascot_visibility,
           mascot.character_status AS mascot_status
    FROM site_external_embeds embed
    INNER JOIN sites site ON site.id = embed.site_id
    LEFT JOIN mascot_settings ms ON ms.site_id = site.id AND ms.setting_status = 'active'
    LEFT JOIN ai_characters mascot ON mascot.id = COALESCE(ms.character_id, site.mascot_character_id)
    WHERE embed.public_id = ? AND embed.embed_status = 'published'
    LIMIT 1`, [normalizedPublicId]);
  return rows[0] || null;
}

async function getExternalEmbedSite(siteId = "") {
  const normalizedSiteId = safeString(siteId).slice(0, 64);
  if (!normalizedSiteId) throwNotFound();
  const [rows] = await getDbPool().execute(`${SITE_WITH_MASCOT_SQL} WHERE s.id = ? LIMIT 1`, [normalizedSiteId]);
  if (!rows[0]) throwNotFound();
  return rows[0];
}

async function getExternalEmbedBySiteId(siteId = "") {
  const [rows] = await getDbPool().execute("SELECT * FROM site_external_embeds WHERE site_id = ? LIMIT 1", [siteId]);
  return rows[0] || null;
}

function normalizeEmbedPayload(payload = {}, { existing = null, site = null } = {}) {
  const status = normalizeStatus(payload.status ?? payload.embedStatus ?? existing?.embed_status);
  const title = requiredText(payload.title ?? existing?.title, "弹窗标题", 96, DEFAULTS.title);
  const description = requiredText(payload.description ?? existing?.description, "弹窗说明", 500, DEFAULTS.description);
  return {
    externalOrigin: resolveExternalOrigin(
      payload.externalOrigin ?? payload.external_origin ?? existing?.external_origin,
      site?.site_url || site?.siteUrl
    ),
    status,
    launcherImageUrl: normalizeLauncherImageUrl(payload.launcherImageUrl ?? payload.launcher_image_url ?? existing?.launcher_image_url),
    showBadge: readBoolean(payload, "showBadge", existing?.show_badge, DEFAULTS.showBadge),
    desktopRightPx: normalizeNumber(payload.desktopRightPx ?? payload.desktop_right_px ?? existing?.desktop_right_px, DEFAULTS.desktopRightPx, 0, 160),
    desktopBottomPx: normalizeNumber(payload.desktopBottomPx ?? payload.desktop_bottom_px ?? existing?.desktop_bottom_px, DEFAULTS.desktopBottomPx, 0, 240),
    mobileRightPx: normalizeNumber(payload.mobileRightPx ?? payload.mobile_right_px ?? existing?.mobile_right_px, DEFAULTS.mobileRightPx, 0, 120),
    mobileBottomPx: normalizeNumber(payload.mobileBottomPx ?? payload.mobile_bottom_px ?? existing?.mobile_bottom_px, DEFAULTS.mobileBottomPx, 0, 240),
    accentColor: normalizeColor(payload.accentColor ?? payload.accent_color ?? existing?.accent_color, DEFAULTS.accentColor),
    surfaceColor: normalizeColor(payload.surfaceColor ?? payload.surface_color ?? existing?.surface_color, DEFAULTS.surfaceColor),
    textColor: normalizeColor(payload.textColor ?? payload.text_color ?? existing?.text_color, DEFAULTS.textColor),
    cornerRadiusPx: normalizeNumber(payload.cornerRadiusPx ?? payload.corner_radius_px ?? existing?.corner_radius_px, DEFAULTS.cornerRadiusPx, 0, 32),
    title,
    titleRichText: normalizeRichText(payload.titleRichText ?? payload.title_rich_text ?? existing?.title_rich_text, title),
    showBeta: readBoolean(payload, "showBeta", existing?.show_beta, DEFAULTS.showBeta),
    betaText: optionalText(payload.betaText ?? payload.beta_text ?? existing?.beta_text, 24, DEFAULTS.betaText),
    description,
    descriptionRichText: normalizeRichText(payload.descriptionRichText ?? payload.description_rich_text ?? existing?.description_rich_text, description),
    ctaText: requiredText(payload.ctaText ?? payload.cta_text ?? existing?.cta_text, "按钮文字", 64, DEFAULTS.ctaText),
  };
}

function assertCanPublish(site = {}, status = "draft") {
  if (status !== "published") return;
  if (!isPublicGuestMascot(site)) {
    throwUserError("该站点需要先启用游客聊天，并绑定一个公开、已发布的前台角色后才能发布挂件。");
  }
}

function isPublicGuestMascot(row = {}) {
  return String(row.site_status || "").toLowerCase() === "active"
    && Boolean(row.guest_chat_enabled)
    && String(row.mascot_character_id || "").trim()
    && String(row.mascot_visibility || "").toLowerCase() === "public"
    && String(row.mascot_status || "").toLowerCase() === "published";
}

function normalizeExternalOrigin(value) {
  const raw = safeString(value).slice(0, 255);
  if (!raw) throwUserError("请填写外部站点 HTTPS 地址。");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throwUserError("外部站点地址格式无效。");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throwUserError("外部站点地址只能填写站点根域名，不要填写路径、参数或账号信息。");
  }
  const localMode = isLocalPublicBaseUrl();
  const localTestHost = isLocalTestHost(url.hostname);
  if (url.protocol !== "https:" && !(localMode && localTestHost && url.protocol === "http:")) {
    throwUserError("外部站点必须使用 HTTPS。");
  }
  if (!url.hostname || (isPrivateOrLocalHost(url.hostname) && !(localMode && localTestHost))) {
    throwUserError("外部站点必须是公网域名。");
  }
  return url.origin;
}

function resolveExternalOrigin(value, siteUrl = "") {
  const raw = safeString(value).slice(0, 255);
  const siteUrlOrigin = deriveExternalOriginFromSiteUrl(siteUrl);
  if (shouldPreferSiteUrlOrigin(raw, siteUrlOrigin)) return siteUrlOrigin;
  return normalizeExternalOrigin(raw);
}

function deriveExternalOriginFromSiteUrl(siteUrl = "") {
  const raw = safeString(siteUrl).slice(0, 512);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return normalizeExternalOrigin(url.origin);
  } catch {
    return "";
  }
}

function shouldPreferSiteUrlOrigin(value, siteUrlOrigin) {
  return Boolean(siteUrlOrigin) && (!safeString(value) || isTemporaryExternalOrigin(value));
}

function isTemporaryExternalOrigin(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(String(value || "")) ? String(value) : `https://${value}`);
    const host = String(url.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    return host === "0.0.0.0" || host === "0.0.0.1" || host === "localhost" || host.endsWith(".localhost") || host === "::1";
  } catch {
    return false;
  }
}

function normalizeLauncherImageUrl(value) {
  const raw = safeString(value).slice(0, 512);
  if (!raw) return null;
  if (raw.startsWith("/uploads/avatars/")) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throwUserError("挂件图标必须是现有头像上传地址或有效的 HTTPS 图片地址。");
  }
  const localMode = isLocalPublicBaseUrl();
  const localTestHost = isLocalTestHost(url.hostname);
  if (url.username || url.password || url.toString().length > 512
    || (url.protocol !== "https:" && !(localMode && localTestHost && url.protocol === "http:"))
    || !url.hostname || (isPrivateOrLocalHost(url.hostname) && !(localMode && localTestHost))) {
    throwUserError("挂件图标必须是 HTTPS 图片地址；本地测试仅允许 localhost 图片地址。");
  }
  return url.toString();
}

function normalizeStatus(value) {
  const status = safeString(value).toLowerCase();
  if (!status) return "draft";
  if (!EMBED_STATUS.has(status)) throwUserError("挂件状态无效。");
  return status;
}

function normalizeColor(value, fallback) {
  const color = safeString(value || fallback).toUpperCase();
  if (!COLOR_PATTERN.test(color)) throwUserError("主题颜色必须是 #RRGGBB 格式。");
  return color;
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function requiredText(value, label, maxLength, fallback) {
  const text = safeString(value || fallback).slice(0, maxLength);
  if (!text) throwUserError(`${label}不能为空。`);
  return text;
}

function optionalText(value, maxLength, fallback = "") {
  return safeString(value ?? fallback).slice(0, maxLength) || null;
}

function parseRichText(value, text) {
  if (Array.isArray(value)) return normalizeRichText(value, text);
  try {
    return normalizeRichText(JSON.parse(String(value || "[]")), text);
  } catch {
    return [];
  }
}

function normalizeRichText(value, text) {
  const source = Array.isArray(value) ? value : parseRichText(value, text);
  const length = String(text || "").length;
  const marks = source
    .map((item) => ({ start: Number(item?.start), end: Number(item?.end), color: String(item?.color || "").toUpperCase() }))
    .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end)
      && item.start >= 0 && item.end > item.start && item.end <= length && COLOR_PATTERN.test(item.color))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const normalized = [];
  for (const mark of marks) {
    const previous = normalized[normalized.length - 1];
    if (previous && mark.start < previous.end) continue;
    if (previous && previous.end === mark.start && previous.color === mark.color) previous.end = mark.end;
    else normalized.push(mark);
  }
  return normalized;
}

function readBoolean(payload, key, existingValue, fallback) {
  if (Object.prototype.hasOwnProperty.call(payload, key)) return parseBoolean(payload[key]);
  const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (Object.prototype.hasOwnProperty.call(payload, snakeKey)) return parseBoolean(payload[snakeKey]);
  if (existingValue != null) return Boolean(existingValue);
  return fallback;
}

function isSameOrigin(value, expected) {
  try {
    return new URL(String(value || "")).origin === String(expected || "");
  } catch {
    return false;
  }
}

function isPrivateOrLocalHost(hostname = "") {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host) || /^::ffff:127\./i.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isLocalTestHost(hostname = "") {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

function isLocalPublicBaseUrl() {
  try {
    const host = new URL(SERVER_CONFIG.publicBaseUrl).hostname;
    return isPrivateOrLocalHost(host);
  } catch {
    return false;
  }
}

function absoluteAssetUrl(value = "") {
  const raw = safeString(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? `${SERVER_CONFIG.publicBaseUrl}${raw}` : "";
}
