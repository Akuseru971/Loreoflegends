/**
 * POST /api/find-champion-interactions — strict workflow:
 * 1) Backend fetches Category:LoL_Champion_audio.
 * 2) OpenAI picks the champion /LoL/Audio URL using only extracted links + page text (no memory URLs).
 * 3) Backend fetches that audio page and builds visible text for the model.
 * 4) OpenAI extracts written champion-to-champion lines; server rejects quotes not present in that text.
 * No lore/script here; no deterministic HTML/wikitext merge (OpenAI-only extraction per product spec).
 */

import OpenAI from "openai";
import { fetchFandomParsedHtml, fandomHtmlToSearchPlainText } from "@/app/lib/fandom-audio-html";
import {
  extractChampionAudioLinkCandidatesFromCategoryHtml,
  extractVisibleTextFromChampionAudioPage,
  fetchChampionAudioPage,
  fetchFandomPage,
  type FandomChampionAudioLinkCandidate,
} from "@/app/lib/fandom-page-fetch";
import { fandomAudioPageTitleFromWikiUrl, wikiChampionKeyFromAudioPageUrl } from "@/app/lib/fandom-openai-agent";
import { callOpenAiWithSchema } from "@/app/lib/lol-openai-expansion";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  extractChampionAudioPageLinksFromCategory,
  toWikiChampionKey,
  wikiFandomArticleUrl,
} from "@/app/lib/lol-wiki-audio";

const LOG = "[find-champion-interactions]";

const WRITTEN_SOURCE_TYPE = "Written interaction from Fandom champion audio page" as const;

const CATEGORY_TEXT_MAX = 120_000;
const CHAMPION_PAGE_TEXT_MAX = 110_000;

const LINK_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    result: { type: "string" },
  },
  required: ["result"],
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

export type PipelineInteractionRow = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
  sourcePageTitle: string;
  sourceType: typeof WRITTEN_SOURCE_TYPE;
  isSkinContext: boolean;
};

export type FindChampionInteractionsResult = {
  selectedChampion: string;
  slug: string;
  audioPageUrl: string;
  interactions: PipelineInteractionRow[];
  count: number;
  error?: string;
};

function log(step: string, detail: Record<string, unknown>): void {
  console.info(`${LOG} ${step}`, detail);
}

function openaiClient(): OpenAI | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k ? new OpenAI({ apiKey: k }) : null;
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseJson(raw: string): Record<string, unknown> | null {
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
  return p.replace(/\s+/g, " ").includes(q.replace(/\s+/g, " "));
}

