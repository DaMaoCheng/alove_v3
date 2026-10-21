import { getDbPool } from "./db.js";
import { createId } from "./security.js";

export async function listPublishedHomeCarouselItems({ now = new Date(), siteSlug = "" } = {}) {
  const site = await resolveSiteContextBySlug(siteSlug);
  const [rows] = await getDbPool().execute(
    `SELECT *
     FROM home_carousel_items
     WHERE item_status = 'published'
       AND (site_id IS NULL OR site_id = '' OR site_id = ?)
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (ends_at IS NULL OR ends_at > ?)
     ORDER BY display_order ASC, updated_at DESC`,
    [site.id, now, now]
  );

  return {
    ok: true,
    items: rows.map((row) => mapCarouselRow(row, { effectiveMascotCharacterId: site.mascotCharacterId })),
  };
}

export async function listAdminHomeCarouselItems() {
  const [rows] = await getDbPool().execute(
    `SELECT hci.*, s.name AS site_name, s.slug AS site_slug,
            target.name AS cta_target_name,
            target.category_id AS cta_target_category_id
     FROM home_carousel_items hci
     LEFT JOIN sites s ON s.id = hci.site_id
     LEFT JOIN ai_characters target ON target.id = hci.cta_target
     ORDER BY hci.display_order ASC, hci.updated_at DESC`
  );

  return {
    ok: true,
    items: rows.map(mapCarouselRow),
  };
}

export async function createAdminHomeCarouselItem(payload = {}) {
  const fields = normalizeCarouselPayload(payload);
  const id = createId("banner");
  await getDbPool().execute(
    `INSERT INTO home_carousel_items (
       id, title, subtitle, eyebrow, image_url, site_id, cta_text, cta_type, cta_target,
       display_order, item_status, starts_at, ends_at, source_type, source_ref
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin-carousel')`,
    [
      id,
      fields.title,
      fields.subtitle,
      fields.eyebrow,
      fields.imageUrl,
      fields.siteId,
      fields.ctaText,
      fields.ctaType,
      fields.ctaTarget,
      fields.displayOrder,
      fields.status,
      fields.startsAt,
      fields.endsAt,
    ]
  );
  return getAdminHomeCarouselItem(id);
}

export async function updateAdminHomeCarouselItem(itemId, payload = {}) {
  const normalizedId = String(itemId || "").trim();
  if (!normalizedId) throwNotFound();

  const fields = normalizeCarouselPayload(payload);
  const [result] = await getDbPool().execute(
    `UPDATE home_carousel_items
     SET title = ?,
         subtitle = ?,
         eyebrow = ?,
         image_url = ?,
         site_id = ?,
         cta_text = ?,
         cta_type = ?,
         cta_target = ?,
         display_order = ?,
         item_status = ?,
         starts_at = ?,
         ends_at = ?,
         updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [
      fields.title,
      fields.subtitle,
      fields.eyebrow,
      fields.imageUrl,
      fields.siteId,
      fields.ctaText,
      fields.ctaType,
      fields.ctaTarget,
      fields.displayOrder,
      fields.status,
      fields.startsAt,
      fields.endsAt,
      normalizedId,
    ]
  );
  if (!result.affectedRows) throwNotFound();
  return getAdminHomeCarouselItem(normalizedId);
}

async function getAdminHomeCarouselItem(itemId) {
  const [rows] = await getDbPool().execute(
    `SELECT hci.*, s.name AS site_name, s.slug AS site_slug,
            target.name AS cta_target_name,
            target.category_id AS cta_target_category_id
     FROM home_carousel_items hci
     LEFT JOIN sites s ON s.id = hci.site_id
     LEFT JOIN ai_characters target ON target.id = hci.cta_target
     WHERE hci.id = ?
     LIMIT 1`,
    [itemId]
  );
  if (!rows[0]) throwNotFound();
  return {
    ok: true,
    item: mapCarouselRow(rows[0]),
  };
}

function normalizeCarouselPayload(payload = {}) {
  const title = safeString(payload.title).slice(0, 128);
  if (!title) {
    const error = new Error("轮播标题不能为空");
    error.statusCode = 400;
    throw error;
  }

  const imageUrl = safeString(payload.imageUrl || payload.image_url).slice(0, 512);
  if (!isAllowedImageUrl(imageUrl)) {
    const error = new Error("轮播图片地址无效");
    error.statusCode = 400;
    throw error;
  }

  return {
    title,
    subtitle: nullableText(payload.subtitle, 500),
    eyebrow: nullableText(payload.eyebrow, 64),
    imageUrl,
    siteId: nullableText(payload.siteId || payload.site_id, 64),
    ctaText: nullableText(payload.ctaText || payload.cta_text, 64),
    ctaType: normalizeOneOf(payload.ctaType || payload.cta_type, ["none", "character", "url"], "none"),
    ctaTarget: nullableText(payload.ctaTarget || payload.cta_target, 512),
    displayOrder: Math.max(0, Math.min(9999, Math.round(Number(payload.displayOrder ?? payload.display_order ?? 100) || 100))),
    status: normalizeOneOf(payload.status || payload.itemStatus || payload.item_status, ["draft", "published", "archived"], "draft"),
    startsAt: nullableDateTime(payload.startsAt || payload.starts_at),
    endsAt: nullableDateTime(payload.endsAt || payload.ends_at),
  };
}

function mapCarouselRow(row, { effectiveMascotCharacterId = "" } = {}) {
  const rawCtaTarget = row.cta_target || "";
  const ctaTarget = row.cta_type === "character" && rawCtaTarget === "mascot_template" && effectiveMascotCharacterId && effectiveMascotCharacterId !== "mascot_template"
    ? effectiveMascotCharacterId
    : rawCtaTarget;
  return {
    id: row.id,
    title: row.title || "",
    subtitle: row.subtitle || "",
    eyebrow: row.eyebrow || "",
    imageUrl: row.image_url || "",
    siteId: row.site_id || "",
    siteName: row.site_name || "",
    siteSlug: row.site_slug || "",
    ctaText: row.cta_text || "",
    ctaType: row.cta_type || "none",
    ctaTarget,
    ctaTargetName: row.cta_target_name || "",
    ctaTargetCategoryId: row.cta_target_category_id || "",
    displayOrder: Number(row.display_order || 0),
    status: row.item_status || "draft",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveSiteContextBySlug(siteSlug = "") {
  const slug = safeString(siteSlug).toLowerCase();
  if (!slug) return { id: "", mascotCharacterId: "" };
  const [rows] = await getDbPool().execute(
    `SELECT sites.id,
            COALESCE(ms.character_id, sites.mascot_character_id, 'mascot_template') AS mascot_character_id
     FROM sites
     LEFT JOIN mascot_settings ms ON ms.site_id = sites.id AND ms.setting_status = 'active'
     WHERE sites.slug = ? AND sites.site_status = 'active'
     LIMIT 1`,
    [slug]
  );
  return {
    id: rows[0]?.id || "",
    mascotCharacterId: rows[0]?.mascot_character_id || "mascot_template",
  };
}

function isAllowedImageUrl(value) {
  return value.startsWith("assets/") || value.startsWith("/uploads/") || /^https?:\/\//i.test(value);
}

function nullableText(value, maxLength) {
  const normalized = safeString(value).slice(0, maxLength);
  return normalized || null;
}

function nullableDateTime(value) {
  const normalized = safeString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeOneOf(value, allowed, fallback) {
  const normalized = safeString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function throwNotFound() {
  const error = new Error("轮播项不存在");
  error.statusCode = 404;
  throw error;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
