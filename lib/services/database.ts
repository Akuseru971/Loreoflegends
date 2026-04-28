import { nanoid } from "nanoid";
import { defaultSettings, mockAssets, mockLines, mockProjects, mockRenders, mockScenes } from "@/lib/mock-data";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AppSettings, NewVideoInput, Render, SelectedAsset, VideoLine, VideoProject, VideoScene, VideoStatus } from "@/lib/types";

type VideoUpdate = Partial<Omit<VideoProject, "id" | "createdAt">>;

const nullable = (value: unknown) => (value === null ? undefined : value);

const toVideoProject = (row: Record<string, any>): VideoProject => ({
  id: row.id,
  title: row.title,
  championOrTheme: row.champion_or_theme,
  durationSeconds: row.duration_seconds,
  style: row.style,
  lambVoiceId: row.lamb_voice_id,
  wolfVoiceId: row.wolf_voice_id,
  status: row.status,
  idea: nullable(row.idea) as string | undefined,
  script: nullable(row.script) as string | undefined,
  finalAudioUrl: nullable(row.final_audio_url) as string | undefined,
  finalVideoUrl: nullable(row.final_video_url) as string | undefined,
  errorMessage: nullable(row.error_message) as string | undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLine = (row: Record<string, any>): VideoLine => ({
  id: row.id,
  videoId: row.video_id,
  index: row.line_index,
  speaker: row.speaker,
  text: row.text,
  pauseAfterMs: row.pause_after_ms ?? 180,
  audioUrl: nullable(row.audio_url) as string | undefined,
  durationMs: nullable(row.duration_ms) as number | undefined,
  startMs: nullable(row.start_ms) as number | undefined,
  endMs: nullable(row.end_ms) as number | undefined,
  createdAt: row.created_at,
});

const toScene = (row: Record<string, any>): VideoScene => ({
  id: row.id,
  videoId: row.video_id,
  sceneIndex: row.scene_index,
  subject: row.subject,
  summary: row.summary,
  visualPrompt: row.visual_prompt,
  searchQueries: row.search_queries ?? [],
  startMs: row.start_ms,
  endMs: row.end_ms,
  createdAt: row.created_at,
});

const toAsset = (row: Record<string, any>): SelectedAsset => ({
  id: row.id,
  videoId: row.video_id,
  sceneId: row.scene_id,
  sourceUrl: row.source_url,
  storagePath: nullable(row.storage_path) as string | undefined,
  storageUrl: row.storage_url,
  width: row.width,
  height: row.height,
  rankScore: row.rank_score,
  altText: row.alt_text,
  reason: row.metadata?.reason ?? row.alt_text,
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
});

const toRender = (row: Record<string, any>): Render => ({
  id: row.id,
  videoId: row.video_id,
  status: row.status,
  progress: row.progress ?? 0,
  outputUrl: nullable(row.output_url) as string | undefined,
  logs: nullable(row.logs) as string | undefined,
  errorMessage: nullable(row.error_message) as string | undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listVideos(): Promise<VideoProject[]> {
  if (!isSupabaseConfigured) return mockProjects;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("videos").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toVideoProject);
}

export async function getVideo(id: string): Promise<VideoProject | null> {
  if (!isSupabaseConfigured) return mockProjects.find((video) => video.id === id) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("videos").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toVideoProject(data);
}

export async function createVideo(input: NewVideoInput): Promise<VideoProject> {
  const now = new Date().toISOString();
  const title = `${input.championOrTheme} ${input.style} Short`;
  if (!isSupabaseConfigured) {
    return {
      id: nanoid(),
      title,
      championOrTheme: input.championOrTheme,
      durationSeconds: input.durationSeconds,
      style: input.style,
      lambVoiceId: input.lambVoiceId,
      wolfVoiceId: input.wolfVoiceId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("videos")
    .insert({
      title,
      champion_or_theme: input.championOrTheme,
      duration_seconds: input.durationSeconds,
      style: input.style,
      lamb_voice_id: input.lambVoiceId,
      wolf_voice_id: input.wolfVoiceId,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw error;
  return toVideoProject(data);
}

export async function updateVideo(id: string, update: VideoUpdate): Promise<VideoProject | null> {
  if (!isSupabaseConfigured) {
    const existing = mockProjects.find((video) => video.id === id);
    return existing ? { ...existing, ...update, updatedAt: new Date().toISOString() } : null;
  }
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (update.title !== undefined) payload.title = update.title;
  if (update.championOrTheme !== undefined) payload.champion_or_theme = update.championOrTheme;
  if (update.durationSeconds !== undefined) payload.duration_seconds = update.durationSeconds;
  if (update.style !== undefined) payload.style = update.style;
  if (update.lambVoiceId !== undefined) payload.lamb_voice_id = update.lambVoiceId;
  if (update.wolfVoiceId !== undefined) payload.wolf_voice_id = update.wolfVoiceId;
  if (update.status !== undefined) payload.status = update.status;
  if (update.idea !== undefined) payload.idea = update.idea;
  if (update.script !== undefined) payload.script = update.script;
  if (update.finalAudioUrl !== undefined) payload.final_audio_url = update.finalAudioUrl;
  if (update.finalVideoUrl !== undefined) payload.final_video_url = update.finalVideoUrl;
  if (update.errorMessage !== undefined) payload.error_message = update.errorMessage;

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("videos").update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return toVideoProject(data);
}

export async function setVideoStatus(id: string, status: VideoStatus, errorMessage?: string) {
  return updateVideo(id, { status, errorMessage });
}

export async function replaceVideoLines(videoId: string, lines: Omit<VideoLine, "id" | "videoId" | "createdAt">[]) {
  const now = new Date().toISOString();
  const rows: VideoLine[] = lines.map((line) => ({ ...line, id: nanoid(), videoId, createdAt: now }));
  if (!isSupabaseConfigured) return rows;
  const supabase = createServiceClient();
  await supabase.from("video_lines").delete().eq("video_id", videoId);
  const { data, error } = await supabase
    .from("video_lines")
    .insert(
      rows.map((line) => ({
        id: line.id,
        video_id: line.videoId,
        line_index: line.index,
        speaker: line.speaker,
        text: line.text,
        pause_after_ms: line.pauseAfterMs,
        audio_url: line.audioUrl,
        duration_ms: line.durationMs,
        start_ms: line.startMs,
        end_ms: line.endMs,
      })),
    )
    .select("*")
    .order("line_index");
  if (error) throw error;
  return (data ?? []).map(toLine);
}

export async function updateVideoLine(id: string, update: Partial<VideoLine>) {
  if (!isSupabaseConfigured) return;
  const supabase = createServiceClient();
  const payload: Record<string, unknown> = {};
  if (update.audioUrl !== undefined) payload.audio_url = update.audioUrl;
  if (update.durationMs !== undefined) payload.duration_ms = update.durationMs;
  if (update.startMs !== undefined) payload.start_ms = update.startMs;
  if (update.endMs !== undefined) payload.end_ms = update.endMs;
  const { error } = await supabase.from("video_lines").update(payload).eq("id", id);
  if (error) throw error;
}

export async function getLinesForVideo(videoId: string): Promise<VideoLine[]> {
  if (!isSupabaseConfigured) return mockLines.filter((line) => line.videoId === videoId);
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("video_lines").select("*").eq("video_id", videoId).order("line_index");
  if (error) throw error;
  return (data ?? []).map(toLine);
}

export async function replaceScenes(videoId: string, scenes: Omit<VideoScene, "id" | "videoId" | "createdAt">[]) {
  const now = new Date().toISOString();
  const rows: VideoScene[] = scenes.map((scene) => ({ ...scene, id: nanoid(), videoId, createdAt: now }));
  if (!isSupabaseConfigured) return rows;
  const supabase = createServiceClient();
  await supabase.from("video_scenes").delete().eq("video_id", videoId);
  const { data, error } = await supabase
    .from("video_scenes")
    .insert(
      rows.map((scene) => ({
        id: scene.id,
        video_id: scene.videoId,
        scene_index: scene.sceneIndex,
        subject: scene.subject,
        summary: scene.summary,
        visual_prompt: scene.visualPrompt,
        search_queries: scene.searchQueries,
        start_ms: scene.startMs,
        end_ms: scene.endMs,
      })),
    )
    .select("*")
    .order("scene_index");
  if (error) throw error;
  return (data ?? []).map(toScene);
}

export async function getScenesForVideo(videoId: string): Promise<VideoScene[]> {
  if (!isSupabaseConfigured) return mockScenes.filter((scene) => scene.videoId === videoId);
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("video_scenes").select("*").eq("video_id", videoId).order("scene_index");
  if (error) throw error;
  return (data ?? []).map(toScene);
}

export async function replaceSelectedAssets(videoId: string, assets: Omit<SelectedAsset, "id" | "videoId" | "createdAt">[]) {
  const now = new Date().toISOString();
  const rows: SelectedAsset[] = assets.map((asset) => ({ ...asset, id: nanoid(), videoId, createdAt: now }));
  if (!isSupabaseConfigured) return rows;
  const supabase = createServiceClient();
  await supabase.from("selected_assets").delete().eq("video_id", videoId);
  const { data, error } = await supabase
    .from("selected_assets")
    .insert(
      rows.map((asset) => ({
        id: asset.id,
        video_id: asset.videoId,
        scene_id: asset.sceneId,
        source_url: asset.sourceUrl,
        storage_path: asset.storagePath,
        storage_url: asset.storageUrl,
        width: asset.width,
        height: asset.height,
        rank_score: asset.rankScore,
        alt_text: asset.altText,
        metadata: { ...(asset.metadata ?? {}), reason: asset.reason },
      })),
    )
    .select("*");
  if (error) throw error;
  return (data ?? []).map(toAsset);
}

export async function getSelectedAssetsForVideo(videoId: string): Promise<SelectedAsset[]> {
  if (!isSupabaseConfigured) return mockAssets.filter((asset) => asset.videoId === videoId);
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("selected_assets").select("*").eq("video_id", videoId);
  if (error) throw error;
  return (data ?? []).map(toAsset);
}

export async function createRender(videoId: string): Promise<Render> {
  const now = new Date().toISOString();
  if (!isSupabaseConfigured) {
    return { id: nanoid(), videoId, status: "queued", progress: 0, createdAt: now, updatedAt: now };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("renders").insert({ video_id: videoId, status: "queued" }).select("*").single();
  if (error) throw error;
  return toRender(data);
}

export async function updateRender(id: string, update: Partial<Render>) {
  if (!isSupabaseConfigured) return;
  const supabase = createServiceClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (update.status !== undefined) payload.status = update.status;
  if (update.progress !== undefined) payload.progress = update.progress;
  if (update.outputUrl !== undefined) payload.output_url = update.outputUrl;
  if (update.logs !== undefined) payload.logs = update.logs;
  if (update.errorMessage !== undefined) payload.error_message = update.errorMessage;
  const { error } = await supabase.from("renders").update(payload).eq("id", id);
  if (error) throw error;
}

export async function getLatestRenderForVideo(videoId: string): Promise<Render | null> {
  if (!isSupabaseConfigured) return mockRenders.find((render: Render) => render.videoId === videoId) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("renders")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return toRender(data);
}

export async function getSettings(): Promise<AppSettings> {
  if (!isSupabaseConfigured) return defaultSettings;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();
  if (error || !data) return defaultSettings;
  return {
    pauseMs: data.pause_ms,
    minImageSeconds: data.min_image_seconds,
    maxImageSeconds: data.max_image_seconds,
    minImageWidth: data.min_image_width,
    minImageHeight: data.min_image_height,
    subtitleStyle: data.subtitle_style,
  };
}
