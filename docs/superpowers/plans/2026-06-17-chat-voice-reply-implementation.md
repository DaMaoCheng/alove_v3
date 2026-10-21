# Chat Voice Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI reply support both readable text and ordered voice playback, while keeping character language defaults, user language preferences, and ElevenLabs usage isolated and trackable.

**Architecture:** Split the feature into seven small phases. First standardize character language as structured data, then add per-user language preference, then make AI replies produce separate `displayText` and `speechText`, then generate ElevenLabs audio assets, and finally add frontend playback queue, unread playback rules, logs, retry, and cost tracking.

**Tech Stack:** Existing Node.js backend, vanilla ES module frontend, MySQL schema, existing chat service, ElevenLabs TTS API, local self-check scripts.

---

## Success Standards

- Every AI reply has visible text.
- Every AI reply attempts to generate voice.
- Slow or failed voice generation must not permanently block visible text.
- Text shown to the user and text sent to TTS are separated.
- Voice playback is ordered and page-scoped.
- Pressing pause stops the current auto-play queue.
- Leaving the chat page, switching chat, browser blur, or hidden tab stops playback.
- Returning to a chat only auto-plays unread AI voice messages.
- User language changes do not modify public character cards.
- Voice model, voice id, request status, cost-estimation data, and errors are logged.

## Non-Goals

- Do not clone voices in this feature pass.
- Do not make voice optional per reply in the main chat.
- Do not overwrite public character defaults when a single user asks for another language.
- Do not copy the old Alove voice implementation directly; only reuse useful ideas.

## Language Priority

Use this deterministic order:

```text
Current user message explicitly requests a language
> Current chat session language
> User-character activation language preference
> Public character default language
> Site default language
> English
```

## Reply Shape

AI reply generation should produce structured data:

```json
{
  "displayText": "Text shown in the chat bubble.",
  "speechText": "Text sent to ElevenLabs.",
  "voiceMeta": {
    "languageCode": "en",
    "languageLabel": "English",
    "provider": "elevenlabs",
    "model": "eleven_v3",
    "voiceId": ""
  }
}
```

The frontend only renders `displayText` as the chat message. `speechText` is used for voice generation and logging.

---

## File Map

Expected files to create or modify during implementation:

- Create: `shared/language-library.js`
  - Shared language definitions, aliases, and model support flags.
- Create: `src/config/language-library.js`
  - Frontend re-export for language dropdowns.
- Modify: `src/features/create-character/create-character-template.js`
  - Replace language free text with searchable standardized dropdown.
- Modify: `src/features/create-character/create-character-page.js`
  - Bind language dropdown search and selection.
- Modify: `src/features/create-character/create-character-validation.js`
  - Reject invalid language values before submit.
- Modify: `server/character-normalizers.js`
  - Normalize create/edit payload language into code and label.
- Modify: `server/character-creation-service.js`
  - Persist structured default language and inject it into prompt.
- Modify: `server/character-mapper.js`
  - Return structured language fields to frontend/admin.
- Modify: `server/chat-language-preference-service.js`
  - Reuse the shared language library for user language switching.
- Modify: `server/ai-reply-service.js`
  - Generate and parse structured `displayText/speechText/voiceMeta`.
- Create: `server/chat-reply-structure-service.js`
  - Parse, validate, and sanitize structured AI reply output.
- Create: `server/tts-speech-text-sanitizer.js`
  - Remove emoji, visual-only symbols, unsafe bracket text, and unreadable punctuation before TTS.
- Create: `server/elevenlabs-tts-service.js`
  - Call ElevenLabs, select model, save audio file, and return metadata.
- Create or modify: `server/chat-voice-asset-service.js`
  - Persist voice generation status and metadata.
- Modify: `server/chat-service.js`
  - Attach voice generation to every AI reply without losing visible text.
- Modify: `src/features/chat/*`
  - Render voice controls, queue playback, pause/stop behavior, and unread playback.
- Modify: `database/schema.sql`
  - Add user-character language preference and message voice asset tables or fields.
- Create self-check scripts under `scripts/`
  - Each phase should have one focused local self-check.

