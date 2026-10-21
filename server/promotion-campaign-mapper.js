function parseProductSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseKeywords(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function mapPromotionCampaignRow(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name || "",
    siteSlug: row.site_slug || "",
    title: row.title || "",
    roleTarget: row.role_target || "all",
    productId: row.product_id || "",
    productTitle: row.product_title || "",
    productUrl: row.product_url || "",
    productSnapshot: parseProductSnapshot(row.product_snapshot_json),
    discountCode: row.discount_code || "",
    messageText: row.message_text || "",
    keywords: parseKeywords(row.keywords_json),
    priority: Number(row.priority || 100),
    status: row.campaign_status || "draft",
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    sourceType: row.source_type || "admin",
    sourceRef: row.source_ref || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export { parseKeywords, parseProductSnapshot, toIso };
