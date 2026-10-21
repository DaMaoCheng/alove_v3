import { closeDbPool, initializeDatabase } from "../server/db.js";
import { upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";

const FKK_SHIPPING_POLICY = {
  id: "kb_site_fkk_shipping_policy",
  label: "Football Kit UK Shipping Policy",
  category: "customer_service",
  scope: "site",
  status: "active",
  language: "English",
  priority: 100,
  maxSections: 1,
  maxCharsPerSection: 1800,
  summary: "Official Football Kit UK shipping policy. FKK currently ships only to the United Kingdom and the United States. Use for FKK destination, delivery-time, dispatch and delayed-package questions before generic customer-service guidance.",
  keywords: ["shipping", "delivery", "dispatch", "parcel", "tracking", "logistics", "destination", "country", "international", "UK", "United Kingdom", "USA", "United States", "物流", "配送", "发货", "包裹", "追踪", "发货地区", "国家"],
  fuzzyKeywords: ["delivery time", "shipping time", "where is my order", "delayed package", "do you ship to", "ship to my country", "shipping countries", "快递多久", "物流时效", "能发到", "发货国家"],
  sourceType: "site_policy",
  sourceRef: "https://footballkituk.com/policies/shipping-policy",
  bindings: { siteIds: ["site_fkk"] },
  sections: [{
    key: "shipping_policy",
    title: "FKK Shipping Policy",
    summary: "FKK ships only to the United Kingdom and the United States. Standard: processing 1–3 business days and estimated delivery 10–15 business days; DHL/UPS Express: processing within 1 business day and estimated delivery 5–10 business days.",
    content: `Use this policy only for Football Kit UK (FKK). This is the source of truth for FKK delivery questions.

Shipping coverage: FKK currently ships only to the United Kingdom and the United States. Do not promise shipping to any other country or region. If a customer asks about an unsupported destination, explain politely that FKK is not currently able to ship there.

Standard Shipping: orders are processed within 1–3 business days. Estimated delivery is 10–15 business days. Standard shipping is free.

DHL/UPS Express (€24.99): orders are processed within 1 business day. Estimated delivery is 5–10 business days. The cost is €24.99.

After payment, the warehouse needs 1–3 business days to process an order. A dispatch notification email is sent once the order has shipped.

For a missing or delayed package, or when tracking says delivered but the package was not received, ask the customer to contact FKK customer service within 45 days of placing the order for verification. For other order, product or logistics concerns, contact FKK within 90 days of the order date. FKK states that delayed, lost or held packages can be reviewed for a replacement shipment.

This chat cannot check live tracking or verify a tracking number. For live tracking, direct the customer to the carrier tracking page or FKK customer service. Exact delivery estimates remain subject to the destination and checkout details.

Source: https://footballkituk.com/policies/shipping-policy (Last Updated: August 19, 2025).`,
    keywords: ["shipping", "delivery", "destination", "country", "United Kingdom", "United States", "UK", "USA", "standard", "express", "DHL", "UPS", "processing", "delayed", "tracking"],
    fuzzyKeywords: ["how long", "where is my package", "shipping time", "delivery time", "do you ship to", "ship to my country", "物流", "发货", "追踪", "能发到"],
    order: 10,
    status: "active",
    sourceHeading: "Shipping policy",
  }],
};

await initializeDatabase();
try {
  const result = await upsertKnowledgeBaseWithSections(FKK_SHIPPING_POLICY);
  console.log(JSON.stringify({
    ok: true,
    id: result.item.id,
    scope: result.item.scope,
    siteIds: result.item.siteIds,
    sourceRef: FKK_SHIPPING_POLICY.sourceRef,
  }, null, 2));
} finally {
  await closeDbPool();
}
