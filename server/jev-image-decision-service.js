import { evaluateJevQuestions } from './jev-evaluation-service.js';
import { resolveCharacterImageFollowupContext } from './chat-image-conversation-context-service.js';
import { pendingAppearanceUserContext } from './chat-image-appearance-context-service.js';

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const choice = (instructions, entries) => ({ type: 'choice', instructions, criteria: Object.fromEntries(entries.map(value => [value, value])) });

// Extract evidence from user text; it does not independently reclassify intent.
function evidenceChoices(text, followup) {
  const sources = [text, ...(followup ? [followup.requestText, ...(followup.priorRequestTexts || [])] : [])];
  const spans = [];
  for (const source of sources) {
    const value = normalize(source);
    const words = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(value)].filter(item => item.isWordLike).map(item => item.segment)
      : value.split(/\s+/);
    for (const span of [value.slice(0, 240), ...words]) {
      if (span && span !== normalize(text) && !spans.includes(span)) spans.push(span);
      if (spans.length >= 96) break;
    }
  }
  return Object.fromEntries([['none', 'No quoted character reference'], ...spans.slice(0, 96).map((span, i) => ['span_' + i, span])]);
}

function actionChoices(text) {
  const value = normalize(text), spans = [value, ...value.split(/[,.!?;:，。！？；：]+/u).map(normalize).filter(Boolean)];
  const tokens = [...value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  for (const size of [2, 3, 4, 6, 8, 1]) for (let i = 0; i + size <= tokens.length; i++) {
    const span = value.slice(tokens[i].index, tokens[i + size - 1].index + tokens[i + size - 1][0].length);
    if (!spans.includes(span)) spans.push(span);
    if (spans.length >= 128) break;
  }
  return Object.fromEntries([['none', 'No quoted action'], ...spans.slice(0, 128).map((span, i) => ['span_' + i, span])]);
}

export async function classifyJevImageDetails(text, { character = null, conversationContext = null,
  primaryDecision = null, evaluate = evaluateJevQuestions, logContext = {} } = {}) {
  const followup = resolveCharacterImageFollowupContext(conversationContext);
  const pending = !followup ? pendingAppearanceUserContext(conversationContext) : null;
  const recent = (conversationContext?.recentConversation || []).slice(-6);
  const latestImageKind = conversationContext?.latestImageKind === 'character'
    && !recent.some(item => ['product', 'attachment', 'image_generation', 'mascot_library_image'].includes(item.kind))
    ? '' : conversationContext?.latestImageKind || '';
  const actors = evidenceChoices(text, followup), actions = actionChoices(text);
  const questions = {
    image_type: choice('The primary intent is already a character image request. Select how to fulfill it: library_photo for an ordinary or additional existing character photo; explicit_generation for a new character image; try_on for a character wearing a requested outfit; group_photo for a character with another person; disallowed for explicitly unsupported posters, ads or product artwork; unclear only if the type itself is genuinely ambiguous. Do not reclassify whether the user requested a picture.', ['library_photo', 'explicit_generation', 'try_on', 'group_photo', 'disallowed', 'unclear']),
    image_scope: choice('Does the ENTIRE message contain only the image request or also a separate question or task? Choose mixed when there is an additional request; unknown if genuinely unclear.', ['image_only', 'mixed', 'unknown']),
    clothing_target: choice('For the requested outfit, select its actual source: catalogue_product means a specific selected or referenced store item; user_upload requires a real supplied image; generic means a described or imagined outfit; none means no outfit; unclear means the source is genuinely unclear. A team name or color alone is not proof of a selected store product.', ['catalogue_product', 'user_upload', 'generic', 'none', 'unclear']),
    actor_evidence: { type: 'choice', instructions: 'Select the exact original span referring to the character for this already-established image request. Use a prior user span only for an unambiguous additional-photo followup. Choose none if no span exists.', criteria: actors },
    action_evidence: { type: 'choice', instructions: 'Select the exact current image request clause, excluding any separate question; short requests for another photo may be elliptical. Choose none if no span exists.', criteria: actions },
  };
  if (pending) Object.assign(questions, {
    previous_outfit: choice('What does the last user context contain: a still-pending clothed appearance, no such appearance, or genuinely unclear?', ['none', 'clothed', 'uncertain']),
    appearance_relation: choice('For the already-established image request, select whether it continues that pending appearance, requests a different appearance, has neither relation, or is genuinely unclear.', ['none', 'continue', 'different', 'uncertain']),
  });
  const result = await evaluate({ sourceRef: 'jev-image-type', logContext, state: {
    message: normalize(text), primaryImageIntent: primaryDecision?.imageIntent || '',
    character: { name: character?.name || '', category: character?.categoryId || character?.category_id || '' },
    recentConversation: recent.filter(item => item.kind !== 'mascot_greeting_image'),
    latestImageKind, characterImageFollowup: followup, pendingUserAppearance: pending,
  }, questions });
  if (!result.ok) return result;
  const a = result.answers, intentType = a.image_type.choice, target = a.clothing_target.choice;
  const actorEvidence = a.actor_evidence.choice === 'none' ? '' : actors[a.actor_evidence.choice] || '';
  const actionEvidence = a.action_evidence.choice === 'none' ? '' : actions[a.action_evidence.choice] || '';
  const role = ['library_photo', 'explicit_generation', 'try_on', 'group_photo'].includes(intentType);
  const unsupported = intentType === 'disallowed';
  return { ...result, parsed: {
    // Confidence is diagnostic only: the selected choice is authoritative.
    confidence: Number(a.image_type.confidence), intentType, hasIntent: role || unsupported,
    allowed: role, communicativeAction: 'request_visual_output', requestKind: unsupported ? 'unsupported_image' : 'character_image',
    imageSubject: 'character', requestScope: a.image_scope.choice, clothingTarget: target,
    requestEvidence: actionEvidence, actionEvidence, actorEvidence,
    explicitGeneration: ['explicit_generation', 'try_on', 'group_photo'].includes(intentType),
    wants_clothing: primaryDecision?.imageConditions?.wants_clothing === true || intentType === 'try_on',
    wants_no_clothing: primaryDecision?.imageConditions?.wants_no_clothing === true,
    clothingTargetUncertain: intentType === 'try_on' && (['none', 'unclear'].includes(target)
      || (target === 'user_upload' && conversationContext?.hasRecentUserImage !== true)),
    ...(pending ? { appearanceContext: { previousOutfit: a.previous_outfit.choice, relation: a.appearance_relation.choice,
      previousEvidence: normalize(pending.userText).slice(0, 240), currentEvidence: normalize(text).slice(0, 240), target } } : {}),
  } };
}
