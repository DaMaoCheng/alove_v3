export function emitCallDiagnostics(client, payload = {}) {
  const heardMs = client.turnStartedAt && client.transcriptFinalAt
    ? Math.max(0, Math.round(client.transcriptFinalAt - client.turnStartedAt))
    : 0;
  const assistantWaitMs = client.transcriptFinalAt && client.assistantAudioAt
    ? Math.max(0, Math.round(client.assistantAudioAt - client.transcriptFinalAt))
    : 0;
  client.onEvent({
    type: "diagnostics",
    payload,
    diagnostics: {
      heardMs,
      assistantWaitMs,
      timing: payload.timing || null,
    },
  });
}
