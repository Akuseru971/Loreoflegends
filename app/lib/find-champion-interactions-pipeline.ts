/**
 * Champion interaction discovery: backend fetches category + audio page HTML, OpenAI matches
 * the audio URL from real candidates (legacy prompt/schema in fandom-openai-agent), OpenAI
 * extracts lines from provided page text with the same legacy extraction prompt, then results
 * are merged with deterministic HTML + wikitext parsing (parseAndCacheLoLAudioPage).
 */

import { fetchFandomParsedHtml, fandomHtmlToSearchPlainText } from "@/app/lib/fandom-audio-html";
import { parseAndCacheLoLAudioPage } from "@/app/lib/fandom-champion-interaction-service";
import {
  extractChampionAudioLinkCandidatesFromCategoryHtml,
  extractLinksFromCategoryPage,
  extractVisibleTextFromChampionAudioPage,
  fetchChampionAudioPage,
  fetchFandomPage,
  findChampionAudioUrl,
  type ChampionAudioLink,
  type FandomChampionAudioLinkCandidate,
} from "@/app/lib/fandom-page-fetch";
import {
  extractWrittenInteractionsForFindPipeline,
  fandomAudioPageTitleFromWikiUrl,
  findChampionAudioPageWithOpenAI,
  wikiChampionKeyFromAudioPageUrl,
  type RawWrittenInteractionFromPage,
} from "@/app/lib/fandom-openai-agent";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  extractChampionAudioPageLinksFromCategory,
  toWikiChampionKey,
  type WikiVoiceInteraction,
  wikiFandomArticleUrl,
} from "@/app/lib/lol-wiki-audio";

const LOG = "[find-champion-interactions]";

const WRITTEN_SOURCE_TYPE = "Written interaction from Fandom champion audio page" as const;

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

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function candidatesToChampionLinks(candidates: FandomChampionAudioLinkCandidate[]): ChampionAudioLink[] {
  const out: ChampionAudioLink[] = [];
  for (const c of candidates) {
    const key = wikiChampionKeyFromAudioPageUrl(c.url);
    if (!key) {
      continue;
    }
    out.push({
      name: key.replace(/_/g, " "),
      fullUrl: c.url,
      wikiKey: key,
    });
  }
  return out;
}

