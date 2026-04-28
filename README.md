# Audio Pace Cleaner

Audio Pace Cleaner is a Vercel-ready SaaS MVP for creators who already have
audio narration and want tighter pacing for TikTok, YouTube Shorts, Instagram
Reels, podcasts, and other short-form content.

The app does not generate videos or voices. It only uploads existing audio,
detects long silent gaps, and shortens those pauses while preserving the voice
track itself.

## Features

- Next.js App Router and TypeScript
- Premium dark, mobile-responsive upload UI
- Drag-and-drop audio upload with before/after previews
- Settings for pacing mode, silence threshold, minimum silence, remaining pause,
  and output format
- Server-side `POST /api/process-audio` route
- FFmpeg-static based processing for Vercel compatibility
- 25 MB MVP upload limit
- No database, login, Stripe, video rendering, or API keys

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

No environment variables are required. Optional FFmpeg overrides are available:

```bash
FFMPEG_PATH=
AUDIO_PACE_WORKDIR=/tmp/audio-pace-cleaner
```

By default the app uses the bundled `ffmpeg-static` binary.

## API

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
