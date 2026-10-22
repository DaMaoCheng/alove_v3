// Transport-only aggregation. Never expose partial, reasoning or tool output as
// a reply; the caller still applies its existing JSON and semantic contracts.
const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_ANSWER_CHARS = 64 * 1024;
const protocolError = kind => Object.assign(new Error('AI reply stream did not contain a complete answer'), {
  code: 'AI_REPLY_PROTOCOL_ERROR', protocolKind: kind,
});

export async function readChatCompletionStream(response, { signal } = {}) {
  if (!response.body?.getReader) throw protocolError('invalid_stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', data = [], text = '', bytes = 0, stopped = false, done = false;
  const abortError = () => signal?.reason || Object.assign(new Error('AI reply stream aborted'), { name: 'AbortError' });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const dispatch = () => {
    if (!data.length) return;
    const raw = data.join('\n'); data = [];
    if (raw === '[DONE]') { done = true; return; }
    let packet;
    try { packet = JSON.parse(raw); } catch { throw protocolError('invalid_stream'); }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet) || packet.error
      || !Array.isArray(packet.choices)) throw protocolError('invalid_stream');
    // Empty choices may carry usage, but cannot certify an answer.
    if (!packet.choices.length) return;
    if (packet.choices.length !== 1 || packet.choices[0]?.index !== 0) throw protocolError('invalid_stream');
    const choice = packet.choices[0], delta = choice.delta;
    if (delta != null && (typeof delta !== 'object' || Array.isArray(delta))) throw protocolError('invalid_stream');
    if (delta?.role != null && delta.role !== 'assistant'
      || delta?.function_call != null || delta?.refusal != null
      || delta?.tool_calls != null && (!Array.isArray(delta.tool_calls) || delta.tool_calls.length))
      throw protocolError('invalid_stream');
    if (delta?.content != null) {
      if (typeof delta.content !== 'string' || stopped && delta.content) throw protocolError('invalid_stream');
      text += delta.content;
      if (text.length > MAX_ANSWER_CHARS) throw protocolError('stream_limit');
    }
    if (choice.finish_reason != null) {
      if (choice.finish_reason !== 'stop') throw protocolError('incomplete_stream');
      stopped = true;
    }
  };
  const consumeLines = (end = false) => {
    // Preserve a trailing CR until the next chunk, including split CRLF.
    let position;
    while (!done && (position = buffer.search(/[\r\n]/)) !== -1) {
      if (!end && buffer[position] === '\r' && position === buffer.length - 1) break;
      const line = buffer.slice(0, position);
      const delimiter = buffer[position] === '\r' && buffer[position + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(position + delimiter);
      if (!line) { dispatch(); continue; }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if ((colon === -1 ? line : line.slice(0, colon)) !== 'data') continue;
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      data.push(value);
    }
  };
  try {
    if (signal?.aborted) throw abortError();
    while (!done) {
      const chunk = await reader.read();
      if (signal?.aborted) throw abortError();
      if (chunk.done) {
        try { buffer += decoder.decode(); } catch { throw protocolError('invalid_stream'); }
        consumeLines(true);
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw protocolError('stream_limit');
      try { buffer += decoder.decode(chunk.value, { stream: true }); } catch { throw protocolError('invalid_stream'); }
      consumeLines();
    }
    if (!done || !stopped) throw protocolError('incomplete_stream');
    if (!text.trim()) throw protocolError('empty_answer');
    return text;
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
