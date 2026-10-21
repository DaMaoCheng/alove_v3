const TARGET_SAMPLE_RATE = 16_000;
const MAX_DURATION_SECONDS = 120;

export async function prepareGuestVoiceClip(voiceClip) {
  const sourceFile = voiceClip?.file;
  if (!(sourceFile instanceof File)) throw new Error("Voice file is invalid.");
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser cannot prepare guest voice input.");
  const context = new AudioContextClass();
  try {
    const sourceBuffer = await sourceFile.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(sourceBuffer.slice(0));
    if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) throw new Error("Voice recording is empty.");
    if (audioBuffer.duration > MAX_DURATION_SECONDS + 0.25) throw new Error("Voice messages cannot exceed 120 seconds.");
    const mono = mixAudioBufferToMono(audioBuffer);
    const resampled = resampleMonoPcm(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
    const wavBytes = encodeMonoPcm16Wav(resampled, TARGET_SAMPLE_RATE);
    const file = new File([wavBytes], `guest-voice-${Date.now()}.wav`, { type: "audio/wav", lastModified: Date.now() });
    return { ...voiceClip, file, durationSeconds: Math.max(1, Math.round(resampled.length / TARGET_SAMPLE_RATE)) };
  } finally {
    await context.close().catch(() => {});
  }
}

export function resampleMonoPcm(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const fromRate = Math.max(1, Number(sourceRate || 0));
  const toRate = Math.max(1, Number(targetRate || 0));
  if (!source.length || fromRate === toRate) return new Float32Array(source);
  const outputLength = Math.max(1, Math.round(source.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.min(source.length - 1, Math.floor(sourcePosition));
    const right = Math.min(source.length - 1, left + 1);
    const weight = sourcePosition - left;
    output[index] = source[left] * (1 - weight) + source[right] * weight;
  }
  return output;
}

export function encodeMonoPcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const buffer = new ArrayBuffer(44 + source.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + source.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, source.length * 2, true);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] || 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function mixAudioBufferToMono(audioBuffer) {
  const output = new Float32Array(audioBuffer.length);
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) output[index] += data[index] / channels;
  }
  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