function resolveUrlAgainstAllowedSet(result: string, allowedUrls: Set<string>): string | null {
  const t = result.trim();
  if (!t || t.toUpperCase() === "NO_MATCH_FOUND") {
    return null;
  }
  if (allowedUrls.has(t)) {
    return t;
  }
  try {
    const abs = t.startsWith("http") ? new URL(t) : new URL(t, "https://leagueoflegends.fandom.com");
    const h = abs.href.replace(/\/+$/, "");
    for (const u of allowedUrls) {
      if (u.replace(/\/+$/, "") === h) {
        return u;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadCategoryBundle(): Promise<{
  htmlFetchOk: boolean;
  status: number;
  htmlLength: number;
  html: string;
  candidates: FandomChampionAudioLinkCandidate[];
  fetchError?: string;
}> {
  const r = await fetchFandomPage(LOL_WIKI_AUDIO_CATEGORY_URL);
  let candidates =
    r.ok && r.html.length > 500 ? extractChampionAudioLinkCandidatesFromCategoryHtml(r.html) : [];
  if (candidates.length < 8) {
    log("category_fallback_api", { priorCount: candidates.length, htmlOk: r.ok, htmlLen: r.html.length });
    try {
      const titles = await extractChampionAudioPageLinksFromCategory();
      if (titles.length) {
        candidates = titles.map((t) => {
          const wikiKey = t.replace(/\/LoL\/Audio$/i, "");
          return {
            label: `${wikiKey}/LoL/Audio`,
            href: `/wiki/${wikiKey}/LoL/Audio`,
            url: wikiFandomArticleUrl(t),
          };
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("category_api_fallback_error", { message: msg });
    }
  }
  return {
    htmlFetchOk: r.ok && r.html.length > 500,
    status: r.status,
    htmlLength: r.html.length,
    html: r.html,
    candidates,
    ...(r.ok ? {} : { fetchError: r.error }),
  };
}

async function openAiMatchCategoryAudioLink(
  client: OpenAI,
  selectedChampion: string,
  candidateUrls: string[],
  categoryPageText: string,
): Promise<{ url: string | null; raw: string }> {
  const allowed = new Set(candidateUrls);
  const urlBlock = candidateUrls.join("\n");

  const system = `You are given a selected League of Legends champion and the content of this Fandom category page:

https://leagueoflegends.fandom.com/wiki/Category:LoL_Champion_audio

Your task is to identify the exact link that leads to the selected champion's LoL audio page.

Rules:
- Find the page that corresponds to the selected champion.
- The correct link should be a Fandom page ending with /LoL/Audio.
- Do not invent a URL.
- Do not guess from memory.
- Use only the links or content provided from the category page.
- Output JSON with one string field "result": either the full HTTPS URL that is exactly one of ALLOWED_URLS, or exactly "NO_MATCH_FOUND".`;

  const user = `Selected champion:
${selectedChampion}

ALLOWED_URLS (the result must be exactly one of these strings or NO_MATCH_FOUND):
${urlBlock}

Category page text excerpt (same wiki category; use with ALLOWED_URLS only; never output a URL not listed above):
---
${categoryPageText}
---`;

  const raw = await callOpenAiWithSchema(client, {
    system,
    user,
    schemaName: "fandom_category_audio_link_result",
    schema: LINK_RESULT_SCHEMA,
    temperature: 0,
  });

  const parsed = parseJson(raw);
  const result = typeof parsed?.result === "string" ? parsed.result.trim() : "";
  const url = result ? resolveUrlAgainstAllowedSet(result, allowed) : null;
  return { url, raw };
}

async function openAiExtractWrittenInteractions(
  client: OpenAI,
  selectedChampion: string,
  audioPageUrl: string,
  pageText: string,
): Promise<{ rows: PipelineInteractionRow[]; raw: string }> {
  const pageTitle = fandomAudioPageTitleFromWikiUrl(audioPageUrl);
  const canonicalSource = pageTitle ? wikiFandomArticleUrl(pageTitle) : audioPageUrl.trim();
  const excerpt =
    pageText.length > CHAMPION_PAGE_TEXT_MAX ?
      `${pageText.slice(0, CHAMPION_PAGE_TEXT_MAX)}\n\n[TRUNCATED]`
    : pageText;

  const system = `You are analyzing the written content of a League of Legends champion audio page.

Selected champion:
${selectedChampion}

Source page:
${audioPageUrl}

Your task:
Extract all written quotes where the selected champion speaks to another champion.

Only extract written champion-to-champion interactions that are explicitly visible in the provided page text.

Do not use audio files.
Do not use .ogg filenames.
Do not download audio.
Do not transcribe audio.
Do not invent quotes.
Do not invent targets.
Do not summarize.
Do not generate lore.

For each quote, extract:
- speaker
- target champion
- exact quote
- interaction type
- section
- source URL (use exactly: ${canonicalSource})

Return JSON only: one object with key "interactions" whose value is an array of objects with fields speaker, target, quote, interactionType, section, sourceUrl. Use an empty array if there are none.`;

  const user = `PAGE_TEXT:\n${excerpt}`;

  const raw = await callOpenAiWithSchema(client, {
    system,
    user,
    schemaName: "fandom_champion_written_interactions",
    schema: EXTRACT_INTERACTIONS_SCHEMA,
    temperature: 0,
  });

  const parsed = parseJson(raw);
  const arr = parsed?.interactions;
  const out: PipelineInteractionRow[] = [];
  if (!Array.isArray(arr)) {
    return { rows: out, raw };
  }

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
    if (normName(speaker) !== normName(selectedChampion)) {
      continue;
    }
    if (!quoteAppearsInPageText(quote, pageText)) {
      continue;
    }
    const skin = /skin/i.test(interactionType) || /skin/i.test(section);
    out.push({
      speaker,
      target,
      quote,
      interactionType,
      section,
      sourceUrl: canonicalSource || sourceUrl,
      sourcePageTitle: pageTitle ?? "",
      sourceType: WRITTEN_SOURCE_TYPE,
      isSkinContext: skin,
    });
  }

  return { rows: out, raw };
}

export async function runFindChampionInteractionsPipeline(championParam: string): Promise<FindChampionInteractionsResult> {
  const decoded = decodeURIComponent(championParam.trim());
  const firstSeg = decoded.split("/")[0]?.replace(/_/g, " ") ?? decoded.replace(/_/g, " ");
  const slug = toWikiChampionKey(firstSeg);
  const selectedChampion = slug.replace(/_/g, " ");

  const empty = (error: string, audioPageUrl = ""): FindChampionInteractionsResult => ({
    selectedChampion,
    slug,
    audioPageUrl,
    interactions: [],
    count: 0,
    error,
  });

  log("step_1_selected_champion", { championParam: decoded, selectedChampion, slug });

  const client = openaiClient();
  if (!client) {
    return empty("Missing OPENAI_API_KEY on the server.");
  }

  const cat = await loadCategoryBundle();
  const candidateUrls = [...new Set(cat.candidates.map((c) => c.url))];
  log("step_2_category_fetch_status", {
    htmlFetchOk: cat.htmlFetchOk,
    httpStatus: cat.status,
    htmlLength: cat.htmlLength,
    candidateCount: candidateUrls.length,
    fetchError: cat.fetchError,
  });

  if (!candidateUrls.length) {
    const detail = cat.fetchError ? ` Last error: ${cat.fetchError}` : "";
    return empty(`Could not load any /LoL/Audio links from Fandom (category page and wiki API).${detail}`);
  }

  log("step_3_category_content_size", { htmlLength: cat.htmlLength });

  log("step_4_extracted_link_count", { linkCount: candidateUrls.length });

  const categoryVisible =
    cat.html.length > 500 ? extractVisibleTextFromChampionAudioPage(cat.html) : "";
  const categoryPageText =
    categoryVisible.trim().length > 0 ?
      categoryVisible.length > CATEGORY_TEXT_MAX ?
        `${categoryVisible.slice(0, CATEGORY_TEXT_MAX)}\n[TRUNCATED]`
      : categoryVisible
    : `[Category HTML unavailable or too short for visible-text extraction; last HTTP status=${cat.status}. Use ONLY ALLOWED_URLS; each URL is one champion's /LoL/Audio page on leagueoflegends.fandom.com.]`;

  const link = await openAiMatchCategoryAudioLink(client, selectedChampion, candidateUrls, categoryPageText);
  log("step_5_openai_link_raw_response", {
    rawLength: link.raw.length,
    rawPreview: link.raw.slice(0, 8000),
  });

  if (!link.url) {
    log("step_6_champion_url", { resolved: false, reason: "NO_MATCH_OR_invalid_url" });
    return empty(
      "OpenAI could not identify a matching champion audio page URL from the category page (NO_MATCH_FOUND or invalid URL).",
    );
  }

  const audioPageUrl = link.url;
  log("step_6_champion_url", { resolved: true, audioPageUrl });

  const pageFetch = await fetchChampionAudioPage(audioPageUrl);
  log("step_7_champion_page_fetch_status", {
    ok: pageFetch.ok,
    httpStatus: pageFetch.status,
    htmlLength: pageFetch.html.length,
  });

  const resolvedTitle =
    fandomAudioPageTitleFromWikiUrl(audioPageUrl) || `${wikiChampionKeyFromAudioPageUrl(audioPageUrl) ?? slug}/LoL/Audio`;

  let pageText = "";
  if (pageFetch.ok && pageFetch.html.length > 0) {
    pageText = extractVisibleTextFromChampionAudioPage(pageFetch.html);
  }
  if (pageText.length < 600) {
    const parseHtml = await fetchFandomParsedHtml(resolvedTitle);
    if (parseHtml) {
      const a = extractVisibleTextFromChampionAudioPage(parseHtml);
      const b = fandomHtmlToSearchPlainText(parseHtml);
      pageText = [pageText, a, b].reduce((x, y) => (y.length > x.length ? y : x), "");
    }
  }

  log("step_8_champion_page_text_size", { textLength: pageText.length });
  if (!pageText.trim()) {
    return empty(
      `Failed to load champion audio page content (direct HTML: HTTP ${pageFetch.status}; MediaWiki parse also failed or returned empty).`,
      audioPageUrl,
    );
  }

  const extracted = await openAiExtractWrittenInteractions(client, selectedChampion, audioPageUrl, pageText);
  log("step_9_openai_extract_raw_response", {
    rawLength: extracted.raw.length,
    rawPreview: extracted.raw.slice(0, 8000),
  });

  const interactions = extracted.rows;
  const count = interactions.length;
  log("step_10_interactions_extracted_count", { count });

  return {
    selectedChampion,
    slug,
    audioPageUrl,
    interactions,
    count,
  };
}
