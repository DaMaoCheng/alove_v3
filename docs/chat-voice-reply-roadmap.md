# Chat Voice Reply Roadmap

## Goal

Every AI character reply should have both text and voice.

- The chat bubble shows `displayText`.
- ElevenLabs reads `speechText`.
- Voice should auto-play in order when the user is in the relevant chat.
- Public character cards must not be changed by a user's language preference.

This document records the implementation plan only. It does not mean the feature has already been implemented.

## Key Rules

### Text And Voice Are Separate

AI replies should be treated as structured output:

```json
{
  "displayText": "Text shown in the chat bubble.",
  "speechText": "Text sent to TTS.",
  "voiceMeta": {
    "languageCode": "en",
    "languageLabel": "English",
    "provider": "elevenlabs",
    "model": "eleven_v3",
    "voiceId": ""
  }
}
```

`displayText` is for reading. `speechText` is for listening. They can be similar, but they should not be forced to be identical.

### Language Is Standardized

Users should not be allowed to save arbitrary language text directly.

Example:

- User searches `中文`, `普通话`, `Chinese`, or `Mandarin`.
- The UI resolves all of them to `Chinese (Mandarin)`.
- The saved value is standardized:

```json
{
  "languageCode": "zh",
  "languageLabel": "Chinese (Mandarin)"
}
```

### Character Defaults Are Not User Preferences

Language priority:

```text
Current user message explicitly requests a language
> Current session language
> User-character activation language preference
> Public character default language
> Site default language
> English
```

If a user asks a public character to speak another language, the public character card must not be changed. The preference belongs to that user and that activated character, or to that chat session.

### Voice Generation Is Required Per Reply

This generation is required for every AI reply, but text must not be blocked forever by slow TTS.

Recommended flow:

```text
AI generates displayText + speechText + voiceMeta
→ Backend calls ElevenLabs TTS
→ If TTS finishes before timeout: return text + audio together
→ If TTS times out: return text with voice status pending
→ When TTS finishes: update the message voice asset
```

Initial timeout recommendation:

- Normal chat: 6-8 seconds.
- Longer replies or product-related replies: up to 10 seconds.

### Auto Playback Uses A Queue

- AI voice replies play in message order.
- Only one audio plays at a time.
- Pressing pause on any voice message pauses the whole auto-play queue.
- Switching page, switching chat, browser blur, or browser hidden state stops playback.
- If the user returns to a chat, only unread AI voice messages should auto-play.
- Old messages that are already read but were not played must not auto-play just because playback was interrupted earlier.

## Phase 1: Language Library And Default Character Language

Goal: standardize language selection before voice generation depends on it.

Tasks:

- Add a shared language library configuration.
- Each language entry should include:
  - `languageCode`
  - `languageLabel`
  - aliases in Chinese and English
  - `flashSupported`
  - `v3Supported`
- Replace free-text language input in character creation with a searchable dropdown.
- Allow alias search but only save a selected standardized language.
- Save default character language in structured character data, for example:
  - `profile_json.defaultLanguageCode`
  - `profile_json.defaultLanguageLabel`
- Inject the default language into the AI prompt.

Result:

Character cards have a clean default language, and backend logic can select a TTS model reliably.

## Phase 2: User-Character Language Preference

Goal: allow a user to change a character's language without changing the public character card.

Tasks:

- Add language preference to the user-character activation relation.
- Save:
  - `preferredLanguageCode`
  - `preferredLanguageLabel`
- Detect messages such as:
  - "以后用英文和我聊"
  - "Please speak Spanish from now on"
  - "用日语说一遍"
- Long-term requests update the user-character preference.
- One-off requests only affect the current reply or current session.

Result:

Public characters remain shared. User language preferences stay isolated.

## Phase 3: Structured AI Reply

Goal: generate reply content that works for both text display and TTS.

Tasks:

- Ask AI to return structured reply data:
  - `displayText`
  - `speechText`
  - `voiceMeta`
- Parse the structured output on the backend.
- Only persist/show `displayText` as the visible chat message.
- Keep `speechText` for TTS.
- Add structured leakage protection so raw `displayText/speechText/voiceMeta` JSON is never shown to the user.
- Add TTS text sanitization based on the previous generation project:
  - remove emoji
  - remove unreadable symbols
  - remove visual-only bracket expressions
  - normalize punctuation
  - keep only controlled ElevenLabs v3 tags if we intentionally add them

Result:

The user sees natural text, and TTS receives a clean voice script.

## Phase 4: ElevenLabs Voice Generation Per Reply

Goal: generate an audio asset for every AI reply.

Tasks:

- Read the character's `voice_provider` and `voice_id`.
- If `voice_provider = elevenlabs`, call ElevenLabs TTS.
- Select model by language:
  - use `eleven_flash_v2_5` for supported languages when speed is preferred
  - use `eleven_v3` for unsupported Flash languages, small languages, or high-emotion replies
- Save voice generation state:
  - `pending`
  - `ready`
  - `failed`
- Save voice asset metadata:
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

Result:

Every AI reply has a voice generation record, even if TTS fails.

## Phase 5: Frontend Playback Queue

Goal: make the chat feel voice-first without overlapping audio.

Tasks:

- Add a chat-level voice playback queue.
- When a new AI voice asset is ready, enqueue it.
- Play one item at a time in message order.
- A pause click pauses the current audio and disables automatic continuation.
- Manual play of a historical message should stop the current auto queue.
- Page switch, chat switch, browser blur, or hidden tab stops playback.

Result:

Voice playback is ordered, controllable, and page-scoped.

## Phase 6: Unread Voice Replay

Goal: play only new unread AI voice messages when the user returns.

Tasks:

- Track whether the user is currently viewing a character's chat.
- If the user is away, mark new AI replies as unread.
- When the user returns to that chat:
  - enqueue unread AI voice messages only
  - play them in order
  - mark them read after entering the chat or after playback policy confirms visibility
- Do not auto-play old already-read messages.

Result:

Returning users hear new replies, without old interrupted messages replaying unexpectedly.

## Phase 7: Logs, Cost, And Retry

Goal: make the voice system observable and cost-aware.

Tasks:

- Log each ElevenLabs request:
  - user id
  - character id
  - message id
  - provider
  - model
  - voice id
  - character count
  - audio bytes
  - duration
  - status
  - error message
- Add retry for failed voice generation.
- Keep text replies visible even if voice generation fails.
- Use logs to estimate ElevenLabs credit cost per message and per user.

Result:

The system can be debugged, retried, and cost-tracked.

## Previous Generation Reference

Useful ideas from the previous generation project:

- `displayText / speechText / voiceMeta`
- TTS speech text sanitization
- structured reply leakage protection
- TTS asset metadata
- provider usage logging

Things not to copy directly:

- Previous generation used MiniMax, not ElevenLabs.
- Previous generation did not force voice generation for every reply.
- Previous generation had `shouldGenerateVoiceReply = false`; this generation should require voice for every AI reply.
