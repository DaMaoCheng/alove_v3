import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

async function readErrorText(response) {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const apiKey = requireApiKey();
const voiceId = readEnv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID);
const modelId = readEnv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL_ID);
const outputFormat = readEnv("ELEVENLABS_OUTPUT_FORMAT", DEFAULT_OUTPUT_FORMAT);
const text = readEnv("ELEVENLABS_TEXT", DEFAULT_TEXT);

if (!text) {
  throw new Error("ELEVENLABS_TEXT is empty after trim().");
}

const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
url.searchParams.set("output_format", outputFormat);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text,
    model_id: modelId,
  }),
});

if (!response.ok) {
  throw new Error(`ElevenLabs REST TTS failed: HTTP ${response.status}\n${await readErrorText(response)}`);
}

const audioBuffer = Buffer.from(await response.arrayBuffer());
if (!audioBuffer.length) {
  throw new Error("ElevenLabs returned an empty audio payload.");
}

await mkdir(OUTPUT_DIR, { recursive: true });
const outputPath = join(OUTPUT_DIR, `rest-tts-${Date.now()}.mp3`);
await writeFile(outputPath, audioBuffer);

console.log("REST TTS 生成成功：");
console.log(`- voiceId: ${voiceId}`);
console.log(`- modelId: ${modelId}`);
console.log(`- outputFormat(query): ${outputFormat}`);
console.log(`- bytes: ${audioBuffer.length}`);
console.log(`- file: ${outputPath}`);
