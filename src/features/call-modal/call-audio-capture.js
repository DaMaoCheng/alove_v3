const TARGET_SAMPLE_RATE = 16000;

export async function createCallAudioCapture({
  stream,
  onProcessAudio = () => {},
} = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    onProcessAudio({
      input,
      encodeAudio: () => {
        const pcm = convertFloat32ToPcm16(resampleFloat32(input, audioContext.sampleRate, TARGET_SAMPLE_RATE));
        return pcm.byteLength ? arrayBufferToBase64(pcm.buffer) : "";
      },
    });
  };
  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);
  return {
    audioContext,
    sourceNode,
    processorNode,
  };
}

export function getCallAudioConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

export function buildAudioProbePayload({
  input,
  turnId = 0,
  callState = "",
  muted = false,
  paused = false,
  pausedForAssistant = false,
  audioProcessTicks = 0,
  sentFramesInTurn = 0,
} = {}) {
  return {
    type: "audio_probe",
    turnId,
    callState,
    muted,
    paused,
    pausedForAssistant,
    audioProcessTicks,
    sentFramesInTurn,
    rms: Number(calculateRms(input).toFixed(5)),
  };
}

function resampleFloat32(input, sourceRate, targetRate) {
  if (!input?.length) return new Float32Array();
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    output[index] = input[Math.min(input.length - 1, Math.floor(index * ratio))];
  }
  return output;
}

function convertFloat32ToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function calculateRms(input) {
  if (!input?.length) return 0;
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index] || 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / input.length);
}
