import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  NO_VERIFIED_VOICE_LINE_MESSAGE,
  OPENAI_LOL_INTERACTION_SCHEMA,
  OPENAI_VOICE_LINE_DISCOVERY_SCHEMA,
  devLoreLog,
  failureLoLInteractionResponse,
  normalizeLoLInteractionResponse,
  normalizeVoiceLineDiscoveryPack,
  parseOpenAiJsonContent,
  sourceCategoryToSourceTypeLabel,
  uiLanguageToMetadataCode,
  type VoiceLineDiscoveryCandidate,
  type VoiceLineDiscoveryPack,
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

function rankSourceCategory(cat: string): number {
  const order = ["league_base_special", "league_skin", "cinematic_or_story", "lor", "wild_rift", "old_removed", "unknown"];
  const i = order.indexOf(cat);
  return i === -1 ? 99 : i;
}

/**
 * Picks one candidate the model marked `high` only. No high-confidence rows → no script pass.
 */
function pickHighConfidenceCandidate(
  pack: VoiceLineDiscoveryPack,
  ctx: { speaker: string; target: string; quote: string },
): VoiceLineDiscoveryCandidate | null {
  const high = pack.candidates.filter((c) => c.confidence === "high" && c.quote.trim().length >= 4 && c.speaker.trim().length >= 2);
  if (high.length === 0) {
    return null;
  }

  const uq = ctx.quote.trim().toLowerCase();
  if (uq.length >= 8) {
    const byQuote = high.find(
      (c) =>
        c.quote.toLowerCase().includes(uq) ||
        uq.includes(c.quote.trim().toLowerCase().slice(0, Math.min(48, c.quote.trim().length))),
    );
    if (byQuote) {
      return byQuote;
    }
  }

  const ut = ctx.target.trim().toLowerCase();
  if (ut.length >= 2) {
    const byTarget = high.filter(
      (c) =>
        c.target.trim().length > 0 &&
        (c.target.toLowerCase().includes(ut) || ut.includes(c.target.toLowerCase())),
    );
    if (byTarget.length) {
      return [...byTarget].sort((a, b) => rankSourceCategory(a.sourceCategory) - rankSourceCategory(b.sourceCategory))[0];
    }
  }

  const us = ctx.speaker.trim().toLowerCase();
  if (us.length >= 2) {
    const bySp = high.filter((c) => c.speaker.toLowerCase().includes(us));
    if (bySp.length) {
      return [...bySp].sort((a, b) => rankSourceCategory(a.sourceCategory) - rankSourceCategory(b.sourceCategory))[0];
    }
  }

  if (pack.selectedCandidateIndex >= 0 && pack.selectedCandidateIndex < pack.candidates.length) {
    const sel = pack.candidates[pack.selectedCandidateIndex];
    if (sel.confidence === "high" && sel.quote.trim()) {
      return sel;
    }
  }

  return [...high].sort((a, b) => rankSourceCategory(a.sourceCategory) - rankSourceCategory(b.sourceCategory))[0];
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

function scriptOpensWithRequiredPattern(language: string, script: string): boolean {
  const t = script.trim();
  if (!t.length) {
    return false;
  }
  if (language === "French") {
    return /^quand\s+/i.test(t);
  }
  if (language === "Spanish") {
    return /^cuando\s+/i.test(t);
  }
  return /^when\s+/i.test(t);
}

function buildDiscoveryPrompt({
  contentType,
  topic,
  quote,
  speaker,
  target,
  sourceType,
}: {
  contentType: string;
  topic: string;
  quote: string;
  speaker: string;
  target: string;
  sourceType: string;
}) {
  return `PASS A — VOICE LINE DISCOVERY (no lore essay, no script).

You are a specialist in League of Legends champion voice lines and interactions. You do NOT browse the live internet, but you MUST only output candidate lines you are highly confident are real, verbatim (or extremely close) champion-to-champion lines from official Riot shipping content.

ABSOLUTE RULES:
- NEVER invent a quote or paraphrase it as if it were exact.
- NEVER output generic lore ("Swain is a master of secrets…") as a candidate.
- Each candidate MUST be a specific line spoken by one champion toward or about another named champion (or clearly directed special interaction).
- If you are not highly confident a line is real, put it with confidence "low" or "medium" — NOT "high".
- Only "high" confidence means: you are confident this exact interaction exists in the cited category.

SEARCH PRIORITY (try in this order when hunting lines):
1) Current League of Legends in-game base or special champion interaction / taunt toward a named champion.
2) Current League special interaction (non-skin).
3) Official Riot cinematic or Universe story dialogue (label cinematic_or_story).
4) Legends of Runeterra (lor).
5) Wild Rift (wild_rift).
6) Old / removed / legacy line (old_removed) — must be labeled as such in sourceReference.

If the user names only ONE champion (see inputs), brainstorm several REAL interactions that champion has toward others, compare them, and pick the strongest for TikTok in selectedCandidateIndex (must point to a "high" row, or -1 if none).

Inputs:
- Content type: ${contentType}
- Topic / hint: ${topic || "(none)"}
- User exact quote (if any): ${quote || "(none)"}
- User speaker hint: ${speaker || "(none)"}
- User target hint: ${target || "(none)"}
- User source hint: ${sourceType}

OUTPUT JSON (schema enforced):
- candidates: up to 8 objects with speaker, target, quote, sourceCategory (enum), sourceReference (short, human-readable; no fake URLs), confidence (high|medium|low), whyInteresting (why this line hits rivalry/trauma/secrets/etc.).
- selectedCandidateIndex: index of your best "high" pick, or -1 if there is NO high-confidence line.
- discoveryNotes: brief note on what you searched and why you picked that index (or why none).

sourceCategory enum values: league_base_special | league_skin | cinematic_or_story | lor | wild_rift | old_removed | unknown

Remember: if there is no line you trust as real, return candidates (possibly empty or all low/medium) and selectedCandidateIndex = -1.`;
}

function buildExpansionPrompt({
  candidate,
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
  candidate: VoiceLineDiscoveryCandidate;
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
  const sourceTypeLabel = sourceCategoryToSourceTypeLabel(candidate.sourceCategory);

  const openingRules =
    language === "French" ?
      `La première phrase de script.fullScript DOIT commencer par :
Quand ${candidate.speaker} dit «${candidate.quote}» à ${candidate.target || "le champion ciblé"}…
(Réplique exacte entre guillemets français.)`
    : language === "Spanish" ?
      `La primera oración de script.fullScript DEBE empezar por:
Cuando ${candidate.speaker} dice «${candidate.quote}» a ${candidate.target || "el campeón al que va dirigida la línea"}…`
    : `The first sentence of script.fullScript MUST begin with:
When ${candidate.speaker} says "${candidate.quote.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" to ${candidate.target || "the champion this line is directed at"}…`;

  return `PASS B — LORE RESEARCH + VIRAL SCRIPT (anchored to ONE real interaction only).

SELECTED VERIFIED LINE (from Pass A — treat as fixed truth for attribution; still separate canon facts from speculation in canonResearch):
- Speaker: ${candidate.speaker}
- Target / addressee: ${candidate.target}
- Quote: ${candidate.quote}
- Source category: ${candidate.sourceCategory}
- Source reference hint: ${candidate.sourceReference}
- Mapped source type label: ${sourceTypeLabel}

Original user inputs (context only): topic="${topic}", userQuote="${quote}", userSpeaker="${speaker}", userTarget="${target}", userSourceHint="${sourceType}", contentType="${contentType}"

STEP 2 — Canon research (Riot Universe, official bios, official stories, cinematics, events, official champion pages):
- canonResearch.confirmedFacts: only what official Riot sources establish.
- canonResearch.lineSuggests: what the line may imply — clearly labeled as interpretation.
- canonResearch.notConfirmed: anything uncertain, fan theory, or "not officially confirmed in canon" style caveats when needed.

STEP 3 — Script:
- interaction fields MUST match the selected line (speaker, target, quote, sourceType="${sourceTypeLabel}", sourceReference echoing Pass A, canonStatus "verified" only if you are confident; otherwise "partially_verified").
- script.title / hook: TikTok-style, non-generic, tied to THIS line.
- script.fullScript: ${language}, ${tone} tone, for ${platform}, ~${range.min}-${range.max} words, ${narrativeAngle} angle, audience ${audienceLevel}, goal ${creatorGoal}.
- NO bullet characters inside fullScript.
- Do NOT pivot to a generic champion biography. Every paragraph must orbit this exact quote.

OPENING LINE (mandatory first sentence of fullScript):
${openingRules}

metadata.language: en | fr | es matching spoken language.
metadata.durationTarget: "${durationMetadataTarget(duration)}"
metadata.formatVersion: "1.0"

Output ONE JSON object matching the final production schema (interaction, canonResearch, script, metadata).`;
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

  const discoveryUser = buildDiscoveryPrompt({
    contentType,
    topic,
    quote,
    speaker,
    target,
    sourceType,
  });

  let discoveryRaw = "";
  try {
    discoveryRaw = await callOpenAiWithSchema(openai, {
      system:
        "You find REAL League of Legends champion-to-champion voice lines from your knowledge of shipped Riot audio and scripts. You never fabricate quotes. If unsure, you mark low confidence. Output JSON only.",
      user: discoveryUser,
      schemaName: "lol_voice_line_discovery",
      schema: OPENAI_VOICE_LINE_DISCOVERY_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.25,
    });
    devLoreLog("Pass A raw", discoveryRaw || "(empty)");
  } catch (error) {
    console.error("[generate-lol-lore] discovery OpenAI failed", error);
    const body = failureLoLInteractionResponse({
      notConfirmed: ["Voice line discovery failed. Please try again."],
      language: langCode,
      durationTarget,
    });
    return NextResponse.json(body);
  }

  const discoveryParsed = parseOpenAiJsonContent(discoveryRaw);
  if (!discoveryParsed.ok) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, `Discovery JSON parse error: ${discoveryParsed.error}`],
      language: langCode,
      durationTarget,
    });
    devLoreLog("final JSON sent to client", body);
    return NextResponse.json(body);
  }

  const discoveryPack = normalizeVoiceLineDiscoveryPack(discoveryParsed.value);
  if (!discoveryPack) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE],
      language: langCode,
      durationTarget,
    });
    return NextResponse.json(body);
  }

  devLoreLog("Pass A normalized discovery", discoveryPack);

  const speakerHint = speaker.trim() || topic.trim().split(/\s+/)[0] || "";
  const chosen = pickHighConfidenceCandidate(discoveryPack, { speaker: speakerHint, target, quote });
  if (!chosen) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [
        NO_VERIFIED_VOICE_LINE_MESSAGE,
        ...(discoveryPack.discoveryNotes.trim() ? [`Discovery notes: ${discoveryPack.discoveryNotes}`] : []),
      ],
      language: langCode,
      durationTarget,
    });
    devLoreLog("final JSON sent to client (no high-confidence line)", body);
    return NextResponse.json(body);
  }

  const expansionUser = buildExpansionPrompt({
    candidate: chosen,
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

  let expansionRaw = "";
  try {
    expansionRaw = await callOpenAiWithSchema(openai, {
      system:
        "You explain ONE verified League of Legends champion interaction: exact quote first, then official canon, then TikTok script. You never invent voice lines. You separate confirmed canon from implication. Output JSON only.",
      user: expansionUser,
      schemaName: "lol_interaction_explainer",
      schema: OPENAI_LOL_INTERACTION_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.55,
    });
    devLoreLog("Pass B raw", expansionRaw || "(empty)");
  } catch (error) {
    console.error("[generate-lol-lore] expansion OpenAI failed", error);
    const body = failureLoLInteractionResponse({
      notConfirmed: [
        NO_VERIFIED_VOICE_LINE_MESSAGE,
        "A high-confidence line was selected, but the lore/script pass failed. Try again.",
      ],
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

  let normalized = normalizeLoLInteractionResponse(expansionParsed.value, normalizeOpts);
  normalized = {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      language: langCode,
      durationTarget,
      formatVersion: normalized.metadata.formatVersion || "1.0",
    },
    interaction: {
      ...normalized.interaction,
      speaker: chosen.speaker || normalized.interaction.speaker,
      target: chosen.target || normalized.interaction.target,
      quote: chosen.quote || normalized.interaction.quote,
      sourceType: sourceCategoryToSourceTypeLabel(chosen.sourceCategory),
      sourceReference: chosen.sourceReference || normalized.interaction.sourceReference,
    },
  };

  const fs = normalized.script.fullScript.trim();
  const anchored = quoteAnchorsScript(chosen.quote, fs);
  const opensOk = scriptOpensWithRequiredPattern(language, fs);

  if (!fs || !anchored || !opensOk) {
    const body = failureLoLInteractionResponse({
      notConfirmed: [
        NO_VERIFIED_VOICE_LINE_MESSAGE,
        "The script pass did not anchor the narration to the selected quote with the required opening format. Try again or narrow champions/quote.",
      ],
      language: langCode,
      durationTarget,
    });
    devLoreLog("rejected expansion (anchor/opening check)", { anchored, opensOk, snippet: fs.slice(0, 220) });
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
