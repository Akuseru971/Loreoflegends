import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const contentTypes = ["Lore Event", "Champion Lore", "Lore Fun Fact"] as const;
const tones = ["Mysterious", "Epic", "Dark", "Tragic", "Cinematic", "Kindred-style"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["1min15", "1min30", "1min40"] as const;
const languages = ["English", "French", "Spanish"] as const;
const narrativeAngles = [
  "Core tragedy",
  "Cause and consequence",
  "Character motivation",
  "Region politics",
  "Beginner explainer",
  "Mythic horror",
  "Moral ambiguity",
] as const;
const audienceLevels = ["New to lore", "Casual player", "Lore fan"] as const;
const creatorGoals = ["Teach clearly", "Maximize retention", "Prepare voiceover", "Spark comments"] as const;

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
  narrativeAngle?: string;
  audienceLevel?: string;
  creatorGoal?: string;
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
  hookVariants: string[];
  alternateTitles: string[];
  retentionBreakdown: {
    moment: string;
    purpose: string;
    text: string;
  }[];
  loreAccuracyNotes: {
    fact: string;
    whyItMatters: string;
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
  const retentionBreakdown = pack.retentionBreakdown;
  const loreAccuracyNotes = pack.loreAccuracyNotes;

  if (
    typeof pack.title !== "string" ||
    typeof pack.hook !== "string" ||
    typeof pack.script !== "string" ||
    typeof pack.voiceReadyScript !== "string" ||
    !isStringArray(pack.captionVersion) ||
    !isStringArray(pack.hookVariants) ||
    !isStringArray(pack.alternateTitles) ||
    !Array.isArray(visualBeats) ||
    !Array.isArray(retentionBreakdown) ||
    !Array.isArray(loreAccuracyNotes) ||
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

  const validRetentionBreakdown = retentionBreakdown.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).moment === "string" &&
      typeof (item as Record<string, unknown>).purpose === "string" &&
      typeof (item as Record<string, unknown>).text === "string",
  );

  const validLoreAccuracyNotes = loreAccuracyNotes.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).fact === "string" &&
      typeof (item as Record<string, unknown>).whyItMatters === "string",
  );

  if (!validVisualBeats || !validRetentionBreakdown || !validLoreAccuracyNotes) {
    return null;
  }

  return pack as LorePack;
}

function firstSentence(text: string) {
  return text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
}

function qualityIssues(pack: LorePack, range: { min: number; max: number }) {
  const issues: string[] = [];
  const wordCount = countWords(pack.script);
  const opening = firstSentence(pack.script);
  const lowerScript = pack.script.toLowerCase();
  const weakOpenings = [
    "today we are going to",
    "welcome back",
    "in this video",
    "let's talk about",
    "league of legends has many",
  ];
  const fillerPhrases = ["dark secret", "hidden truth", "what nobody knows"];

  if (wordCount < range.min || wordCount > range.max) {
    issues.push(`The script is ${wordCount} words; target ${range.min}-${range.max}.`);
  }

  if (opening.length < 35 || weakOpenings.some((phrase) => opening.toLowerCase().includes(phrase))) {
    issues.push("The opening hook is too weak or generic.");
  }

  if (pack.loreAccuracyNotes.length < 3) {
    issues.push("The script needs at least 3 concrete confirmed lore facts.");
  }

  if (pack.retentionBreakdown.length < 4) {
    issues.push("The script needs a complete retention breakdown.");
  }

  if (fillerPhrases.some((phrase) => lowerScript.includes(phrase))) {
    issues.push("The narration uses overused dramatic filler.");
  }

  if (pack.pinnedComment.trim().length < 20) {
    issues.push("The pinned comment should invite a meaningful lore discussion.");
  }

  return issues;
}

function qualityReport(pack: LorePack, range: { min: number; max: number }) {
  const wordCount = countWords(pack.script);
  const issues = qualityIssues(pack, range);
  const strengths = [
    "Structured for short-form retention",
    `${pack.loreAccuracyNotes.length} creator-side lore accuracy notes`,
    `${pack.retentionBreakdown.length} retention moments mapped`,
  ];

  if (wordCount >= range.min && wordCount <= range.max) {
    strengths.push("Within requested duration target");
  }

  return {
    score: Math.max(0, 100 - issues.length * 15),
    passed: issues.length === 0,
    wordCount,
    targetWordRange: `${range.min}-${range.max}`,
    strengths,
    warnings: issues,
  };
}

