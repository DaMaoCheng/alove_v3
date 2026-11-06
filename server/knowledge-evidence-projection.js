// Server-owned sentence spans separate answer permission from source context.
export function knowledgeSentenceSpans(content) {
  return [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(String(content || ''))]
    .map((part, index) => ({ id: `s${index}`, text: part.segment.trim() })).filter(row => row.text);
}
export function projectKnowledgeEvidence(item = {}) {
  const sourceContent = String(item.sourceContent ?? item.content ?? '');
  if (!Array.isArray(item.answerEvidence)) return { scoped: false, sourceContent, content: String(item.content || ''), answerEvidence: [] };
  const spans = new Map(knowledgeSentenceSpans(sourceContent).map(row => [row.id, row.text]));
  const seen = new Set();
  const valid = item.answerEvidence.length > 0 && item.answerEvidence.every(row => row && !seen.has(row.id) && seen.add(row.id)
    && ['answer', 'qualification'].includes(row.role) && spans.get(row.id) === row.text);
  const answerEvidence = valid && item.answerEvidence.some(row => row.role === 'answer') ? item.answerEvidence : [];
  const sourceRelations = selectedSourceRelations(sourceContent, { answerSentenceIds: answerEvidence.map(row => row.id), qualificationSentenceIds: [], sourceRelations: item.sourceRelations });
  return { scoped: true, sourceContent, answerEvidence, sourceRelations, content: answerEvidence.map(row => row.text).join('\n') };
}
export function selectedKnowledgeEvidence(content, match) {
  if (!Array.isArray(match.answerSentenceIds) || !Array.isArray(match.qualificationSentenceIds)) return null;
  const spans = knowledgeSentenceSpans(content), known = new Set(spans.map(row => row.id));
  const answers = new Set(match.answerSentenceIds), qualifications = new Set(match.qualificationSentenceIds);
  if (!answers.size || answers.size !== match.answerSentenceIds.length || qualifications.size !== match.qualificationSentenceIds.length
    || [...answers, ...qualifications].some(id => !known.has(id)) || [...answers].some(id => qualifications.has(id))) return null;
  return spans.filter(row => answers.has(row.id) || qualifications.has(row.id))
    .map(row => ({ ...row, role: answers.has(row.id) ? 'answer' : 'qualification' }));
}


const RELATION_TYPES = new Set(['sequence', 'addition', 'causal', 'alternative', 'condition']);
// Relations cannot introduce unselected source prose. The quote must cover the
// complete selected sentence range, including every intervening qualification.
export function selectedSourceRelations(content, match = {}) {
  if (!Array.isArray(match.sourceRelations) || match.sourceRelations.length > 12) return [];
  const spans = knowledgeSentenceSpans(content), selected = new Set([...(match.answerSentenceIds || []), ...(match.qualificationSentenceIds || [])]);
  const seen = new Set();
  let quoteCharacters = 0;
  return match.sourceRelations.filter(row => {
    if (!row || !RELATION_TYPES.has(row.type) || row.fromSentenceId === row.toSentenceId || typeof row.quote !== 'string' || row.quote.length > 1800) return false;
    const from = spans.findIndex(span => span.id === row.fromSentenceId), to = spans.findIndex(span => span.id === row.toSentenceId);
    if (from < 0 || to < 0 || !String(content).includes(row.quote)) return false;
    const range = spans.slice(Math.min(from, to), Math.max(from, to) + 1);
    if (!range.every(span => selected.has(span.id) && row.quote.includes(span.text))) return false;
    const quoted = knowledgeSentenceSpans(row.quote);
    if (quoted.length !== range.length || !quoted.every((span, index) => span.text === range[index].text)) return false;
    const key = JSON.stringify([row.type, row.fromSentenceId, row.toSentenceId]);
    if (seen.has(key) || quoteCharacters + row.quote.length > 3600) return false;
    quoteCharacters += row.quote.length; seen.add(key); return true;
  }).map(row => ({ type: row.type, fromSentenceId: row.fromSentenceId, toSentenceId: row.toSentenceId, quote: row.quote }));
}

// All model-facing lanes consume this same fact/relationship representation.
// Single-fact wording retains its original conditions and internal relations.
export function knowledgeEvidenceModelContent(item = {}) {
  const projected = projectKnowledgeEvidence(item);
  if (!projected.scoped) return projected.content;
  return JSON.stringify({ facts: projected.answerEvidence, sourceRelations: projected.sourceRelations.map(({ type, fromSentenceId, toSentenceId }) => ({ type, fromSentenceId, toSentenceId })),
    crossFactInference: 'Treat facts as separately scoped claims. Preserve each original condition and internal relationship. Only explicit sourceRelations authorize constructing a new sequence, sum or causal relationship BETWEEN independent facts; an empty list leaves those relationships unverified. Do not infer a combined total, guarantee or dependency from co-occurrence. Answer the complete current question in context.' });
}
