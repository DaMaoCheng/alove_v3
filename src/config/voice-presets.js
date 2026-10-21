import { ELEVENLABS_VOICE_PRESETS, getElevenLabsVoicePreset } from "../../shared/voice-presets.js?v=20260625";

export { ELEVENLABS_VOICE_PRESETS, getElevenLabsVoicePreset };

export function getVoicePresetLabel(value) {
  return getElevenLabsVoicePreset(value)?.label || String(value || "");
}
