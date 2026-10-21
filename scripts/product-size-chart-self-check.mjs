import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyLocalProductSizeChart,
  listLocalSizeChartCatalog,
  resolveLocalProductAgeRangeRequirement,
  resolveNearestLocalProductAgeRequirement,
  resolveLocalProductSizeChart,
} from "../server/product-size-chart-catalog.js";

for (const [sku, expected] of [
  ["NS004202602-S", "fan_short_sleeve"],
  ["FCS003161701-S", "fan_short_sleeve"],
  ["DCS,DCK001-S", "order_fan_short_sleeve"],
  ["NPV008202601-S", "player_short_sleeve"],
  ["DNPV008202601-S", "order_player_short_sleeve"],
  ["NN001-S", "women"],
  ["CTZ001-16", "fan_kids"],
  ["DCTZ,CTW001-14", "order_fan_kids"],
  ["FCLS001-S", "fan_long_sleeve"],
  ["CK001-S", "adult_shorts"],
  ["CSWT001-S", "jacket"],
]) {
  assert.equal(
    classifyLocalProductSizeChart({ sku })?.id,
    expected,
    `${sku} should resolve to ${expected} using longest-prefix matching`,
  );
}
assert.equal(
  classifyLocalProductSizeChart({ sku: "UNKNOWN-001-S" }),
  null,
  "unknown SKU must not receive a guessed chart",
);
for (const sku of ["CSSURPRISE-001", "NSWOMEN-001", "CTOP001", "CNOTHER-001"]) {
  assert.equal(
    classifyLocalProductSizeChart({ sku }),
    null,
    `${sku} must not match a chart without a valid SKU prefix boundary`,
  );
}
assert.equal(
  resolveLocalProductSizeChart({ sku: "NPV008202601-S" })?.rows.length,
  7,
  "local player chart should contain the configured rows",
);
assert.equal(
  listLocalSizeChartCatalog().length,
  10,
  "local catalog should contain all ten supplied chart types",
);
assert.deepEqual(
  resolveLocalProductAgeRangeRequirement({ sku: "DCTZ,CTW001-14" }, "18–24 months"),
  { chartId: "order_fan_kids", sizeLabel: "#14" },
  "18–24 months should map to #14 only for an order fan-kids SKU",
);
assert.equal(
  resolveLocalProductAgeRangeRequirement({ sku: "CTZ001-16" }, "18-24 months"),
  null,
  "an age range must not guess a #14 size for a different kids chart",
);
assert.deepEqual(
  resolveLocalProductAgeRangeRequirement({ sku: "DCTZ,CTW001-14" }, "1 year"),
  { chartId: "order_fan_kids", sizeLabel: "#14" },
  "a one-year-old request should map to #14 for the matching order fan-kids chart",
);
assert.deepEqual(
  resolveNearestLocalProductAgeRequirement({
    sku: "DCTZ,CTW001-16",
    sizes: [{ label: "#16 (2-3 Years)", available: true }],
  }, "1 year"),
  { chartId: "order_fan_kids", sizeLabel: "#16", ageReference: "2–3", requestedAgeRange: "1 year", distance: 1 },
  "nearest age fallback must use only an actually available chart size",
);
assert.equal(
  resolveNearestLocalProductAgeRequirement({
    sku: "CTZ001-22",
    sizes: [{ label: "#22 (8-9 Years)", available: true }],
  }, "1 year"),
  null,
  "a remote age band must not be treated as a useful nearest-size fallback",
);

const searchPageSource = readFileSync("src/features/search/search-page.js", "utf8");
const kitshopPageSource = readFileSync("src/features/kitshop/kitshop-page.js", "utf8");
const normalizerSource = readFileSync("server/product-normalizer.js", "utf8");
const resolverSource = readFileSync("server/product-checkout-resolver-service.js", "utf8");
for (const [name, source] of [["search", searchPageSource], ["kitshop", kitshopPageSource]]) {
  assert.match(
    source,
    /productPanelHtml\(\{\s*includeSizeChartModal:\s*false,\s*pageLanguage\s*\}\)/,
    `${name} should keep the size chart modal outside its transformed product detail panel`,
  );
  assert.match(
    source,
    /productSizeChartModalHtml\(\{\s*pageLanguage\s*\}\)/,
    `${name} should render the size chart as a page-level floating overlay`,
  );
}
assert.doesNotMatch(
  normalizerSource,
  /fetchProductSizeChart|fetchSizeChart\(/,
  "product normalization must not fetch a remote size chart",
);
assert.doesNotMatch(
  resolverSource,
  /fetchProductSizeChart/,
  "checkout product resolution must not fetch a remote size chart",
);
assert.match(
  resolverSource,
  /function stripUntrustedSizeChart[\s\S]*sizeChart:\s*null/,
  "unresolved checkout payloads must not echo a client-supplied size chart",
);

const matchServiceSource = readFileSync("server/product-search-match-service.js", "utf8");
assert.match(
  matchServiceSource,
  /sizeChart:\s*resolved\.sizeChart\s*\|\|\s*null/,
  "resolved checkout products must only use the trusted source size chart",
);
assert.doesNotMatch(
  matchServiceSource,
  /resolved\.sizeChart\s*\|\|\s*original\.sizeChart/,
  "resolved checkout products must not fall back to a client-supplied size chart",
);

console.log("product size chart self-check passed");
