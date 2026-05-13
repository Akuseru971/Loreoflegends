/**
 * OpenAI: (1) pick champion /LoL/Audio URL from real category link candidates only.
 * (2) extract written interactions only from server-provided page text (quotes validated).
 * No blind browsing.
 */

import OpenAI from "openai";
import { callOpenAiWithSchema } from "@/app/lib/lol-openai-expansion";
import type { FandomChampionAudioLinkCandidate } from "@/app/lib/fandom-page-fetch";
import { LOL_WIKI_AUDIO_CATEGORY_URL, wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

const LINK_MATCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    championName: { type: "string" },
    found: { type: "boolean" },
    matchedLabel: { type: "string" },
    audioPageUrl: { type: "string" },
    confidence: { type: "number" },
    error: { type: "string" },
  },
  required: ["championName", "found", "matchedLabel", "audioPageUrl", "confidence", "error"],
};

const EXTRACT_INTERACTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    interactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          target: { type: "string" },
          quote: { type: "string" },
          interactionType: { type: "string" },
          section: { type: "string" },
          sourceUrl: { type: "string" },
        },
        required: ["speaker", "target", "quote", "interactionType", "section", "sourceUrl"],
      },
    },
  },
  required: ["interactions"],
};

const MODEL_EXCERPT_CHARS = 110_000;

const LOG_PREFIX = "[fandom-openai-agent]";

function log(stage: string, detail: Record<string, unknown>): void {
  console.info(`${LOG_PREFIX} ${stage}`, detail);
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function wikiChampionKeyFromAudioPageUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.toLowerCase().endsWith("leagueoflegends.fandom.com")) {
      return null;
    }
    const raw = u.pathname.replace(/^\/wiki\//i, "").replace(/\/+$/, "");
    if (!raw) {
      return null;
    }
    const decoded = decodeURIComponent(raw);
    const first = decoded.split("/")[0]?.trim();
    if (!first) {
      return null;
    }
    return first.replace(/ /g, "_");
  } catch {
    return null;
  }
}

export function fandomAudioPageTitleFromWikiUrl(url: string): string | null {
  const key = wikiChampionKeyFromAudioPageUrl(url);
  if (!key) {
    return null;
  }
  return `${key}/LoL/Audio`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function quoteAppearsInPageText(quote: string, pageText: string): boolean {
  const p = pageText.replace(/\u00a0/g, " ");
  const q = quote.replace(/\u00a0/g, " ");
  if (p.includes(q)) {
    return true;
  }
  const pc = p.replace(/\s+/g, " ");
  const qc = q.replace(/\s+/g, " ");
  return pc.includes(qc);
}

function openaiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return null;
  }
  return new OpenAI({ apiKey: key });
}

