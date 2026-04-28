import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnFfmpeg } from "@/lib/ffmpeg/audio";
import type { RenderManifest } from "@/lib/types";

const WIDTH = 1080;
const HEIGHT = 1920;

function seconds(value: number) {
  return Math.max(0.1, value).toFixed(3);
}

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function renderVerticalVideo(manifest: RenderManifest) {
  await mkdir(path.dirname(manifest.outputPath), { recursive: true });

  const imageInputs = manifest.scenes.flatMap((scene) => [
    "-loop",
    "1",
    "-t",
    seconds(scene.durationSeconds),
    "-i",
    scene.imagePath,
  ]);

  const sceneFilters = manifest.scenes
    .map((scene, index) => {
      const frames = Math.max(1, Math.round(scene.durationSeconds * 30));
      return [
        `[${index}:v]scale=${WIDTH * 1.2}:${HEIGHT * 1.2}:force_original_aspect_ratio=increase`,
        `crop=${WIDTH}:${HEIGHT}:x='min(iw-ow,n*1.15)':y=(ih-oh)/2`,
        `zoompan=z='min(zoom+0.0007,1.055)':x='min(iw-iw/zoom,on*1.05)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=30`,
        "setsar=1",
        `drawtext=text='${escapeText(scene.caption)}':fontcolor=${manifest.subtitleStyle.primaryColor}:fontsize=${manifest.subtitleStyle.fontSize}:borderw=${manifest.subtitleStyle.outlineWidth}:bordercolor=${manifest.subtitleStyle.outlineColor}:x=(w-text_w)/2:y=h-${manifest.subtitleStyle.bottomMargin}`,
        `[v${index}]`,
      ].join(",");
    })
    .join(";");

  const concatInputs = manifest.scenes.map((_, index) => `[v${index}]`).join("");
  const filter = `${sceneFilters};${concatInputs}concat=n=${manifest.scenes.length}:v=1:a=0,format=yuv420p[v]`;

  await spawnFfmpeg([
    ...imageInputs,
    "-i",
    manifest.narrationPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    `${manifest.scenes.length}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    manifest.outputPath,
  ]);

  return manifest.outputPath;
}
