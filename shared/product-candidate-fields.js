// Public candidate metadata is finite; raw source evidence stays server-side.
const UNKNOWN_FIELDS = new Set(["edition", "sleeve", "printing", "giveaway", "terms"]);

export function sanitizeCandidateUnknownFields(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(item => UNKNOWN_FIELDS.has(item)))];
}

export function publicProductCandidateFields(product = {}) {
  return {
    ...(["candidate", "matched", "alternative"].includes(product.matchStatus) ? { matchStatus: product.matchStatus } : {}),
    candidateUnknownFields: sanitizeCandidateUnknownFields(product.candidateUnknownFields),
    ...(sanitizeProductAlternative(product.alternative) ? { alternative: sanitizeProductAlternative(product.alternative) } : {}),
    giveaway: product.giveaway === true ? true : product.giveaway === false ? false : null,
  };
}

// Display history only; this public metadata never grants search/card permission.
export function sanitizeProductAlternative(value) {
  const validSeason = x => typeof x === "string" && /^(?:19|20)\d{2}(?:\s*[/-]\s*(?:\d{2}|(?:19|20)\d{2}))?$/.test(x) && x.length <= 16;
  if (value?.kind === 'retro_alternative' && validSeason(value.alternativeSeason)
    && (value.requestedSeason === '' || validSeason(value.requestedSeason))
    && ['', 'jersey_kit'].includes(value.alternativeGarment || '')) return {
      kind: 'retro_alternative', requestedSeason: value.requestedSeason, alternativeSeason: value.alternativeSeason,
      alternativeGarment: value.alternativeGarment || '',
    };
  return value?.kind === "season_alternative" && validSeason(value.requestedSeason) && validSeason(value.alternativeSeason)
    ? { kind: "season_alternative", requestedSeason: value.requestedSeason, alternativeSeason: value.alternativeSeason } : null;
}
