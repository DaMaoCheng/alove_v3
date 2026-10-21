const SEARCH_QUERY_SOFT_WORDS = new Set([
  "show",
  "see",
  "find",
  "want",
  "need",
  "looking",
  "look",
  "for",
  "latest",
  "current",
  "season",
  "football",
  "shirt",
  "shirts",
  "jersey",
  "jerseys",
  "kit",
  "kits",
  "soccer",
  "long",
  "short",
  "sleeve",
  "sleeves",
]);

export function buildProductSearchQueryVariants(query = "") {
  const original = safeString(query);
  if (!original) return [];

  const normalized = normalizeSearchQuery(original);
  const tokens = tokenizeSearchQuery(normalized);
  const coreTokens = tokens.filter((token, index) => shouldKeepCoreToken(token, index, tokens));
  const anchorTokens = buildAnchorTokens(tokens);
  const variants = [
    original,
    normalized,
    coreTokens.join(" "),
    coreTokens.filter((token) => !/^\d+(?:st|nd|rd|th)?$/i.test(token)).join(" "),
    ...anchorTokens,
  ];

  return uniqueNonEmpty(variants).slice(0, 8);
}

function shouldKeepCoreToken(token = "", index = 0, tokens = []) {
  if (!token) return false;
  if (SEARCH_QUERY_SOFT_WORDS.has(token)) return false;
  if (/^(?:19|20)\d{2}$/.test(token)) return false;
  if (/^\d{2}$/.test(token) && tokens.some((item) => /^(?:19|20)\d{2}$/.test(item))) return false;
  if (index === 0 && /^\d+$/.test(token) && tokens.some((item) => item.startsWith(`${token}th`))) return false;
  return true;
}

function normalizeSearchQuery(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchQuery(value = "") {
  return normalizeSearchQuery(value).split(/\s+/).filter(Boolean);
}

function buildAnchorTokens(tokens = []) {
  const anchors = [];
  for (const token of tokens) {
    if (!token || SEARCH_QUERY_SOFT_WORDS.has(token)) continue;
    if (/^(?:19|20)\d{2}$/.test(token) || /^\d{1,2}$/.test(token)) continue;
    if (token.length < 3) continue;
    anchors.push(token);
    if (anchors.length >= 1) break;
  }
  return anchors;
}

function uniqueNonEmpty(values = []) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    const text = safeString(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    rows.push(text);
  }
  return rows;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
