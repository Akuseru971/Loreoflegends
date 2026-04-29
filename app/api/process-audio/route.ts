import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Map([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/m4a", "m4a"],
]);
const EXTENSION_TYPES = new Map([
  ["mp3", "mp3"],
  ["wav", "wav"],
  ["m4a", "m4a"],
]);
const OUTPUT_TYPES = new Map([
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
]);

type Silence = {
  start: number;
  end: number;
  duration: number;
};

type FfmpegResult = {
  stderr: string;
};

function getFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }

  const candidates = [
    ffmpegPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? "ffmpeg";
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function clampNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(numeric, min), max);
}

function safeBaseName(name: string) {
  const withoutExtension = name.replace(/\.[^/.]+$/, "");
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "audio";
}

function resolveInputExtension(file: File) {
  const typeExtension = ACCEPTED_TYPES.get(file.type);
  const fileExtension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return typeExtension || EXTENSION_TYPES.get(fileExtension);
}

function runFfmpeg(args: string[], cwd: string): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { cwd });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }

      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

function parseDetectedSilences(stderr: string, minSilenceMs: number): Silence[] {
  const starts: number[] = [];
  const silences: Silence[] = [];
  const startPattern = /silence_start:\s*([0-9.]+)/g;
  const endPattern = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;

  for (const match of stderr.matchAll(startPattern)) {
    starts.push(Number(match[1]));
  }

  let index = 0;
  for (const match of stderr.matchAll(endPattern)) {
    const end = Number(match[1]);
    const duration = Number(match[2]);
    const start = starts[index] ?? end - duration;
    index += 1;

    if (duration * 1000 >= minSilenceMs) {
      silences.push({ start, end, duration });
    }
  }

  return silences;
}

function createFilterGraph(silences: Silence[], targetSilenceMs: number) {
  const targetSeconds = targetSilenceMs / 1000;
  const filters: string[] = [];
  const labels: string[] = [];
  let cursor = 0;

  silences.forEach((silence, index) => {
    const keepStart = Math.max(silence.start, silence.end - targetSeconds);

    if (silence.start > cursor + 0.01) {
      const speechLabel = `speech${index}`;
      filters.push(
        `[0:a]atrim=start=${cursor.toFixed(3)}:end=${silence.start.toFixed(3)},asetpts=PTS-STARTPTS[${speechLabel}]`,
      );
      labels.push(`[${speechLabel}]`);
    }

    if (silence.end > keepStart + 0.01) {
      const pauseLabel = `pause${index}`;
      filters.push(
        `[0:a]atrim=start=${keepStart.toFixed(3)}:end=${silence.end.toFixed(3)},asetpts=PTS-STARTPTS[${pauseLabel}]`,
      );
      labels.push(`[${pauseLabel}]`);
    }

    cursor = silence.end;
  });

  filters.push(`[0:a]atrim=start=${cursor.toFixed(3)},asetpts=PTS-STARTPTS[tail]`);
  labels.push("[tail]");

  return `${filters.join(";")};${labels.join("")}concat=n=${labels.length}:v=0:a=1[outa]`;
}

function outputArgs(format: string, outputPath: string) {
  if (format === "wav") {
    return ["-map", "[outa]", "-c:a", "pcm_s16le", outputPath];
  }

  return ["-map", "[outa]", "-c:a", "libmp3lame", "-q:a", "2", outputPath];
}

function originalOutputArgs(format: string, outputPath: string) {
  if (format === "wav") {
    return ["-c:a", "pcm_s16le", outputPath];
  }

  return ["-c:a", "libmp3lame", "-q:a", "2", outputPath];
}

export async function POST(request: NextRequest) {
  const workDir = path.join(tmpdir(), `audio-pace-cleaner-${randomUUID()}`);

  try {
    const formData = await request.formData();
    const upload = formData.get("file");

    if (!(upload instanceof File)) {
      return jsonError("No file uploaded.");
    }

    if (upload.size > MAX_FILE_SIZE) {
      return jsonError("File is too large. The MVP limit is 25 MB.");
    }

    const inputExtension = resolveInputExtension(upload);
    if (!inputExtension) {
      return jsonError("Unsupported file type. Please upload an MP3, WAV, or M4A file.");
    }

    const thresholdDb = clampNumber(formData.get("thresholdDb"), -35, -80, -5);
    const minSilenceMs = clampNumber(formData.get("minSilenceMs"), 450, 150, 5000);
    const targetSilenceMs = clampNumber(formData.get("targetSilenceMs"), 120, 40, 1000);
    const outputFormat = formData.get("outputFormat") === "wav" ? "wav" : "mp3";

    await mkdir(workDir, { recursive: true });

    const baseName = safeBaseName(upload.name);
    const inputPath = path.join(workDir, `input.${inputExtension}`);
    const outputPath = path.join(workDir, `${baseName}-cleaned.${outputFormat}`);
    const bytes = Buffer.from(await upload.arrayBuffer());
    await writeFile(inputPath, bytes);

    if (bytes.length < 1024) {
      return jsonError("Audio too short. Please upload a longer audio file.");
    }

    const detection = await runFfmpeg(
      [
        "-hide_banner",
        "-i",
        inputPath,
        "-af",
        `silencedetect=noise=${thresholdDb}dB:d=${(minSilenceMs / 1000).toFixed(3)}`,
        "-f",
        "null",
        "-",
      ],
      workDir,
    );
    const silences = parseDetectedSilences(detection.stderr, minSilenceMs);
    const meaningfulSilences = silences.filter((silence) => silence.duration * 1000 > targetSilenceMs + 25);
    const noSilenceFound = meaningfulSilences.length === 0;

    if (noSilenceFound) {
      if (inputExtension === outputFormat) {
        return new NextResponse(bytes, {
          headers: {
            "Content-Type": OUTPUT_TYPES.get(outputFormat) ?? upload.type ?? "application/octet-stream",
            "Content-Disposition": `attachment; filename="${baseName}-cleaned.${outputFormat}"`,
            "X-Audio-Pace-Status": "no_silence",
            "X-Audio-Pace-Message": "No long pauses were detected. Your audio already seems tightly paced.",
            "X-Detected-Silences": "0",
          },
        });
      }

      await runFfmpeg(["-hide_banner", "-y", "-i", inputPath, ...originalOutputArgs(outputFormat, outputPath)], workDir);
    } else {
      const filterGraph = createFilterGraph(meaningfulSilences, targetSilenceMs);
      await runFfmpeg(
        ["-hide_banner", "-y", "-i", inputPath, "-filter_complex", filterGraph, ...outputArgs(outputFormat, outputPath)],
        workDir,
      );
    }

    const processed = await readFile(outputPath);

    return new NextResponse(processed, {
      headers: {
        "Content-Type": OUTPUT_TYPES.get(outputFormat) ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${baseName}-cleaned.${outputFormat}"`,
        "X-Audio-Pace-Status": noSilenceFound ? "no_silence" : "processed",
        "X-Audio-Pace-Message": noSilenceFound
          ? "No long pauses were detected. Your audio already seems tightly paced."
          : `Cleaned ${meaningfulSilences.length} long pause${meaningfulSilences.length === 1 ? "" : "s"}.`,
        "X-Detected-Silences": String(meaningfulSilences.length),
      },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message.toLowerCase().includes("invalid data")
      ? "Processing failed. Please check that the uploaded file is a valid audio file."
      : "Processing failed. Please try another audio file or adjust the silence settings.";

    return jsonError(message, 500);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
