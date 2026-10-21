export function logCallTurnTiming(payload = {}) {
  console.info("[aiove][call-timing]", JSON.stringify({
    callSessionId: payload.callSessionId || "",
    turnId: payload.turnId || 0,
    characterId: payload.characterId || "",
    userMessageMs: Number(payload.userMessageMs || 0),
    replyTotalMs: Number(payload.replyTotalMs || 0),
    assistantMessageId: payload.assistantMessageId || "",
    voiceAssetId: payload.voiceAssetId || "",
    voiceStatus: payload.voiceStatus || "",
    ttsModel: payload.ttsModel || "",
    languageCode: payload.languageCode || "",
    languageLabel: payload.languageLabel || "",
    ttsModelReason: payload.ttsModelReason || "",
    hasAudio: Boolean(payload.hasAudio),
  }));
}

export function logCallAudioEvent(session, payload = {}) {
  console.info("[aiove][call-audio]", JSON.stringify({
    callSessionId: session.callSessionId || "",
    characterId: session.characterId || "",
    listening: Boolean(session.listening),
    processing: Boolean(session.processing),
    activeTurnId: Number(session.activeTurnId || 0),
    ...payload,
  }));
}
