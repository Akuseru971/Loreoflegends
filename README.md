# Loreoflegends

Premium full-stack SaaS for automatically creating short-form League of Legends
videos for TikTok, Reels, and Shorts. The pipeline uses OpenAI for ideas,
scripts, scene planning, search queries, and ranking decisions; ElevenLabs for
line-by-line Lamb and Wolf narration; web image search for visual assets; and
FFmpeg for audio cleanup plus 1080x1920 video rendering.

## Features

- Next.js App Router and TypeScript
- Supabase database plus Supabase Storage
- Dashboard with project status tracking
- Project creation with champion/theme, duration, style, and voice IDs
- Detail page for idea, script lines, generated audio, selected images, render
  status, final video playback, and download
- Settings page documenting env-only API keys and editable rendering defaults
- Queue-friendly services for each workflow step
- Railway-compatible worker entrypoint
- FFmpeg utilities for:
  - per-line MP3 concatenation with controlled pauses
  - loudness normalization and optional silence trimming
  - subtle zoom/pan vertical video rendering
  - crossfade transitions and burned subtitles

## Workflow

1. Create a video project from `/videos/new`.
2. The pipeline generates a League of Legends video idea.
3. A high-retention script is generated with every line assigned to Lamb or Wolf.
4. Every script line is sent to ElevenLabs separately.
5. Line audio files are stored, concatenated with configurable pauses, then
   cleaned with FFmpeg.
6. Scene beats are generated from the script.
7. Image search queries are generated per scene.
8. Candidate web images are filtered for resolution, relevance, watermarks,
   visual quality, and 9:16 suitability.
9. Selected assets are stored and attached to scenes.
10. FFmpeg renders a dynamic 1080x1920 MP4 with left pan motion, slight zoom,
    transitions, subtitles, and the processed narration.
11. Final audio and video are stored in Supabase Storage.

## Pages

- `/dashboard` - lists all video projects and status:
  `draft`, `idea_generated`, `script_generated`, `voice_generated`,
  `audio_processed`, `images_selected`, `rendering`, `completed`, `failed`
- `/videos/new` - creates a new project
- `/videos/[id]` - project detail, previews, selected images, render status, and
  download
- `/settings` - env-key guidance plus pause, image duration, and subtitle
  defaults

## Setup

Install dependencies:

```bash
npm install
```

Copy environment variables:

```bash
cp .env.example .env.local
```

Create a Supabase project and apply:

```bash
supabase/migrations/20260428143400_create_lol_video_saas.sql
```

Create the `video-assets` storage bucket in Supabase. The app stores line audio,
processed narration, selected images, generated subtitle files, and final MP4
renders there.

Set the required environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
IMAGE_SEARCH_ENDPOINT=
IMAGE_SEARCH_API_KEY=
ASSET_BUCKET=video-assets
FFMPEG_PATH=ffmpeg
```

Run the app:

```bash
npm run dev
```

Run type checks:

```bash
npm run typecheck
```

Build for production:

```bash
npm run build
```

## Background worker

The API route `/api/videos/[id]/run` can advance a project in-process for local
development. For production, point a queue processor at the same orchestration
function:

```bash
npm run worker
```

The included worker is Railway-friendly and polls Supabase for pending videos.
In a production deployment, replace polling with your queue of choice while
keeping the `runVideoPipeline(videoId)` service as the job handler.

## Architecture

```text
app/
  dashboard/              project list
  videos/new/             creation flow
  videos/[id]/            project detail
  settings/               rendering configuration
  api/videos/             project API
  api/videos/[id]/run/    pipeline trigger
components/               shared UI
lib/
  services/
    database.ts           Supabase persistence
    openai.ts             idea, script, scene, query, ranking logic
    elevenlabs.ts         per-line voice generation
    image-search.ts       search, download, filter, dedupe, rank
    storage.ts            Supabase Storage helpers
    video-pipeline.ts     queue-friendly orchestration
  ffmpeg/
    audio.ts              narration concat, pauses, cleanup
    video.ts              vertical render, pan/zoom, transitions, subtitles
  worker/
    render-worker.ts      Railway worker entrypoint
supabase/migrations/      database schema
```

## Notes

- API keys are intentionally env-only and are not stored in the database.
- If Supabase or external API keys are missing, the app shows mock project data
  and uses safe placeholders so the UI remains explorable during setup.
- FFmpeg must be available in the runtime image for real audio/video rendering.