function rowDedupeKey(r: PipelineInteractionRow): string {
  return `${normName(r.speaker)}|${normName(r.target)}|${r.quote.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function mergePipelineRows(
  primary: PipelineInteractionRow[],
  secondary: PipelineInteractionRow[],
): PipelineInteractionRow[] {
  const m = new Map<string, PipelineInteractionRow>();
  for (const r of primary) {
    m.set(rowDedupeKey(r), r);
  }
  for (const r of secondary) {
    const k = rowDedupeKey(r);
    if (!m.has(k)) {
      m.set(k, r);
    }
  }
  return [...m.values()];
}

function wikiVoiceToPipelineRow(r: WikiVoiceInteraction): PipelineInteractionRow {
  const section = r.wikiSection.split("›")[0]?.trim() || r.wikiSection || "";
  return {
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: section || "Intro",
    sourceUrl: r.sourceUrl,
    sourcePageTitle: r.wikiPageTitle || "",
    sourceType: WRITTEN_SOURCE_TYPE,
    isSkinContext: r.isSkinContext,
  };
}

function rawToPipelineRow(raw: RawWrittenInteractionFromPage, pageTitle: string | null): PipelineInteractionRow {
  const skin = /skin/i.test(raw.interactionType) || /skin/i.test(raw.section);
  return {
    speaker: raw.speaker,
    target: raw.target,
    quote: raw.quote,
    interactionType: raw.interactionType,
    section: raw.section,
    sourceUrl: raw.sourceUrl,
    sourcePageTitle: pageTitle ?? "",
    sourceType: WRITTEN_SOURCE_TYPE,
    isSkinContext: skin,
  };
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

/**
 * Category fetch → OpenAI link match (legacy schema/prompt) with deterministic URL fallback →
 * champion page fetch → deterministic HTML/wikitext parse merged with legacy OpenAI extraction.
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

  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

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
  log("3_category_visible_text_length", { length: categoryVisible.length });

  let openAiLinkError = "";
  let audioPageUrl: string | null = null;
  let linkSource: "openai" | "deterministic_html" | "deterministic_candidates" | "none" = "none";

  if (hasOpenAiKey) {
    const linkMatch = await findChampionAudioPageWithOpenAI(selectedChampion, candidates);
    openAiLinkError = linkMatch.error;
    log("5_openai_link_match", {
      found: linkMatch.found,
      audioPageUrl: linkMatch.audioPageUrl,
      matchedLabel: linkMatch.matchedLabel,
      confidence: linkMatch.confidence,
      error: linkMatch.error,
      jsonPreview: JSON.stringify(linkMatch).slice(0, 2000),
    });
    if (linkMatch.found && linkMatch.audioPageUrl) {
      audioPageUrl = linkMatch.audioPageUrl;
      linkSource = "openai";
    }
  } else {
    log("5_openai_link_skipped", { reason: "no OPENAI_API_KEY" });
  }

  if (!audioPageUrl) {
    const fromHtml = findChampionAudioUrl(selectedChampion, extractLinksFromCategoryPage(cat.html));
    if (fromHtml) {
      audioPageUrl = fromHtml.fullUrl;
      linkSource = "deterministic_html";
      log("5b_url_fallback_html_links", { url: audioPageUrl });
    }
  }
  if (!audioPageUrl) {
    const fromCands = findChampionAudioUrl(selectedChampion, candidatesToChampionLinks(candidates));
    if (fromCands) {
      audioPageUrl = fromCands.fullUrl;
      linkSource = "deterministic_candidates";
      log("5b_url_fallback_candidates", { url: audioPageUrl });
    }
  }

  if (!audioPageUrl) {
    const msg =
      hasOpenAiKey ?
        openAiLinkError || "OpenAI could not match the selected champion to any link on the category page."
      : "Could not resolve champion audio page from category links (set OPENAI_API_KEY for fuzzy link matching).";
    log("6_champion_url_failed", { error: msg, linkSource });
    return empty(msg);
  }

  log("6_champion_url_ok", { audioPageUrl, linkSource });

  const pageFetch = await fetchChampionAudioPage(audioPageUrl);
  log("7_champion_page_fetch", { ok: pageFetch.ok, status: pageFetch.status, htmlLength: pageFetch.html.length });
  if (!pageFetch.ok || !pageFetch.html.length) {
    return empty("Failed to fetch the champion audio page.", audioPageUrl);
  }

  const resolvedTitle =
    fandomAudioPageTitleFromWikiUrl(audioPageUrl) || `${wikiChampionKeyFromAudioPageUrl(audioPageUrl) ?? slug}/LoL/Audio`;
  const pageTitleStr = fandomAudioPageTitleFromWikiUrl(audioPageUrl);

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

  const wikiRows = await parseAndCacheLoLAudioPage(resolvedTitle);
  const fromDeterministic = wikiRows
    .filter((r) => normName(r.speaker) === normName(selectedChampion))
    .map(wikiVoiceToPipelineRow);
  log("9_deterministic_parse", { wikiRowCount: wikiRows.length, spokenBySelected: fromDeterministic.length });

  let fromOpenAi: RawWrittenInteractionFromPage[] = [];
  if (hasOpenAiKey && pageText.trim()) {
    fromOpenAi = await extractWrittenInteractionsForFindPipeline(selectedChampion, audioPageUrl, pageText);
    log("9_openai_extract", { rowCount: fromOpenAi.length });
  } else if (hasOpenAiKey && !pageText.trim()) {
    log("9_openai_extract_skipped", { reason: "empty_page_text" });
  }

  const openAiPipeline = fromOpenAi.map((r) => rawToPipelineRow(r, pageTitleStr ?? resolvedTitle));
  const interactions = mergePipelineRows(fromDeterministic, openAiPipeline);
  const count = interactions.length;
  log("10_final_interaction_count", { count, deterministic: fromDeterministic.length, openai: openAiPipeline.length });

  return {
    selectedChampion,
    slug,
    audioPageUrl,
    interactions,
    count,
  };
}
