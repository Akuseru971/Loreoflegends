import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const contentTypes = ["Voice Line", "Champion Relationship", "Dialogue Subtext", "Conflict Explanation"] as const;
const tones = ["Mysterious", "Cinematic", "Serious", "Dark", "Tragic", "Analytical"] as const;
const platforms = ["TikTok", "YouTube Shorts", "Instagram Reels", "Podcast Short"] as const;
const durations = ["45s", "60s"] as const;
const languages = ["English", "French", "Spanish"] as const;
const sourceTypes = ["Unknown / Let AI assess", "Base champion voice line", "Skin voice line", "Legends of Runeterra", "Wild Rift", "Cinematic", "Riot Universe story", "Old / legacy lore"] as const;
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

type LorePack = {
  title: string;
  hook: string;
  interaction: {
    speaker: string;
    quote: string;
    target: string;
    sourceType: string;
    canonStatus: "CONFIRMED" | "UNCONFIRMED" | "RISKY" | "LEGACY_OR_SKIN";
  };
  canonContext: string;
  whatItReveals: string;
  importantCanonLimit: string;
  tiktokScript: string;
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
  const interaction = pack.interaction;
  const visualBeats = pack.visualBeats;
  const retentionBreakdown = pack.retentionBreakdown;
  const loreAccuracyNotes = pack.loreAccuracyNotes;

  if (
    typeof pack.title !== "string" ||
    typeof pack.hook !== "string" ||
    !interaction ||
    typeof interaction !== "object" ||
    typeof (interaction as Record<string, unknown>).speaker !== "string" ||
    typeof (interaction as Record<string, unknown>).quote !== "string" ||
    typeof (interaction as Record<string, unknown>).target !== "string" ||
    typeof (interaction as Record<string, unknown>).sourceType !== "string" ||
    typeof (interaction as Record<string, unknown>).canonStatus !== "string" ||
    typeof pack.canonContext !== "string" ||
    typeof pack.whatItReveals !== "string" ||
    typeof pack.importantCanonLimit !== "string" ||
    typeof pack.tiktokScript !== "string" ||
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
  const wordCount = countWords(pack.tiktokScript || pack.script);
  const opening = firstSentence(pack.tiktokScript || pack.script);
  const lowerScript = (pack.tiktokScript || pack.script).toLowerCase();
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

  if (!pack.interaction.speaker || !pack.interaction.quote) {
    issues.push("The interaction must identify the speaker and quote.");
  }

  if (pack.interaction.canonStatus === "CONFIRMED" && pack.importantCanonLimit.toLowerCase().includes("not officially confirmed")) {
    issues.push("Canon status and canon limit conflict.");
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
  const wordCount = countWords(pack.tiktokScript || pack.script);
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
  retryInstruction,
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
  retryInstruction?: string;
}) {
  const range = durationWordRanges[duration];

  return `Generate a production-ready League of Legends interaction explainer.

Return ONLY valid JSON. No markdown. No comments.

JSON schema:
{
  "title": string,
  "hook": string,
  "interaction": {
    "speaker": string,
    "quote": string,
    "target": string,
    "sourceType": string,
    "canonStatus": "CONFIRMED" | "UNCONFIRMED" | "RISKY" | "LEGACY_OR_SKIN"
  },
  "canonContext": string,
  "whatItReveals": string,
  "importantCanonLimit": string,
  "tiktokScript": string,
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
- Interaction/topic/quote: ${topic}
- Exact quote provided by user: ${quote || "Not provided"}
- Claimed speaker: ${speaker || "Not provided"}
- Claimed target: ${target || "Not provided"}
- Claimed source type: ${sourceType}
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
Explain interactions between League of Legends champions: exact voice lines, who says them, who they target, what the line reveals, and the canon lore behind the sentence. The viewer should finish thinking: "I understand this champion interaction better now."

CRITICAL ATTRIBUTION RULE:
- Never attribute a quote to the wrong champion.
- Never invent a reply or turn a single quote into a fake dialogue.
- Never create an interaction that is not confirmed.
- If the exact quote, speaker, or target cannot be verified from official Riot material, set canonStatus to "UNCONFIRMED" or "RISKY" and clearly state: "I cannot confirm this interaction as canon without an official source."
- If the line comes from a skin, event, Legends of Runeterra, Wild Rift, or old/legacy version, state that in sourceType and importantCanonLimit.

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
- Valid source types are Riot Universe bios, official short stories, official in-game voice lines, official narrative events, Riot cinematics, official champion pages, Legends of Runeterra, or Wild Rift when clearly labeled.
- Do not invent new lore, relationships, motivations, factions, powers, locations, or timelines.
- Do not add headcanon.
- Do not exaggerate beyond what is confirmed.
- Do not create fake connections between champions.
- Do not rely on fan theories.
- Do not transform unclear lore into certainty.
- If a detail is uncertain or interpretive, phrase it carefully and naturally.
- Avoid repeated phrases like "according to official lore" or "according to Riot".
- The output must sound natural, cinematic, and human, not like a disclaimer.

OUTPUT FORMAT REQUIREMENTS:
- title: viral title explaining the core interaction.
- hook: short TikTok-style hook.
- interaction.speaker: champion who says the quote, or "Unconfirmed" if not verifiable.
- interaction.quote: exact quote if confirmed. If not confirmed, do not fabricate; write "I cannot confirm this exact quote as canon without an official source."
- interaction.target: target champion if confirmed, otherwise "Unconfirmed / not target-specific".
- interaction.sourceType: base champion voice line, skin voice line, Legends of Runeterra, Wild Rift, cinematic, Riot Universe story, old/legacy lore, or unconfirmed.
- canonContext: official lore behind the line using only confirmed canon.
- whatItReveals: what the line reveals about relationship, conflict, trauma, ideology, rivalry, family, or old alliance.
- importantCanonLimit: what is not confirmed and what should not be over-interpreted.
- tiktokScript: 45-60 second script, short and punchy, 100% canon-safe.
- script and voiceReadyScript must equal the final tiktokScript for ElevenLabs compatibility.

CONTENT DEPTH RULES:
- Include clear context.
- Include at least 3 confirmed lore facts.
- Explain the exact lore behind each important phrase.
- Distinguish confirmed, implied, and unconfirmed.
- Make the viewer understand something precise by the end.
- Use the narrative angle "${narrativeAngle}" as the main lens.
- If the interaction cannot be verified, do not pretend. Explain that it cannot be confirmed, then provide a safer canon-grounded explanation only if possible.

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
- script: same as tiktokScript.
- voiceReadyScript: same as tiktokScript, optimized for spoken delivery.
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
- Is the quote real or clearly marked unconfirmed?
- Is the speaker identified correctly?
- Is the target identified only when confirmed?
- Does it avoid fake dialogue and unsupported claims?
- Does it teach something precise?

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

function buildIntegratedAccuracyPrompt({
  pack,
  topic,
  contentType,
  language,
}: {
  pack: LorePack;
  topic: string;
  contentType: string;
  language: string;
}) {
  return `Verify and correct this generated League of Legends interaction explainer before it reaches the user.

Return ONLY valid JSON matching the same production pack schema. No markdown. No text outside JSON.

JSON schema:
{
  "title": string,
  "hook": string,
  "interaction": {
    "speaker": string,
    "quote": string,
    "target": string,
    "sourceType": string,
    "canonStatus": "CONFIRMED" | "UNCONFIRMED" | "RISKY" | "LEGACY_OR_SKIN"
  },
  "canonContext": string,
  "whatItReveals": string,
  "importantCanonLimit": string,
  "tiktokScript": string,
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

Context:
- Topic: ${topic || pack.title}
- Content type: ${contentType}
- Language: ${language}

Production pack to verify and correct:
${JSON.stringify(pack)}

Strict canon rules:
- Be conservative and current Riot / Runeterra canon focused.
- Verify exact quote, speaker, target, and source type.
- If the quote cannot be verified, the final result must not pretend it is canon. It must clearly say "I cannot confirm this interaction as canon without an official source."
- Remove invented factions, titles, relationships, causes, motives, powers, locations, or timelines.
- Remove outdated League institution framing or old removed champion backgrounds.
- Remove fan theories and unsupported emotional or political consequences presented as fact.
- If a claim is plausible but not confirmed, remove it or use safer wording.
- Do not add citations or repeated phrases like "according to Riot", "officially", or "in canon" inside the script.
- Do not rewrite everything unnecessarily. Keep accurate content and the same social-media energy.
- Preserve the same language, approximate duration, short-form structure, educational value, and voice-ready rhythm.
- The final script returned in "tiktokScript", "script", and "voiceReadyScript" must be the clean, final, lore-accurate version.
- The user should not need a separate accuracy scanner. This response is the final publish-ready pack.

Output requirements:
- Keep the production pack useful for TikTok, Shorts, Reels, and podcast shorts.
- Ensure loreAccuracyNotes contain only confirmed facts actually used in the corrected script.
- Ensure retentionBreakdown and captions match the corrected script.
- Ensure title, hook variants, alternate titles, descriptions, hashtags, and pinned comment remain accurate and non-clickbait.`;
}

async function canonCleanPack(openai: OpenAI, pack: LorePack, topic: string, contentType: string, language: string) {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict League of Legends lore accuracy editor. You correct generated content to current Riot canon and never invent facts.",
      },
      {
        role: "user",
        content: buildIntegratedAccuracyPrompt({ pack, topic, contentType, language }),
      },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("The lore accuracy pass returned an empty response.");
  }

  return JSON.parse(content) as unknown;
}

async function finalizeLorePack(openai: OpenAI, pack: LorePack, topic: string, contentType: string, language: string) {
  const rawCleanedPack = await canonCleanPack(openai, pack, topic, contentType, language);
  return validateLorePack(rawCleanedPack) ?? pack;
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

  if (mode === "custom" && !topic && !quote) {
    return jsonError("Enter an interaction, quote, or champion relationship before generating.");
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

      const cleanPack = await finalizeLorePack(openai, pack, topic || pack.title, contentType, language);
      const wordCount = countWords(cleanPack.script);
      const issues = qualityIssues(cleanPack, durationWordRanges[duration]);

      if (issues.length === 0) {
        return NextResponse.json({
          ...cleanPack,
          selectedTopic: topic,
          selectedContentType: contentType,
          selectedNarrativeAngle: narrativeAngle,
          selectedAudienceLevel: audienceLevel,
          selectedCreatorGoal: creatorGoal,
          wordCount,
          qualityReport: qualityReport(cleanPack, durationWordRanges[duration]),
          qualityNote: "Lore accuracy guardrail completed internally. Final script is the cleaned canon-safe version.",
        });
      }

      fallbackPack = { ...cleanPack, wordCount };
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
        qualityNote: "Lore accuracy guardrail completed internally. Returned the best cleaned version after one regeneration attempt.",
      });
    }

    return jsonError("Unable to generate a valid lore script.", 502);
  } catch (error) {
    console.error(error);
    return jsonError("Lore generation failed. Please try again or adjust the topic.", 500);
  }
}
