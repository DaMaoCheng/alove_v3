// Translate the old scenario's semantic fixture into actual JEV choice/noul
// answers. Decisions remain explicit test data; no classifier is emulated.
export function jevImageAnswerFixture(body, parsed = {}) {
  const chooseSpan = (criteria, evidence) => Object.keys(criteria).find(key => key !== 'none' && criteria[key] === evidence) || 'none';
  const selected = {
    image_intent: parsed.hasIntent === false ? 'none' : parsed.intentType || 'none',
    image_action: parsed.communicativeAction || 'other', image_kind: parsed.requestKind || 'non_image',
    image_subject: parsed.imageSubject || 'none', image_scope: parsed.requestScope || 'unknown',
    clothing_target: parsed.clothingTarget || 'none', previous_outfit: parsed.appearanceContext?.previousOutfit || 'uncertain',
    appearance_relation: parsed.appearanceContext?.relation || 'uncertain',
  };
  const confidence = Number(parsed.confidence);
  const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
    if (question.type === 'noul') return [key, { noul: ['actor_is_character', 'current_visual_action'].includes(key) ? .99 : key === 'wants_clothing' ? Number(parsed.wants_clothing === true) : Number(parsed.wants_no_clothing === true) }];
    const choice = key === 'actor_evidence' ? chooseSpan(question.criteria, parsed.actorEvidence)
      : key === 'action_evidence' ? [parsed.requestEvidence, parsed.actionEvidence].some(span => span && !String(body.state.message).includes(span)) ? 'none' : chooseSpan(question.criteria, parsed.requestEvidence || parsed.actionEvidence)
      : Object.hasOwn(question.criteria, selected[key]) ? selected[key] : ['unknown', 'none', 'uncertain'].find(value => Object.hasOwn(question.criteria, value)) || Object.keys(question.criteria)[0];
    return [key, { choice, confidence: Number.isFinite(confidence) ? confidence : 0 }];
  }));
  return { model: 'jev-fixture', answers };
}
