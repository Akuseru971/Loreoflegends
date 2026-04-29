"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

const loreContentTypeOptions = ["Lore Event", "Champion Lore", "Lore Fun Fact"] as const;
const tones = ["Mysterious", "Epic", "Dark", "Tragic", "Cinematic", "Kindred-style"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["1min15", "1min30", "1min40"] as const;
const languages = ["English", "French", "Spanish"] as const;
const elevenLabsModels = ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"] as const;

type LoreContentType = (typeof loreContentTypeOptions)[number];
type LoreTone = (typeof tones)[number];
type LorePlatform = (typeof platforms)[number];
type LoreDuration = (typeof durations)[number];
type LoreLanguage = (typeof languages)[number];
type ElevenLabsModel = (typeof elevenLabsModels)[number];

type LorePack = {
  title: string;
  hook: string;
  script: string;
  voiceReadyScript: string;
  captionVersion: string[];
  visualBeats: {
    beat: string;
    visualSuggestion: string;
  }[];
  tiktokDescription: string;
  instagramCaption: string;
  youtubeShortsTitle: string;
  hashtags: string[];
  pinnedComment: string;
};

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

function downloadTextFile(fileName: string, content: string, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function scriptAsText(pack: LorePack) {
  return [
    `Viral title: ${pack.title}`,
    "",
    `Short hook: ${pack.hook}`,
    "",
    "Full narration script:",
    pack.script,
    "",
    "Voice-ready version:",
    pack.voiceReadyScript,
    "",
    "Caption-friendly version:",
    ...pack.captionVersion.map((line) => `- ${line}`),
    "",
    "Suggested visual beats:",
    ...pack.visualBeats.map((item) => `- ${item.beat}: ${item.visualSuggestion}`),
    "",
    `TikTok description: ${pack.tiktokDescription}`,
    "",
    `Instagram caption: ${pack.instagramCaption}`,
    "",
    `YouTube Shorts title: ${pack.youtubeShortsTitle}`,
    "",
    `Hashtags: ${pack.hashtags.join(" ")}`,
    "",
    `Pinned comment question: ${pack.pinnedComment}`,
  ].join("\n");
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
  const [loreContentType, setLoreContentType] = useState<LoreContentType>("Lore Event");
  const [loreTopic, setLoreTopic] = useState("");
  const [loreTone, setLoreTone] = useState<LoreTone>("Mysterious");
  const [lorePlatform, setLorePlatform] = useState<LorePlatform>("TikTok");
  const [loreDuration, setLoreDuration] = useState<LoreDuration>("1min30");
  const [loreLanguage, setLoreLanguage] = useState<LoreLanguage>("English");
  const [loreResult, setLoreResult] = useState<LorePack | null>(null);
  const [loreError, setLoreError] = useState("");
  const [isLoreGenerating, setIsLoreGenerating] = useState(false);
  const [editableScript, setEditableScript] = useState("");
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState("");
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState("");
  const [elevenLabsModel, setElevenLabsModel] = useState<ElevenLabsModel>("eleven_multilingual_v2");
  const [voiceStability, setVoiceStability] = useState(0.35);
  const [voiceSimilarity, setVoiceSimilarity] = useState(0.85);
  const [voiceStyle, setVoiceStyle] = useState(0.35);
  const [speakerBoost, setSpeakerBoost] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isCleaningGeneratedAudio, setIsCleaningGeneratedAudio] = useState(false);
  const [rawAudioBlob, setRawAudioBlob] = useState<Blob | null>(null);
  const [rawAudioUrl, setRawAudioUrl] = useState("");
  const [cleanedGeneratedAudioUrl, setCleanedGeneratedAudioUrl] = useState("");

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

  useEffect(() => {
    return () => {
      if (rawAudioUrl) {
        URL.revokeObjectURL(rawAudioUrl);
      }
      if (cleanedGeneratedAudioUrl) {
        URL.revokeObjectURL(cleanedGeneratedAudioUrl);
      }
    };
  }, [rawAudioUrl, cleanedGeneratedAudioUrl]);

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

  async function handleLoreSubmit(event: FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>, generationMode: "daily" | "custom") {
    event.preventDefault();
    setLoreError("");

    if (generationMode === "custom" && !loreTopic.trim()) {
      setLoreError("Enter a League of Legends lore topic before generating.");
      return;
    }

    setIsLoreGenerating(true);

    try {
      const response = await fetch("/api/generate-lol-lore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: loreContentType,
          topic: loreTopic,
          tone: loreTone,
          platform: lorePlatform,
          duration: loreDuration,
          language: loreLanguage,
          mode: generationMode,
        }),
      });

      const payload = (await response.json().catch(() => null)) as (LorePack & { error?: string }) | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "Lore generation failed. Please try again.");
      }

      setLoreResult(payload);
      setEditableScript(payload.script);
      setVoiceError("");
      setVoiceNotice("");
      if (rawAudioUrl) {
        URL.revokeObjectURL(rawAudioUrl);
        setRawAudioUrl("");
      }
      if (cleanedGeneratedAudioUrl) {
        URL.revokeObjectURL(cleanedGeneratedAudioUrl);
        setCleanedGeneratedAudioUrl("");
      }
      setRawAudioBlob(null);
    } catch (submitError) {
      setLoreError(submitError instanceof Error ? submitError.message : "Network error while generating lore.");
    } finally {
      setIsLoreGenerating(false);
    }
  }

  async function handleGenerateElevenLabsAudio() {
    setVoiceError("");
    setVoiceNotice("");

    const text = editableScript.trim();
    if (!elevenLabsApiKey.trim()) {
      setVoiceError("Please enter your ElevenLabs API key.");
      return;
    }
    if (!elevenLabsVoiceId.trim()) {
      setVoiceError("Please enter your ElevenLabs Voice ID.");
      return;
    }
    if (!text) {
      setVoiceError("Please write or generate a script first.");
      return;
    }
    if (text.length > 5000) {
      setVoiceError("Script is too long for this MVP. Keep it under 5,000 characters.");
      return;
    }

    setIsGeneratingVoice(true);

    try {
      const response = await fetch("/api/generate-elevenlabs-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: elevenLabsApiKey,
          voiceId: elevenLabsVoiceId,
          text,
          modelId: elevenLabsModel,
          stability: voiceStability,
          similarityBoost: voiceSimilarity,
          style: voiceStyle,
          speakerBoost,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Audio generation failed.");
      }

      const audioBlob = await response.blob();

      if (rawAudioUrl) {
        URL.revokeObjectURL(rawAudioUrl);
      }
      if (cleanedGeneratedAudioUrl) {
        URL.revokeObjectURL(cleanedGeneratedAudioUrl);
        setCleanedGeneratedAudioUrl("");
      }

      setRawAudioBlob(audioBlob);
      setRawAudioUrl(URL.createObjectURL(audioBlob));
      setVoiceNotice("Raw ElevenLabs audio generated. You can preview, download, or clean it now.");
    } catch (generationError) {
      setVoiceError(generationError instanceof Error ? generationError.message : "Audio generation failed.");
    } finally {
      setIsGeneratingVoice(false);
    }
  }

  async function handleCleanGeneratedAudio() {
    setVoiceError("");
    setVoiceNotice("");

    if (!rawAudioBlob) {
      setVoiceError("Generate ElevenLabs audio before cleaning it.");
      return;
    }

    const audioFile = new File([rawAudioBlob], "raw-elevenlabs-audio.mp3", { type: "audio/mpeg" });
    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("mode", mode);
    formData.append("thresholdDb", String(threshold));
    formData.append("minSilenceMs", String(minimumSilence));
    formData.append("targetSilenceMs", String(remainingSilence));
    formData.append("outputFormat", "mp3");

    setIsCleaningGeneratedAudio(true);

    try {
      const response = await fetch("/api/process-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Audio cleaning failed.");
      }

      const cleanedBlob = await response.blob();
      const messageHeader = response.headers.get("x-audio-pace-message");

      if (cleanedGeneratedAudioUrl) {
        URL.revokeObjectURL(cleanedGeneratedAudioUrl);
      }

      setCleanedGeneratedAudioUrl(URL.createObjectURL(cleanedBlob));
      setVoiceNotice(messageHeader ?? "Cleaned dynamic audio is ready.");
    } catch (cleanError) {
      setVoiceError(cleanError instanceof Error ? cleanError.message : "Audio cleaning failed.");
    } finally {
      setIsCleaningGeneratedAudio(false);
    }
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
              LC
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/70">Lore to audio workflow</p>
              <p className="font-semibold text-white">LoL Lore + Audio Pace Cleaner</p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 backdrop-blur">
            Generate script. Voice it. Clean the pacing.
          </div>
        </nav>

        <section className="rounded-[2.25rem] border border-violet-200/15 bg-violet-300/[0.035] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-6 sm:p-8">
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-6">
                <div className="inline-flex rounded-full border border-violet-300/20 bg-violet-300/10 px-4 py-2 text-sm font-medium text-violet-100">
                  Step 1 - League of Legends lore script pack
                </div>
                <div>
                  <h1 className="max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                    LoL Lore Content Generator
                  </h1>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
                    Generate accurate, cinematic League of Legends lore scripts for TikTok, Shorts, Reels, and podcast-style narration.
                  </p>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                    Built for a daily workflow: create a voice-ready lore pack, send the narration to ElevenLabs, then clean the exported audio below.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Canon-first", "Prompted to avoid fake lore and headcanon."],
                    ["Retention-ready", "Hooks, twists, climax, and final line."],
                    ["Voice-ready", "Natural narration for ElevenLabs delivery."],
                  ].map(([title, description]) => (
                    <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-bold text-white">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={(event) => handleLoreSubmit(event, "custom")} className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Content type"
                    value={loreContentType}
                    onChange={(value) => setLoreContentType(value as LoreContentType)}
                    options={loreContentTypeOptions}
                  />
                  <SelectField
                    label="Tone"
                    value={loreTone}
                    onChange={(value) => setLoreTone(value as LoreTone)}
                    options={tones}
                  />
                  <SelectField
                    label="Platform"
                    value={lorePlatform}
                    onChange={(value) => setLorePlatform(value as LorePlatform)}
                    options={platforms}
                  />
                  <SelectField
                    label="Duration"
                    value={loreDuration}
                    onChange={(value) => setLoreDuration(value as LoreDuration)}
                    options={durations}
                  />
                  <SelectField
                    label="Language"
                    value={loreLanguage}
                    onChange={(value) => setLoreLanguage(value as LoreLanguage)}
                    options={languages}
                  />
                  <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50/85">
                    Default: English, TikTok, Mysterious, 1min30.
                  </div>
                </div>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-bold text-slate-200">Topic</span>
                  <input
                    value={loreTopic}
                    onChange={(event) => setLoreTopic(event.target.value)}
                    placeholder='Example: "The fall of Icathia", "Aatrox", "The Watchers"'
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-violet-200/60 focus:ring-4 focus:ring-violet-300/10"
                  />
                </label>

                {loreError ? (
                  <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    {loreError}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={(event) => handleLoreSubmit(event, "daily")}
                    disabled={isLoreGenerating}
                    className="rounded-2xl border border-violet-200/40 bg-violet-300/10 px-5 py-4 font-black text-violet-50 transition hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoreGenerating ? "Generating..." : "Generate Today's Lore Script"}
                  </button>
                  <button
                    type="submit"
                    disabled={isLoreGenerating}
                    className="rounded-2xl bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 px-5 py-4 font-black text-slate-950 shadow-[0_18px_70px_rgba(168,85,247,0.22)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {isLoreGenerating ? "Generating..." : "Generate From My Topic"}
                  </button>
                </div>
              </form>
            </div>

            {loreResult ? (
              <div className="mt-8 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-100/70">Production pack ready</p>
                    <h2 className="mt-1 text-2xl font-bold text-white">{loreResult.title}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadTextFile("lol-lore-script.txt", scriptAsText(loreResult))}
                      className="rounded-full border border-white/10 bg-white px-4 py-2 text-sm font-bold text-slate-950"
                    >
                      Download script.txt
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadTextFile("lol-lore-production-pack.json", JSON.stringify(loreResult, null, 2), "application/json")}
                      className="rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white"
                    >
                      Download production-pack.json
                    </button>
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                  <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-white">Script Editor</h3>
                        <p className="mt-1 text-sm text-slate-400">Edit your script before generating the voice.</p>
                      </div>
                      <div className="flex gap-2">
                        <CopyButton value={editableScript} />
                        <button
                          type="button"
                          onClick={() => setEditableScript(loreResult.script)}
                          className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-violet-200/50 hover:text-white"
                        >
                          Reset to Generated Script
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={editableScript}
                      onChange={(event) => setEditableScript(event.target.value)}
                      rows={13}
                      className="w-full resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-7 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-violet-200/60 focus:ring-4 focus:ring-violet-300/10"
                    />
                    <p className="mt-2 text-xs text-slate-500">{editableScript.trim().length} characters</p>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                    <div className="mb-4">
                      <h3 className="text-xl font-bold text-white">ElevenLabs Voice Settings</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        Your API key is sent only to the server request and is not stored.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-slate-200">API Key</span>
                        <input
                          value={elevenLabsApiKey}
                          onChange={(event) => setElevenLabsApiKey(event.target.value)}
                          type="password"
                          autoComplete="off"
                          placeholder="Paste your ElevenLabs API key"
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-200/60 focus:ring-4 focus:ring-cyan-300/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-slate-200">Voice ID</span>
                        <input
                          value={elevenLabsVoiceId}
                          onChange={(event) => setElevenLabsVoiceId(event.target.value)}
                          placeholder="Example: 21m00Tcm4TlvDq8ikWAM"
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-200/60 focus:ring-4 focus:ring-cyan-300/10"
                        />
                      </label>
                      <SelectField
                        label="Model"
                        value={elevenLabsModel}
                        onChange={(value) => setElevenLabsModel(value as ElevenLabsModel)}
                        options={elevenLabsModels}
                      />
                      <SliderField label="Stability" value={voiceStability} min={0} max={1} step={0.01} suffix="" onChange={setVoiceStability} />
                      <SliderField label="Similarity boost" value={voiceSimilarity} min={0} max={1} step={0.01} suffix="" onChange={setVoiceSimilarity} />
                      <SliderField label="Style" value={voiceStyle} min={0} max={1} step={0.01} suffix="" onChange={setVoiceStyle} />
                      <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                        <span>
                          <span className="block text-sm font-bold text-slate-200">Speaker boost</span>
                          <span className="text-xs text-slate-500">Default enabled for clearer narration.</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={speakerBoost}
                          onChange={(event) => setSpeakerBoost(event.target.checked)}
                          className="size-5 accent-cyan-300"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleGenerateElevenLabsAudio}
                        disabled={isGeneratingVoice || isCleaningGeneratedAudio}
                        className="w-full rounded-2xl bg-gradient-to-r from-violet-300 via-cyan-300 to-fuchsia-300 px-5 py-4 font-black text-slate-950 shadow-[0_18px_70px_rgba(168,85,247,0.22)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                      >
                        {isGeneratingVoice ? "Generating audio with ElevenLabs..." : "Generate Audio with ElevenLabs"}
                      </button>
                    </div>
                  </section>
                </div>

                {(voiceError || voiceNotice) ? (
                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      voiceError
                        ? "border-rose-300/20 bg-rose-400/10 text-rose-100"
                        : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                    }`}
                  >
                    {voiceError || voiceNotice}
                  </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-white">Audio Output</h3>
                        <p className="mt-1 text-sm text-slate-400">Raw ElevenLabs Audio</p>
                      </div>
                      {rawAudioUrl ? (
                        <a
                          href={rawAudioUrl}
                          download="raw-elevenlabs-audio.mp3"
                          className="rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white"
                        >
                          Download Raw Audio
                        </a>
                      ) : null}
                    </div>
                    {rawAudioUrl ? (
                      <div className="space-y-4">
                        <audio controls src={rawAudioUrl} className="w-full" />
                        <button
                          type="button"
                          onClick={handleCleanGeneratedAudio}
                          disabled={isGeneratingVoice || isCleaningGeneratedAudio}
                          className="w-full rounded-2xl border border-cyan-200/40 bg-cyan-300/10 px-5 py-4 font-black text-cyan-50 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCleaningGeneratedAudio ? "Reducing silences..." : "Clean This Audio"}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                        Generate audio with ElevenLabs to preview and download the raw MP3.
                      </div>
                    )}
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-white">Cleaned Audio Output</h3>
                        <p className="mt-1 text-sm text-slate-400">Cleaned Dynamic Audio</p>
                      </div>
                      {cleanedGeneratedAudioUrl ? (
                        <a
                          href={cleanedGeneratedAudioUrl}
                          download="cleaned-dynamic-audio.mp3"
                          className="rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white"
                        >
                          Download Cleaned Audio
                        </a>
                      ) : null}
                    </div>
                    {cleanedGeneratedAudioUrl ? (
                      <audio controls src={cleanedGeneratedAudioUrl} className="w-full" />
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                        Use Clean This Audio to reuse the Audio Pace Cleaner settings and create final dynamic audio.
                      </div>
                    )}
                  </section>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <TextResultCard title="Viral title" value={loreResult.title} />
                  <TextResultCard title="Short hook" value={loreResult.hook} />
                  <TextResultCard title="Voice-ready version" value={loreResult.voiceReadyScript} multiline />
                  <ListResultCard title="Caption-friendly version" items={loreResult.captionVersion} />
                  <VisualBeatsCard beats={loreResult.visualBeats} />
                  <TextResultCard title="TikTok description" value={loreResult.tiktokDescription} />
                  <TextResultCard title="Instagram caption" value={loreResult.instagramCaption} />
                  <TextResultCard title="YouTube Shorts title" value={loreResult.youtubeShortsTitle} />
                  <ListResultCard title="Hashtags" items={loreResult.hashtags} />
                  <TextResultCard title="Pinned comment question" value={loreResult.pinnedComment} />
                </div>
              </div>
            ) : (
              <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-slate-400">
                Your generated lore pack will appear here with copy buttons for every block and downloads for script and JSON production files.
              </div>
            )}
          </div>
        </section>

        <div className="flex items-center gap-4 py-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-white/5" />
          <p className="text-xs font-bold uppercase tracking-[0.34em] text-slate-500">Step 2 - Clean ElevenLabs audio</p>
          <div className="h-px flex-1 bg-gradient-to-r from-white/5 via-white/15 to-transparent" />
        </div>

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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-200/50 hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TextResultCard({ title, value, multiline = false }: { title: string; value: string; multiline?: boolean }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-white">{title}</h3>
        <CopyButton value={value} />
      </div>
      <p className={`${multiline ? "whitespace-pre-wrap" : ""} text-sm leading-7 text-slate-300`}>{value}</p>
    </article>
  );
}

function ListResultCard({ title, items }: { title: string; items: string[] }) {
  const value = items.join("\n");

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-white">{title}</h3>
        <CopyButton value={value} />
      </div>
      <ul className="space-y-2 text-sm leading-6 text-slate-300">
        {items.map((item) => (
          <li key={item} className="rounded-2xl bg-white/[0.035] px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function VisualBeatsCard({ beats }: { beats: LorePack["visualBeats"] }) {
  const value = beats.map((beat) => `${beat.beat}: ${beat.visualSuggestion}`).join("\n");

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-white">Suggested visual beats</h3>
        <CopyButton value={value} />
      </div>
      <div className="space-y-3">
        {beats.map((beat) => (
          <div key={`${beat.beat}-${beat.visualSuggestion}`} className="rounded-2xl bg-white/[0.035] p-3">
            <p className="text-sm font-bold text-cyan-100">{beat.beat}</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">{beat.visualSuggestion}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function TextInputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-200">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-200/60 focus:ring-4 focus:ring-cyan-300/10"
      />
    </label>
  );
}

function DecimalSliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <label className="text-sm font-bold text-slate-200">{label}</label>
        <span className="rounded-full bg-white/[0.06] px-3 py-1 text-sm font-semibold text-violet-100">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-violet-300"
      />
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left"
    >
      <span className="text-sm font-bold text-slate-200">{label}</span>
      <span className={`rounded-full px-3 py-1 text-xs font-black ${checked ? "bg-emerald-300/15 text-emerald-100" : "bg-white/[0.06] text-slate-400"}`}>
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}

function AudioOutputCard({
  title,
  url,
  emptyText,
  downloadName,
}: {
  title: string;
  url: string;
  emptyText: string;
  downloadName: string;
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-white">{title}</h3>
        {url ? (
          <a
            href={url}
            download={downloadName}
            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-200/50 hover:text-white"
          >
            Download
          </a>
        ) : null}
      </div>
      {url ? (
        <audio controls src={url} className="w-full" />
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">{emptyText}</div>
      )}
    </article>
  );
}

function DownloadButton({ label, fileName, content, mimeType }: { label: string; fileName: string; content: string; mimeType: string }) {
  const href = useMemo(() => {
    const blob = new Blob([content], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [content, mimeType]);

  useEffect(() => {
    return () => URL.revokeObjectURL(href);
  }, [href]);

  return (
    <a
      href={href}
      download={fileName}
      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-sm font-bold text-white transition hover:border-cyan-200/50 hover:bg-cyan-300/10"
    >
      {label}
    </a>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-200">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-200/60 focus:ring-4 focus:ring-cyan-300/10"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
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
