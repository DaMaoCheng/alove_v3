export function buildCampaignProductPayload(campaign = {}) {
  const code = safeString(campaign.discountCode);
  const snapshot = campaign.productSnapshot && typeof campaign.productSnapshot === "object" ? campaign.productSnapshot : {};
  const features = Array.isArray(snapshot.features) ? snapshot.features.filter(Boolean).slice(0, 8) : [];
  if (code && !features.includes(`Code: ${code}`)) features.unshift(`Code: ${code}`);
  return {
    id: safeString(snapshot.id || campaign.productId),
    productId: safeString(snapshot.id || campaign.productId),
    sku: safeString(snapshot.sku),
    name: safeString(snapshot.name || campaign.productTitle),
    subtitle: safeString(snapshot.subtitle) || "Promotion",
    priceNow: safeString(snapshot.price),
    priceWas: safeString(snapshot.priceWas),
    code,
    discountCode: code,
    tag: "Promo",
    imageUrl: safeString(snapshot.imageUrl),
    imageUrls: Array.isArray(snapshot.imageUrls) ? snapshot.imageUrls.filter(Boolean).slice(0, 8) : [],
    url: safeString(snapshot.url || campaign.productUrl),
    stock: safeString(snapshot.stock),
    summary: safeString(campaign.title),
    available: null,
    sizes: Array.isArray(snapshot.sizes) ? snapshot.sizes.slice(0, 12) : [],
    features,
    siteId: safeString(campaign.siteId),
    siteSlug: safeString(campaign.siteSlug),
    campaignId: safeString(campaign.id),
  };
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
