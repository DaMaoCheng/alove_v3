import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ELEVENLABS_VOICE_PRESETS } from "../../shared/voice-presets.js";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE_URL = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1";
const OUTPUT_FORMAT = "mp3_44100_128";

const SAMPLE_TEXT = Object.freeze({
  nova: "[warmly] Hey, I’m Nova... tell me what mood you want tonight, and I’ll match it.",
  sunny: "[bright and playful] Okay, that kit is honestly a vibe — wait... show me your favorite club first.",
  iris: "[clear and calm] I’ll keep it simple: form, fit, and football feeling — that’s what matters.",
  velvet: "[softly] Take your time... I’m here, and we can talk it through one step at a time.",
  mira: "[professional and warm] I can help you compare options quickly, without making it feel complicated.",
  atlas: "[relaxed] Alright, let’s not overthink it — tell me the club, and I’ll point you in the right direction.",
  ever: "[smooth and confident] Good choice. Now let’s find the one that actually feels like you.",
  vale: "[warm storyteller] Every match has a memory... and every shirt carries a little piece of it.",
  rook: "[deep and energetic] That’s a strong pick — bold, clean, and ready for match day.",
  nolan: "[steady broadcaster] Here’s the quick read: classic shape, sharp details, and a proper football look.",
  echo: "[relaxed and neutral] I’ll keep the pace easy... ask me anything, and we’ll narrow it down together.",
});

if (!API_KEY) {
  console.error("ELEVENLABS_API_KEY is required");
  process.exit(1);
}

for (const preset of ELEVENLABS_VOICE_PRESETS) {
  const text = SAMPLE_TEXT[preset.id];
  if (!text) throw new Error(`Missing sample text for ${preset.id}`);
  const outputPath = join(process.cwd(), preset.sampleUrl.replace(/^\//, ""));
  await mkdir(dirname(outputPath), { recursive: true });
  console.log(`Generating ${preset.label} -> ${outputPath}`);

  const response = await fetch(`${BASE_URL}/text-to-speech/${preset.voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: preset.qualityModel,
      voice_settings: {
        stability: 0.42,
        similarity_boost: 0.78,
        style: 0.38,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs failed for ${preset.id}: HTTP ${response.status} ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

console.log("ElevenLabs preset previews generated");
