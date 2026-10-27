// USER context is bounded evidence, never image permission or catalogue proof.
export function pendingAppearanceUserContext(context = null) {
  const recent = Array.isArray(context?.recentConversation) ? context.recentConversation.slice(-6) : [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const item = recent[i];
    if (['image_generation', 'mascot_library_image', 'product', 'attachment'].includes(item?.kind)) return null;
    if (item?.role === 'user' && item.kind === 'text') {
      const userText = String(item.text || '').trim().slice(0, 600);
      return userText ? { userText } : null;
    }
  }
  return null;
}
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const quoted = (span, text) => typeof span === 'string' && span.trim().length >= 2 && span.length <= 240
  && normalize(text).toLowerCase().includes(normalize(span).toLowerCase());

export function resolveImageAppearance(result, parsed, { pendingContext = null, userText = '' } = {}) {
  if (!pendingContext || !result.hasIntent || !result.allowed || result.intentType !== 'library_photo'
    || result.explicitGeneration || result.conditions?.wants_clothing || result.conditions?.wants_no_clothing) return result;
  const appearance = parsed.appearanceContext;
  const clarify = () => ({ ...result, allowed: false, explicitGeneration: false,
    appearanceClarificationRequired: true, reason: 'appearance_uncertain' });
  if (!appearance || typeof appearance !== 'object') return clarify();
  if (appearance.previousOutfit === 'none' && appearance.relation === 'none') return result;
  if (appearance.previousOutfit !== 'clothed' || !quoted(appearance.previousEvidence, pendingContext.userText)) return clarify();
  if (!quoted(appearance.currentEvidence, userText)) return clarify();
  if (appearance.relation === 'different') return result;
  if (appearance.relation !== 'continue' || !['generic', 'catalogue_product', 'user_upload'].includes(appearance.target)) return clarify();
  return { ...result, intentType: 'try_on', explicitGeneration: true,
    conditions: { wants_clothing: true, wants_no_clothing: false }, clothingTarget: appearance.target,
    appearanceContext: { relation: 'continue', previousEvidence: normalize(appearance.previousEvidence),
      currentEvidence: normalize(appearance.currentEvidence), target: appearance.target } };
}
