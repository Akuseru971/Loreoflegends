"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a"];
const ACCEPTED_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
];

const modes = {
  natural: {
    label: "Natural",
    description: "Keeps conversational pacing with gentle pause reduction.",
    remainingSilence: 250,
  },
  dynamic: {
    label: "Dynamic",
    description: "Default short-form pacing for TikTok, Reels, and Shorts.",
    remainingSilence: 120,
  },
  ultra: {
    label: "Ultra Fast",
    description: "Very tight pacing while preserving breaths and phrasing.",
    remainingSilence: 60,
  },
} as const;

type Mode = keyof typeof modes;
type OutputFormat = "mp3" | "wav";

type ProcessResponse = {
  message?: string;
  noSilenceDetected?: boolean;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function validateAudioFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return "Unsupported file type. Upload an MP3, WAV, or M4A file.";
  }

  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    return "Unsupported file type. Upload an MP3, WAV, or M4A file.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "File is too large. The MVP upload limit is 25 MB.";
  }

  return "";
}

export default function HomePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState("");
  const [afterUrl, setAfterUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [mode, setMode] = useState<Mode>("dynamic");
  const [threshold, setThreshold] = useState(-35);
  const [minimumSilence, setMinimumSilence] = useState(450);
  const [remainingSilence, setRemainingSilence] = useState<number>(modes.dynamic.remainingSilence);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedMode = modes[mode];

  useEffect(() => {
    return () => {
      if (beforeUrl) {
        URL.revokeObjectURL(beforeUrl);
      }
      if (afterUrl) {
        URL.revokeObjectURL(afterUrl);
      }
    };
  }, [beforeUrl, afterUrl]);

  const canProcess = useMemo(() => Boolean(file) && !isProcessing, [file, isProcessing]);

  function selectFile(nextFile: File | null) {
    setError("");
    setNotice("");
    setDownloadName("");

    if (afterUrl) {
      URL.revokeObjectURL(afterUrl);
      setAfterUrl("");
    }

    if (!nextFile) {
      setFile(null);
      if (beforeUrl) {
        URL.revokeObjectURL(beforeUrl);
        setBeforeUrl("");
      }
      return;
    }

    const validationError = validateAudioFile(nextFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (beforeUrl) {
      URL.revokeObjectURL(beforeUrl);
    }

    setFile(nextFile);
    setBeforeUrl(URL.createObjectURL(nextFile));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!file) {
      setError("Upload an audio file before cleaning.");
      return;
    }

    const validationError = validateAudioFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);
    formData.append("thresholdDb", String(threshold));
    formData.append("minSilenceMs", String(minimumSilence));
    formData.append("targetSilenceMs", String(remainingSilence));
    formData.append("outputFormat", outputFormat);

    setIsProcessing(true);

    try {
      const response = await fetch("/api/process-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Processing failed. Try a different audio file.");
      }

      const resultBlob = await response.blob();
      const statusHeader = response.headers.get("x-audio-pace-status");
      const messageHeader = response.headers.get("x-audio-pace-message");
      const metadata: ProcessResponse = {
        message: messageHeader ?? undefined,
        noSilenceDetected: statusHeader === "no_silence",
      };

      if (afterUrl) {
        URL.revokeObjectURL(afterUrl);
      }

      const processedUrl = URL.createObjectURL(resultBlob);
      setAfterUrl(processedUrl);
      setDownloadName(`audio-pace-cleaner-${Date.now()}.${outputFormat}`);
      setNotice(
        metadata.noSilenceDetected
          ? "No long pauses were detected. Your audio already seems tightly paced."
          : metadata.message ?? "Audio cleaned successfully. Preview the tightened pacing below.",
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Processing failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050713] text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-12rem] top-[-14rem] h-[34rem] w-[34rem] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute right-[-12rem] top-20 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute bottom-[-16rem] left-1/3 h-[34rem] w-[34rem] rounded-full bg-indigo-500/20 blur-3xl" />
      </div>

      <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-8 sm:px-8 lg:py-12">
        <nav className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-lg font-black text-cyan-200 shadow-[0_0_40px_rgba(34,211,238,0.22)]">
              AP
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/70">Creator audio SaaS</p>
              <p className="font-semibold text-white">Audio Pace Cleaner</p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 backdrop-blur">
            No login. No database. Audio only.
          </div>
        </nav>

        <div className="grid items-center gap-8 lg:grid-cols-[1fr_0.86fr]">
          <div className="space-y-7">
            <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100">
              Built for ElevenLabs narration, podcasts, and short-form creators
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-5xl font-black tracking-tight text-white sm:text-6xl lg:text-7xl">
                Audio Pace Cleaner
              </h1>
              <p className="max-w-2xl text-xl leading-8 text-slate-300 sm:text-2xl">
                Turn slow AI narration into dynamic short-form audio.
              </p>
              <p className="max-w-3xl text-base leading-7 text-slate-400">
                Upload an existing MP3, WAV, or M4A file and shorten only the long silent gaps between phrases.
                The voice stays natural: no pitch shift, no speed-up, no video rendering, and no AI voice generation.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/65 p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-fuchsia-200/70">Default cleanup</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Dynamic mode</h2>
                </div>
                <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-sm font-semibold text-emerald-200">
                  FFmpeg
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Threshold", "-35 dB"],
                  ["Detect", "450 ms+"],
                  ["Keep", "120 ms"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-2 text-lg font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50/85">
                Long pauses are detected with FFmpeg silence analysis, then the audio is rebuilt from clean
                speech segments with a short natural gap between them.
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`group flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed p-8 text-center transition ${
                isDragging
                  ? "border-cyan-200 bg-cyan-300/10"
                  : "border-white/15 bg-slate-950/55 hover:border-cyan-200/60 hover:bg-cyan-300/[0.055]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
                onChange={handleFileChange}
                className="sr-only"
              />
              <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-cyan-300 to-fuchsia-300 text-3xl shadow-[0_0_50px_rgba(34,211,238,0.28)]">
                ♪
              </div>
              <h2 className="text-2xl font-bold text-white">Drag & drop your narration</h2>
              <p className="mt-3 max-w-xl text-slate-400">
                Upload an MP3, WAV, or M4A up to 25 MB. Perfect for ElevenLabs exports and existing voiceovers.
              </p>
              {file ? (
                <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-left">
                  <p className="font-semibold text-emerald-100">{file.name}</p>
                  <p className="text-sm text-emerald-100/70">{formatBytes(file.size)}</p>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-6 rounded-full bg-white px-5 py-3 text-sm font-bold text-slate-950 transition group-hover:scale-[1.02]"
                >
                  Choose audio file
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <PreviewCard title="Before processing" url={beforeUrl} emptyText="Upload audio to preview the original pacing." />
              <PreviewCard title="After processing" url={afterUrl} emptyText="Your cleaned audio will appear here." />
            </div>

            {afterUrl ? (
              <a
                href={afterUrl}
                download={downloadName}
                className="mt-5 flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-300 px-5 py-4 text-center font-black text-slate-950 shadow-[0_18px_60px_rgba(34,211,238,0.22)] transition hover:scale-[1.01]"
              >
                Download processed audio
              </a>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/65 p-6">
              <div className="mb-6">
                <p className="text-sm uppercase tracking-[0.28em] text-cyan-200/70">Settings</p>
                <h2 className="mt-2 text-3xl font-bold text-white">Control the pacing</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Tune silence detection without changing the voice speed or pitch.
                </p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-3 block text-sm font-bold text-slate-200">Mode</label>
                  <div className="grid gap-3">
                    {(Object.entries(modes) as [Mode, (typeof modes)[Mode]][]).map(([key, value]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setMode(key);
                          setRemainingSilence(value.remainingSilence);
                        }}
                        className={`rounded-2xl border p-4 text-left transition ${
                          mode === key
                            ? "border-cyan-200/60 bg-cyan-300/10"
                            : "border-white/10 bg-white/[0.035] hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold text-white">{value.label}</p>
                          <p className="text-sm text-cyan-100">{value.remainingSilence} ms</p>
                        </div>
                        <p className="mt-1 text-sm text-slate-400">{value.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <SliderField
                  label="Silence threshold"
                  value={threshold}
                  min={-60}
                  max={-20}
                  step={1}
                  suffix="dB"
                  onChange={setThreshold}
                />
                <SliderField
                  label="Minimum silence to detect"
                  value={minimumSilence}
                  min={200}
                  max={1500}
                  step={10}
                  suffix="ms"
                  onChange={setMinimumSilence}
                />
                <SliderField
                  label={`Remaining silence after cleanup (${selectedMode.label})`}
                  value={remainingSilence}
                  min={40}
                  max={500}
                  step={10}
                  suffix="ms"
                  onChange={setRemainingSilence}
                />

                <div>
                  <label className="mb-3 block text-sm font-bold text-slate-200">Output format</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["mp3", "wav"] as OutputFormat[]).map((format) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => setOutputFormat(format)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-bold uppercase transition ${
                          outputFormat === format
                            ? "border-fuchsia-200/60 bg-fuchsia-300/10 text-fuchsia-50"
                            : "border-white/10 bg-white/[0.035] text-slate-300 hover:border-white/25"
                        }`}
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}

                {notice ? (
                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                    {notice}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={!canProcess}
                  className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-300 px-5 py-4 font-black text-slate-950 shadow-[0_18px_70px_rgba(56,189,248,0.25)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-3">
                      <span className="size-4 animate-spin rounded-full border-2 border-slate-950/25 border-t-slate-950" />
                      Cleaning audio...
                    </span>
                  ) : (
                    "Clean Audio"
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Designed for ElevenLabs", "Tighten narration exports without generating a new voice."],
            ["More engaging pacing", "Make slow voiceovers feel sharper for retention-focused content."],
            ["Short-form ready", "Ideal for TikTok, Instagram Reels, YouTube Shorts, and podcasts."],
            ["Natural voice preserved", "Only long pauses are shortened; speech speed and pitch stay intact."],
          ].map(([title, description]) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 backdrop-blur">
              <h3 className="font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function PreviewCard({ title, url, emptyText }: { title: string; url: string; emptyText: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-white">{title}</h3>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-slate-400">Preview</span>
      </div>
      {url ? (
        <audio controls src={url} className="w-full" />
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <label className="text-sm font-bold text-slate-200">{label}</label>
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-sm font-semibold text-cyan-100">
          {value} {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-300"
      />
    </div>
  );
}
