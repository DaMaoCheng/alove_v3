export function ensureVoiceAutoplayState(appState = {}) {
  if (!appState.chat) appState.chat = {};
  if (!appState.chat.voiceAutoplayByCharacterId) {
    appState.chat.voiceAutoplayByCharacterId = {};
  }
  return appState.chat.voiceAutoplayByCharacterId;
}

export function collectReadyCharacterVoiceMessageIds(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.senderType === "character")
    .filter((message) => {
      const voice = message?.voice || {};
      return message?.id && voice.audioUrl && normalizeVoiceStatus(voice.assetStatus) === "ready";
    })
    .map((message) => String(message.id));
}

export function markVoiceMessagesForAutoplay(appState, characterId, messages = []) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) return [];
  const messageIds = collectReadyCharacterVoiceMessageIds(messages);
  if (!messageIds.length) return [];

  const store = ensureVoiceAutoplayState(appState);
  const existing = Array.isArray(store[normalizedCharacterId]) ? store[normalizedCharacterId] : [];
  store[normalizedCharacterId] = uniqueIds([...existing, ...messageIds]);
  return store[normalizedCharacterId];
}

export function consumeVoiceAutoplayIds(appState, characterId, availableMessages = null) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) return [];

  const store = ensureVoiceAutoplayState(appState);
  const queuedIds = uniqueIds(store[normalizedCharacterId] || []);
  if (!queuedIds.length) return [];

  if (!Array.isArray(availableMessages)) {
    store[normalizedCharacterId] = [];
    return queuedIds;
  }

  const availableIds = new Set(collectReadyCharacterVoiceMessageIds(availableMessages));
  const playableIds = queuedIds.filter((id) => availableIds.has(id));
  const remainingIds = queuedIds.filter((id) => !availableIds.has(id));
  store[normalizedCharacterId] = remainingIds;
  return playableIds;
}

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

function normalizeVoiceStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "ready";
}
