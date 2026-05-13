import OpenAI from "openai";
import {
  LOL_INTERACTION_FORMAT_VERSION,
  NO_VERIFIED_VOICE_LINE_MESSAGE,
  OPENAI_LOL_INTERACTION_SCHEMA,
  devLoreLog,
  failureLoLInteractionResponse,
  normalizeLoLInteractionResponse,
  parseOpenAiJsonContent,
  type LoLInteractionExplainerResponse,
} from "@/app/lib/lol-interaction-explainer";
import { LOL_WIKI_AUDIO_CATEGORY_URL, type WikiVoiceInteraction } from "@/app/lib/lol-wiki-audio";
import { WRITTEN_INTERACTION_SOURCE_TYPE } from "@/app/lib/fandom-champion-interaction-service";

export const durationWordRanges = {
  "45s": { min: 115, max: 145, label: "45 seconds" },
  "60s": { min: 145, max: 175, label: "60 seconds" },
} as const;

export function durationMetadataTarget(duration: keyof typeof durationWordRanges): string {
  return duration === "45s" ? "45s" : "45-60s";
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function quoteAnchorsScript(quote: string, script: string): boolean {
  const q = quote.replace(/\s+/g, " ").trim();
  if (q.length < 4) {
    return false;
  }
  const s = script.toLowerCase();
  const needle = q.length > 48 ? q.slice(0, 48).toLowerCase() : q.toLowerCase();
  return s.includes(needle);
}

export function scriptOpensWithWhenPattern(script: string, speaker: string, quote: string, target: string): boolean {
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

export function buildExpansionPrompt(opts: {
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
}): string {
  const v = opts.verified;
  const range = durationWordRanges[opts.duration];
  const qJson = JSON.stringify(v.quote);
  const skinNote = v.isSkinContext ?
    "This line is under a skin-specific wiki block (e.g. {{csl|…}} or skin tab). You MUST label it clearly as alternate skin voice-over in notConfirmed and/or lineSuggests, and use canonStatus partially_verified unless the line is identical on base."
  : "Parsed from written Fandom Champion/LoL/Audio HTML or wikitext (community transcription). Never infer dialogue from .ogg filenames or audio binaries.";

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
- sourceType: "${WRITTEN_INTERACTION_SOURCE_TYPE}"
- sourceReference: EXACT URL above.
- canonStatus: ${v.isSkinContext ? '"partially_verified" (skin-specific written VO block on Fandom)' : '"verified_written_voice_line"'}

STEP 4 — hashtags: 4–8 strings, include #LeagueOfLegends or #LoL plus champion tags.

metadata.durationTarget: "${durationMetadataTarget(opts.duration)}"
metadata.formatVersion: "${LOL_INTERACTION_FORMAT_VERSION}"
metadata.sourceCategory: "${LOL_WIKI_AUDIO_CATEGORY_URL}"

Output ONE JSON object matching the production schema (interaction, canonResearch, script, metadata).`;
}

export async function callOpenAiWithSchema(
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

export type LoreExpansionOptions = {
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
  langCode: string;
  durationTarget: string;
};

/**
 * Single OpenAI pass: canon research + English TikTok script for a verified written interaction.
 */
export async function expandLoreForVerifiedInteraction(
  openai: OpenAI,
  opts: LoreExpansionOptions,
): Promise<LoLInteractionExplainerResponse> {
  const normalizeOpts = { language: opts.langCode, durationTarget: opts.durationTarget };

  const expansionUser = buildExpansionPrompt({
    verified: opts.verified,
    contentType: opts.contentType,
    topic: opts.topic,
    userQuote: opts.userQuote,
    sourceType: opts.sourceType,
    tone: opts.tone,
    platform: opts.platform,
    duration: opts.duration,
    narrativeAngle: opts.narrativeAngle,
    audienceLevel: opts.audienceLevel,
    creatorGoal: opts.creatorGoal,
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
    console.error("[expandLoreForVerifiedInteraction] OpenAI failed", error);
    return failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, "The lore and script generation step failed. Please try again."],
      language: opts.langCode,
      durationTarget: opts.durationTarget,
    });
  }

  const expansionParsed = parseOpenAiJsonContent(expansionRaw);
  if (!expansionParsed.ok) {
    return failureLoLInteractionResponse({
      notConfirmed: [NO_VERIFIED_VOICE_LINE_MESSAGE, `Script pass parse error: ${expansionParsed.error}`],
      language: opts.langCode,
      durationTarget: opts.durationTarget,
    });
  }

  const forcedCanon = opts.verified.isSkinContext ? ("partially_verified" as const) : ("verified_written_voice_line" as const);

  let normalized = normalizeLoLInteractionResponse(expansionParsed.value, normalizeOpts);
  normalized = {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      language: "en",
      durationTarget: opts.durationTarget,
      formatVersion: normalized.metadata.formatVersion || LOL_INTERACTION_FORMAT_VERSION,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
    },
    interaction: {
      ...normalized.interaction,
      speaker: opts.verified.speaker,
      target: opts.verified.target,
      quote: opts.verified.quote,
      interactionType: opts.verified.interactionType,
      sourceType: WRITTEN_INTERACTION_SOURCE_TYPE,
      sourceReference: opts.verified.sourceUrl,
      canonStatus: forcedCanon,
    },
  };

  const fs = normalized.script.fullScript.trim();
  const anchored = quoteAnchorsScript(opts.verified.quote, fs);
  const opensOk = scriptOpensWithWhenPattern(fs, opts.verified.speaker, opts.verified.quote, opts.verified.target);

  if (!fs || !anchored || !opensOk) {
    devLoreLog("rejected expansion (anchor/opening check)", { anchored, opensOk, snippet: fs.slice(0, 240) });
    return failureLoLInteractionResponse({
      notConfirmed: [
        NO_VERIFIED_VOICE_LINE_MESSAGE,
        "The generated script did not stay anchored to the wiki quote with the required English opening. Try again.",
      ],
      language: opts.langCode,
      durationTarget: opts.durationTarget,
    });
  }

  const wordCount = countWords(fs);
  const range = durationWordRanges[opts.duration];
  if (wordCount < range.min || wordCount > range.max) {
    devLoreLog("validation notes", [`Script word count ${wordCount} outside target ${range.min}-${range.max}.`]);
  }

  return normalized;
}
