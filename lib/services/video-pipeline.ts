import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/config";
import {
  createRender,
  getLinesForVideo,
  getScenesForVideo,
  getSelectedAssetsForVideo,
  getSettings,
  getVideo,
  replaceScenes,
  replaceSelectedAssets,
  replaceVideoLines,
  updateRender,
  updateVideo,
  updateVideoLine,
} from "@/lib/services/database";
import { generateLineAudio } from "@/lib/services/elevenlabs";
import { searchAndSelectImage } from "@/lib/services/image-search";
import { generateIdea, generateScriptAndScenes } from "@/lib/services/openai";
import { uploadLocalFile } from "@/lib/services/storage";
import { concatLineAudio, createPlaceholderNarration, processNarration } from "@/lib/ffmpeg/audio";
import { renderVerticalVideo } from "@/lib/ffmpeg/video";
import type { SelectedAsset, VideoProject, VideoScene } from "@/lib/types";

export async function runVideoPipeline(videoId: string) {
  let video = await getVideo(videoId);
  if (!video) throw new Error(`Video ${videoId} was not found`);

  try {
    video = await ensureIdea(video);
    video = await ensureScript(video);
    video = await ensureVoice(video);
    video = await ensureImages(video);
    video = await ensureRender(video);
    return video;
  } catch (error) {
    await updateVideo(videoId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown pipeline failure",
    });
    throw error;
  }
}

async function ensureIdea(video: VideoProject): Promise<VideoProject> {
  if (video.idea) return video;
  const idea = await generateIdea(video);
  await updateVideo(video.id, { idea, status: "idea_generated" });
  return { ...video, idea, status: "idea_generated" };
}

async function ensureScript(video: VideoProject): Promise<VideoProject> {
  const [existingLines, existingScenes] = await Promise.all([
    getLinesForVideo(video.id),
    getScenesForVideo(video.id),
  ]);
  if (video.script && existingLines.length && existingScenes.length) return video;

  const generated = await generateScriptAndScenes(video);
  const lines = await replaceVideoLines(video.id, generated.lines);
  await replaceScenes(video.id, generated.scenes);
  const script = lines.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  await updateVideo(video.id, {
    idea: generated.idea,
    script,
    status: "script_generated",
  });
  return { ...video, idea: generated.idea, script, status: "script_generated" };
}

async function ensureVoice(video: VideoProject): Promise<VideoProject> {
  const settings = await getSettings();
  const lines = await getLinesForVideo(video.id);
  const workDir = path.join(env.RENDER_TMP_DIR, video.id, "audio");
  await mkdir(workDir, { recursive: true });

  const localFiles: string[] = [];
  let cursorMs = 0;
  for (const line of lines) {
    const voiceId = line.speaker === "Lamb" ? video.lambVoiceId : video.wolfVoiceId;
    const generated = await generateLineAudio({
      videoId: video.id,
      lineId: line.id,
      text: line.text,
      voiceId,
      speaker: line.speaker,
      workDir,
    });
    localFiles.push(generated.localPath);
    const storedLine = await uploadLocalFile(
      generated.localPath,
      `videos/${video.id}/audio-lines/${line.index}-${line.speaker.toLowerCase()}.mp3`,
      "audio/mpeg",
    );
    await updateVideoLine(line.id, {
      audioUrl: storedLine.publicUrl,
      durationMs: generated.durationMs,
      startMs: cursorMs,
      endMs: cursorMs + generated.durationMs,
    });
    cursorMs += generated.durationMs + (line.pauseAfterMs || settings.pauseMs);
  }

  const rawPath = path.join(workDir, "narration-raw.mp3");
  const finalPath = path.join(workDir, "narration-final.mp3");
  if (localFiles.length) {
    await concatLineAudio(localFiles, rawPath, settings.pauseMs);
    await processNarration(rawPath, finalPath);
  } else {
    await createPlaceholderNarration(finalPath, 8);
  }

  const stored = await uploadLocalFile(finalPath, `videos/${video.id}/audio/final-narration.mp3`, "audio/mpeg");
  await updateVideo(video.id, { finalAudioUrl: stored.publicUrl, status: "audio_processed" });
  return { ...video, finalAudioUrl: stored.publicUrl, status: "audio_processed" };
}

async function ensureImages(video: VideoProject): Promise<VideoProject> {
  const settings = await getSettings();
  const scenes = await getScenesForVideo(video.id);
  const existing = await getSelectedAssetsForVideo(video.id);
  if (scenes.length && existing.length >= scenes.length) return video;

  const assets = await Promise.all(
    scenes.map((scene) =>
      searchAndSelectImage(video.id, scene, settings.minImageWidth, settings.minImageHeight),
    ),
  );
  await replaceSelectedAssets(video.id, assets);
  await updateVideo(video.id, { status: "images_selected" });
  return { ...video, status: "images_selected" };
}

async function ensureRender(video: VideoProject): Promise<VideoProject> {
  const settings = await getSettings();
  const [scenes, assets] = await Promise.all([
    getScenesForVideo(video.id),
    getSelectedAssetsForVideo(video.id),
  ]);
  const render = await createRender(video.id);
  await updateVideo(video.id, { status: "rendering" });
  await updateRender(render.id, { status: "rendering", logs: "Rendering 1080x1920 FFmpeg composition." });

  const workDir = path.join(env.RENDER_TMP_DIR, video.id, "render");
  await mkdir(workDir, { recursive: true });
  const outputPath = path.join(workDir, "final.mp4");
  const narrationPath = publicUrlToLocalPath(video.finalAudioUrl ?? undefined, path.join(env.RENDER_TMP_DIR, video.id, "audio", "narration-final.mp3"));
  const averageDuration = Math.max(
    settings.minImageSeconds,
    Math.min(settings.maxImageSeconds, video.durationSeconds / Math.max(1, scenes.length)),
  );

  await renderVerticalVideo({
    outputPath,
    narrationPath,
    scenes: scenes.map((scene) => ({
      imagePath: assetPathForScene(scene, assets),
      caption: scene.summary,
      durationSeconds: averageDuration,
    })),
    subtitleStyle: settings.subtitleStyle,
  });

  const stored = await uploadLocalFile(outputPath, `videos/${video.id}/renders/final.mp4`, "video/mp4");
  await updateRender(render.id, { status: "completed", outputUrl: stored.publicUrl, logs: "Render complete." });
  await updateVideo(video.id, { finalVideoUrl: stored.publicUrl, status: "completed" });
  return { ...video, finalVideoUrl: stored.publicUrl, status: "completed" };
}

function publicUrlToLocalPath(value: string | undefined, fallback: string) {
  if (value?.startsWith("/")) {
    return path.join(process.cwd(), "public", value.replace(/^\//, ""));
  }
  return fallback;
}

function assetPathForScene(scene: VideoScene, assets: SelectedAsset[]) {
  const asset = assets.find((item) => item.sceneId === scene.id);
  if (asset?.storageUrl.startsWith("/")) {
    return path.join(process.cwd(), "public", asset.storageUrl.replace(/^\//, ""));
  }
  return path.join(process.cwd(), "public", "placeholder.svg");
}
