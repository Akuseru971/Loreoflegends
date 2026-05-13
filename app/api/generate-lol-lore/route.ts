import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  NO_VERIFIED_VOICE_LINE_MESSAGE,
  devLoreLog,
  failureLoLInteractionResponse,
  normalizeLoLInteractionResponse,
  uiLanguageToMetadataCode,
} from "@/app/lib/lol-interaction-explainer";
import { findWrittenChampionInteractions, type WikiVoiceInteraction } from "@/app/lib/lol-wiki-audio";
import { durationMetadataTarget, durationWordRanges, expandLoreForVerifiedInteraction } from "@/app/lib/lol-openai-expansion";

export const runtime = "nodejs";

const contentTypes = ["Voice Line", "Champion Relationship", "Dialogue Subtext", "Conflict Explanation"] as const;
const tones = ["Mysterious", "Cinematic", "Serious", "Dark", "Tragic", "Analytical"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["45s", "60s"] as const;
const languages = ["English", "French", "Spanish"] as const;
const sourceTypes = [
  "Unknown / Let AI assess",
  "Base champion voice line",
  "Skin voice line",
  "Legends of Runeterra",
  "Wild Rift",
  "Cinematic",
  "Riot Universe story",
  "Old / legacy lore",
] as const;
const narrativeAngles = ["Relationship", "Conflict", "Trauma", "Ideology", "Family tie", "Rivalry", "Hidden subtext"] as const;
const audienceLevels = ["New to lore", "Casual player", "Lore fan"] as const;
const creatorGoals = ["Teach clearly", "Maximize retention", "Prepare voiceover", "Spark comments"] as const;

const dailyTopics = [
  "Aatrox toward Pantheon — real special interaction line",
  "Swain — pick his strongest verified line toward another champion",
  "Mordekaiser and LeBlanc — verified interaction quote",
  "Vayne and Evelynn — verified taunt or interaction line",
  "Yasuo and Yone — verified brother interaction line",
  "Jinx and Vi — verified sister interaction line",
  "Nasus and Renekton — verified brother conflict line",
  "Lucian and Senna — verified interaction after Ruination",
  "Kayle and Morgana — verified sister conflict line",
  "Azir and Xerath — verified betrayal-related line",
];

type LoreRequest = {
  contentType?: string;
  topic?: string;
  quote?: string;
  speaker?: string;
  target?: string;
  sourceType?: string;
  tone?: string;
  platform?: string;
  duration?: string;
  language?: string;
  narrativeAngle?: string;
  audienceLevel?: string;
  creatorGoal?: string;
  mode?: string;
  /** When set, skip wiki discovery and explain this exact written line (explorer flow). */
  exploreSelection?: {
    speaker: string;
    target: string;
    quote: string;
    interactionType?: string;
    section?: string;
    sourceUrl: string;
    isSkinContext?: boolean;
  };
};

function pickRandom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function normalizeOption<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}

function topicFirstToken(topic: string): string {
  return topic.trim().split(/\s+/).filter(Boolean)[0] ?? "";
}

/**
 * Resolve which champion(s) drive the wiki crawl. Speaker + target as a pair narrows to both;
 * a single field uses that champion and enables reverse lookup inside findWrittenChampionInteractions.
 */
function resolveWikiFocus(speaker: string, target: string, topic: string): { primaryDisplay: string; secondaryDisplay?: string } {
  const s = speaker.trim();
  const t = target.trim();
  const tf = topicFirstToken(topic);

  if (s && t && s.toLowerCase() !== t.toLowerCase()) {
    return { primaryDisplay: s, secondaryDisplay: t };
  }
  if (s) {
    return { primaryDisplay: s };
  }
  if (t) {
    return { primaryDisplay: t };
  }
  return { primaryDisplay: tf };
}

