import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/config";

export function spawnFfmpeg(args: string[], binary = env.FFMPEG_PATH): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-y", ...args], { stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited with ${code}: ${stderr}`));
    });
  });
}

export async function concatLineAudio(
  lineAudioPaths: string[],
  outputPath: string,
  pauseMs: number,
): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (lineAudioPaths.length === 0) {
    return createPlaceholderNarration(outputPath, 8);
  }

  const inputs: string[] = [];
  const filters: string[] = [];
  const concatRefs: string[] = [];

  lineAudioPaths.forEach((linePath, index) => {
    inputs.push("-i", linePath);
    filters.push(`[${index}:a]atrim=start=0,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=10[a${index}]`);
    concatRefs.push(`[a${index}]`);
    if (index < lineAudioPaths.length - 1) {
      filters.push(`anullsrc=r=44100:cl=mono:d=${pauseMs / 1000}[s${index}]`);
      concatRefs.push(`[s${index}]`);
    }
  });

  const filterGraph = `${filters.join(";")};${concatRefs.join("")}concat=n=${concatRefs.length}:v=0:a=1[out]`;
  await spawnFfmpeg([
    ...inputs,
    "-filter_complex",
    filterGraph,
    "-map",
    "[out]",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath,
  ]);
  return outputPath;
}

export async function processNarration(inputPath: string, outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await spawnFfmpeg([
    "-i",
    inputPath,
    "-af",
    "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-42dB:stop_periods=-1:stop_duration=0.18:stop_threshold=-42dB,loudnorm=I=-14:TP=-1.0:LRA=8,aresample=44100",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath,
  ]);
  return outputPath;
}

export function probeAudioDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFPROBE_PATH, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffprobe exited with ${code}: ${stderr}`));
      else resolve(Number.parseFloat(stdout.trim()) || 0);
    });
  });
}

export async function createPlaceholderNarration(outputPath: string, durationSeconds: number): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await spawnFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${durationSeconds}`,
    "-filter:a",
    "volume=0.03,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-codec:a",
    "libmp3lame",
    outputPath,
  ]);
  return outputPath;
}

export async function writeMockLineAudio(outputPath: string, durationSeconds = 1.6): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(`${outputPath}.txt`, "Mock line audio generated because ElevenLabs is not configured.");
  await spawnFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=330:duration=${durationSeconds}`,
    "-filter:a",
    "volume=0.02,loudnorm=I=-18:TP=-1.5:LRA=11",
    "-codec:a",
    "libmp3lame",
    outputPath,
  ]);
  return outputPath;
}
