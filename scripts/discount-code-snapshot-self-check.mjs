import assert from "node:assert/strict";
import {
  isActiveSnapshot,
  refreshDiscountOfferSnapshots,
  shouldRefreshSnapshot,
} from "../server/discount-code-snapshot-service.js";

const now = new Date("2026-07-23T10:00:00.000Z");
const baseRow = {
  id: "discount_snapshot_check",
  site_id: "site_fkk",
  code: "START10",
  offer_description: "Old summary",
  starts_at: new Date("2026-07-23T09:59:00.000Z"),
  ends_at: null,
  shopify_status: "SCHEDULED",
  shopify_rule_json: { type: "percentage", value: 5, pricePreviewEligible: true },
  shopify_synced_at: new Date("2026-07-23T09:59:30.000Z"),
};

assert.equal(shouldRefreshSnapshot(baseRow, now), true, "scheduled snapshots must refresh as soon as startsAt is reached");
assert.equal(isActiveSnapshot(baseRow, now), false, "a scheduled snapshot is not trusted as active before refresh");

const updates = [];
const db = {
  execute: async (sql, values) => {
    updates.push({ sql, values });
    return [{ affectedRows: 1 }];
  },
};
let resolveCount = 0;
const [refreshed] = await refreshDiscountOfferSnapshots(db, {
  rows: [baseRow],
  site: { id: "site_fkk", product_api_url: "shopify-admin://example.myshopify.com?version=2026-07" },
  now,
  resolveShopifyDiscountCodeImpl: async (_site, code) => {
    resolveCount += 1;
    return {
      shopifyDiscountId: "gid://shopify/DiscountCodeNode/start10",
      code,
      offerDescription: "10% off all products",
      shopifyDiscountType: "percentage",
      shopifyStatus: "ACTIVE",
      validityMode: "indefinite",
      startsAt: "2026-07-23T09:59:00.000Z",
      endsAt: "",
      rule: {
        type: "percentage",
        value: 10,
        currencyCode: "",
        appliesOnEachItem: false,
        minimumRequirement: null,
        targetScope: { type: "all" },
        customerContext: "DiscountBuyerSelectionAll",
        pricePreviewEligible: true,
      },
    };
  },
});
assert.equal(resolveCount, 1);
assert.equal(updates.length, 1, "refreshed rules must persist a new trusted snapshot");
assert.equal(refreshed.shopify_status, "ACTIVE");
assert.equal(refreshed.shopify_rule_json.value, 10);
assert.equal(isActiveSnapshot(refreshed, now), true);

const failed = await refreshDiscountOfferSnapshots(db, {
  rows: [{ ...baseRow, code: "DISABLED10", shopify_synced_at: null }],
  site: { id: "site_fkk" },
  now,
  logger: { warn() {} },
  resolveShopifyDiscountCodeImpl: async () => {
    resolveCount += 1;
    throw new Error("provider unavailable");
  },
});
assert.deepEqual(failed, [], "stale snapshots must fail closed when Shopify cannot refresh them");
const resolveCountAfterFailure = resolveCount;
const cooledDown = await refreshDiscountOfferSnapshots(db, {
  rows: [{ ...baseRow, code: "DISABLED10", shopify_synced_at: null }],
  site: { id: "site_fkk" },
  now: new Date(now.getTime() + 1000),
  logger: { warn() {} },
  resolveShopifyDiscountCodeImpl: async () => {
    resolveCount += 1;
    throw new Error("provider unavailable");
  },
});
assert.deepEqual(cooledDown, []);
assert.equal(resolveCount, resolveCountAfterFailure, "provider failures must enter a cooldown instead of retrying on every product view");

const casDb = {
  execute: async (sql) => {
    assert.match(sql, /AND code = \? AND shopify_synced_at <=> \?/, "snapshot refresh must use code and version CAS");
    return [{ affectedRows: 0 }];
  },
};
const raced = await refreshDiscountOfferSnapshots(casDb, {
  rows: [{ ...baseRow, code: "RACE10", shopify_synced_at: null }],
  site: { id: "site_fkk" },
  now,
  resolveShopifyDiscountCodeImpl: async () => ({
    shopifyDiscountId: "gid://shopify/DiscountCodeNode/race10",
    code: "RACE10",
    offerDescription: "10% off",
    shopifyDiscountType: "percentage",
    shopifyStatus: "ACTIVE",
    validityMode: "indefinite",
    startsAt: "",
    endsAt: "",
    rule: { type: "percentage", value: 10, pricePreviewEligible: true },
  }),
});
assert.deepEqual(raced, [], "a lost snapshot CAS must not return an unpersisted refreshed offer");

console.log("discount code snapshot self-check passed");
