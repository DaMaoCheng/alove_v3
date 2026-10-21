import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const OUTPUT_DIR = "/tmp/alove-elevenlabs-test";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_TEXT = "The first move is what sets everything in motion.";

function readEnv(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function requireApiKey() {
  const apiKey = readEnv("ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY. Export it before running this script.");
  }
  return apiKey;
}

async function toBuffer(audio) {
  if (audio instanceof Uint8Array) return Buffer.from(audio);
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (audio?.arrayBuffer) return Buffer.from(await audio.arrayBuffer());
  if (audio?.getReader) {
    const chunks = [];
    const reader = audio.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  if (audio?.pipe || audio instanceof Readable) {
    const chunks = [];
    for await (const chunk of audio) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error(`Unsupported audio response type: ${Object.prototype.toString.call(audio)}`);
}

const apiKey = requireApiKey();
const voiceId = readEnv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID);
const modelId = readEnv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL_ID);
const outputFormat = readEnv("ELEVENLABS_OUTPUT_FORMAT", DEFAULT_OUTPUT_FORMAT);
const text = readEnv("ELEVENLABS_TEXT", DEFAULT_TEXT);

if (!text) {
  throw new Error("ELEVENLABS_TEXT is empty after trim().");
}

const client = new ElevenLabsClient({ apiKey });
const audio = await client.textToSpeech.convert(voiceId, {
  text,
  modelId,
  outputFormat,
});

const audioBuffer = await toBuffer(audio);
if (!audioBuffer.length) {
  throw new Error("ElevenLabs returned an empty audio payload.");
}

await mkdir(OUTPUT_DIR, { recursive: true });
const outputPath = join(OUTPUT_DIR, `sdk-tts-${Date.now()}.mp3`);
await writeFile(outputPath, audioBuffer);

console.log("SDK TTS 生成成功：");
console.log(`- voiceId: ${voiceId}`);
console.log(`- modelId: ${modelId}`);
console.log(`- outputFormat: ${outputFormat}`);
console.log(`- bytes: ${audioBuffer.length}`);
console.log(`- file: ${outputPath}`);