export async function POST(request: NextRequest) {
  const metaDefaults = { language: "en", durationTarget: "45-60s" };

  let payload: LoreRequest;
  try {
    payload = (await request.json()) as LoreRequest;
  } catch {
    const body = normalizeLoLInteractionResponse(null, metaDefaults);
    body.canonResearch.notConfirmed = ["Invalid request body."];
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  const mode = payload.mode === "daily" ? "daily" : "custom";
  const contentType =
    mode === "daily" ? pickRandom(contentTypes) : normalizeOption(payload.contentType, contentTypes, "Voice Line");
  const topic = mode === "daily" ? pickRandom(dailyTopics) : payload.topic?.trim() ?? "";
  const quote = payload.quote?.trim() ?? "";
  const speaker = payload.speaker?.trim() ?? "";
  const target = payload.target?.trim() ?? "";
  const sourceType = normalizeOption(payload.sourceType, sourceTypes, "Unknown / Let AI assess");
  const tone = normalizeOption(payload.tone, tones, "Mysterious");
  const platform = normalizeOption(payload.platform, platforms, "TikTok");
  const duration = normalizeOption(payload.duration, durations, "60s") as keyof typeof durationWordRanges;
  const language = normalizeOption(payload.language, languages, "English");
  const narrativeAngle = normalizeOption(payload.narrativeAngle, narrativeAngles, "Relationship");
  const audienceLevel = normalizeOption(payload.audienceLevel, audienceLevels, "Casual player");
  const creatorGoal = normalizeOption(payload.creatorGoal, creatorGoals, "Teach clearly");

  const langCode = uiLanguageToMetadataCode(language);
  const durationTarget = durationMetadataTarget(duration);

  if (mode === "custom" && !payload.exploreSelection && !topic && !quote && !speaker && !target) {
    const body = failureLoLInteractionResponse({
      notConfirmed: ["Enter a champion name, topic, or quote before generating."],
      language: langCode,
      durationTarget,
    });
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  if (!process.env.OPENAI_API_KEY) {
    const body = failureLoLInteractionResponse({
      notConfirmed: ["Missing OpenAI API key. Add OPENAI_API_KEY in your environment."],
      language: langCode,
      durationTarget,
    });
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  const explore = payload.exploreSelection;

  let verified: WikiVoiceInteraction;
  let wikiMeta: { candidatesConsidered?: number } = {};

  if (explore?.speaker && explore.target && explore.quote && explore.sourceUrl) {
    verified = {
      speaker: explore.speaker.trim(),
      target: explore.target.trim(),
      quote: explore.quote.trim(),
      interactionType: explore.interactionType?.trim() || "Written interaction",
      wikiSection: explore.section?.trim() || "",
      wikiPageTitle: "",
      sourceUrl: explore.sourceUrl.trim(),
      headerLine: "",
      isSkinContext: !!explore.isSkinContext,
    };
    wikiMeta = { candidatesConsidered: 1 };
  } else {
    const { primaryDisplay, secondaryDisplay } = resolveWikiFocus(speaker, target, topic);
    if (!primaryDisplay.trim()) {
      const body = failureLoLInteractionResponse({
        notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, "No champion name could be resolved from the request."],
        language: langCode,
        durationTarget,
      });
      return NextResponse.json(body);
    }

    let wikiResult: Awaited<ReturnType<typeof findWrittenChampionInteractions>> = null;
    try {
      wikiResult = await findWrittenChampionInteractions({
        primaryDisplay,
        secondaryDisplay,
      });
    } catch (error) {
      devLoreLog("wiki find error", error instanceof Error ? error.message : error);
    }

    if (!wikiResult) {
      const body = failureLoLInteractionResponse({
        notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE],
        language: langCode,
        durationTarget,
      });
      devLoreLog("final JSON sent to client (no wiki interaction)", body);
      return NextResponse.json(body);
    }

    verified = wikiResult.selected;
    wikiMeta = { candidatesConsidered: wikiResult.candidatesConsidered };
  }

  devLoreLog("wiki-selected interaction", { ...verified, ...wikiMeta });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const normalized = await expandLoreForVerifiedInteraction(openai, {
    verified,
    contentType,
    topic,
    userQuote: quote || undefined,
    sourceType,
    tone,
    platform,
    duration,
    narrativeAngle,
    audienceLevel,
    creatorGoal,
    langCode,
    durationTarget,
  });

  devLoreLog("final JSON sent to client", normalized);
  return NextResponse.json(normalized);
}
