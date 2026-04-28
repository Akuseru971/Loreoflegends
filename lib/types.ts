import { z } from "zod";

export const videoStatuses = [
  "draft",
  "idea_generated",
  "script_generated",
  "voice_generated",
  "audio_processed",
  "images_selected",
  "rendering",
  "completed",
  "failed",
] as const;

export type VideoStatus = (typeof videoStatuses)[number];
export type Speaker = "Lamb" | "Wolf";

export const newVideoSchema = z.object({
  championOrTheme: z.string().min(2).max(120),
  durationSeconds: z.coerce.number().min(15).max(90),
  style: z.string().min(2).max(80),
  lambVoiceId: z.string().min(1),
  wolfVoiceId: z.string().min(1),
});

export type NewVideoInput = z.infer<typeof newVideoSchema>;

export type VideoProject = NewVideoInput & {
  id: string;
  title: string;
  status: VideoStatus;
  idea?: string | null;
  script?: string | null;
  finalAudioUrl?: string | null;
  finalVideoUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScriptLine = {
  index: number;
  speaker: Speaker;
  text: string;
  pauseAfterMs: number;
};

export type VideoLine = ScriptLine & {
  id: string;
  videoId: string;
  audioUrl?: string | null;
  durationMs?: number | null;
  startMs?: number | null;
  endMs?: number | null;
  createdAt: string;
};

export type VideoScene = {
  id: string;
  videoId: string;
  sceneIndex: number;
  subject: string;
  summary: string;
  visualPrompt: string;
  searchQueries: string[];
  startMs: number;
  endMs: number;
  createdAt: string;
};

export type SceneDraft = Omit<VideoScene, "id" | "videoId" | "createdAt">;

export type SelectedAsset = {
  id: string;
  videoId: string;
  sceneId: string;
  sourceUrl: string;
  storageUrl: string;
  storagePath?: string | null;
  altText: string;
  width: number;
  height: number;
  rankScore: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type Render = {
  id: string;
  videoId: string;
  status: "queued" | "rendering" | "completed" | "failed";
  progress?: number | null;
  outputUrl?: string | null;
  logs?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubtitleStyle = {
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  bottomMargin: number;
};

export type AppSettings = {
  pauseMs: number;
  minImageSeconds: number;
  maxImageSeconds: number;
  minImageWidth: number;
  minImageHeight: number;
  subtitleStyle: SubtitleStyle;
};

export type ImageCandidate = {
  sourceUrl: string;
  previewUrl: string;
  title: string;
  description?: string;
  width: number;
  height: number;
  hasWatermark: boolean;
  attribution?: string;
};

export type GeneratedScript = {
  idea: string;
  lines: ScriptLine[];
  scenes: SceneDraft[];
};

export type RenderManifest = {
  outputPath: string;
  narrationPath: string;
  scenes: Array<{
    imagePath: string;
    caption: string;
    durationSeconds: number;
  }>;
  subtitleStyle: SubtitleStyle;
};
