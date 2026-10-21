import assert from "node:assert/strict";
import { buildTtmallAttributeEvidence, evaluateProductAttributeMatch, extractRequestedPrinting, normalizeProductAttributeEvidence } from "../server/product-attribute-evidence-service.js";
import { normalizeTtmallProduct } from "../server/product-source-ttmall-mapper.js";
import { buildProductSearchIntent, buildRecentProductContext, filterProductsByIntent } from "../server/product-intent-service.js";

const base = {
  product_id: 501,
  title: "Real Madrid Away Soccer Fan Jersey 2026/27",
  team_name: "Real Madrid",
  category: "Fan Jersey",
  year: "2026/27",
  home_away: "Away",
  version: "Fan Version",
  star_name: "",
  star_num: "",
  is_giveaway: 1,
  style: 1,
  is_stock: 1,
  price: 0,
  // A copied marketing paragraph must not override explicit catalogue fields.
  description_text: "Home white player jersey with long sleeves and name printing",
};
const normalized = normalizeTtmallProduct(base);
assert.deepEqual(normalized.attributeEvidence, { edition: "fan", sleeve: "unknown", printing: "none", giveaway: true });
assert.equal(evaluateProductAttributeMatch(normalized, { requestedFeatures: ["short_sleeve"], requestedPrinting: "none" }).status, "unknown");
assert.deepEqual(evaluateProductAttributeMatch(normalized, { requestedFeatures: ["short_sleeve"] }).unknownFields, ["sleeve"]);
assert.equal(evaluateProductAttributeMatch(normalized, { requestedPrinting: "none", requestedFeatures: ["fan_version"] }).status, "match");
assert.equal(evaluateProductAttributeMatch(normalized, { requestedFeatures: ["authentic"] }).status, "mismatch");

const short = normalizeTtmallProduct({ ...base, title: `${base.title} Short Sleeves`, is_giveaway: 0 });
const long = normalizeTtmallProduct({ ...base, title: `${base.title} Long Sleeves` });
const printed = normalizeTtmallProduct({ ...base, product_id: 502, title: `${base.title} Short Sleeves`, star_name: "BELLINGHAM", star_num: "5" });
const intent = { requestedTeam: "Real Madrid", requestedVariants: ["away"], requestedSeason: "2026/27", requestedFeatures: ["short_sleeve"], requestedPrinting: "none" };
assert.deepEqual(filterProductsByIntent([normalized, short, long, printed], intent).map((product) => product.id), ["501"]);
assert.equal(evaluateProductAttributeMatch(long, intent).status, "mismatch");
assert.deepEqual(evaluateProductAttributeMatch(printed, intent).mismatchFields, ["printing"]);
assert.equal(evaluateProductAttributeMatch({ name: "Short Sleeves Jersey", customizationOptions: [{ name: "Name", required: false }, { name: "Number", required: false }] }, { requestedPrinting: "none" }).status, "unknown");
assert.equal(buildTtmallAttributeEvidence({ star_name: null, star_num: null }).printing, "unknown");
assert.equal(buildTtmallAttributeEvidence({ star_name: {}, star_num: [] }).printing, "unknown");
assert.equal(buildTtmallAttributeEvidence({ star_name: "", star_num: "7" }).printing, "printed");
assert.equal(buildTtmallAttributeEvidence({ category: "Fan Version Long Sleeves", style: 1 }).sleeve, "long_sleeve");
assert.equal(buildTtmallAttributeEvidence({ title: "Short Sleeve Jersey", category: "Long Sleeves" }).sleeve, "conflict");
assert.equal(evaluateProductAttributeMatch({ name: "Short Sleeve Jersey", subtitle: "Long Sleeves" }, { requestedFeatures: ["short_sleeve"] }).status, "unknown");
assert.equal(evaluateProductAttributeMatch(short, { requestedFeatures: ["short_sleeve", "long_sleeve"] }).status, "mismatch");
assert.equal(buildTtmallAttributeEvidence({}).giveaway, null);
assert.equal(short.attributeEvidence.giveaway, false);
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid BELLINGHAM #5 Away Soccer Fan Jersey 2026/27" }).printing, "printed");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid Nameset Jersey" }).printing, "printed");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid Jersey Without Nameset" }).printing, "unknown");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid Soccer Fan Jersey" }).edition, "fan");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid Soccer Match Jersey" }).edition, "player");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid Soccer Fan Jersey", version: "Player Version" }).edition, "conflict");
assert.equal(buildTtmallAttributeEvidence({ title: "Real Madrid BELLINGHAM Jersey" }).edition, "unknown");
assert.equal(buildTtmallAttributeEvidence({ title: "[Free]Real Madrid Jersey" }).giveaway, null);
assert.equal(normalizeTtmallProduct({ title: "Real Madrid Soccer Fan Jersey" }).canonicalEdition, "fan");
assert.equal(evaluateProductAttributeMatch({ name: "Real Madrid Soccer Fan Jersey" }, { requestedFeatures: ["fan_version"] }).status, "match");
assert.equal(evaluateProductAttributeMatch({ name: "Real Madrid Jersey" }, { requestedFeatures: ["fan_version"] }).status, "unknown");

assert.deepEqual(normalizeProductAttributeEvidence({ edition: "fan", sleeve: "<script>", printing: true, giveaway: "free", secret: "drop" }), { edition: "fan", sleeve: "unknown", printing: "unknown", giveaway: null });
for (const text of ["Real Madrid away jersey without name or number", "Real Madrid jersey no nameset", "Real Madrid jersey unprinted", "Real Madrid球衣不带名字号码", "Real Madrid camiseta sin número ni nombre"]) {
  assert.equal(extractRequestedPrinting(text), "none", text);
  const result = buildProductSearchIntent(text);
  assert.equal(result.customizationRequest, "", `negative printing must not request customization: ${text}`);
  assert.equal(result.requestedPrinting, "none", text);
}
assert.equal(extractRequestedPrinting("Real Madrid jersey with name and number"), "");
assert.equal(extractRequestedPrinting("Real Madrid jersey without name but with number 7"), "");
assert.equal(extractRequestedPrinting("Real Madrid jersey without name"), "");
assert.equal(extractRequestedPrinting("Real Madrid jersey without name or player name"), "");
assert.equal(buildProductSearchIntent("Real Madrid jersey with name and number").customizationRequest, "jersey");
assert.deepEqual(buildProductSearchIntent("Real Madrid camiseta manga corta").requestedFeatures, ["short_sleeve"]);
const context = buildRecentProductContext([{ sender_type: "user", text_content: "Real Madrid away jersey without name or number" }]);
assert.equal(context.requestedPrinting, "none");
assert.equal(buildProductSearchIntent("the same in short sleeves", "", { recentProductContext: context }).requestedPrinting, "none");
console.log("product attribute evidence self-check passed");
