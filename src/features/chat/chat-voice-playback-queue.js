export function collectPlayableVoiceMessages(messages = [], { messageIds = null } = {}) {
  const allowedIds = Array.isArray(messageIds)
    ? new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))
    : null;
  if (allowedIds && !allowedIds.size) return [];

  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.senderType === "character")
    .filter((message) => !allowedIds || allowedIds.has(String(message?.id || "")))
    .filter((message) => {
      const voice = message?.voice || {};
      return voice.audioUrl && normalizeVoiceStatus(voice.assetStatus) === "ready";
    })
    .map((message) => ({
      messageId: String(message.id || ""),
      voiceId: String(message.voice?.id || ""),
      audioUrl: String(message.voice?.audioUrl || ""),
      displayOrder: Number(message.displayOrder || 0),
    }))
    .filter((item) => item.messageId && item.audioUrl)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function createChatVoicePlaybackQueue({ createAudio = (url) => new Audio(url), onStateChange = () => {} } = {}) {
  const state = {
    queue: [],
    playedMessageIds: new Set(),
    current: null,
    audio: null,
    autoPaused: false,
  };

  function enqueue(items = [], { force = false } = {}) {
    for (const item of items) {
      if (!item?.messageId || !item.audioUrl) continue;
      if (!force && state.playedMessageIds.has(item.messageId)) continue;
      if (state.current?.messageId === item.messageId) continue;
      if (state.queue.some((queued) => queued.messageId === item.messageId)) continue;
      state.queue.push(item);
    }
    state.queue.sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
    notify();
  }

  async function playNext() {
    if (state.autoPaused || state.audio || state.current) return;
    const next = state.queue.shift();
    if (!next) {
      notify();
      return;
    }

    state.current = next;
    state.audio = createAudio(next.audioUrl);
    state.audio.addEventListener("ended", handleEnded, { once: true });
    state.audio.addEventListener("error", handleEnded, { once: true });
    notify();

    try {
      await state.audio.play();
    } catch {
      handleEnded();
    }
  }

  function handleEnded() {
    if (state.current?.messageId) {
      state.playedMessageIds.add(state.current.messageId);
    }
    state.audio = null;
    const shouldContinue = !state.autoPaused;
    state.current = null;
    notify();
    if (shouldContinue) void playNext();
  }

  function pauseAll() {
    state.autoPaused = true;
    stopAudioOnly();
    state.current = null;
    notify();
  }

  function stopAll() {
    stopAudioOnly();
    state.current = null;
    state.queue = [];
    notify();
  }

  function resumeAuto() {
    state.autoPaused = false;
    notify();
    return playNext();
  }

  function stopAudioOnly() {
    if (!state.audio) return;
    state.audio.pause();
    state.audio.currentTime = 0;
    state.audio = null;
  }

  function getState() {
    return {
      queueLength: state.queue.length,
      currentMessageId: state.current?.messageId || "",
      currentVoiceId: state.current?.voiceId || "",
      autoPaused: state.autoPaused,
    };
  }

  function notify() {
    onStateChange(getState());
  }

  return {
    enqueue,
    playNext,
    pauseAll,
    stopAll,
    resumeAuto,
    getState,
  };
}

function normalizeVoiceStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "ready";
}
