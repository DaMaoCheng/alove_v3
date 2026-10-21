// Public candidate metadata is finite; raw source evidence stays server-side.
const UNKNOWN_FIELDS = new Set(["edition", "sleeve", "printing", "giveaway", "terms"]);

export function sanitizeCandidateUnknownFields(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => UNKNOWN_FIELDS.has(item)))];
}

export function publicProductCandidateFields(product = {}) {
  return {
    ...(product.matchStatus === "candidate" || product.matchStatus === "matched" ? { matchStatus: product.matchStatus } : {}),
    candidateUnknownFields: sanitizeCandidateUnknownFields(product.candidateUnknownFields),
    giveaway: product.giveaway === true ? true : product.giveaway === false ? false : null,
  };
}
