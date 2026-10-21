export const ELEVENLABS_VOICE_MODELS = Object.freeze({
  quality: "eleven_v4_turbo",
  fast: "eleven_v4_turbo",
  stable: "eleven_multilingual_v2",
});

export const ELEVENLABS_VOICE_PRESETS = Object.freeze([
  {
    id: "nova",
    label: "Nova",
    provider: "elevenlabs",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/nova.mp3",
  },
  {
    id: "sunny",
    label: "Sunny",
    provider: "elevenlabs",
    voiceId: "cgSgspJ2msm6clMCkdW9",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/sunny.mp3",
  },
  {
    id: "iris",
    label: "Iris",
    provider: "elevenlabs",
    voiceId: "Xb7hH8MSUJpSbSDYk0k2",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/iris.mp3",
  },
  {
    id: "velvet",
    label: "Velvet",
    provider: "elevenlabs",
    voiceId: "pFZP5JQG7iQjIQuC4Bku",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/velvet.mp3",
  },
  {
    id: "mira",
    label: "Mira",
    provider: "elevenlabs",
    voiceId: "hpp4J3VqNfWAUOO0d1Us",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/mira.mp3",
  },
  {
    id: "atlas",
    label: "Atlas",
    provider: "elevenlabs",
    voiceId: "CwhRBWXzGAHq8TQ4Fs17",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/atlas.mp3",
  },
  {
    id: "ever",
    label: "Ever",
    provider: "elevenlabs",
    voiceId: "cjVigY5qzO86Huf0OWal",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/ever.mp3",
  },
  {
    id: "vale",
    label: "Vale",
    provider: "elevenlabs",
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/vale.mp3",
  },
  {
    id: "rook",
    label: "Rook",
    provider: "elevenlabs",
    voiceId: "IKne3meq5aSn9XLyUdCD",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/rook.mp3",
  },
  {
    id: "nolan",
    label: "Nolan",
    provider: "elevenlabs",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/nolan.mp3",
  },
  {
    id: "echo",
    label: "Echo",
    provider: "elevenlabs",
    voiceId: "SAz9YHcvj6GT2YYXdXww",
    qualityModel: ELEVENLABS_VOICE_MODELS.quality,
    fastModel: ELEVENLABS_VOICE_MODELS.fast,
    stableModel: ELEVENLABS_VOICE_MODELS.stable,
    sampleUrl: "/uploads/voice/presets/echo.mp3",
  },
]);

const LEGACY_VOICE_PRESET_ALIASES = Object.freeze({
  warm_friendly: "nova",
  bright_playful: "sunny",
  deep_calm: "vale",
  husky_cool: "rook",
  old_school: "nolan",
});

export function getElevenLabsVoicePreset(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return null;
  const alias = LEGACY_VOICE_PRESET_ALIASES[normalized];
  const lookup = alias || normalized;
  return ELEVENLABS_VOICE_PRESETS.find((preset) => {
    return preset.id.toLowerCase() === lookup || preset.label.toLowerCase() === lookup || preset.voiceId.toLowerCase() === lookup;
  }) || null;
}

export function getDefaultElevenLabsVoicePreset() {
  return ELEVENLABS_VOICE_PRESETS[0];
}
