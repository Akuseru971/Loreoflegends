import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const contentTypes = ["Lore Event", "Champion Lore", "Lore Fun Fact"] as const;
const tones = ["Mysterious", "Epic", "Dark", "Tragic", "Cinematic", "Kindred-style"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["1min15", "1min30", "1min40"] as const;
const languages = ["English", "French", "Spanish"] as const;

const durationWordRanges = {
  "1min15": { min: 185, max: 210, label: "1 minute 15 seconds" },
  "1min30": { min: 220, max: 250, label: "1 minute 30 seconds" },
  "1min40": { min: 250, max: 280, label: "1 minute 40 seconds" },
} as const;

const dailyTopics = [
  "The fall of Icathia",
  "Aatrox and the Darkin",
  "Mordekaiser's return",
  "Ryze and the World Runes",
  "The Watchers beneath the Freljord",
  "The Ruination of the Blessed Isles",
  "The tragedy of Azir and Xerath",
  "Kindred and Runeterra's idea of death",
  "The Void's first breach into Runeterra",
  "The Black Mist and Shadow Isles",
  "Lissandra's bargain with the Watchers",
  "The origins of Pantheon and Atreus",
];

type LoreRequest = {
  contentType?: string;
  topic?: string;
  tone?: string;
  platform?: string;
  duration?: string;
  language?: string;
  mode?: string;
};

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

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateLorePack(value: unknown): LorePack | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const pack = value as Record<string, unknown>;
  const visualBeats = pack.visualBeats;

  if (
    typeof pack.title !== "string" ||
    typeof pack.hook !== "string" ||
    typeof pack.script !== "string" ||
    typeof pack.voiceReadyScript !== "string" ||
    !isStringArray(pack.captionVersion) ||
    !Array.isArray(visualBeats) ||
    typeof pack.tiktokDescription !== "string" ||
    typeof pack.instagramCaption !== "string" ||
    typeof pack.youtubeShortsTitle !== "string" ||
    !isStringArray(pack.hashtags) ||
    typeof pack.pinnedComment !== "string"
  ) {
    return null;
  }

  const validVisualBeats = visualBeats.every(
    (beat) =>
      beat &&
      typeof beat === "object" &&
      typeof (beat as Record<string, unknown>).beat === "string" &&
      typeof (beat as Record<string, unknown>).visualSuggestion === "string",
  );

  if (!validVisualBeats) {
    return null;
  }

  return pack as LorePack;
}

function buildPrompt({
  contentType,
  topic,
  tone,
  platform,
  duration,
  language,
  retryInstruction,
}: {
  contentType: string;
  topic: string;
  tone: string;
  platform: string;
  duration: keyof typeof durationWordRanges;
  language: string;
  retryInstruction?: string;
}) {
  const range = durationWordRanges[duration];

  return `Generate a production-ready League of Legends lore short-form script pack.

Return ONLY valid JSON. No markdown. No comments.

JSON schema:
{
  "title": string,
  "hook": string,
  "script": string,
  "voiceReadyScript": string,
  "captionVersion": string[],
  "visualBeats": [{ "beat": string, "visualSuggestion": string }],
  "tiktokDescription": string,
  "instagramCaption": string,
  "youtubeShortsTitle": string,
  "hashtags": string[],
  "pinnedComment": string
}

Inputs:
- Content type: ${contentType}
- Topic: ${topic}
- Tone: ${tone}
- Platform: ${platform}
- Duration target: ${range.label}
- Language: ${language}

Canon accuracy rules:
- Use only confirmed official League of Legends / Runeterra lore.
- Do not invent new lore, relationships, motivations, factions, powers, locations, or timelines.
- Do not add headcanon.
- Do not exaggerate beyond what is confirmed.
- If a detail is uncertain or interpretive, phrase it carefully and naturally.
- Avoid repeated phrases like "according to official lore" or "according to Riot".
- The output must sound natural, cinematic, and human, not like a disclaimer.

Script requirements:
- Write the final narration in ${language}.
- The script must be ready for ElevenLabs voice generation.
- Target ${range.min}-${range.max} words for the main "script" field.
- Structure the narration naturally: immediate 0-3 second hook, context, lore development, retention beats every 10-12 seconds, climax/reveal, short mysterious final line.
- No timeline labels or section labels inside the final narration.
- No emojis in the script.
- No boring intro such as "Today we are going to talk about".
- Avoid repetitive constructions and fake dramatic filler.
- Do not overuse phrases such as "dark secret", "hidden truth", or "what nobody knows".
- Make it clear enough for viewers who do not know the lore deeply.
- Make it developed, specific, and retention-focused without being generic.

Output field guidance:
- title: viral but accurate title.
- hook: one short opening sentence from the script or a tighter version of it.
- script: polished narration only.
- voiceReadyScript: same content optimized for spoken delivery with clean paragraph breaks and no production labels.
- captionVersion: 4-7 short caption lines suitable for on-screen text.
- visualBeats: 6-9 concise beat objects with non-video-generation visual direction ideas.
- tiktokDescription, instagramCaption, youtubeShortsTitle: platform-ready copy.
- hashtags: 8-14 relevant hashtags.
- pinnedComment: one question that invites lore discussion.

${retryInstruction ?? ""}`;
}

async function generatePack(openai: OpenAI, prompt: string) {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.75,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a senior League of Legends lore writer and short-form retention editor. You are strict about Riot canon and never fabricate lore.",
      },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("The model returned an empty response.");
  }

  return JSON.parse(content) as unknown;
}

export async function POST(request: NextRequest) {
  let payload: LoreRequest;
  try {
    payload = (await request.json()) as LoreRequest;
  } catch {
    return jsonError("Invalid request body.");
  }

  const mode = payload.mode === "daily" ? "daily" : "custom";
  const contentType =
    mode === "daily" ? pickRandom(contentTypes) : normalizeOption(payload.contentType, contentTypes, "Lore Event");
  const topic = mode === "daily" ? pickRandom(dailyTopics) : payload.topic?.trim() ?? "";
  const tone = normalizeOption(payload.tone, tones, "Mysterious");
  const platform = normalizeOption(payload.platform, platforms, "TikTok");
  const duration = normalizeOption(payload.duration, durations, "1min30") as keyof typeof durationWordRanges;
  const language = normalizeOption(payload.language, languages, "English");

  if (mode === "custom" && !topic) {
    return jsonError("Enter a League of Legends lore topic before generating.");
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError("Missing OpenAI API key. Add OPENAI_API_KEY in your environment.", 500);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const range = durationWordRanges[duration];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryInstruction =
        attempt === 1
          ? `Regenerate now. The previous script length was outside the required range. The "script" field must be ${range.min}-${range.max} words.`
          : undefined;
      const prompt = buildPrompt({ contentType, topic, tone, platform, duration, language, retryInstruction });
      const rawPack = await generatePack(openai, prompt);
      const pack = validateLorePack(rawPack);

      if (!pack) {
        if (attempt === 0) {
          continue;
        }
        return jsonError("Invalid response format from the lore generator.", 502);
      }

      const wordCount = countWords(pack.script);
      if (wordCount >= range.min && wordCount <= range.max) {
        return NextResponse.json({ ...pack, selectedTopic: topic, selectedContentType: contentType, wordCount });
      }

      if (attempt === 1) {
        return jsonError(
          `Script length was ${wordCount} words, but ${duration} requires ${range.min}-${range.max} words.`,
          502,
        );
      }
    }

    return jsonError("Unable to generate a valid lore script.", 502);
  } catch (error) {
    console.error(error);
    return jsonError("Lore generation failed. Please try again or adjust the topic.", 500);
  }
}
