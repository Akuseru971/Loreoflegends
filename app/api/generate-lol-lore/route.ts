import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  LOL_INTERACTION_FORMAT_VERSION,
  NO_VERIFIED_VOICE_LINE_MESSAGE,
  OPENAI_LOL_INTERACTION_SCHEMA,
  devLoreLog,
  failureLoLInteractionResponse,
  normalizeLoLInteractionResponse,
  parseOpenAiJsonContent,
  uiLanguageToMetadataCode,
} from "@/app/lib/lol-interaction-explainer";
import { findWrittenChampionInteractions, LOL_WIKI_AUDIO_CATEGORY_URL, type WikiVoiceInteraction } from "@/app/lib/lol-wiki-audio";

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

const durationWordRanges = {
  "45s": { min: 115, max: 145, label: "45 seconds" },
  "60s": { min: 145, max: 175, label: "60 seconds" },
} as const;

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
};

function pickRandom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function normalizeOption<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function durationMetadataTarget(duration: keyof typeof durationWordRanges): string {
  return duration === "45s" ? "45s" : "45-60s";
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

function quoteAnchorsScript(quote: string, script: string): boolean {
  const q = quote.replace(/\s+/g, " ").trim();
  if (q.length < 4) {
    return false;
  }
  const s = script.toLowerCase();
  const needle = q.length > 48 ? q.slice(0, 48).toLowerCase() : q.toLowerCase();
  return s.includes(needle);
}

function scriptOpensWithWhenPattern(script: string, speaker: string, quote: string, target: string): boolean {
  const t = script.trim().toLowerCase();
  if (!/^when\s+/.test(t)) {
    return false;
  }
  if (!t.includes(speaker.trim().toLowerCase())) {
    return false;
  }
  if (!t.includes(target.trim().toLowerCase())) {
    return false;
  }
  const q = quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (q.length >= 10) {
    const needle = q.length > 44 ? q.slice(0, 44) : q;
    if (!t.includes(needle)) {
      return false;
    }
  }
  return true;
}

function buildExpansionPrompt(opts: {
  verified: WikiVoiceInteraction;
  contentType: string;
  topic: string;
  userQuote?: string;
  sourceType: string;
  tone: string;
  platform: string;
  duration: keyof typeof durationWordRanges;
  narrativeAngle: string;
  audienceLevel: string;
  creatorGoal: string;
}) {
  const v = opts.verified;
  const range = durationWordRanges[opts.duration];
  const qJson = JSON.stringify(v.quote);
  const skinNote = v.isSkinContext ?
    "This line is under a skin-specific wiki block (e.g. {{csl|…}} or skin tab). You MUST label it clearly as alternate skin voice-over in notConfirmed and/or lineSuggests, and use canonStatus partially_verified unless the line is identical on base."
  : "Parsed from written wikitext on the Fandom `Champion/LoL/Audio` page (community transcription). Never infer text from .ogg filenames or audio binaries.";

  return `PASS B — OFFICIAL RIOT LORE + ENGLISH SHORT-FORM SCRIPT (voice line is frozen; do not change one word of the quote).

LOCKED LINE (verbatim written quote from leagueoflegends.fandom.com Champion/LoL/Audio — Category:LoL_Champion_audio).
We never download, play, or transcribe audio files; only text already printed on the wiki.
- Speaker: ${v.speaker}
- Target: ${v.target}
- Quote (verbatim): ${qJson}
- Interaction type: ${v.interactionType}
- Wiki section: ${v.wikiSection}
- Source URL: ${v.sourceUrl}
- Skin context flag: ${v.isSkinContext ? "true" : "false"}
${skinNote}

User context (secondary): contentType=${opts.contentType}, topic=${opts.topic || "(none)"}, userQuoteHint=${opts.userQuote || "(none)"}, sourceTypeHint=${opts.sourceType}

STEP 1 — Canon research (Riot Universe, official bios, official short stories, cinematics, events, official champion pages ONLY):
- confirmedFacts: only what those official sources establish.
- lineSuggests: careful "may suggest / could imply" readings tied to this quote.
- notConfirmed: limits, unknowns, and anything not explicitly confirmed by Riot. When appropriate, include the exact sentence: "This is not officially confirmed in canon."

STEP 2 — Script (English only):
- metadata.language MUST be "en".
- script.title / script.hook: TikTok-style, tied to THIS quote.
- script.fullScript: English, ${opts.tone} tone, for ${opts.platform}, ~${range.min}-${range.max} words, ${opts.narrativeAngle} angle, audience ${opts.audienceLevel}, goal ${opts.creatorGoal}.
- FIRST sentence of fullScript MUST follow: When ${v.speaker} says ${qJson} to ${v.target}, … (use straight double quotes around the quote as shown).
- Include beat markers on their own lines: [0-3s], [7s], [14s], [21s], [28s], [35s], [42s], [50s] — each block advances the mystery; mini-hook about every 7 seconds.
- No bullet characters in narration paragraphs.
- Do not drift into a generic biography; stay on this interaction.

STEP 3 — interaction JSON (must mirror the locked line):
- speaker, target, quote: EXACT strings above.
- interactionType: EXACT string above.
- sourceType: "Written champion interaction from Fandom LoL champion audio page"
- sourceReference: EXACT URL above.
- canonStatus: ${v.isSkinContext ? '"partially_verified" (skin-specific written VO block on Fandom)' : '"verified_written_voice_line"'}

STEP 4 — hashtags: 4–8 strings, include #LeagueOfLegends or #LoL plus champion tags.

metadata.durationTarget: "${durationMetadataTarget(opts.duration)}"
metadata.formatVersion: "${LOL_INTERACTION_FORMAT_VERSION}"
metadata.sourceCategory: "${LOL_WIKI_AUDIO_CATEGORY_URL}"

Output ONE JSON object matching the production schema (interaction, canonResearch, script, metadata).`;
}

async function callOpenAiWithSchema(
  openai: OpenAI,
  options: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
    temperature: number;
  },
): Promise<string> {
  const strictFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: options.schemaName,
      strict: true,
      schema: options.schema,
    },
  };

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: options.temperature,
      response_format: strictFormat,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    });
    return completion.choices[0]?.message.content ?? "";
  } catch (error) {
    devLoreLog(`json_schema "${options.schemaName}" failed`, error instanceof Error ? error.message : error);
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: options.temperature,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${options.system} Output ONE JSON object only—valid JSON, no markdown, no text before/after.`,
        },
        { role: "user", content: options.user },
      ],
    });
    return completion.choices[0]?.message.content ?? "";
  }
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
  const normalizeOpts = { language: langCode, durationTarget };

  if (mode === "custom" && !topic && !quote && !speaker && !target) {
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

  const verified = wikiResult.selected;
  devLoreLog("wiki-selected interaction", { ...verified, candidatesConsidered: wikiResult.candidatesConsidered });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const expansionUser = buildExpansionPrompt({
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
  });

  let expansionRaw = "";
  try {
    expansionRaw = await callOpenAiWithSchema(openai, {
      system:
        "You are a League of Legends lore analyst. You NEVER invent written voice lines. You NEVER analyze, download, or transcribe audio files (.ogg, .mp3, .wav). The written quote in the user message is absolute ground truth. Separate official Riot canon from speculation. Output JSON only.",
      user: expansionUser,
      schemaName: "lol_interaction_explainer",
      schema: OPENAI_LOL_INTERACTION_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.45,
    });
    devLoreLog("lore+script raw", expansionRaw || "(empty)");
  } catch (error) {
    console.error("[generate-lol-lore] expansion OpenAI failed", error);
    const body = failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, "The lore and script generation step failed. Please try again."],
      language: langCode,
      durationTarget,
    });
    return NextResponse.json(body);
  }

  const expansionParsed = parseOpenAiJsonContent(expansionRaw);
  if (!expansionParsed.ok) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, `Script pass parse error: ${expansionParsed.error}`],
      language: langCode,
      durationTarget,
    });
    return NextResponse.json(body);
  }

  const forcedCanon = verified.isSkinContext ? ("partially_verified" as const) : ("verified_written_voice_line" as const);

  let normalized = normalizeLoLInteractionResponse(expansionParsed.value, normalizeOpts);
  normalized = {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      language: "en",
      durationTarget,
      formatVersion: normalized.metadata.formatVersion || LOL_INTERACTION_FORMAT_VERSION,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
    },
    interaction: {
      ...normalized.interaction,
      speaker: verified.speaker,
      target: verified.target,
      quote: verified.quote,
      interactionType: verified.interactionType,
      sourceType: "Written champion interaction from Fandom LoL champion audio page",
      sourceReference: verified.sourceUrl,
      canonStatus: forcedCanon,
    },
  };

  const fs = normalized.script.fullScript.trim();
  const anchored = quoteAnchorsScript(verified.quote, fs);
  const opensOk = scriptOpensWithWhenPattern(fs, verified.speaker, verified.quote, verified.target);

  if (!fs || !anchored || !opensOk) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [
        NO_VERIFIED_VOICE_LINE_MESSAGE,
        "The generated script did not stay anchored to the wiki quote with the required English opening. Try again.",
      ],
      language: langCode,
      durationTarget,
    });
    devLoreLog("rejected expansion (anchor/opening check)", { anchored, opensOk, snippet: fs.slice(0, 240) });
    return NextResponse.json(body);
  }

  const wordCount = countWords(fs);
  const range = durationWordRanges[duration];
  if (wordCount < range.min || wordCount > range.max) {
    devLoreLog("validation notes", [`Script word count ${wordCount} outside target ${range.min}-${range.max}.`]);
  }

  devLoreLog("final JSON sent to client", normalized);
  return NextResponse.json(normalized);
}
