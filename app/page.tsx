"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  LOL_INTERACTION_FORMAT_VERSION,
  normalizeLoLInteractionResponse,
  uiLanguageToMetadataCode,
  type LoLInteractionExplainerResponse,
} from "@/app/lib/lol-interaction-explainer";
import type { InteractionExplainApiResponse } from "@/app/lib/lol-interaction-explain-openai";
import { LOL_WIKI_AUDIO_CATEGORY_URL } from "@/app/lib/lol-wiki-audio";

function wikiPageTitleFromAudioPageUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ""));
  } catch {
    return "";
  }
}

const EXPLORER_LOADING_STAGES = [
  "Searching champion audio index…",
  "Finding the correct champion page with OpenAI…",
  "Opening champion audio page…",
  "Extracting written interactions…",
] as const;

const EXPLORER_SUCCESS_LINE = "Interactions found.";

/** Fixed preferences for interactions/explain (no UI). */
const DEFAULT_LORE_TONE = "Mysterious";
const DEFAULT_LORE_PLATFORM = "TikTok";
const DEFAULT_LORE_DURATION: "45s" | "60s" = "60s";
const DEFAULT_LORE_LANGUAGE = "English";
const DEFAULT_NARRATIVE_ANGLE = "Relationship";
const DEFAULT_AUDIENCE_LEVEL = "Casual player";
const DEFAULT_CREATOR_GOAL = "Teach clearly";

const elevenLabsModels = ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_v3"] as const;

type ElevenLabsModel = (typeof elevenLabsModels)[number];

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

function scriptAsText(pack: LoLInteractionExplainerResponse) {
  const { speaker, quote, target, sourceType, sourceReference, canonStatus, interactionType } = pack.interaction;
  return [
    "Title:",
    pack.script.title,
    "",
    "Hook:",
    pack.script.hook,
    "",
    "INTERACTION FOUND",
    `Champion speaking: ${speaker || "(unspecified)"}`,
    `Target: ${target || "(unspecified)"}`,
    "",
    "Exact voice line:",
    `"${quote}"`,
    "",
    `Interaction type: ${interactionType || "—"}`,
    "",
    `Source type: ${sourceType}`,
    `Source: ${sourceReference}`,
    `Canon status: ${canonStatus}`,
    "",
    "Confirmed facts:",
    ...(pack.canonResearch.confirmedFacts.length ? pack.canonResearch.confirmedFacts.map((line) => `- ${line}`) : ["- (none)"]),
    "",
    "What the line suggests:",
    ...(pack.canonResearch.lineSuggests.length ? pack.canonResearch.lineSuggests.map((line) => `- ${line}`) : ["- (none)"]),
    "",
    "What is not confirmed:",
    ...(pack.canonResearch.notConfirmed.length ? pack.canonResearch.notConfirmed.map((line) => `- ${line}`) : ["- (none)"]),
    "",
    "Full script:",
    pack.script.fullScript,
    "",
    "Caption:",
    pack.script.caption,
    "",
    "Hashtags:",
    pack.script.hashtags.length ? pack.script.hashtags.join(" ") : "(none)",
    "",
    ...(pack.script.timedStructure?.length ?
      [
        "Timed beats (7s structure):",
        ...pack.script.timedStructure.map((b) => `[${b.time}] ${b.purpose}: ${b.text}`),
        "",
      ]
    : []),
    ...(pack.explainResearch ?
      [
        "Sources used (model + server fetches):",
        ...pack.explainResearch.sourcesUsed.map((s) => `- [${s.type}] ${s.title}: ${s.url}`),
        "",
        "Fandom / wiki context (raw research bucket):",
        ...(pack.explainResearch.fandomContext.length ?
          pack.explainResearch.fandomContext.map((line) => `- ${line}`)
        : ["- (none)"]),
        "",
      ]
    : []),
    "Metadata:",
    `language: ${pack.metadata.language}`,
    `durationTarget: ${pack.metadata.durationTarget}`,
    `formatVersion: ${pack.metadata.formatVersion}`,
    `sourceCategory: ${pack.metadata.sourceCategory}`,
  ].join("\n");
}

