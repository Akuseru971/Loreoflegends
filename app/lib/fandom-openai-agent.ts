/**
 * OpenAI extracts written champion interactions only from server-provided page text.
 * Quotes must appear verbatim in that text (post-validation). No URL discovery here.
 */

import OpenAI from "openai";
import { callOpenAiWithSchema } from "@/app/lib/lol-openai-expansion";
import { wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

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

export type RawWrittenInteractionFromPage = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
};

/**
 * Extract champion-to-champion lines from pageText (already fetched by the backend).
 * Rows whose quote is not a substring of pageText are dropped.
 */
export async function extractWrittenInteractionsWithOpenAI(
  openai: OpenAI,
  championName: string,
  pageText: string,
  audioPageUrl: string,
): Promise<RawWrittenInteractionFromPage[]> {
  const pageTitle = fandomAudioPageTitleFromWikiUrl(audioPageUrl);
  const canonicalSource = pageTitle ? wikiFandomArticleUrl(pageTitle) : audioPageUrl.trim();

  const excerpt =
    pageText.length > MODEL_EXCERPT_CHARS ?
      `${pageText.slice(0, MODEL_EXCERPT_CHARS)}\n\n[PAGE_TEXT_TRUNCATED_AFTER_${MODEL_EXCERPT_CHARS}_CHARS]`
    : pageText;

  const system = `You are extracting written League of Legends champion-to-champion interactions from the provided Fandom page text.

Selected champion:
${championName}

Source URL:
${audioPageUrl}

Important:
You are NOT browsing the web.
You are NOT allowed to invent anything.
You must only extract interactions that are explicitly present in the provided page text.

Extract all written interactions where the selected champion speaks to another champion.

Ignore:
- audio files
- .ogg filenames
- file names
- buttons
- playback elements
- generic movement lines not directed at a champion

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
    championName,
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

  log("extract_raw_response", {
    rawLength: raw.length,
    ...(process.env.NODE_ENV === "development" ? { rawPreview: raw.slice(0, 2000) } : {}),
  });

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

export function openAiFandomInteractionAgentEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.LOL_FANDOM_OPENAI_AGENT !== "0";
}

export async function extractWrittenInteractionsWithOpenAiIfConfigured(
  championName: string,
  pageText: string,
  audioPageUrl: string,
): Promise<RawWrittenInteractionFromPage[]> {
  const client = openaiClient();
  if (!client || !openAiFandomInteractionAgentEnabled()) {
    return [];
  }
  return extractWrittenInteractionsWithOpenAI(client, championName, pageText, audioPageUrl);
}
