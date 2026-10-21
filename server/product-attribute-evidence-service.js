import { requestedProductEdition, resolveCanonicalProductEdition } from "./product-edition-service.js";

const SLEEVES = new Set(["short_sleeve", "long_sleeve", "sleeveless"]);
const safeText = (value) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// Attribute evidence uses explicit catalogue labels, never generic marketing
// descriptions, images, numeric style IDs or the absence of another attribute.
export function buildTtmallAttributeEvidence(product = {}) {
  const title = safeText(product.title || product.name);
  const labels = [product.title || product.name, product.category, product.alias_category_name, product.sleeve, product.sleeve_length];
  const name = safeText(product.star_name);
  const number = safeText(product.star_num);
  const hasPrintFields = own(product, "star_name") && own(product, "star_num")
    && [product.star_name, product.star_num].every((value) => typeof value === "string" || typeof value === "number");
  const printing = name || number || titleShowsPrinting(title) ? "printed" : hasPrintFields ? "none" : "unknown";
  const giveaway = [1, "1", true].includes(product.is_giveaway) ? true
    : [0, "0", false].includes(product.is_giveaway) ? false : null;
  const printNumber = printedNumber(number || title.match(/#\s*(\d{1,3})\b/u)?.[1]);
  return {
    edition: resolveCatalogueEdition({ name: title, version: safeText(product.version), subtitle: safeText(product.category) }),
    sleeve: resolveSleeve(labels),
    printing,
    ...(printNumber ? { printNumber } : {}),
    giveaway,
  };
}

export function resolveProductAttributeEvidence(product = {}) {
  const evidence = normalizeProductAttributeEvidence(product.attributeEvidence);
  const labels = [product.name || product.title, product.subtitle, ...(Array.isArray(product.features) ? product.features : [])];
  // Normalizers own this object. Missing source fields remain unknown; optional
  // customization controls do not prove whether the catalogue item is printed.
  return {
    edition: evidence.edition !== "unknown" ? evidence.edition : resolveCatalogueEdition(product),
    sleeve: SLEEVES.has(evidence?.sleeve) || evidence?.sleeve === "conflict" ? evidence.sleeve : resolveSleeve(labels),
    printing: evidence.printing === "unknown" && titleShowsPrinting(safeText(product.name || product.title)) ? "printed" : evidence.printing,
    printNumber: evidence.printNumber || printedNumber(safeText(product.name || product.title).match(/#\s*(\d{1,3})\b/u)?.[1]),
    giveaway: evidence.giveaway,
  };
}

function resolveCatalogueEdition(product = {}) {
  const canonical = resolveCanonicalProductEdition(product);
  const title = safeText(product.name || product.title).toLowerCase();
  const fan = /\bfan\s+jersey\b/u.test(title);
  const player = /\bmatch\s+jersey\b/u.test(title);
  if (canonical === "conflict" || (fan && player) || (canonical === "player" && fan) || (canonical === "fan" && player)) return "conflict";
  return ["fan", "player"].includes(canonical) ? canonical : fan ? "fan" : player ? "player" : "unknown";
}

function titleShowsPrinting(title = "") {
  if (/\b(?:without|no)\s+(?:name\s*set|nameset)\b|\bunprinted\b/iu.test(title)) return false;
  return /#\s*\d{1,3}\b|\b(?:name\s*set|nameset)\b/iu.test(title);
}

export function normalizeProductAttributeEvidence(value = {}) {
  return {
    edition: ["fan", "player", "conflict"].includes(value?.edition) ? value.edition : "unknown",
    sleeve: SLEEVES.has(value?.sleeve) || value?.sleeve === "conflict" ? value.sleeve : "unknown",
    printing: ["none", "printed", "conflict"].includes(value?.printing) ? value.printing : "unknown",
    giveaway: typeof value?.giveaway === "boolean" ? value.giveaway : null,
    ...(printedNumber(value?.printNumber) ? { printNumber: printedNumber(value.printNumber) } : {}),
  };
}

function printedNumber(value) {
  const text = safeText(value);
  return /^\d{1,3}$/.test(text) ? String(Number(text)) : "";
}

export function evaluateProductAttributeMatch(product = {}, intent = {}) {
  const evidence = resolveProductAttributeEvidence(product);
  const requestedSleeves = [...new Set((Array.isArray(intent.requestedFeatures) ? intent.requestedFeatures : []).filter((feature) => SLEEVES.has(feature)))];
  const requirements = [];
  if (requestedSleeves.length) requirements.push(["sleeve", requestedSleeves.length === 1 ? requestedSleeves[0] : "conflict"]);
  if (["none", "printed"].includes(intent.requestedPrinting)) requirements.push(["printing", intent.requestedPrinting]);
  const edition = requestedProductEdition(intent);
  if (edition && !(intent.commerceRoute === "product_question" && intent.cardAllowed === false)) requirements.push(["edition", edition]);
  const matchedFields = [];
  const mismatchFields = [];
  const unknownFields = [];
  for (const [field, expected] of requirements) {
    if (expected === "conflict") mismatchFields.push(field);
    else if (["unknown", "conflict"].includes(evidence[field])) unknownFields.push(field);
    else if (evidence[field] === expected) matchedFields.push(field);
    else mismatchFields.push(field);
  }
  // An identity confirmation never changes a requested number. A base blank
  // shirt may still use the existing customization flow; an already printed
  // contradictory number cannot be treated as that requested customization.
  const number = printedNumber(intent.requestedPrintNumber);
  if (number && evidence.printing === "printed") {
    if (!evidence.printNumber) unknownFields.push("printing");
    else if (evidence.printNumber !== number) mismatchFields.push("printing");
  }
  return { status: mismatchFields.length ? "mismatch" : unknownFields.length ? "unknown" : "match", matchedFields, mismatchFields, unknownFields };
}

export function extractRequestedPrinting(text = "") {
  const value = safeText(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Partial or mixed printing requirements need the commerce classifier. A
  // fast path must not turn "no name, with number" into an unprinted shirt.
  if (/\b(?:with|con)\s+(?:(?:a|player|printed)\s+)*(?:name|number|nombre|numero)\b|(?:只印|要印)(?:名字|姓名|号码)/u.test(value)) return "";
  const noPrinting = /\b(?:without|no)\s+(?:(?:a|any|player|printed)\s+)*(?:nameset|printing)\b|\b(?:plain|blank)\s+(?:jersey|shirt)\b|\bunprinted\b|(?:不要|不带|没有|无|不)(?:印字|印号)/u.test(value);
  const pair = value.match(/\b(?:without|no|sin)\s+(?:(?:a|any|player|printed|el|un)\s+)*(name|number|nombre|numero)\b.{0,25}\b(?:and|or|nor|ni|y)\s+(?:(?:a|any|player|printed|el|un)\s+)*(name|number|nombre|numero)\b/u);
  const noNameAndNumber = Boolean(pair && /^(?:name|nombre)$/.test(pair[1]) !== /^(?:name|nombre)$/.test(pair[2]))
    || /(?:不要|不带|没有|无)(?:球员)?(?:姓名|名字)(?:和|或|及)?号码|(?:不要|不带|没有|无)(?:球员)?号码(?:和|或|及)?(?:姓名|名字)/u.test(value);
  return noPrinting || noNameAndNumber ? "none" : "";
}

function resolveSleeve(labels = []) {
  const found = new Set();
  for (const label of labels) {
    const value = safeText(label).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_-]/g, " ");
    if (/\b(?:short sleeves?|mangas? cortas?)\b|短袖/u.test(value)) found.add("short_sleeve");
    if (/\b(?:long sleeves?|mangas? largas?)\b|长袖/u.test(value)) found.add("long_sleeve");
    if (/\b(?:sleeveless|without sleeves|sin mangas?)\b|无袖/u.test(value)) found.add("sleeveless");
  }
  return found.size > 1 ? "conflict" : [...found][0] || "unknown";
}