type ProgressState = {
  label: string;
  detail: string;
  percent: number;
  steps: string[];
};

function progressForState({
  isLoreGenerating,
  isGeneratingVoice,
  isCleaningGeneratedAudio,
  isProcessing,
}: {
  isLoreGenerating: boolean;
  isGeneratingVoice: boolean;
  isCleaningGeneratedAudio: boolean;
  isProcessing: boolean;
}): ProgressState | null {
  if (isLoreGenerating) {
    return {
      label: "Analyzing champion interaction",
      detail:
        "Fetching Riot + Fandom excerpts on the server, then one structured JSON pass for cross-checked canon, beats, and English script.",
      percent: 44,
      steps: ["Structured JSON", "Normalize fields", "Ready to edit"],
    };
  }

  if (isGeneratingVoice) {
    return {
      label: "Generating ElevenLabs audio",
      detail: "Sending the final editable script to the secure server route.",
      percent: 68,
      steps: ["Prepare text", "Create voice", "Return MP3"],
    };
  }

  if (isCleaningGeneratedAudio) {
    return {
      label: "Cleaning generated audio",
      detail: "Reducing long pauses with the current Audio Pace Cleaner settings.",
      percent: 82,
      steps: ["Analyze silence", "Shorten pauses", "Export MP3"],
    };
  }

  if (isProcessing) {
    return {
      label: "Processing uploaded audio",
      detail: "Detecting silence and rebuilding the track without changing voice speed.",
      percent: 78,
      steps: ["Upload file", "Analyze silence", "Export audio"],
    };
  }

  return null;
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
  const [loreResult, setLoreResult] = useState<LoLInteractionExplainerResponse | null>(null);
  const [loreError, setLoreError] = useState("");
  const [isLoreGenerating, setIsLoreGenerating] = useState(false);
  const [editableScript, setEditableScript] = useState("");

  type ExplorerChampion = { name: string; audioPageUrl: string };
  type ExplorerApiInteraction = {
    speaker: string;
    target: string;
    quote: string;
    interactionType: string;
    section: string;
    sourceUrl: string;
    sourcePageTitle: string;
    sourceType: string;
    isSkinContext: boolean;
  };
  type ExplorerWrittenInteraction = ExplorerApiInteraction;
  type ExplorerInteractionsResponse = {
    selectedChampion: string;
    slug: string;
    audioPageUrl: string;
    interactions: ExplorerApiInteraction[];
    count: number;
    error?: string;
  };

  const [explorerChampions, setExplorerChampions] = useState<ExplorerChampion[]>([]);
  const [explorerCategoryUrl, setExplorerCategoryUrl] = useState("");
  const [explorerChampionsLoading, setExplorerChampionsLoading] = useState(true);
  const [explorerChampionsError, setExplorerChampionsError] = useState("");
  const [selectedExplorerSlug, setSelectedExplorerSlug] = useState("");
  const [explorerInteractions, setExplorerInteractions] = useState<ExplorerInteractionsResponse | null>(null);
  const [explorerInteractionsLoading, setExplorerInteractionsLoading] = useState(false);
  const [explorerInteractionsError, setExplorerInteractionsError] = useState("");
  const [explorerLoadingTick, setExplorerLoadingTick] = useState(0);
  const [explorerFilterTarget, setExplorerFilterTarget] = useState("");
  const [explorerFilterType, setExplorerFilterType] = useState("");
  const [explorerFilterQuote, setExplorerFilterQuote] = useState("");
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
  const activeProgress = progressForState({
    isLoreGenerating,
    isGeneratingVoice,
    isCleaningGeneratedAudio,
    isProcessing,
  });

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

  useEffect(() => {
    if (!explorerInteractionsLoading) {
      return;
    }
    const id = window.setInterval(() => {
      setExplorerLoadingTick((t) => (t + 1) % EXPLORER_LOADING_STAGES.length);
    }, 800);
    return () => window.clearInterval(id);
  }, [explorerInteractionsLoading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setExplorerChampionsLoading(true);
      setExplorerChampionsError("");
      try {
        const res = await fetch("/api/champions");
        const data = (await res.json()) as {
          champions?: ExplorerChampion[];
          sourceCategory?: string;
          error?: string;
        };
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setExplorerChampionsError(data.error ?? "Failed to load champions.");
          setExplorerChampions([]);
        } else {
          setExplorerChampions(Array.isArray(data.champions) ? data.champions : []);
          setExplorerCategoryUrl(typeof data.sourceCategory === "string" ? data.sourceCategory : "");
        }
      } catch {
        if (!cancelled) {
          setExplorerChampionsError("Network error while loading champions.");
        }
      } finally {
        if (!cancelled) {
          setExplorerChampionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedExplorerSlug) {
      return;
    }
    let cancelled = false;
    (async () => {
      setExplorerInteractionsLoading(true);
      setExplorerLoadingTick(0);
      setExplorerInteractionsError("");
      try {
        const championName = decodeURIComponent(selectedExplorerSlug).split("/")[0]?.replace(/_/g, " ") ?? "";
        const res = await fetch("/api/find-champion-interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ champion: championName }),
        });
        const data = await res.json();
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setExplorerInteractions(null);
          setExplorerInteractionsError(typeof data.error === "string" ? data.error : "Failed to load interactions.");
        } else {
          setExplorerInteractions(data as ExplorerInteractionsResponse);
        }
      } catch {
        if (!cancelled) {
          setExplorerInteractions(null);
          setExplorerInteractionsError("Network error while loading interactions.");
        }
      } finally {
        if (!cancelled) {
          setExplorerInteractionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedExplorerSlug]);

  const explorerFilteredRows = useMemo(() => {
    if (!explorerInteractions) {
      return [];
    }
    const rows = Array.isArray(explorerInteractions.interactions) ? explorerInteractions.interactions : [];
    const ft = explorerFilterTarget.trim().toLowerCase();
    const fty = explorerFilterType.trim().toLowerCase();
    const fq = explorerFilterQuote.trim().toLowerCase();
    return rows.filter((r) => {
      if (ft && !r.target.toLowerCase().includes(ft) && !r.speaker.toLowerCase().includes(ft)) {
        return false;
      }
      if (fty && !r.interactionType.toLowerCase().includes(fty) && !r.section.toLowerCase().includes(fty)) {
        return false;
      }
      if (fq && !r.quote.toLowerCase().includes(fq)) {
        return false;
      }
      return true;
    });
  }, [explorerInteractions, explorerFilterTarget, explorerFilterType, explorerFilterQuote]);

  async function refreshExplorerInteractions() {
    if (!selectedExplorerSlug) {
      return;
    }
    setExplorerInteractionsLoading(true);
    setExplorerLoadingTick(0);
    setExplorerInteractionsError("");
    try {
      const championName = decodeURIComponent(selectedExplorerSlug).split("/")[0]?.replace(/_/g, " ") ?? "";
      const res = await fetch("/api/find-champion-interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ champion: championName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExplorerInteractions(null);
        setExplorerInteractionsError(typeof data.error === "string" ? data.error : "Refresh failed.");
      } else {
        setExplorerInteractions(data as ExplorerInteractionsResponse);
      }
    } catch {
      setExplorerInteractions(null);
      setExplorerInteractionsError("Network error on refresh.");
    } finally {
      setExplorerInteractionsLoading(false);
    }
  }

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

  async function handleExplainExplorerLine(row: ExplorerWrittenInteraction) {
    setLoreError("");
    setIsLoreGenerating(true);
    try {
      const response = await fetch("/api/interactions/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: row.speaker,
          target: row.target,
          quote: row.quote,
          interactionType: row.interactionType,
          section: row.section,
          sourceUrl: row.sourceUrl,
          isSkinContext: row.isSkinContext,
        }),
      });
      const raw = (await response.json()) as InteractionExplainApiResponse & { error?: string };
      if (!response.ok) {
        setLoreError(typeof raw.error === "string" ? raw.error : "Explain request failed.");
        return;
      }
      if (raw.error && !raw.script?.fullScript?.trim()) {
        setLoreError(raw.error);
        return;
      }

      const data = raw;
      const durationTarget = DEFAULT_LORE_DURATION === "45s" ? "45s" : "45-60s";
      const langCode = uiLanguageToMetadataCode(DEFAULT_LORE_LANGUAGE);

      const partial = {
        interaction: {
          speaker: data.interaction.speaker,
          target: data.interaction.target,
          quote: data.interaction.quote,
          interactionType: data.interaction.interactionType,
          sourceType: row.sourceType,
          sourceReference: data.interaction.sourceUrl,
          canonStatus: row.isSkinContext ? ("partially_verified" as const) : ("verified_written_voice_line" as const),
        },
        canonResearch: {
          confirmedFacts: data.research.officialCanonFacts,
          lineSuggests: [
            ...data.research.whatTheLineMeans.map((t) => `What the line means: ${t}`),
            ...data.research.whatTheLineSuggests.map((t) => `What it suggests: ${t}`),
            ...data.research.fandomContext.map((t) => `Fandom / wiki context: ${t}`),
          ],
          notConfirmed: data.research.notConfirmed,
        },
        script: {
          title: data.script.title,
          hook: data.script.hook,
          fullScript: data.script.fullScript,
          caption: data.script.caption,
          hashtags: data.script.hashtags,
          timedStructure: data.script.timedStructure,
        },
        metadata: {
          language: "en",
          durationTarget,
          formatVersion: LOL_INTERACTION_FORMAT_VERSION,
          sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
        },
        explainResearch: data.research,
      };
      const normalized = normalizeLoLInteractionResponse(partial, { language: langCode, durationTarget });
      setLoreResult(normalized);
      setEditableScript(normalized.script.fullScript);
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
    } catch (explainError) {
      console.error("[explorer explain]", explainError);
      setLoreError(explainError instanceof Error ? explainError.message : "Network error while explaining.");
    } finally {
      setIsLoreGenerating(false);
    }
  }

  async function handleGenerateElevenLabsAudio() {
    setVoiceError("");
    setVoiceNotice("");

    const text = editableScript.trim();
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
            <div className="grid size-11 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-xs font-black leading-tight text-cyan-200 shadow-[0_0_40px_rgba(34,211,238,0.22)]">
              LoL
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200/70">Canon interaction studio</p>
              <p className="font-semibold text-white">LoL Interaction Explainer + Audio Pace Cleaner</p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 backdrop-blur">
            Canon-first lines. Viral scripts. Voiceover-ready pacing.
          </div>
        </nav>

        <WorkflowProgressBar progress={activeProgress} />

        <section className="rounded-[2.25rem] border border-violet-200/15 bg-violet-300/[0.035] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-6 sm:p-8">
            <div className="space-y-6">
                <div className="inline-flex rounded-full border border-violet-300/20 bg-violet-300/10 px-4 py-2 text-sm font-medium text-violet-100">
                  Step 1 - League of Legends interaction explainer
                </div>
                <div>
                  <h1 className="max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                    LoL Interaction Explainer
                  </h1>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
                    Pick a champion below, load their written Fandom audio lines, then tap Explain on any card for
                    canon-backed lore and a short-form script anchored to that exact quote.
                  </p>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                    No manual topic entry: lines come only from the wiki index and the champion page the server opens.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Exact attribution", "Speaker, target, quote, and source are always separated."],
                    ["Canon-only", "Unverified interactions are marked instead of invented."],
                    ["Voice-ready", "45-60 second narration ready for ElevenLabs."],
                  ].map(([title, description]) => (
                    <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                      <h3 className="font-bold text-white">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
                    </div>
                  ))}
                </div>
            </div>

            <div className="mt-8 rounded-[1.5rem] border border-cyan-300/15 bg-slate-950/50 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/70">Live explorer</p>
                  <h2 className="mt-1 text-xl font-bold text-white">Fandom written interactions</h2>
                  <p className="mt-2 max-w-3xl text-sm text-slate-400">
                    Champions are listed from the{" "}
                    {explorerCategoryUrl ? (
                      <a
                        href={explorerCategoryUrl}
                        className="text-cyan-200 underline underline-offset-2"
                        target="_blank"
                        rel="noreferrer"
                      >
                        LoL champion audio category
                      </a>
                    ) : (
                      "LoL champion audio category"
                    )}
                    . The server fetches the category page, sends its links and visible text to OpenAI to pick the
                    correct <code className="text-cyan-100/90">/LoL/Audio</code> URL (never invented), then fetches that
                    page and sends the visible text to OpenAI to extract written champion-to-champion lines (quotes
                    must appear verbatim in that text). No .ogg download or transcription.
                  </p>
                </div>
                {explorerChampionsLoading ? (
                  <span className="text-sm text-slate-400">Loading champions…</span>
                ) : (
                  <span className="text-sm text-slate-400">{explorerChampions.length} champions</span>
                )}
              </div>

              {explorerChampionsError ? (
                <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {explorerChampionsError}
                </div>
              ) : null}

              {loreError ? (
                <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {loreError}
                </div>
              ) : null}

              <label className="block max-w-2xl">
                <span className="mb-2 block text-sm font-bold text-slate-200">Select champion</span>
                <select
                  value={selectedExplorerSlug}
                  onChange={(event) => {
                    const next = event.target.value;
                    setLoreError("");
                    setSelectedExplorerSlug(next);
                    if (!next) {
                      setExplorerInteractions(null);
                    }
                    setExplorerFilterTarget("");
                    setExplorerFilterType("");
                    setExplorerFilterQuote("");
                  }}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-200/50"
                >
                  <option value="">— Choose a champion —</option>
                  {explorerChampions.map((champion) => {
                    const pageTitle = wikiPageTitleFromAudioPageUrl(champion.audioPageUrl);
                    return (
                      <option key={champion.audioPageUrl} value={pageTitle}>
                        {champion.name}
                      </option>
                    );
                  })}
                </select>
              </label>

              {selectedExplorerSlug ? (
                <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-400">Selected champion</p>
                      <p className="text-lg font-bold text-white">
                        {explorerInteractions?.selectedChampion ?? selectedExplorerSlug.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void refreshExplorerInteractions()}
                        disabled={explorerInteractionsLoading}
                        className="rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Refresh interactions
                      </button>
                      {explorerInteractions?.audioPageUrl ? (
                        <a
                          href={explorerInteractions.audioPageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/15"
                        >
                          Open Fandom page
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {explorerInteractionsLoading ? (
                    <p className="text-sm text-slate-400">
                      {EXPLORER_LOADING_STAGES[explorerLoadingTick % EXPLORER_LOADING_STAGES.length]}
                    </p>
                  ) : null}
                  {explorerInteractionsError ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                      {explorerInteractionsError}
                    </div>
                  ) : null}
                  {explorerInteractions?.error ? (
                    <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
                      {explorerInteractions.error}
                    </div>
                  ) : null}

                  {explorerInteractions && !explorerInteractionsLoading ? (
                    <>
                      <p className="text-sm text-slate-300">
                        {!explorerInteractions.error ? (
                          <>
                            <span className="font-semibold text-cyan-200">{EXPLORER_SUCCESS_LINE}</span>{" "}
                          </>
                        ) : null}
                        <span className="font-semibold text-white">{explorerInteractions.selectedChampion}</span> —{" "}
                        <span className="text-cyan-200">{explorerInteractions.count}</span> written champion interaction
                        {explorerInteractions.count === 1 ? "" : "s"} (category index → OpenAI link match → page fetch →
                        OpenAI extraction).
                      </p>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block text-sm">
                          <span className="mb-1 block font-bold text-slate-300">Filter champion (speaker or target)</span>
                          <input
                            value={explorerFilterTarget}
                            onChange={(event) => setExplorerFilterTarget(event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white outline-none focus:border-cyan-200/40"
                            placeholder="e.g. Jinx"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block font-bold text-slate-300">Interaction type</span>
                          <input
                            value={explorerFilterType}
                            onChange={(event) => setExplorerFilterType(event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white outline-none focus:border-cyan-200/40"
                            placeholder="Taunt, Kill, First…"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block font-bold text-slate-300">Search in quote</span>
                          <input
                            value={explorerFilterQuote}
                            onChange={(event) => setExplorerFilterQuote(event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white outline-none focus:border-cyan-200/40"
                            placeholder="Keyword"
                          />
                        </label>
                      </div>

                      <p className="text-sm text-slate-400">
                        Showing <span className="text-white">{explorerFilteredRows.length}</span> interaction cards
                      </p>

                      <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                        {explorerFilteredRows.map((row, index) => (
                          <div
                            key={`${row.speaker}|${row.target}|${row.quote}|${index}`}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-xs uppercase tracking-wider text-slate-500">{row.interactionType}</p>
                                <p className="font-bold text-white">
                                  {row.speaker} → {row.target}
                                </p>
                                <p className="text-xs text-slate-500">Section: {row.section}</p>
                              </div>
                              <a
                                href={row.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-semibold text-cyan-200 underline underline-offset-2"
                              >
                                {row.sourcePageTitle || "Fandom audio page"}
                              </a>
                            </div>
                            <blockquote className="mt-3 border-l-2 border-cyan-400/40 pl-3 text-sm leading-relaxed text-slate-100">
                              &ldquo;{row.quote}&rdquo;
                            </blockquote>
                            <button
                              type="button"
                              disabled={isLoreGenerating}
                              onClick={() => void handleExplainExplorerLine(row)}
                              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-violet-400/80 to-cyan-400/80 py-3 text-sm font-black text-slate-950 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Explain this interaction
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {loreResult ? (
              <div className="mt-8 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-100/70">Production pack ready</p>
                    <h2 className="mt-1 text-2xl font-bold text-white">{loreResult.script.title}</h2>
                    <p className="mt-2 text-sm text-emerald-100/75">
                      Format v{loreResult.metadata.formatVersion} · {loreResult.metadata.language} · {loreResult.metadata.durationTarget} ·{" "}
                      {loreResult.metadata.sourceCategory ? (
                        <a
                          href={loreResult.metadata.sourceCategory}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-emerald-200/40 underline-offset-2 hover:text-white"
                        >
                          Wiki audio category
                        </a>
                      ) : null}{" "}
                      · Canon: {loreResult.interaction.canonStatus.replace(/_/g, " ")}
                    </p>
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
                          onClick={() => setEditableScript(loreResult.script.fullScript)}
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
                      <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/70">Interaction found</p>
                      <h3 className="mt-1 text-xl font-bold text-white">Champion speaking: {loreResult.interaction.speaker || "—"}</h3>
                    </div>
                    <blockquote className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4 text-lg font-semibold leading-8 text-cyan-50">
                      &ldquo;{loreResult.interaction.quote || "—"}&rdquo;
                    </blockquote>
                    <div className="mt-4 grid gap-3 text-sm text-slate-300">
                      <p>
                        <span className="font-bold text-white">Target:</span> {loreResult.interaction.target || "—"}
                      </p>
                      <p>
                        <span className="font-bold text-white">Interaction type:</span>{" "}
                        {loreResult.interaction.interactionType || "—"}
                      </p>
                      <p>
                        <span className="font-bold text-white">Source type:</span> {loreResult.interaction.sourceType || "—"}
                      </p>
                      <p>
                        <span className="font-bold text-white">Source:</span>{" "}
                        {loreResult.interaction.sourceReference?.startsWith("http") ? (
                          <a
                            href={loreResult.interaction.sourceReference}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-200 underline decoration-cyan-400/30 underline-offset-2 hover:text-white"
                          >
                            {loreResult.interaction.sourceReference}
                          </a>
                        ) : (
                          loreResult.interaction.sourceReference || "—"
                        )}
                      </p>
                      <p>
                        <span className="font-bold text-white">Canon status:</span> {loreResult.interaction.canonStatus.replace(/_/g, " ")}
                      </p>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-slate-950/55 p-5">
                    <div className="mb-4">
                      <h3 className="text-xl font-bold text-white">ElevenLabs Voice Settings</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        Uses ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID from the server by default. Fill these only to override for this request.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-slate-200">API Key override</span>
                        <input
                          value={elevenLabsApiKey}
                          onChange={(event) => setElevenLabsApiKey(event.target.value)}
                          type="password"
                          autoComplete="off"
                          placeholder="Optional - uses server env when empty"
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-200/60 focus:ring-4 focus:ring-cyan-300/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-bold text-slate-200">Voice ID override</span>
                        <input
                          value={elevenLabsVoiceId}
                          onChange={(event) => setElevenLabsVoiceId(event.target.value)}
                          placeholder="Optional - uses server env when empty"
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
                  <TextResultCard title="Short hook" value={loreResult.script.hook} />
                  <TextResultCard title="Caption" value={loreResult.script.caption} multiline />
                  <TextResultCard title="Full script (generated)" value={loreResult.script.fullScript} multiline />
                  <ListResultCard title="Hashtags" items={loreResult.script.hashtags.length ? loreResult.script.hashtags : ["(none)"]} />
                  <ListResultCard
                    title="Canon explanation — confirmed facts"
                    items={loreResult.canonResearch.confirmedFacts.length ? loreResult.canonResearch.confirmedFacts : ["(none)"]}
                  />
                  <ListResultCard
                    title="Canon explanation — what the line suggests"
                    items={loreResult.canonResearch.lineSuggests.length ? loreResult.canonResearch.lineSuggests : ["(none)"]}
                  />
                  <ListResultCard
                    title="Canon explanation — what is not confirmed"
                    items={loreResult.canonResearch.notConfirmed.length ? loreResult.canonResearch.notConfirmed : ["(none)"]}
                  />
                  {loreResult.explainResearch?.fandomContext?.length ? (
                    <ListResultCard
                      title="Fandom / wiki context (secondary)"
                      items={loreResult.explainResearch.fandomContext}
                    />
                  ) : null}
                  {loreResult.explainResearch?.sourcesUsed?.length ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <h4 className="text-sm font-bold text-slate-200">Sources referenced</h4>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300">
                        {loreResult.explainResearch.sourcesUsed.map((s, i) => (
                          <li key={`${s.url}-${i}`}>
                            <span className="text-cyan-200/90">[{s.type}]</span> {s.title}
                            {s.url?.startsWith("http") ? (
                              <>
                                {" "}
                                <a href={s.url} className="text-cyan-200 underline underline-offset-2" target="_blank" rel="noreferrer">
                                  Link
                                </a>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {loreResult.script.timedStructure?.length ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 lg:col-span-2">
                      <h4 className="text-sm font-bold text-slate-200">Short-form beats (~7s)</h4>
                      <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                        {loreResult.script.timedStructure.map((b) => (
                          <li key={b.time} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                            <span className="font-bold text-cyan-200">{b.time}</span>
                            <span className="text-slate-500"> — {b.purpose}</span>
                            <p className="mt-1 text-slate-200">{b.text}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-slate-400">
                Your canon-safe interaction explanation will appear here with copy buttons, exact attribution, and a voice-ready short-form script.
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

function WorkflowProgressBar({ progress }: { progress: ProgressState | null }) {
  if (!progress) {
    return null;
  }

  const clampedPercent = Math.min(Math.max(progress.percent, 0), 100);

  return (
    <div className="sticky top-4 z-20 rounded-3xl border border-cyan-200/20 bg-slate-950/85 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-100/70">Processing</p>
          <h2 className="mt-1 text-lg font-black text-white">{progress.label}</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-sm font-bold text-cyan-100">
          {clampedPercent}%
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 transition-all duration-700"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{progress.detail}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {progress.steps.map((step, index) => {
          const isDone = clampedPercent >= ((index + 1) / progress.steps.length) * 100;
          const isActive =
            clampedPercent >= (index / progress.steps.length) * 100 &&
            clampedPercent < ((index + 1) / progress.steps.length) * 100;

          return (
            <div
              key={step}
              className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                isDone
                  ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : isActive
                    ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-white/[0.035] text-slate-500"
              }`}
            >
              {step}
            </div>
          );
        })}
      </div>
    </div>
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
