// This guard is only for a newly generated, already scoped ordinary-chat
// recovery. It does not establish any business, identity or action facts.
const INTERNAL_TAG = /<\s*\/?\s*(?:context|analysis|think|system|assistant|tool_call)(?=[\s/>]|$)/i;
const STRUCTURED_FIELD = /["']?(?:displayText|speechText|voiceMeta|ttsText)["']?\s*[:：]/i;
const SECRET = /\bsk-[A-Za-z0-9_-]{12,}\b|(?:api|secret)[\s._-]*key\s*[:=]|bearer\s+[A-Za-z0-9._~-]{12,}|\bsystem\s+prompt\s*[:：]|系统(?:提示词|内部指令)\s*[:：]/i;

// When the current user supplied the notation, preserve the pre-existing
// complete review instead of treating a literal discussion as a leak.
export function hasUserSuppliedInternalNotation(userText = '') {
  return typeof userText === 'string' && (INTERNAL_TAG.test(userText) || /```/.test(userText));
}

export function inspectReplyTechnicalGuard(replyResult = {}) {
  const text = typeof replyResult.text === 'string' ? replyResult.text.trim() : '';
  if (!text) return { ok: false, reason: 'empty' };
  const channels = [text];
  for (const key of ['displayText', 'speechText']) {
    if (replyResult[key] == null) continue;
    if (typeof replyResult[key] !== 'string' || !replyResult[key].trim()) return { ok: false, reason: 'empty' };
    channels.push(replyResult[key]);
  }
  if (channels.some(value => value.length > 8000)) return { ok: false, reason: 'length' };
  if (channels.some(value => INTERNAL_TAG.test(value) || STRUCTURED_FIELD.test(value) || /```/.test(value) || SECRET.test(value)))
    return { ok: false, reason: 'internal_format' };
  return { ok: true, reason: '' };
}
