# Audio Pace Cleaner

Audio Pace Cleaner is a Vercel-ready creator SaaS MVP with a two-step short-form
workflow:

1. Analyze a League of Legends champion interaction, voice line, or relationship with strict canon attribution.
2. Edit the final cleaned explanation script and generate narration with ElevenLabs.
3. Clean the generated or uploaded narration audio to tighten long silent gaps.

The app does not generate videos. It generates text-only champion interaction
explanations through the OpenAI API, can call ElevenLabs text-to-speech from a server route
with a user-supplied session key, then processes audio with FFmpeg.

## Features

- Next.js App Router and TypeScript
- Premium dark, mobile-responsive upload UI
- League of Legends interaction explainer for voice lines, champion relationships,
  dialogue subtext, rivalries, family ties, conflicts, and trauma
- Server-side `POST /api/generate-lol-lore` route using `OPENAI_API_KEY`
- Editable generated script textarea before voice generation
- Built-in lore accuracy guardrail inside `POST /api/generate-lol-lore` that
  checks quote attribution and rewrites risky drafts before the final script reaches the UI
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

## LoL interaction explainer

The generator creates production-ready League of Legends interaction packs with:

- Viral title
- Short hook
- Exact interaction attribution: speaker, quote, target, source type, canon status
- Canon context
- What the interaction reveals
- Important canon limit / what is not confirmed
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

The UI includes fields for an exact quote, speaker champion, target champion, and
source type. The backend prompt emphasizes official Riot canon accuracy, exact
speaker attribution, no invented dialogue, no fake interactions, and clear
separation between confirmed, implied, and unconfirmed details. If the quote or
target cannot be verified, the final result must say so instead of pretending.

## Built-in lore accuracy guardrail

Before the app returns an interaction pack, the backend runs an internal strict
lore accuracy pass. That pass checks for invented quotes, wrong speakers,
unsupported targets, skin/legacy sources, outdated League institution framing,
fan theories, and exaggerated claims presented as fact. If needed, it rewrites
the draft into a safer version while preserving the same topic, language,
short-form pacing, and voice-ready structure.

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

- `contentType`: `Voice Line`, `Champion Relationship`, `Dialogue Subtext`, or
  `Conflict Explanation`
- `topic`: interaction or relationship to explain for `mode: "custom"`
- `quote`: exact quote if available
- `speaker`: champion who says the line, if known
- `target`: target champion, if known
- `sourceType`: source label such as `Base champion voice line`, `Skin voice line`,
  `Legends of Runeterra`, `Wild Rift`, `Cinematic`, `Riot Universe story`,
  `Old / legacy lore`, or `Unknown / Let AI assess`
- `tone`: `Mysterious`, `Cinematic`, `Serious`, `Dark`, `Tragic`, or
  `Analytical`
- `platform`: `TikTok`, `YouTube Shorts`, `Instagram Reels`, or `Podcast Short`
- `duration`: `45s` or `60s`
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
