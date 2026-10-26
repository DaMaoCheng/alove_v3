// Private construction proof: JSON/client projections cannot recreate it. The
// original context and owned requirement state must remain unchanged.
const SOURCE_PROOF = Symbol('server-candidate-source');
const productSignature = products => JSON.stringify((products || []).map(product => ({
  id: String(product.productId || product.id || ''), siteId: product.siteId || '', name: product.name,
  url: product.url, price: product.price, available: product.available, attributeEvidence: product.attributeEvidence,
  ...(product.matchStatus === 'candidate' && product.alternative ? { catalogueDifference: product.alternative } : {}),
})));
export function markCandidateContextSource(context, searchIntent = {}, products = [], location = {}) {
  if (!context) return context;
  Object.defineProperty(context, SOURCE_PROOF, { value: Object.freeze({
    context: JSON.stringify(context), state: JSON.stringify(searchIntent.productCandidateState || null), products: productSignature(products),
    siteId: String(location.siteId || products[0]?.siteId || ''),
    characterId: String(location.characterId || searchIntent.productCandidateState?.characterId || ''),
  }), enumerable: true });
  return context;
}
export function hasCandidateContextSource(context, searchIntent = {}, products = [], location = {}) {
  const proof = context?.[SOURCE_PROOF];
  return Boolean(proof && proof.siteId && proof.characterId
    && proof.siteId === String(location.siteId || '') && proof.characterId === String(location.characterId || '')
    && proof.products === productSignature(products) && proof.context === JSON.stringify(context)
    && proof.state === JSON.stringify(searchIntent.productCandidateState || null));
}
