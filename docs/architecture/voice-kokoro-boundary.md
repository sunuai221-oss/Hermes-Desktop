# Voice/Kokoro Boundary

## Scope
This document clarifies responsibility between `server/services/voice.mjs` and `server/services/kokoro-tts.mjs`.

## Responsibilities

### voice.mjs (orchestration layer)
- Entry-point for API voice routes.
- Reads runtime config (`runtime-files` service).
- Handles request lifecycle: parse payload, STT call, TTS selection, output file exposure.
- Chooses provider path (`kokoro` vs `neutts-server`).
- Handles ffmpeg transcode and final audio URL shape.

### kokoro-tts.mjs (text shaping + routing logic)
- Normalizes Kokoro config.
- Sanitizes markdown-rich assistant text for speech.
- Language detection (`fr/en/mixed`).
- Segmentation and per-segment voice routing.
- WAV buffer concatenation logic.

## Data contract

Input to `voice.synthesizeSpeech`:
- `text: string`
- `voiceConfig` including normalized `tts.kokoro.*` runtime/routing options

Output from `voice.synthesizeSpeech`:
- `audioUrl: string` (served by `/api/voice/audio/:file`)
- `fileName: string`
- `voice: string` (provider + effective voices)
- `text: string` (shaped speech text)

Input to Kokoro planner (`buildSpeechSynthesisPlan`):
- Raw user-visible response text
- Normalized Kokoro config

Output from Kokoro planner:
- `sanitizedText`
- `shapedText`
- `segments[{ text, language, voice }]`

## Rule of thumb
- If change concerns API behavior, provider fallback, files, ffmpeg, or HTTP calls: modify `voice.mjs`.
- If change concerns linguistic cleanup, sentence splitting, language routing, or segment voice choice: modify `kokoro-tts.mjs`.
