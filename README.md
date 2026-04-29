# Audio Pace Cleaner

Audio Pace Cleaner is a Vercel-ready creator SaaS MVP with a two-step short-form
workflow:

1. Generate a League of Legends lore script pack that is automatically checked and corrected for lore accuracy.
2. Edit the final cleaned script and generate narration with ElevenLabs.
3. Clean the generated or uploaded narration audio to tighten long silent gaps.

The app does not generate videos. It generates text-only lore script packs
through the OpenAI API, can call ElevenLabs text-to-speech from a server route
with a user-supplied session key, then processes audio with FFmpeg.

## Features

- Next.js App Router and TypeScript
- Premium dark, mobile-responsive upload UI
- League of Legends lore script generator for TikTok, Shorts, Reels, and podcast
  shorts
- Server-side `POST /api/generate-lol-lore` route using `OPENAI_API_KEY`
- Editable generated script textarea before voice generation
- Built-in lore accuracy guardrail inside `POST /api/generate-lol-lore` that
  rewrites risky drafts before the final script reaches the UI
- Server-side `POST /api/generate-elevenlabs-audio` route using a pasted
  ElevenLabs API key for that request only
- Raw ElevenLabs audio preview/download plus one-click cleanup through the
  existing audio cleaner route
- Drag-and-drop audio upload with before/after previews
- Settings for pacing mode, silence threshold, minimum silence, remaining pause,
  and output format
- Server-side `POST /api/process-audio` route
- FFmpeg-static based processing for Vercel compatibility
- 25 MB MVP upload limit
- No database, login, Stripe, video rendering, image generation, or automatic
  posting

## Lore script generator

The generator creates production-ready League of Legends lore packs with:

- Viral title
- Short hook
- Full narration script
- ElevenLabs-ready voice script
- Caption-friendly lines
- Hook variants
- Alternate titles
- Suggested visual beats
- Retention breakdown
- Lore accuracy notes for creator-side validation
- Quality report with score, strengths, and warnings
- TikTok description
- Instagram caption
- YouTube Shorts title
- Hashtags
- Pinned comment question

The UI includes smart controls for narrative angle, audience level, and creator
goal so each script can focus on a precise educational purpose. The backend
prompt emphasizes official Riot canon accuracy, no invented lore, educational
cause-and-effect explanations, concrete lore facts, strong short-form retention,
natural narration, and target durations between 1min15 and 1min40. The API
performs a quality check for structure, concrete facts, hook, final payoff, and
generic filler, then regenerates once if the first result is weak. Word count is
returned as metadata only and does not block the generated script from being
shown.

## Built-in lore accuracy guardrail

Before the app returns a generated lore pack, the backend runs an internal strict
lore accuracy pass. That pass checks for invented factions, outdated League
institution framing, unsupported relationships, risky timelines, fan theories,
and exaggerated claims presented as fact. If needed, it rewrites the draft into a
safer version while preserving the same topic, language, short-form pacing, and
voice-ready structure.

The UI only receives the final cleaned script. ElevenLabs therefore uses the
current final edited script, not an unverified draft.

## Audio behavior

Defaults:

- Silence threshold: `-35 dB`
- Detect silences longer than `450 ms`
- Reduce detected pauses to `120 ms`
- Preserve natural breathing rhythm
- Do not speed up, pitch-shift, or distort the voice

Modes:

- Natural: leaves `250 ms`
- Dynamic: leaves `120 ms`
- Ultra Fast: leaves `60 ms`

If no matching pauses are found, the API returns the original file and the UI
shows: "No long pauses were detected. Your audio already seems tightly paced."

## ElevenLabs audio generation

After a lore pack is generated, the script appears in an editable textarea. The
edited script is what gets sent to ElevenLabs. By default, the backend uses
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from the deployment environment.
The UI fields are optional overrides for a single request.

When an override key is pasted, it is sent only to
`POST /api/generate-elevenlabs-audio` and is not stored in a database,
localStorage, or committed configuration.

Generated raw audio can be downloaded as `raw-elevenlabs-audio.mp3` or sent to
the existing `/api/process-audio` route for pause reduction, then downloaded as
`cleaned-dynamic-audio.mp3`.

## Setup

```bash
npm install
npm run dev
```

Run checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Configuration

Set the OpenAI API key for the lore generator and ElevenLabs credentials for
server-side voice generation. Optional FFmpeg overrides are available:

```bash
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
FFMPEG_PATH=
AUDIO_PACE_WORKDIR=/tmp/audio-pace-cleaner
```

By default the app uses the bundled `ffmpeg-static` binary.

## API

`POST /api/generate-lol-lore`

JSON body:

- `contentType`: `Lore Event`, `Champion Lore`, or `Lore Fun Fact`
- `topic`: custom topic for `mode: "custom"`
- `tone`: `Mysterious`, `Epic`, `Dark`, `Tragic`, `Cinematic`, or
  `Kindred-style`
- `platform`: `TikTok`, `YouTube Shorts`, `Instagram Reels`, or `Podcast Short`
- `duration`: `1min15`, `1min30`, or `1min40`
- `language`: `English`, `French`, or `Spanish`
- `narrativeAngle`: optional focus such as `Cause and consequence`,
  `Core tragedy`, or `Moral ambiguity`
- `audienceLevel`: optional audience targeting such as `New to lore`,
  `Casual player`, or `Lore fan`
- `creatorGoal`: optional output goal such as `Teach clearly`,
  `Maximize retention`, `Prepare voiceover`, or `Spark comments`
- `mode`: `daily` or `custom`

Returns a JSON production pack for short-form lore content.

`POST /api/generate-elevenlabs-audio`

JSON body:

- `apiKey`: optional ElevenLabs API key override; defaults to `ELEVENLABS_API_KEY`
- `voiceId`: optional ElevenLabs Voice ID override; defaults to `ELEVENLABS_VOICE_ID`
- `text`: edited script text
- `modelId`: `eleven_multilingual_v2`, `eleven_turbo_v2_5`,
  `eleven_flash_v2_5`, or `eleven_v3`
- `stability`: number between `0` and `1`
- `similarityBoost`: number between `0` and `1`
- `style`: number between `0` and `1`
- `speakerBoost`: boolean

Returns an MP3 audio blob.

`POST /api/process-audio`

Multipart form fields:

- `file`: mp3, wav, or m4a audio file
- `thresholdDb`: silence threshold in dB
- `minSilenceMs`: minimum silence duration to detect
- `targetSilenceMs`: silence duration to keep
- `outputFormat`: `mp3` or `wav`

The response is the processed audio file with headers:

- `X-Audio-Pace-Status`: `processed` or `no_silence`
- `X-Audio-Pace-Message`: human-readable status
