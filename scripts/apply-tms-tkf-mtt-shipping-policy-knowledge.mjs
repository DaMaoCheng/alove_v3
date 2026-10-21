import { closeDbPool, initializeDatabase } from "../server/db.js";
import { upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";

// Operational script: writes only the three fixed site-specific policies below.
// It intentionally does not import or upsert FKK policy data.
const SITE_SHIPPING_POLICIES = [
  {
    id: "kb_site_tms_shipping_policy",
    label: "TMS Shipping Policy",
    category: "customer_service",
    scope: "site",
    status: "active",
    language: "Hungarian",
    priority: 100,
    maxSections: 1,
    maxCharsPerSection: 1800,
    summary: "Official TMS shipping policy. TMS ships only within Hungary. Delivery is free and the estimated total delivery time is 7–15 business days.",
    keywords: ["shipping", "delivery", "dispatch", "tracking", "parcel", "Hungary", "Magyarország", "szállítás", "kiszállítás", "csomag", "nyomkövetés", "rendelésem", "megérkezik", "物流", "配送", "发货", "追踪"],
    fuzzyKeywords: ["how long is shipping", "where is my package", "shipping to Hungary", "szállítási idő", "mikor érkezik a csomagom", "rendelésem hol tart", "csomagkövetés", "物流多久", "包裹什么时候到"],
    sourceType: "site_policy",
    sourceRef: "https://mezkiraly.com/policies/shipping-policy",
    bindings: { siteIds: ["site_76b7e019-e2a2-45ab-aa57-082a67c35b28"] },
    sections: [{
      key: "shipping_policy",
      title: "TMS Shipping Policy",
      summary: "Csak Magyarországra szállítunk. A szállítás minden rendelésnél ingyenes, a várható teljes kézbesítési idő 7–15 munkanap.",
      content: `Use this policy only for TMS / Mezkiraly. This is the source of truth for its delivery questions.

Shipping coverage: TMS delivers only to addresses within Hungary. Do not promise international delivery.

Shipping cost and methods: Delivery within Hungary is free for every order. TMS has no separate standard or express shipping tiers.

Delivery time: The estimated total time from placing the order to delivery is 7–15 business days.

Tracking: Available tracking information is sent by email after the order has been dispatched.

Address and delays: The customer should provide a complete, accurate delivery address. If there is an address error or an unexpected delay, ask them to contact TMS customer service promptly so the package status can be checked.

This chat cannot check live tracking or verify a tracking number. For live tracking, direct the customer to the carrier tracking page or TMS customer service. Exact delivery remains subject to the destination and carrier handling.

Source: https://mezkiraly.com/policies/shipping-policy.`,
      keywords: ["Hungary", "Magyarország", "free", "7–15", "business days", "szállítás", "kiszállítás", "csomag", "nyomkövetés"],
      fuzzyKeywords: ["szállítási idő", "mikor érkezik", "csomagom hol tart", "ingyenes szállítás", "shipping time", "tracking"],
      order: 10,
      status: "active",
      sourceHeading: "Szállítási szabályzat",
    }],
  },
  {
    id: "kb_site_tkf_shipping_policy",
    label: "TKF Shipping Policy",
    category: "customer_service",
    scope: "site",
    status: "active",
    language: "Turkish",
    priority: 100,
    maxSections: 1,
    maxCharsPerSection: 1800,
    summary: "Official TKF shipping policy. TKF ships only within Türkiye, with free delivery, 1–3 business days processing and an estimated 7–15 business days delivery time.",
    keywords: ["shipping", "delivery", "dispatch", "tracking", "parcel", "Türkiye", "Turkey", "kargo", "teslimat", "gönderi", "takip", "sipariş", "物流", "配送", "发货", "追踪"],
    fuzzyKeywords: ["how long is shipping", "where is my package", "shipping to Turkey", "kargo ne zaman gelir", "siparişim nerede", "kargo takip", "uluslararası teslimat", "物流多久", "包裹什么时候到"],
    sourceType: "site_policy",
    sourceRef: "https://turkforma.com/policies/shipping-policy",
    bindings: { siteIds: ["site_51a1059d-86dd-4702-8e6f-3d050731b6ea"] },
    sections: [{
      key: "shipping_policy",
      title: "TKF Shipping Policy",
      summary: "Sadece Türkiye içi teslimat yapıyoruz. Kargo ücretsizdir; işlem süresi 1–3 iş günü, tahmini teslimat süresi 7–15 iş günüdür.",
      content: `Use this policy only for TKF / TurkForma. This is the source of truth for its delivery questions.

Shipping coverage: TKF delivers only to addresses within Türkiye. International delivery is not currently supported.

Shipping cost: Delivery within Türkiye is free. No hidden shipping charge is added at checkout.

Processing and delivery: Orders are processed within 1–3 business days. Estimated delivery is 7–15 business days. Delivery can vary by city, local carrier, holidays, or logistics delays. Remote areas such as villages or small towns may take an additional 1–2 days.

Tracking: A tracking number is sent by email once the order is handed to the carrier.

Lost or damaged packages: Ask the customer to contact TKF promptly with the order/tracking information and relevant photos when a shipment is lost or damaged. TKF reviews the case for an appropriate replacement or refund.

This chat cannot check live tracking or verify a tracking number. For live tracking, direct the customer to the carrier tracking page or TKF customer service. Exact delivery remains subject to the destination and carrier handling.

Source: https://turkforma.com/policies/shipping-policy (Last updated: July 10, 2026).`,
      keywords: ["Türkiye", "Turkey", "free", "1–3", "7–15", "kargo", "teslimat", "takip", "uzak bölge"],
      fuzzyKeywords: ["kargo ne zaman gelir", "siparişim nerede", "kargo takip", "Türkiye dışına gönderiyor musunuz", "shipping time", "tracking"],
      order: 10,
      status: "active",
      sourceHeading: "Kargo politikası",
    }],
  },
  {
    id: "kb_site_mtt_shipping_policy",
    label: "MTT Shipping Policy",
    category: "customer_service",
    scope: "site",
    status: "active",
    language: "French",
    priority: 100,
    maxSections: 1,
    maxCharsPerSection: 1800,
    summary: "Official MTT shipping policy. MTT ships only within Morocco. Preparation takes 1–3 business days and estimated delivery after dispatch is 5–10 business days, for an estimated total of 6–13 business days.",
    keywords: ["shipping", "delivery", "dispatch", "tracking", "parcel", "Morocco", "Maroc", "livraison", "colis", "suivi", "expédition", "commande", "物流", "配送", "发货", "追踪"],
    fuzzyKeywords: ["how long is shipping", "where is my package", "shipping to Morocco", "délai de livraison", "où est mon colis", "suivi de commande", "livraison internationale", "物流多久", "包裹什么时候到"],
    sourceType: "site_policy",
    sourceRef: "https://maillotatlas.com/policies/shipping-policy",
    bindings: { siteIds: ["site_faced451-b700-4f68-bac0-579b0d97079c"] },
    sections: [{
      key: "shipping_policy",
      title: "MTT Shipping Policy",
      summary: "Livraison uniquement au Maroc. Préparation 1–3 jours ouvrables, puis livraison estimée 5–10 jours ouvrables, soit 6–13 jours ouvrables au total. Livraison standard gratuite.",
      content: `Use this policy only for MTT / Maillot Atlas. This is the source of truth for its delivery questions.

Shipping coverage: MTT currently delivers orders only within Morocco. Do not promise delivery outside Morocco.

Preparation and delivery: Jerseys and personalized items need 1–3 business days for order verification, preparation, and any applicable personalization. After dispatch, estimated delivery is 5–10 business days. The estimated total time from order to delivery is therefore 6–13 business days. Weekends and public holidays are excluded from business days.

Shipping cost: Standard delivery is free for orders delivered within Morocco.

Tracking: An email containing the tracking number is sent once the order has shipped. If the tracking number is not received, ask the customer to contact MTT with the order number.

Address and package issues: The customer must provide a complete, accurate address. For an address error after ordering, MTT may try to correct it before dispatch but cannot guarantee a change after preparation or handoff to the carrier. For a damaged, lost, missing, or unreceived package after the estimated delivery date, ask the customer to contact MTT with the order number and, for damage, clear photos of the item, packaging, and shipping label.

This chat cannot check live tracking or verify a tracking number. For live tracking, direct the customer to the carrier tracking page or MTT customer service. Exact delivery remains subject to the destination and carrier handling.

Source: https://maillotatlas.com/policies/shipping-policy (Last updated: July 10, 2026).`,
      keywords: ["Morocco", "Maroc", "free", "1–3", "5–10", "6–13", "livraison", "colis", "suivi", "personnalisé"],
      fuzzyKeywords: ["délai de livraison", "où est mon colis", "suivi de commande", "livrez-vous au Maroc", "modifier mon adresse", "shipping time", "tracking"],
      order: 10,
      status: "active",
      sourceHeading: "Politique d’expédition",
    }],
  },
];

await initializeDatabase();
try {
  const results = [];
  for (const policy of SITE_SHIPPING_POLICIES) {
    const result = await upsertKnowledgeBaseWithSections(policy);
    results.push({ id: result.item.id, siteIds: result.item.siteIds, sourceRef: result.item.sourceRef });
  }
  console.log(JSON.stringify({ ok: true, applied: results }, null, 2));
} finally {
  await closeDbPool();
}
