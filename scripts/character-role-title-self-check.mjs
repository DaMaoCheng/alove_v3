import { deriveCharacterRoleTitle } from "../server/character-polish-service.js";

const result = await deriveCharacterRoleTitle({
  name: "Rafa Riot",
  category: "Fan",
  personality: "Cheeky banter",
  voice: "Bright & playful",
  openingLine: "Tell me your wildest match prediction.",
  backstory: "A fast-talking football superfan who turns every match into teasing, chants, and playful rivalry, but still remembers what the user cares about.",
});

const text = String(result.text || "").trim();
const ok = Boolean(text) && text.length <= 128 && !/[{}[\]"`]/.test(text) && !/AI Assistant|Good Friend|Best Partner/i.test(text);

console.log(JSON.stringify({
  ok,
  result,
}, null, 2));

if (!ok) {
  process.exit(1);
}

process.exit(0);