function canonicalizeCandidateUrl(url: string, candidates: FandomChampionAudioLinkCandidate[]): string | null {
  const t = url.trim();
  for (const c of candidates) {
    if (c.url === t) {
      return c.url;
    }
  }
  try {
    const abs = t.startsWith("http") ? new URL(t) : new URL(t, "https://leagueoflegends.fandom.com");
    const a = abs.href.replace(/\/+$/, "");
    for (const c of candidates) {
      if (c.url.replace(/\/+$/, "") === a) {
        return c.url;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type ChampionAudioLinkMatchResult = {
  championName: string;
  found: boolean;
  matchedLabel: string;
  audioPageUrl: string;
  confidence: number;
  error: string;
};

/**
 * Pick the champion LoL audio page URL using only candidate links extracted from the category HTML.
 */
export async function findChampionAudioPageWithOpenAI(
  championName: string,
  candidateLinks: FandomChampionAudioLinkCandidate[],
): Promise<ChampionAudioLinkMatchResult> {
  const empty: ChampionAudioLinkMatchResult = {
    championName: championName.trim(),
    found: false,
    matchedLabel: "",
    audioPageUrl: "",
    confidence: 0,
    error: "No matching champion audio page found in provided candidate links.",
  };

  if (!candidateLinks.length) {
    return { ...empty, error: "No candidate links were provided." };
  }

  const client = openaiClient();
  if (!client) {
    return { ...empty, error: "OPENAI_API_KEY is not configured." };
  }

  const system = `You are matching a League of Legends champion name to the correct Fandom champion audio page.

Selected champion:
${championName.trim()}

You are given a list of real links extracted from this Fandom category page:
${LOL_WIKI_AUDIO_CATEGORY_URL}

Your task:
Find the exact link corresponding to the selected champion's LoL audio page.

Rules:
- Choose only from the provided candidateLinks.
- Do not invent a URL.
- Do not guess a link that is not in the list.
- The correct link usually matches this pattern:
  /wiki/[Champion]/LoL/Audio
- Handle apostrophes, spaces, special characters, and alternate formatting.
- If no reliable match exists, return found=false.

Return JSON only.`;

  const user = JSON.stringify({ championName: championName.trim(), candidateLinks }, null, 0);

  log("link_match_request", { championName: championName.trim(), candidateCount: candidateLinks.length });

  const raw = await callOpenAiWithSchema(client, {
    system,
    user,
    schemaName: "fandom_match_champion_audio_link",
    schema: LINK_MATCH_SCHEMA,
    temperature: 0,
  });

  if (process.env.NODE_ENV === "development") {
    console.info(`${LOG_PREFIX} link_match_raw_response`, { rawLength: raw.length, rawPreview: raw.slice(0, 2500) });
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    log("link_match_parse_fail", { rawLen: raw.length });
    return { ...empty, error: "OpenAI returned invalid JSON for link matching." };
  }

  const found = parsed.found === true;
  const audioPageUrlRaw = typeof parsed.audioPageUrl === "string" ? parsed.audioPageUrl.trim() : "";
  const matchedLabel = typeof parsed.matchedLabel === "string" ? parsed.matchedLabel.trim() : "";
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
  const err = typeof parsed.error === "string" ? parsed.error.trim() : "";

  if (!found) {
    log("link_match_not_found", { matchedLabel, err });
    return {
      championName: championName.trim(),
      found: false,
      matchedLabel: "",
      audioPageUrl: "",
      confidence: 0,
      error: err || "No matching champion audio page found in provided candidate links.",
    };
  }

  const canonical = canonicalizeCandidateUrl(audioPageUrlRaw, candidateLinks);
  if (!canonical) {
    log("link_match_url_rejected", { audioPageUrlRaw });
    return {
      championName: championName.trim(),
      found: false,
      matchedLabel: "",
      audioPageUrl: "",
      confidence: 0,
      error: "OpenAI returned a URL that was not in the candidate list.",
    };
  }

  log("link_match_ok", { audioPageUrl: canonical, matchedLabel, confidence });
  return {
    championName: championName.trim(),
    found: true,
    matchedLabel: matchedLabel || candidateLinks.find((c) => c.url === canonical)?.label || "",
    audioPageUrl: canonical,
    confidence: Math.min(1, Math.max(0, confidence)),
    error: "",
  };
}

export type RawWrittenInteractionFromPage = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
};

async function extractWrittenInteractionsWithOpenAiClient(
  openai: OpenAI,
  championName: string,
  audioPageUrl: string,
  pageText: string,
): Promise<RawWrittenInteractionFromPage[]> {
  const pageTitle = fandomAudioPageTitleFromWikiUrl(audioPageUrl);
  const canonicalSource = pageTitle ? wikiFandomArticleUrl(pageTitle) : audioPageUrl.trim();

  const excerpt =
    pageText.length > MODEL_EXCERPT_CHARS ?
      `${pageText.slice(0, MODEL_EXCERPT_CHARS)}\n\n[PAGE_TEXT_TRUNCATED_AFTER_${MODEL_EXCERPT_CHARS}_CHARS]`
    : pageText;

  const system = `You are extracting written League of Legends champion-to-champion interactions from provided Fandom page text.

Selected champion:
${championName.trim()}

Source URL:
${audioPageUrl}

Important:
You are NOT browsing the web.
You are NOT allowed to invent anything.
You must only extract interactions explicitly present in the provided page text.

Extract all written interactions where the selected champion speaks to another champion.

Ignore:
- audio files
- .ogg filenames
- file names
- playback buttons
- generic movement lines not directed at a champion
- non champion-specific lines

For each interaction, return:
- speaker
- target
- quote
- interactionType
- section
- sourceUrl (use exactly: ${canonicalSource || audioPageUrl})

Return JSON only.`;

  const user = `PAGE_TEXT:\n${excerpt}`;

  log("extract_request", {
    championName: championName.trim(),
    audioPageUrl,
    pageChars: pageText.length,
    excerptChars: excerpt.length,
  });

  const raw = await callOpenAiWithSchema(openai, {
    system,
    user,
    schemaName: "fandom_extract_written_interactions",
    schema: EXTRACT_INTERACTIONS_SCHEMA,
    temperature: 0,
  });

  if (process.env.NODE_ENV === "development") {
    console.info(`${LOG_PREFIX} interaction_extract_raw_response`, {
      rawLength: raw.length,
      rawPreview: raw.slice(0, 2500),
    });
  }

  if (!raw.trim()) {
    log("extract_empty_raw", {});
    return [];
  }

  const parsed = parseJsonObject(raw);
  const arr = parsed?.interactions;
  if (!Array.isArray(arr)) {
    log("extract_parse_fail", { rawLen: raw.length });
    return [];
  }

  const out: RawWrittenInteractionFromPage[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const speaker = typeof o.speaker === "string" ? o.speaker.trim() : "";
    const target = typeof o.target === "string" ? o.target.trim() : "";
    const quote = typeof o.quote === "string" ? o.quote.trim() : "";
    const interactionType = typeof o.interactionType === "string" ? o.interactionType.trim() : "";
    const section = typeof o.section === "string" ? o.section.trim() : "";
    const sourceUrl = typeof o.sourceUrl === "string" ? o.sourceUrl.trim() : audioPageUrl;
    if (!speaker || !target || quote.length < 4 || !interactionType || !section) {
      continue;
    }
    if (normName(speaker) !== normName(championName)) {
      continue;
    }
    if (!quoteAppearsInPageText(quote, pageText)) {
      log("extract_quote_rejected", { quotePreview: quote.slice(0, 80) });
      continue;
    }
    out.push({
      speaker,
      target,
      quote,
      interactionType,
      section,
      sourceUrl: canonicalSource || sourceUrl,
    });
  }

  log("extract_validated", { rowCount: out.length });
  return out;
}

/**
 * Extract champion-to-champion lines from page text (server-fetched). Returns [] if OpenAI is disabled or unavailable.
 */
export async function extractWrittenInteractionsWithOpenAI(
  championName: string,
  audioPageUrl: string,
  pageText: string,
): Promise<RawWrittenInteractionFromPage[]> {
  if (!openAiFandomInteractionAgentEnabled()) {
    return [];
  }
  const client = openaiClient();
  if (!client) {
    return [];
  }
  return extractWrittenInteractionsWithOpenAiClient(client, championName, audioPageUrl, pageText);
}

export function openAiFandomInteractionAgentEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.LOL_FANDOM_OPENAI_AGENT !== "0";
}