function buildPrompt({
  contentType,
  topic,
  tone,
  platform,
  duration,
  language,
  narrativeAngle,
  audienceLevel,
  creatorGoal,
  retryInstruction,
}: {
  contentType: string;
  topic: string;
  tone: string;
  platform: string;
  duration: keyof typeof durationWordRanges;
  language: string;
  narrativeAngle: string;
  audienceLevel: string;
  creatorGoal: string;
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
  "hookVariants": string[],
  "alternateTitles": string[],
  "visualBeats": [{ "beat": string, "visualSuggestion": string }],
  "retentionBreakdown": [
    { "moment": string, "purpose": string, "text": string }
  ],
  "loreAccuracyNotes": [
    { "fact": string, "whyItMatters": string }
  ],
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
- Narrative angle: ${narrativeAngle}
- Audience level: ${audienceLevel}
- Creator goal: ${creatorGoal}

ANGLE AND AUDIENCE DIRECTION:
- Narrative angle controls what the script should prioritize:
  Core tragedy = emotional wound and consequence.
  Cause and consequence = clear chain of events.
  Character motivation = why a character acts the way they do.
  Region politics = factions, power, conflict, and stakes.
  Beginner explainer = maximum clarity for new viewers.
  Mythic horror = cosmic dread through confirmed facts only.
  Moral ambiguity = why the topic is hard to judge.
- Audience level controls assumed knowledge:
  New to lore = explain every proper noun quickly.
  Casual player = connect lore to champions/regions viewers may recognize.
  Lore fan = allow more specificity, but still keep it clear.
- Creator goal controls optimization:
  Teach clearly = prioritize explanation.
  Maximize retention = prioritize hooks, reversals, and escalating reveals.
  Prepare voiceover = prioritize clean spoken rhythm.
  Spark comments = prioritize a nuanced final question and debate angle.

CORE GOAL:
The video must instruct, not just entertain. The viewer should finish thinking:
"I actually understand this part of League of Legends lore better now."
Educational clarity comes first, cinematic intensity second.

SCRIPT STYLE:
- Sound like a high-retention TikTok / Shorts lore creator explaining real League of Legends canon.
- Do not sound like Wikipedia.
- Do not sound like generic fantasy storytelling.
- Use short, punchy spoken sentences with natural ElevenLabs rhythm.
- Be social-media native: strong first 3 seconds, no dead time, no academic phrasing.
- Be dramatic only through confirmed facts, consequences, motivations, and reversals.
- Adapt depth for audience level:
  - New to lore: explain terms and stakes simply.
  - Casual player: connect lore to recognizable champions, regions, and conflicts.
  - Lore fan: include sharper cause/effect and less obvious implications.
- Prioritize the creator goal:
  - Teach clearly: maximize clarity and concrete facts.
  - Maximize retention: sharpen hook, reversals, and payoff.
  - Prepare voiceover: simplify sentence rhythm and pronunciation.
  - Spark comments: make the final question more debatable without rage-bait.

CANON ACCURACY RULES:
- Use only confirmed official League of Legends / Runeterra lore.
- Do not invent new lore, relationships, motivations, factions, powers, locations, or timelines.
- Do not add headcanon.
- Do not exaggerate beyond what is confirmed.
- Do not create fake connections between champions.
- Do not rely on fan theories.
- Do not transform unclear lore into certainty.
- If a detail is uncertain or interpretive, phrase it carefully and naturally.
- Avoid repeated phrases like "according to official lore" or "according to Riot".
- The output must sound natural, cinematic, and human, not like a disclaimer.

SCRIPT STRUCTURE:
1. Pattern-interrupt hook:
   Start with one strong sentence that immediately creates curiosity.
   Hook styles can include:
   - "Most players completely misunderstand why..."
   - "The scariest part of this story is not..."
   - "This champion did not become a monster by accident."
   - "There is one detail in this lore that changes everything."
   - "Before you judge this character, you need to understand what happened first."
   - "This is one of the most tragic events in Runeterra."
   - "The reason this war started is much darker than it seems."
   Do not reuse the same hook style every time.
2. Stakes in one sentence:
   Immediately explain why this topic matters in Runeterra.
3. Clear lore context:
   Explain the relevant region, champion, event, faction, or conflict for non-experts.
4. Developed canon explanation:
   Explain what happened, who was involved, why it mattered, what changed afterward,
   and the emotional or political consequence.
5. Retention beats:
   Every few sentences, add a new piece of information that raises interest:
   a reversal, surprising canon detail, tragic consequence, motivation, hidden connection,
   or larger implication in Runeterra.
6. Educational explanation:
   Include at least 3 concrete confirmed lore facts. Avoid vague dramatic filler.
7. Climax / key reveal:
   End the explanation with the strongest confirmed lore detail.
8. Final social-media line:
   End with a short reflection or comment-inviting line that does not sound cheap.

CONTENT DEPTH RULES:
- Include clear context.
- Include at least 3 confirmed lore facts.
- Include cause-and-effect explanation.
- Explain why the event, champion, faction, or detail matters.
- Make the viewer understand something precise by the end.
- Use the narrative angle "${narrativeAngle}" as the main lens. Do not try to cover everything.
- If the topic is broad, focus on one precise angle instead of summarizing everything.
- If the topic is a champion, do not summarize their whole biography. Explain the core tragedy,
  conflict, transformation, belief, or consequence that defines them.
- If the topic is an event, explain what caused it, what happened, who was affected,
  and why it changed Runeterra.
- If the topic is a fun fact, make it meaningful to a champion, region, faction,
  relationship, or historical event.

SOCIAL MEDIA REQUIREMENTS:
- No boring intro such as "Today we are going to talk about".
- No "Welcome back".
- No timestamps in the narration.
- No emojis.
- No bullet points inside the narration.
- No fake cliffhangers.
- No repetitive "not this, but that" structure.
- Avoid overusing "dark secret", "hidden truth", or "what nobody knows".
- Add curiosity at least every 10-12 seconds.
- Make viewers feel they are learning something important.

VOICEOVER REQUIREMENTS:
- Write the final narration in ${language}.
- The script must be ready for ElevenLabs voice generation.
- Target ${range.min}-${range.max} words for the main "script" field.
- Use clear punctuation and pronunciation-friendly wording.
- Avoid overly long sentences and complicated nested clauses.
- Avoid excessive names in one sentence.

Output field guidance:
- title: viral but accurate title.
- hook: one short opening sentence from the script or a tighter version of it.
- script: polished narration only.
- voiceReadyScript: same content optimized for spoken delivery with clean paragraph breaks and no production labels.
- captionVersion: 4-7 short caption lines suitable for on-screen text.
- hookVariants: 3 alternate first-sentence hooks with different angles, all accurate.
- alternateTitles: 3 alternate social-native titles, all accurate and non-clickbait.
- visualBeats: 6-9 concise beat objects with non-video-generation visual direction ideas.
- retentionBreakdown: exactly 4 objects for:
  1. Opening hook - why this makes viewers stop scrolling - exact hook sentence.
  2. First lore reveal - what viewers learn - exact sentence or idea.
  3. Mid-video escalation - why the viewer keeps watching - exact sentence or idea.
  4. Final payoff - what makes the ending satisfying - exact sentence or idea.
- loreAccuracyNotes: at least 3 confirmed lore facts used in the script, with why each supports the story.
  These are creator notes, not narration disclaimers.
- tiktokDescription, instagramCaption, youtubeShortsTitle: platform-ready copy.
- hashtags: 8-14 relevant hashtags.
- pinnedComment: one question that invites lore discussion.

QUALITY CHECK BEFORE RETURNING:
- Is it within the requested word count?
- Does it have a strong first sentence?
- Does it contain at least 3 concrete lore facts?
- Does it avoid fake lore and unsupported claims?
- Does it teach something precise?
- Does it have a strong final payoff?
- Does it avoid generic filler?

${retryInstruction ?? ""}
`;
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
  const narrativeAngle = normalizeOption(payload.narrativeAngle, narrativeAngles, "Cause and consequence");
  const audienceLevel = normalizeOption(payload.audienceLevel, audienceLevels, "Casual player");
  const creatorGoal = normalizeOption(payload.creatorGoal, creatorGoals, "Teach clearly");

  if (mode === "custom" && !topic) {
    return jsonError("Enter a League of Legends lore topic before generating.");
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError("Missing OpenAI API key. Add OPENAI_API_KEY in your environment.", 500);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    let fallbackPack: (LorePack & { wordCount: number }) | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryInstruction =
        attempt === 1 && fallbackPack
          ? `Regenerate once. Fix these quality issues from the previous attempt: ${qualityIssues(fallbackPack, durationWordRanges[duration]).join(" ")}`
          : undefined;
      const prompt = buildPrompt({
        contentType,
        topic,
        tone,
        platform,
        duration,
        language,
        narrativeAngle,
        audienceLevel,
        creatorGoal,
        retryInstruction,
      });
      const rawPack = await generatePack(openai, prompt);
      const pack = validateLorePack(rawPack);

      if (!pack) {
        if (attempt === 0) {
          continue;
        }
        return jsonError("Invalid response format from the lore generator.", 502);
      }

      const wordCount = countWords(pack.script);
      const issues = qualityIssues(pack, durationWordRanges[duration]);

      if (issues.length === 0) {
        return NextResponse.json({
          ...pack,
          selectedTopic: topic,
          selectedContentType: contentType,
          selectedNarrativeAngle: narrativeAngle,
          selectedAudienceLevel: audienceLevel,
          selectedCreatorGoal: creatorGoal,
          wordCount,
          qualityReport: qualityReport(pack, durationWordRanges[duration]),
        });
      }

      fallbackPack = { ...pack, wordCount };
    }

    if (fallbackPack) {
      return NextResponse.json({
        ...fallbackPack,
        selectedTopic: topic,
        selectedContentType: contentType,
        selectedNarrativeAngle: narrativeAngle,
        selectedAudienceLevel: audienceLevel,
        selectedCreatorGoal: creatorGoal,
        qualityReport: qualityReport(fallbackPack, durationWordRanges[duration]),
        qualityNote: "Returned after one regeneration attempt. Review the retention and accuracy notes before recording.",
      });
    }

    return jsonError("Unable to generate a valid lore script.", 502);
  } catch (error) {
    console.error(error);
    return jsonError("Lore generation failed. Please try again or adjust the topic.", 500);
  }
}
