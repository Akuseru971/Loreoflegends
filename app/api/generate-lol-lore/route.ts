import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  OPENAI_LOL_INTERACTION_SCHEMA,
  devLoreLog,
  failureLoLInteractionResponse,
  normalizeLoLInteractionResponse,
  parseOpenAiJsonContent,
  uiLanguageToMetadataCode,
} from "@/app/lib/lol-interaction-explainer";

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
  "Aatrox voice line toward Pantheon",
  "Swain voice line toward Raum-related secrets",
  "Mordekaiser interaction with LeBlanc",
  "Vayne interaction with Evelynn",
  "Yasuo and Yone interaction",
  "Jinx and Vi relationship voice lines",
  "Nasus and Renekton brother conflict",
  "Lucian and Senna interaction after the Ruination",
  "Kayle and Morgana sister conflict",
  "Azir and Xerath betrayal subtext",
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

function buildPrompt({
  contentType,
  topic,
  quote,
  speaker,
  target,
  sourceType,
  tone,
  platform,
  duration,
  language,
  narrativeAngle,
  audienceLevel,
  creatorGoal,
}: {
  contentType: string;
  topic: string;
  quote: string;
  speaker: string;
  target: string;
  sourceType: string;
  tone: string;
  platform: string;
  duration: keyof typeof durationWordRanges;
  language: string;
  narrativeAngle: string;
  audienceLevel: string;
  creatorGoal: string;
}) {
  const range = durationWordRanges[duration];

  return `You output a single JSON object matching the enforced response schema (interaction, canonResearch, script, metadata). No markdown, no prose outside JSON.

League of Legends champion interaction explainer — strict Riot canon only.

Inputs:
- Content type: ${contentType}
- Topic / relationship: ${topic}
- User quote (exact if provided): ${quote || "Not provided"}
- Claimed speaker: ${speaker || "Not provided"}
- Claimed target: ${target || "Not provided"}
- Claimed source type: ${sourceType}
- Tone: ${tone}
- Platform: ${platform}
- Spoken output language (for fullScript, hook, caption): ${language}
- Narrative angle: ${narrativeAngle}
- Audience: ${audienceLevel}
- Creator goal: ${creatorGoal}
- Target narration length: ${range.label} (aim ~${range.min}-${range.max} words in fullScript)

Field rules:
- interaction.speaker / target / quote: use verified game or official Riot sources only. If you cannot verify, leave strings empty and set canonStatus to "unconfirmed".
- interaction.sourceType: e.g. base VO, skin, LoR, Wild Rift, cinematic, Riot Universe story, legacy.
- interaction.sourceReference: short human-readable hint (e.g. "League champion VO — in-game interaction") — never invent URLs.
- interaction.canonStatus: "verified" only if quote + speaker + context are confident; "partially_verified" if some elements are uncertain; "unconfirmed" if not safe to assert.
- canonResearch.confirmedFacts: bullet-style strings of confirmed facts only.
- canonResearch.lineSuggests: what the line may imply — clearly speculative strings, still grounded in wording.
- canonResearch.notConfirmed: list anything that must not be stated as fact; if nothing to list, use one string explaining limits.
- script.title: viral but accurate.
- script.hook: one punchy line.
- script.fullScript: continuous narration for ${platform}, ${tone} tone, ${language}, no bullet characters inside the script.
- script.caption: short platform caption text.
- script.hashtags: relevant tags without # in the strings or with # — your choice but keep strings array.
- metadata.language: use ISO-style code matching spoken language (en, fr, or es).
- metadata.durationTarget: use "${durationMetadataTarget(duration)}".
- metadata.formatVersion: "1.0"

Never invent dialogue, fake replies, or interactions not supported by official Riot material. If unsure, prefer empty quote and unconfirmed status.`;
}

async function callOpenAiStructured(openai: OpenAI, prompt: string) {
  const strictFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "lol_interaction_explainer",
      strict: true,
      schema: OPENAI_LOL_INTERACTION_SCHEMA,
    },
  };

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.65,
      response_format: strictFormat,
      messages: [
        {
          role: "system",
          content:
            "You are a League of Legends lore expert for short-form video. You only output JSON matching the schema. You never fabricate voice lines or champion interactions.",
        },
        { role: "user", content: prompt },
      ],
    });
    return completion.choices[0]?.message.content ?? "";
  } catch (error) {
    devLoreLog("json_schema call failed, falling back to json_object", error instanceof Error ? error.message : error);
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.65,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a League of Legends lore expert. Reply with ONE JSON object only. Keys must be exactly: interaction (object with speaker, target, quote, sourceType, sourceReference, canonStatus), canonResearch (object with confirmedFacts, lineSuggests, notConfirmed arrays of strings), script (object with title, hook, fullScript, caption, hashtags), metadata (object with language, durationTarget, formatVersion). canonStatus must be verified, partially_verified, or unconfirmed.",
        },
        { role: "user", content: prompt },
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

  if (mode === "custom" && !topic && !quote) {
    const body = failureLoLInteractionResponse({
      notConfirmed: ["Enter an interaction, quote, or champion relationship before generating."],
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

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = buildPrompt({
    contentType,
    topic,
    quote,
    speaker,
    target,
    sourceType,
    tone,
    platform,
    duration,
    language,
    narrativeAngle,
    audienceLevel,
    creatorGoal,
  });

  let rawContent = "";
  try {
    rawContent = await callOpenAiStructured(openai, prompt);
    devLoreLog("raw OpenAI message.content", rawContent || "(empty)");
  } catch (error) {
    console.error("[generate-lol-lore] OpenAI request failed", error);
    const body = failureLoLInteractionResponse({
      notConfirmed: ["Lore generation failed. Please try again or adjust the topic."],
      language: langCode,
      durationTarget,
    });
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  if (!rawContent.trim()) {
    const body = failureLoLInteractionResponse({
      notConfirmed: ["The model returned an empty response."],
      language: langCode,
      durationTarget,
    });
    devLoreLog("validation errors", ["empty model content"]);
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  const parsed = parseOpenAiJsonContent(rawContent);
  if (!parsed.ok) {
    devLoreLog("JSON.parse error", parsed.error);
    const body = failureLoLInteractionResponse({
      notConfirmed: [`Could not parse model JSON: ${parsed.error}`],
      language: langCode,
      durationTarget,
    });
    devLoreLog("parsed response (failed)", { rawSnippet: rawContent.slice(0, 2000) });
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  devLoreLog("parsed response", parsed.value);

  let normalized = normalizeLoLInteractionResponse(parsed.value, normalizeOpts);
  normalized = {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      language: langCode,
      durationTarget,
      formatVersion: normalized.metadata.formatVersion || "1.0",
    },
  };

  const wordCount = countWords(normalized.script.fullScript);
  const range = durationWordRanges[duration];
  if (wordCount < range.min || wordCount > range.max) {
    devLoreLog("validation notes", [`Script word count ${wordCount} outside target ${range.min}-${range.max}.`]);
  }

  devLoreLog("final JSON sent to client", normalized);
  return NextResponse.json(normalized);
}
