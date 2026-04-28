# Audio Pace Cleaner

Audio Pace Cleaner is a Vercel-ready creator SaaS MVP with a two-step short-form
workflow:

1. Generate a League of Legends lore script pack.
2. Upload the ElevenLabs narration audio and tighten long silent gaps.

The app does not generate videos or voices. It generates text-only lore script
packs through the OpenAI API, then processes existing uploaded audio with
FFmpeg.

## Features

- Next.js App Router and TypeScript
- Premium dark, mobile-responsive upload UI
- League of Legends lore script generator for TikTok, Shorts, Reels, and podcast
  shorts
- Server-side `POST /api/generate-lol-lore` route using `OPENAI_API_KEY`
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
- Suggested visual beats
- TikTok description
- Instagram caption
- YouTube Shorts title
- Hashtags
- Pinned comment question

The backend prompt emphasizes official Riot canon accuracy, no invented lore,
strong short-form retention, natural narration, and target durations between
1min15 and 1min40. Word count is returned as metadata only and does not block
the generated script from being shown.

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

Set the OpenAI API key for the lore generator. Optional FFmpeg overrides are
available:

```bash
OPENAI_API_KEY=
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
- `mode`: `daily` or `custom`

Returns a JSON production pack for short-form lore content.

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
