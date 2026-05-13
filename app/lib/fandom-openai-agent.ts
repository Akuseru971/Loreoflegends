/**
 * OpenAI-assisted Fandom discovery: the server fetches the real category URL list and the
 * rendered audio page HTML; the model may only return an audioPageUrl from the allow-list
 * and may only return quotes that survive substring checks against the fetched page text.
 * No audio download, playback, or transcription.
 */

import OpenAI from "openai";
import { callOpenAiWithSchema } from "@/app/lib/lol-openai-expansion";
import { LOL_WIKI_AUDIO_CATEGORY_URL, wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

const FIND_PAGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    champion: { type: "string" },
    found: { type: "boolean" },
    audioPageUrl: { type: "string" },
  },
  required: ["champion", "found", "audioPageUrl"],
};

const EXTRACT_INTERACTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    spokenByChampion: {
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
        },
        required: ["speaker", "target", "quote", "interactionType", "section"],
      },
    },
  },
  required: ["spokenByChampion"],
};

const MODEL_EXCERPT_CHARS = 110_000;

function logAgent(stage: string, detail: Record<string, unknown>): void {
  console.info(`[fandom-openai-agent] ${stage}`, detail);
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

export function canonicalFandomWikiUrl(url: string): string | null {
  const title = fandomAudioPageTitleFromWikiUrl(url);
  if (!title) {
    return null;
  }
  return wikiFandomArticleUrl(title);
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

/**
 * Pick the champion /LoL/Audio article URL using only URLs present in allowedAudioPageUrls
 * (derived from Category:LoL_Champion_audio). Output is rejected unless it matches the list
 * and the champion segment matches championWikiKey.
 */
export async function findChampionAudioPageWithOpenAI(
  openai: OpenAI,
  championDisplayName: string,
  championWikiKey: string,
  allowedAudioPageUrls: string[],
): Promise<{ champion: string; found: boolean; audioPageUrl: string }> {
  const allow = new Set<string>();
  for (const u of allowedAudioPageUrls) {
    const c = canonicalFandomWikiUrl(u);
    if (c) {
      allow.add(c);
    }
  }
  const sorted = [...allow].sort((a, b) => a.localeCompare(b));
  const system = `You are a web research agent. Your task is to start from this Fandom category page:
${LOL_WIKI_AUDIO_CATEGORY_URL}

Find the exact champion audio page for the selected League of Legends champion: ${championDisplayName}.

Rules:
- You MUST set audioPageUrl to exactly one string from the allowedUrls JSON array, or return found=false with audioPageUrl "".
- The URL must correspond to the champion "${championDisplayName}" (wiki key: ${championWikiKey}) — the first path segment after /wiki/ must match that champion.
- Do not invent links. Do not guess URLs outside allowedUrls.
- Return JSON only (handled by response_format).`;

  const user = JSON.stringify(
    {
      championDisplayName,
      championWikiKey,
      allowedUrls: sorted,
    },
    null,
    0,
  );

  logAgent("find_page_request", {
    championDisplayName,
    championWikiKey,
    allowedCount: sorted.length,
  });

  const raw = await callOpenAiWithSchema(openai, {
    system,
    user,
    schemaName: "fandom_find_champion_audio_page",
    schema: FIND_PAGE_SCHEMA,
    temperature: 0,
  });

  const parsed = parseJsonObject(raw);
  const found = parsed?.found === true;
  const audioPageUrl = typeof parsed?.audioPageUrl === "string" ? parsed.audioPageUrl.trim() : "";
  const champion = typeof parsed?.champion === "string" ? parsed.champion.trim() : championDisplayName;

  const canonical = audioPageUrl ? canonicalFandomWikiUrl(audioPageUrl) : "";
  const keyFromPick = audioPageUrl ? wikiChampionKeyFromAudioPageUrl(audioPageUrl) : null;
  const keyOk = keyFromPick != null && keyFromPick.toLowerCase() === championWikiKey.toLowerCase();
  const inAllow = Boolean(canonical && allow.has(canonical));

  const ok = found && Boolean(canonical) && inAllow && keyOk;
  logAgent("find_page_response", { ok, canonical, inAllow, keyOk, rawFound: found });

  return {
    champion,
    found: ok,
    audioPageUrl: ok && canonical ? canonical : "",
  };
}

export type RawWrittenInteractionFromPage = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
};

/**
 * Extract champion-to-champion lines from pagePlainTextFull (server-fetched visible text).
 * Rows whose quote is not a substring of pagePlainTextFull are dropped.
 */
export async function extractWrittenInteractionsWithOpenAI(
  openai: OpenAI,
  championDisplayName: string,
  audioPageUrl: string,
  pagePlainTextFull: string,
): Promise<RawWrittenInteractionFromPage[]> {
  const excerpt =
    pagePlainTextFull.length > MODEL_EXCERPT_CHARS ?
      `${pagePlainTextFull.slice(0, MODEL_EXCERPT_CHARS)}\n\n[PAGE_TEXT_TRUNCATED_AFTER_${MODEL_EXCERPT_CHARS}_CHARS]`
    : pagePlainTextFull;

  const system = `You extract written League of Legends champion-to-champion interactions from the PAGE_TEXT excerpt below.

Rules:
- The page is: ${audioPageUrl}
- Selected champion (expected speaker for these rows): ${championDisplayName}
- Extract ONLY lines that appear verbatim in PAGE_TEXT as spoken dialogue (quoted or clearly VO lines between champions).
- Do not analyze, download, or transcribe audio. Ignore .ogg filenames and file URLs.
- Do not invent quotes, targets, or sections. If unsure, omit the row.
- speaker must be ${championDisplayName} (same champion; normalize spacing only).
- Return JSON only (response_format).`;

  const user = `PAGE_TEXT:\n${excerpt}`;

  logAgent("extract_request", {
    championDisplayName,
    audioPageUrl,
    pageChars: pagePlainTextFull.length,
    excerptChars: excerpt.length,
  });

  const raw = await callOpenAiWithSchema(openai, {
    system,
    user,
    schemaName: "fandom_extract_written_interactions",
    schema: EXTRACT_INTERACTIONS_SCHEMA,
    temperature: 0,
  });

  const parsed = parseJsonObject(raw);
  const arr = parsed?.spokenByChampion;
  if (!Array.isArray(arr)) {
    logAgent("extract_parse_fail", { rawLen: raw.length });
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
    if (!speaker || !target || quote.length < 4 || !interactionType || !section) {
      continue;
    }
    if (normName(speaker) !== normName(championDisplayName)) {
      continue;
    }
    if (!quoteAppearsInPageText(quote, pagePlainTextFull)) {
      logAgent("extract_quote_rejected", { quotePreview: quote.slice(0, 80) });
      continue;
    }
    out.push({ speaker, target, quote, interactionType, section });
  }

  logAgent("extract_validated", { rowCount: out.length });
  return out;
}

export function openAiFandomInteractionAgentEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.LOL_FANDOM_OPENAI_AGENT !== "0";
}