---

## Phase 1: Language Library And Character Default Language

**Goal:** Character language becomes standardized before voice generation depends on it.

- [ ] Add `shared/language-library.js`.
- [ ] Add at least 32 ElevenLabs-supported languages.
- [ ] Each language entry includes:
  - `languageCode`
  - `languageLabel`
  - Chinese aliases
  - English aliases
  - `flashSupported`
  - `v3Supported`
- [ ] Support alias matching such as:
  - `中文`
  - `普通话`
  - `Chinese`
  - `Mandarin`
  - `zh`
- [ ] Replace create-character language free text with searchable dropdown.
- [ ] Save standardized values:
  - `profile_json.defaultLanguageCode`
  - `profile_json.defaultLanguageLabel`
  - compatible `profile_json.language`
- [ ] Inject default language into character persona prompt.
- [ ] Reject invalid language values instead of silently saving free text.

**Verification:**

```bash
node scripts/language-library-self-check.mjs
node scripts/create-character-language-standardization-self-check.mjs
node scripts/create-voice-dropdown-ui-self-check.mjs
node --check shared/language-library.js
node --check server/character-normalizers.js
npm run check:deployment
```

**Phase result:** Characters have a clean default language that both text generation and TTS model selection can trust.

---

## Phase 2: User-Character Language Preference

**Goal:** A user can ask a character to use another language without changing the public character card.

- [ ] Add language preference fields to the user-character activation relation:
  - `preferred_language_code`
  - `preferred_language_label`
- [ ] Detect long-term language requests:
  - `以后用英文和我聊`
  - `以后说西班牙语`
  - `Please speak Spanish from now on`
- [ ] Detect one-off language requests:
  - `用日语说一遍`
  - `Translate that to English`
- [ ] Long-term requests update the user-character activation preference.
- [ ] One-off requests only affect the current reply or current chat session.
- [ ] Public character cards remain unchanged.

**Verification:**

```bash
node scripts/chat-language-preference-self-check.mjs
node --check server/chat-language-preference-service.js
npm run check:deployment
```

**Phase result:** Language preference is user-specific and does not pollute shared characters.

---

## Phase 3: Structured AI Reply

**Goal:** AI output separates visible text from voice script.

- [ ] Add backend structured reply parser.
- [ ] Prompt AI to return:
  - `displayText`
  - `speechText`
  - `voiceMeta`
- [ ] Add fallback when AI returns plain text:
  - `displayText = plain text`
  - `speechText = sanitized plain text`
  - `voiceMeta` generated from resolved language and character voice.
- [ ] Prevent raw JSON leakage into chat bubbles.
- [ ] Add speech text sanitizer:
  - remove emoji
  - remove unreadable symbols
  - remove visual-only bracket expressions
  - normalize punctuation
  - keep controlled ElevenLabs v3 tags only when intentionally enabled

**Verification:**

```bash
node scripts/chat-structured-reply-self-check.mjs
node scripts/tts-speech-text-sanitizer-self-check.mjs
node --check server/chat-reply-structure-service.js
node --check server/tts-speech-text-sanitizer.js
npm run check:deployment
```

**Phase result:** The user sees natural chat text, and ElevenLabs receives a clean voice script.

---

## Phase 4: ElevenLabs Voice Generation Per Reply

**Goal:** Every AI reply attempts to generate an ElevenLabs audio asset.

- [ ] Read character voice configuration:
  - `voice_provider`
  - `voice_id`
- [ ] Use `eleven_v3` as quality-first model.
- [ ] Keep `eleven_flash_v2_5` available as the fast model.
- [ ] Select model through explicit config, not model guessing.
- [ ] Set a text wait timeout:
  - normal chat: 6-8 seconds
  - product-related or long reply: up to 10 seconds
- [ ] If TTS finishes before timeout, return text and audio together.
- [ ] If TTS times out, return visible text first and mark voice as `pending`.
- [ ] Save voice status:
  - `pending`
  - `ready`
  - `failed`
