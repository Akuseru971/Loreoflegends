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
  /** Internal pre-publish checklist; must not invent verification—be honest when uncertain. */
  accuracySelfCheck: {
    quoteReal: string;
    speakerVerified: string;
    targetVerified: string;
    sourceOrigin: string;
    canonOnlyBasis: string;
    unsupportedAssumptions: string;
  };
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

  const selfCheck = pack.accuracySelfCheck;
  const validSelfCheck =
    selfCheck &&
    typeof selfCheck === "object" &&
    typeof (selfCheck as Record<string, unknown>).quoteReal === "string" &&
    typeof (selfCheck as Record<string, unknown>).speakerVerified === "string" &&
    typeof (selfCheck as Record<string, unknown>).targetVerified === "string" &&
    typeof (selfCheck as Record<string, unknown>).sourceOrigin === "string" &&
    typeof (selfCheck as Record<string, unknown>).canonOnlyBasis === "string" &&
    typeof (selfCheck as Record<string, unknown>).unsupportedAssumptions === "string";

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
    typeof pack.pinnedComment !== "string" ||
    !validSelfCheck
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
  "pinnedComment": string,
  "accuracySelfCheck": {
    "quoteReal": string,
    "speakerVerified": string,
    "targetVerified": string,
    "sourceOrigin": string,
    "canonOnlyBasis": string,
    "unsupportedAssumptions": string
  }
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

NARRATIVE ANGLE (use "${narrativeAngle}" as the main lens):
- Relationship: bonds, trust, betrayal, and what ties these champions.
- Conflict: opposing goals, violence, political or personal clash.
- Trauma: wounds, loss, guilt—only when supported by official material.
- Ideology: beliefs, orders, creeds—tied to confirmed lore.
- Family tie: lineage and kinship only when officially established.
- Rivalry: sustained opposition supported by canon.
- Hidden subtext: reading between the lines only when you clearly label speculation vs confirmation.

AUDIENCE AND CREATOR GOALS:
- New to lore: define proper nouns and stakes in simple terms.
- Casual player: anchor to recognizable champions, regions, and game moments.
- Lore fan: allow sharper detail; never smuggle fan theory as fact.
- Teach clearly: clarity first.
- Maximize retention: hooks and payoffs without fake drama.
- Prepare voiceover: short sentences, speakable names, clean rhythm.
- Spark comments: one nuanced question; no rage-bait.

CORE GOAL:
Explain champion-to-champion interactions: voice lines, who speaks, who is addressed when known, in-game vs skin vs event context, and the official lore behind the line. The viewer should think: I understand this interaction better, and I know what is confirmed vs not.

CRITICAL ATTRIBUTION RULE:
- Never attribute a quote to the wrong champion.
- Never invent a reply; never turn one line into a fake two-way dialogue.
- Never fabricate an interaction that does not exist in official sources.
- If quote, speaker, or target cannot be verified from official Riot sources, set canonStatus to "UNCONFIRMED" or "RISKY" and include verbatim: "I cannot confirm this interaction as canon without an official source." in importantCanonLimit or canonContext as appropriate.
- If the line is from a skin, alternate canon (Legends of Runeterra / Wild Rift), cinematic, narrative event, or legacy version, say so explicitly in interaction.sourceType and importantCanonLimit.

MANDATORY DISCLAIMER WHEN NOT OFFICIALLY CONFIRMED:
- Whenever you state or imply that something is not officially confirmed, you MUST also include the exact sentence (in the same language as the rest of the written fields canonContext / importantCanonLimit / whatItReveals where the caveat appears):
  - English: This is not officially confirmed in canon.
  - French: Ceci n'est pas confirmé officiellement dans le canon.
  - Spanish: Esto no está confirmado oficialmente en el canon.
- Use plain language elsewhere to separate: confirmed fact vs reasonable implication vs unknown.

