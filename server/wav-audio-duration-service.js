import { createPublicError } from "./public-error-utils.js";

export function readWavDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw createPublicError("Guest voice input must be valid WAV audio.", 400);
  }
  let offset = 12;
  let formatSeen = false;
  let dataSeen = false;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) throw createPublicError("WAV audio is malformed.", 400);
    if (chunkId === "fmt " && chunkSize >= 16) {
      if (formatSeen) throw createPublicError("WAV audio contains conflicting format chunks.", 400);
      const audioFormat = buffer.readUInt16LE(dataOffset);
      const channels = buffer.readUInt16LE(dataOffset + 2);
      const sampleRate = buffer.readUInt32LE(dataOffset + 4);
      const byteRate = buffer.readUInt32LE(dataOffset + 8);
      const blockAlign = buffer.readUInt16LE(dataOffset + 12);
      const bitsPerSample = buffer.readUInt16LE(dataOffset + 14);
      if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16_000 || bitsPerSample !== 16 || blockAlign !== 2 || byteRate !== 32_000) {
        throw createPublicError("Guest WAV audio must be 16kHz mono PCM16.", 400);
      }
      formatSeen = true;
    } else if (chunkId === "data") {
      if (dataSeen) throw createPublicError("WAV audio contains conflicting data chunks.", 400);
      dataBytes = chunkSize;
      dataSeen = true;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (!formatSeen || !dataSeen || !dataBytes) throw createPublicError("WAV audio is empty or malformed.", 400);
  return dataBytes / 32_000;
}

export function assertGuestWavDuration(buffer, maxDurationSeconds = 120) {
  const durationSeconds = readWavDurationSeconds(buffer);
  if (durationSeconds > Number(maxDurationSeconds || 120) + 0.25) {
    throw createPublicError("Voice messages cannot exceed 120 seconds.", 413);
  }
  return durationSeconds;
}