- [ ] Save voice metadata:
  - `messageId`
  - `characterId`
  - `provider`
  - `model`
  - `voiceId`
  - `speechText`
  - `audioUrl`
  - `durationSeconds`
  - `audioBytes`
  - `characterCount`
  - `errorMessage`

**Verification:**

```bash
node scripts/elevenlabs-chat-tts-self-check.mjs
node scripts/chat-voice-timeout-self-check.mjs
node --check server/elevenlabs-tts-service.js
node --check server/chat-voice-asset-service.js
npm run check:deployment
```

**Phase result:** Voice generation is attached to every AI reply but cannot permanently block text display.

---

## Phase 5: Frontend Playback Queue

**Goal:** AI voice messages auto-play in order without overlapping.

- [ ] Add a chat-scoped playback queue.
- [ ] Only one audio item can play at a time.
- [ ] New ready voice assets enter the queue in message order.
- [ ] Pressing pause on any message pauses the whole auto-play queue.
- [ ] Manual play of an old message stops current auto-play.
- [ ] Switching page stops playback.
- [ ] Switching chat stops playback.
- [ ] Browser blur stops playback.
- [ ] Browser hidden state stops playback.
- [ ] Voice preview dropdown audio remains separate from chat playback audio.

**Verification:**

```bash
node scripts/chat-voice-playback-queue-self-check.mjs
node scripts/chat-voice-page-scope-self-check.mjs
node --check src/features/chat/chat-voice-playback-queue.js
npm run check:deployment
```

**Phase result:** Chat audio behaves like one ordered conversation, not a pile of overlapping clips.

---

## Phase 6: Unread Voice Playback

**Goal:** Returning users hear only new unread AI voice messages.

- [ ] Track whether the user is currently viewing a character chat.
- [ ] If AI replies while the user is away, mark those AI messages unread for that chat.
- [ ] When the user returns, enqueue unread AI voice messages only.
- [ ] Play unread voice messages in message order.
- [ ] Mark messages read after entering the chat or after the selected read policy confirms visibility.
- [ ] Do not auto-play old already-read messages, even if they were never played before.

**Verification:**

```bash
node scripts/chat-unread-voice-playback-self-check.mjs
node scripts/chat-read-state-self-check.mjs
npm run check:deployment
```

**Phase result:** New missed replies are audible when the user comes back, but old history does not suddenly start speaking.

---

## Phase 7: Logs, Cost, Retry, And Admin Visibility

**Goal:** Make voice generation debuggable and cost-aware.

- [ ] Log every ElevenLabs request:
  - user id
  - character id
  - message id
  - provider
  - model
  - voice id
  - language code
  - character count
  - audio bytes
  - duration
  - status
  - error message
- [ ] Estimate ElevenLabs credit usage from recorded request metadata.
- [ ] Store raw provider errors in backend/admin logs.
- [ ] Show user-friendly frontend error text only when the user needs to know voice failed.
- [ ] Add retry for failed voice generation.
- [ ] Prevent repeated retries from creating duplicate audio records for the same message.

**Verification:**

```bash
node scripts/elevenlabs-usage-log-self-check.mjs
node scripts/chat-voice-retry-self-check.mjs
node scripts/admin-error-log-filters-self-check.mjs
npm run check:deployment
```

**Phase result:** Voice failures, cost, and retry behavior can be audited instead of guessed.

---

## Open Decisions Before Implementation

- Whether the first implementation should always use `eleven_v3`, or whether admin should be able to choose quality-first versus speed-first per character.
- Whether one-off language requests should affect only the current reply or the full current chat session.
- Whether unread messages should be marked read immediately when the chat opens or only after playback reaches them.
- Whether voice failure should show a small UI state in the chat bubble or only be recorded in logs.

## Recommended Execution Order

1. Phase 1: language standardization.
2. Phase 2: per-user language preference.
3. Phase 3: structured AI reply.
4. Phase 4: ElevenLabs generation with timeout.
5. Phase 5: playback queue.
6. Phase 6: unread playback policy.
7. Phase 7: logs, cost, retry, and admin audit.

Stop after each phase, run self-checks, and report before continuing to the next phase.
