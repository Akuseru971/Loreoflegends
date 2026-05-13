/**
 * Strict two-step OpenAI workflow: category page content → matched /LoL/Audio URL →
 * fetched champion page text → extracted written champion-to-champion lines (quote-validated).
 * No lore, no script, no deterministic merge at this stage.
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

const LINK_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    result: { type: "string" },
  },
  required: ["result"],
};

const EXTRACT_SCHEMA: Record<string, unknown> = {
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

const CATEGORY_TEXT_MAX = 120_000;
const PAGE_TEXT_MAX = 110_000;

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

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function quoteInText(quote: string, pageText: string): boolean {
  const p = pageText.replace(/\u00a0/g, " ");
  const q = quote.replace(/\u00a0/g, " ");
  if (p.includes(q)) {
    return true;
  }
  return p.replace(/\s+/g, " ").includes(q.replace(/\s+/g, " "));
}

function openai(): OpenAI | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k ? new OpenAI({ apiKey: k }) : null;
}

async function loadCategoryCandidates(): Promise<{
  ok: boolean;
  status: number;
  htmlLength: number;
  html: string;
  candidates: FandomChampionAudioLinkCandidate[];
}> {
  const r = await fetchFandomPage(LOL_WIKI_AUDIO_CATEGORY_URL);
  let candidates =
    r.ok && r.html.length > 500 ? extractChampionAudioLinkCandidatesFromCategoryHtml(r.html) : [];
  if (candidates.length < 8) {
    log("category_fallback_api", { priorCount: candidates.length });
    const titles = await extractChampionAudioPageLinksFromCategory();
    candidates = titles.map((t) => {
      const wikiKey = t.replace(/\/LoL\/Audio$/i, "");
      return {
        label: `${wikiKey}/LoL/Audio`,
        href: `/wiki/${wikiKey}/LoL/Audio`,
        url: wikiFandomArticleUrl(t),
      };
    });
  }
  return { ok: r.ok, status: r.status, htmlLength: r.html.length, html: r.html, candidates };
}

function normalizeResolvedUrl(result: string, allowedUrls: Set<string>): string | null {
  const t = result.trim();
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

async function openAiResolveAudioUrl(
  client: OpenAI,
  selectedChampion: string,
  candidates: FandomChampionAudioLinkCandidate[],
  categoryVisibleExcerpt: string,
): Promise<{ url: string | null; raw: string; error?: string }> {
  const urlList = candidates.map((c) => c.url).join("\n");
  const system = `You are given a selected League of Legends champion and material from this Fandom category page:

${LOL_WIKI_AUDIO_CATEGORY_URL}

Your task is to identify the exact link that leads to the selected champion's LoL audio page.

Rules:
- Find the page that corresponds to the selected champion.
- The correct link should be a Fandom page ending with /LoL/Audio.
- Do not invent a URL.
- Do not guess from memory.
- Use only the links or content provided below from the category page.
- Return JSON with a single field "result": either the full matched HTTPS URL (must be one of REAL_LINKS_FROM_PAGE exactly), or the exact string NO_MATCH_FOUND if no reliable match exists.`;

  const user = `Selected champion:
${selectedChampion}

REAL_LINKS_FROM_PAGE (authoritative — your result must be exactly one of these URLs or NO_MATCH_FOUND):
${urlList}

Visible text excerpt from the category page (may be truncated; use it only to disambiguate names):
---
${categoryVisibleExcerpt}
---

Return JSON: {"result":"<URL>"} or {"result":"NO_MATCH_FOUND"}`;

  const raw = await callOpenAiWithSchema(client, {
    system,
    user,
    schemaName: "fandom_category_link_result",
    schema: LINK_RESULT_SCHEMA,
    temperature: 0,
  });

  const parsed = parseJson(raw);
  const result = typeof parsed?.result === "string" ? parsed.result.trim() : "";
  if (!result) {
    return { url: null, raw, error: "OpenAI returned an empty link result." };
  }
  if (result.toUpperCase() === "NO_MATCH_FOUND") {
    return { url: null, raw, error: "NO_MATCH_FOUND" };
  }
  const allowed = new Set(candidates.map((c) => c.url));
  const url = normalizeResolvedUrl(result, allowed);
  if (!url) {
    return { url: null, raw, error: "OpenAI returned a URL that was not in the extracted category links." };
  }
  return { url, raw };
}

async function openAiExtractInteractions(
  client: OpenAI,
  selectedChampion: string,
  audioPageUrl: string,
  pageText: string,
): Promise<{ rows: PipelineInteractionRow[]; raw: string }> {
  const pageTitle = fandomAudioPageTitleFromWikiUrl(audioPageUrl);
  const canonicalSource = pageTitle ? wikiFandomArticleUrl(pageTitle) : audioPageUrl.trim();
  const excerpt =
    pageText.length > PAGE_TEXT_MAX ? `${pageText.slice(0, PAGE_TEXT_MAX)}\n\n[TRUNCATED]` : pageText;

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

Return JSON: {"interactions":[...]} with an empty array if none.`;

  const user = `PAGE_TEXT:\n${excerpt}`;
  const raw = await callOpenAiWithSchema(client, {
    system,
    user,
    schemaName: "fandom_champion_page_interactions",
    schema: EXTRACT_SCHEMA,
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
    if (!quoteInText(quote, pageText)) {
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

/**
 * Full pipeline: category fetch → OpenAI link match → champion page fetch → OpenAI extraction.
 */
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

  log("1_selected_champion", { championParam: decoded, selectedChampion, slug });

  const client = openai();
  if (!client) {
    return empty("OPENAI_API_KEY is required for this workflow.");
  }

  const cat = await loadCategoryCandidates();
  log("2_category_fetch", { ok: cat.ok, status: cat.status, htmlLength: cat.htmlLength });
  if (!cat.ok || !cat.html.length) {
    return empty("Failed to fetch the Fandom category page.");
  }

  const candidates = cat.candidates;
  log("4_links_extracted", { count: candidates.length });
  if (!candidates.length) {
    return empty("No /LoL/Audio links were extracted from the category page.");
  }

  const categoryVisible = extractVisibleTextFromChampionAudioPage(cat.html);
  const categoryExcerpt =
    categoryVisible.length > CATEGORY_TEXT_MAX ?
      categoryVisible.slice(0, CATEGORY_TEXT_MAX) + "\n[TRUNCATED]"
    : categoryVisible;
  log("3_category_visible_text_length", { length: categoryVisible.length });

  const linkRes = await openAiResolveAudioUrl(client, selectedChampion, candidates, categoryExcerpt);
  log("5_openai_link_raw", { rawLength: linkRes.raw.length, preview: linkRes.raw.slice(0, 2000) });

  if (!linkRes.url) {
    const msg =
      linkRes.error === "NO_MATCH_FOUND" ?
        "OpenAI could not match the selected champion to any link on the category page (NO_MATCH_FOUND)."
      : linkRes.error || "OpenAI could not resolve a champion audio page URL.";
    log("6_champion_url_failed", { error: msg });
    return empty(msg);
  }

  const audioPageUrl = linkRes.url;
  log("6_champion_url_ok", { audioPageUrl });

  const pageFetch = await fetchChampionAudioPage(audioPageUrl);
  log("7_champion_page_fetch", { ok: pageFetch.ok, status: pageFetch.status, htmlLength: pageFetch.html.length });
  if (!pageFetch.ok || !pageFetch.html.length) {
    return empty("Failed to fetch the champion audio page.", audioPageUrl);
  }

  const resolvedTitle =
    fandomAudioPageTitleFromWikiUrl(audioPageUrl) || `${wikiChampionKeyFromAudioPageUrl(audioPageUrl) ?? slug}/LoL/Audio`;

  let pageText = extractVisibleTextFromChampionAudioPage(pageFetch.html);
  if (pageText.length < 600) {
    const parseHtml = await fetchFandomParsedHtml(resolvedTitle);
    if (parseHtml) {
      const a = extractVisibleTextFromChampionAudioPage(parseHtml);
      const b = fandomHtmlToSearchPlainText(parseHtml);
      pageText = [pageText, a, b].reduce((x, y) => (y.length > x.length ? y : x), "");
    }
  }
  log("8_champion_page_text_length", { length: pageText.length });
  if (!pageText.trim()) {
    return empty("Champion page visible text is empty after extraction.", audioPageUrl);
  }

  const ex = await openAiExtractInteractions(client, selectedChampion, audioPageUrl, pageText);
  log("9_openai_extract_raw", { rawLength: ex.raw.length, preview: ex.raw.slice(0, 2500) });

  const interactions = ex.rows;
  const count = interactions.length;
  log("10_final_interaction_count", { count });

  return {
    selectedChampion,
    slug,
    audioPageUrl,
    interactions,
    count,
  };
}
