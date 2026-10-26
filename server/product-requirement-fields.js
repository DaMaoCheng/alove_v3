// Canonical finite USER requirement values. Each caller retains its own
// evidence, empty-value, length and projection rules.
export const PRODUCT_REQUIREMENT_SCALAR_VALUES = Object.freeze({
  requestedProductType: Object.freeze(['shirt', 'top', 'merch']),
  requestedAudience: Object.freeze(['adult', 'kids', 'women']),
  requestedColor: Object.freeze(['black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'orange', 'grey']),
  requestedEdition: Object.freeze(['fan', 'player']),
  requestedPrinting: Object.freeze(['none', 'printed']),
});

// Existing catalogue child labels, kept as sizes rather than inferred ages.
export const CHILD_PRODUCT_SIZE_LABELS = Object.freeze(['14', '16', '18', '20', '22', '24', '26', '28', '30']);

export const PRODUCT_REQUIREMENT_ARRAY_VALUES = Object.freeze({
  requestedFeatures: Object.freeze(['short_sleeve', 'long_sleeve', 'sleeveless']),
  requestedVariants: Object.freeze(['home', 'away', 'third', 'retro']),
  requestedSizes: Object.freeze(['5XL', '4XL', '3XL', '2XL', 'XXL', 'XL', 'XXS', 'XS', 'S', 'M', 'L', ...CHILD_PRODUCT_SIZE_LABELS]),
});

// An identity anchor only, never an action permission or a catalogue fact.
export function hasNamedRetroProductAnchor(intent = {}) {
  const variants = [intent.requestedVariant, ...(Array.isArray(intent.requestedVariants) ? intent.requestedVariants : [])];
  return variants.includes('retro') && Boolean(intent.requestedProductType)
    && Array.isArray(intent.requestedKeywords)
    && intent.requestedKeywords.some(value => typeof value === 'string' && value.trim().length >= 3);
}

// Literal multiword catalogue identity; not an alias, team or person inference.
export function multiwordProductNameTerms(intent = {}) {
  const terms = (Array.isArray(intent.requestedKeywords) ? intent.requestedKeywords : []).flatMap(value => String(value).split(/\s+/));
  return intent.requestedProductType && terms.length >= 2 && terms.length <= 5
    && terms.every(term => /^[\p{Script=Latin}\p{M}]{2,}(?:['’\-][\p{Script=Latin}\p{M}]+)*$/u.test(term))
    && terms.at(-1).length >= 3 ? terms.map(term => term.normalize('NFKC').toLowerCase()) : [];
}