SCRIPT STYLE:
- Tone: ${tone} — mysterious, cinematic, serious, TikTok-native, simple for a general audience, precise for lore fans.
- Sound like a high-retention Shorts lore creator, not Wikipedia.
- Short punchy sentences, ElevenLabs-friendly rhythm, no academic tone.
- Strong first 3 seconds; curiosity every ~10-12 seconds.
- Drama only from confirmed facts; no invented emotional reactions or conclusions.

CANON ACCURACY RULES:
- Canon only: Riot Universe bios, official short stories, official League voice lines, official narrative events, Riot cinematics, official champion pages; LoR/WR only when labeled as such.
- Never invent relationships, intentions, dialogue, emotional reactions, non-canon chronology, or conclusions.
- You may explain what a line suggests only if you clearly separate confirmed vs implicit vs not confirmed.
- Do not blend old removed lore, fan theory, and current canon—call out legacy explicitly when relevant.
- Avoid repetitive filler like "according to Riot" every sentence; stay human and cinematic.

OUTPUT FIELD REQUIREMENTS:
- title: strong viral title for the core interaction.
- hook: one short TikTok-style hook (mysterious/shocking but accurate).
- interaction.speaker: speaking champion, or honest unconfirmed wording.
- interaction.quote: EXACT in-game or official line if you are confident it is real. If not verifiable, do not invent text; use: I cannot confirm this exact quote as canon without an official source.
- interaction.target: addressee if confirmed; otherwise Unconfirmed / not target-specific or similar honest wording.
- interaction.sourceType: label precisely (base in-game interaction, skin, LoR, Wild Rift, cinematic, Riot Universe story, legacy/old VO, unknown).
- canonContext: only confirmed official lore behind the line.
- whatItReveals: relationship, conflict, trauma, ideology, rivalry, family, alliances—tie each claim to confirmed vs implicit vs not confirmed.
- importantCanonLimit: what must not be over-interpreted; any misread risk; legacy/skin caveats.
- tiktokScript: single continuous 45-60 second narration, same language as requested, 100% canon-safe, no fake facts.
- script and voiceReadyScript must match tiktokScript (voice-ready punctuation).

accuracySelfCheck (answer honestly—do not fake certainty):
- quoteReal: Is the quote real and exact, or marked unverified?
- speakerVerified: Who says it, and confidence level.
- targetVerified: Target if any, and confidence level.
- sourceOrigin: Base VO / skin / LoR / WR / cinematic / story / legacy / unknown.
- canonOnlyBasis: Which official source categories you relied on (general, no fake URLs).
- unsupportedAssumptions: List any assumptions you refused to state as fact, or "None" if truly none.

CONTENT DEPTH RULES:
- At least 3 confirmed lore facts in loreAccuracyNotes that actually appear in the script.
- Explain important phrases with confirmed backing.
- If the interaction cannot be verified, do not pretend—state the unavailability message, then only add safe, clearly labeled general canon if helpful.

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
          "You are a senior League of Legends lore writer and short-form retention editor. You never invent quotes, dialogue, or relationships. You separate confirmed canon from implication and unknowns. When something is not officially confirmed, you include the exact required disclaimer sentence for the output language in written analysis fields.",
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
  "pinnedComment": string,
  "accuracySelfCheck": {
    "quoteReal": string,
    "speakerVerified": string,
    "targetVerified": string,
    "sourceOrigin": string,
    "canonOnlyBasis": string,
    "unsupportedAssumptions": string
  }
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

- If anything is not officially confirmed, the written fields (not the narration script) must include the exact mandatory sentence for the output language:
  English: This is not officially confirmed in canon.
  French: Ceci n'est pas confirmé officiellement dans le canon.
  Spanish: Esto no está confirmado oficialmente en el canon.
- Update accuracySelfCheck to honestly reflect the corrected pack after your edits.

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
          "You are a strict League of Legends lore accuracy editor. You correct drafts to current Riot canon, never invent facts, and you refresh accuracySelfCheck to match the final pack. Mandatory disclaimer sentences for unconfirmed claims must appear in written fields when applicable.",
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
