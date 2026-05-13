import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { uiLanguageToMetadataCode } from "@/app/lib/lol-interaction-explainer";
import { expandLoreForVerifiedInteraction, durationMetadataTarget } from "@/app/lib/lol-openai-expansion";
import type { WikiVoiceInteraction } from "@/app/lib/lol-wiki-audio";

export const runtime = "nodejs";

const tones = ["Mysterious", "Cinematic", "Serious", "Dark", "Tragic", "Analytical"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["45s", "60s"] as const;
const narrativeAngles = ["Relationship", "Conflict", "Trauma", "Ideology", "Family tie", "Rivalry", "Hidden subtext"] as const;
const audienceLevels = ["New to lore", "Casual player", "Lore fan"] as const;
const creatorGoals = ["Teach clearly", "Maximize retention", "Prepare voiceover", "Spark comments"] as const;

function normalizeOption<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}

type ExplainBody = {
  speaker?: string;
  target?: string;
  quote?: string;
  interactionType?: string;
  section?: string;
  sourceUrl?: string;
  tone?: string;
  platform?: string;
  duration?: string;
  narrativeAngle?: string;
  audienceLevel?: string;
  creatorGoal?: string;
  language?: string;
  isSkinContext?: boolean;
};

export async function POST(request: NextRequest) {
  let body: ExplainBody;
  try {
    body = (await request.json()) as ExplainBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const speaker = body.speaker?.trim() ?? "";
  const target = body.target?.trim() ?? "";
  const quote = body.quote?.trim() ?? "";
  const sourceUrl = body.sourceUrl?.trim() ?? "";

  if (!speaker || !target || !quote || !sourceUrl) {
    return NextResponse.json(
      { error: "Missing required fields: speaker, target, quote, and sourceUrl are required." },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY on the server." }, { status: 503 });
  }

  const verified: WikiVoiceInteraction = {
    speaker,
    target,
    quote,
    interactionType: body.interactionType?.trim() || "Written interaction",
    wikiSection: body.section?.trim() || "",
    wikiPageTitle: "",
    sourceUrl,
    headerLine: "",
    isSkinContext: !!body.isSkinContext,
  };

  const tone = normalizeOption(body.tone, tones, "Mysterious");
  const platform = normalizeOption(body.platform, platforms, "TikTok");
  const duration = normalizeOption(body.duration, durations, "60s") as "45s" | "60s";
  const narrativeAngle = normalizeOption(body.narrativeAngle, narrativeAngles, "Relationship");
  const audienceLevel = normalizeOption(body.audienceLevel, audienceLevels, "Casual player");
  const creatorGoal = normalizeOption(body.creatorGoal, creatorGoals, "Teach clearly");
  const language = typeof body.language === "string" ? body.language : "English";
  const langCode = uiLanguageToMetadataCode(language);
  const durationTarget = durationMetadataTarget(duration);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const full = await expandLoreForVerifiedInteraction(openai, {
    verified,
    contentType: "Voice Line",
    topic: `${speaker} to ${target}`,
    sourceType: "Unknown / Let AI assess",
    tone,
    platform,
    duration,
    narrativeAngle,
    audienceLevel,
    creatorGoal,
    langCode,
    durationTarget,
  });

  return NextResponse.json({
    interaction: {
      speaker: full.interaction.speaker,
      target: full.interaction.target,
      quote: full.interaction.quote,
      interactionType: full.interaction.interactionType,
      sourceUrl: full.interaction.sourceReference,
    },
    canonResearch: full.canonResearch,
    script: full.script,
  });
}
