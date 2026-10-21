import { recordProductAnalyticsEvent } from "../../services/product-analytics-service.js";

const reportedProductImpressionKeys = new Set();

export function reportProductImpressions(root) {
  reportCatalogProductImpressions(root, {
    selector: ".product-card[data-product-analytics]",
    eventType: "product_bubble_impression",
    source: "chat_product_card",
  });
}

export function reportCatalogProductImpressions(root, { selector = "", eventType = "", source = "" } = {}) {
  if (!root || !selector || !eventType) return;
  root.querySelectorAll(selector).forEach((card) => {
    const payload = parseProductPayload(card.dataset.productAnalytics);
    const identity = payload.messageId || payload.catalogReceipt || payload.searchReceipt || "";
    if (!identity) return;
    const key = `${eventType}:${identity}`;
    if (reportedProductImpressionKeys.has(key)) return;
    reportedProductImpressionKeys.add(key);
    recordProductAnalyticsEvent({
      ...payload,
      eventType,
      source,
    });
  });
}

export function parseProductPayload(value = "") {
  if (!value) return {};
  try {
    const payload = JSON.parse(value);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}
