// Canonical finite USER requirement values. Each caller retains its own
// evidence, empty-value, length and projection rules.
export const PRODUCT_REQUIREMENT_SCALAR_VALUES = Object.freeze({
  requestedProductType: Object.freeze(['shirt', 'top', 'merch']),
  requestedAudience: Object.freeze(['adult', 'kids', 'women']),
  requestedColor: Object.freeze(['black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'orange', 'grey']),
  requestedEdition: Object.freeze(['fan', 'player']),
  requestedPrinting: Object.freeze(['none', 'printed']),
});

export const PRODUCT_REQUIREMENT_ARRAY_VALUES = Object.freeze({
  requestedFeatures: Object.freeze(['short_sleeve', 'long_sleeve', 'sleeveless']),
  requestedVariants: Object.freeze(['home', 'away', 'third', 'retro']),
  requestedSizes: Object.freeze(['5XL', '4XL', '3XL', '2XL', 'XXL', 'XL', 'XXS', 'XS', 'S', 'M', 'L']),
});
