/**
 * Fandom explorer: fetch category → extract real /LoL/Audio link candidates → OpenAI picks the champion URL
 * (validated against candidates) with deterministic fallback → fetch audio page → visible text → OpenAI extracts
 * interactions from that text (quote-validated) merged with HTML/wikitext parsing. No audio download.
 */

import { extractWrittenInteractionsFromParsedHtml, fetchFandomParsedHtml, fandomHtmlToSearchPlainText } from "@/app/lib/fandom-audio-html";
import {
  extractWrittenInteractionsWithOpenAI,
  findChampionAudioPageWithOpenAI,
  openAiFandomInteractionAgentEnabled,
  wikiChampionKeyFromAudioPageUrl,
  type RawWrittenInteractionFromPage,
} from "@/app/lib/fandom-openai-agent";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  championKeyToLoLAudioPageTitle,
  getChampionLoLAudioWikitext,
  parseWikiVoiceInteractions,
  toWikiChampionKey,
  type WikiVoiceInteraction,
} from "@/app/lib/lol-wiki-audio";
import {
  extractVisibleTextFromChampionAudioPage,
  fetchAndExtractChampionAudioLinks,
  fetchChampionAudioPage,
  findChampionAudioUrl,
  logExtractedTextDebug,
  type ChampionAudioLink,
  type FandomChampionAudioLinkCandidate,
} from "@/app/lib/fandom-page-fetch";

export const WRITTEN_INTERACTION_SOURCE_TYPE = "Written interaction from Fandom champion audio page" as const;

export type FandomInteractionMinimal = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
  sourcePageTitle: string;
  sourceType: typeof WRITTEN_INTERACTION_SOURCE_TYPE;
  isSkinContext: boolean;
};

export type ChampionListEntry = {
  name: string;
  audioPageUrl: string;
};

export type WrittenInteractionPayload = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
  /** MediaWiki page title, e.g. Viego/LoL/Audio */
  sourcePageTitle: string;
  sourceType: typeof WRITTEN_INTERACTION_SOURCE_TYPE;
  isSkinContext: boolean;
};

function normk(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function rowKey(r: WikiVoiceInteraction): string {
  return `${normk(r.speaker)}|${normk(r.target)}|${r.quote.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function mergeVoiceRows(primary: WikiVoiceInteraction[], secondary: WikiVoiceInteraction[]): WikiVoiceInteraction[] {
  const m = new Map<string, WikiVoiceInteraction>();
  for (const r of primary) {
    m.set(rowKey(r), r);
  }
  for (const r of secondary) {
    const k = rowKey(r);
    if (!m.has(k)) {
      m.set(k, r);
    }
  }
  return [...m.values()];
}

const pageCache = new Map<string, { rows: WikiVoiceInteraction[]; exp: number }>();
const PAGE_TTL_MS = 1000 * 60 * 30;

const globalSeen = new Set<string>();
const globalByTarget = new Map<string, WikiVoiceInteraction[]>();
const globalList: WikiVoiceInteraction[] = [];

function registerRows(rows: WikiVoiceInteraction[]) {
  for (const r of rows) {
    const k = rowKey(r);
    if (globalSeen.has(k)) {
      continue;
    }
    globalSeen.add(k);
    globalList.push(r);
    const tk = normk(r.target);
    if (!globalByTarget.has(tk)) {
      globalByTarget.set(tk, []);
    }
    globalByTarget.get(tk)!.push(r);
  }
}

export function invalidateFandomInteractionCaches(): void {
  pageCache.clear();
  globalSeen.clear();
  globalByTarget.clear();
  globalList.length = 0;
}

export async function parseAndCacheLoLAudioPage(pageTitle: string, force = false): Promise<WikiVoiceInteraction[]> {
  if (!force) {
    const c = pageCache.get(pageTitle);
    if (c && c.exp > Date.now()) {
      return c.rows;
    }
  }
  const [html, wt] = await Promise.all([fetchFandomParsedHtml(pageTitle), getChampionLoLAudioWikitext(pageTitle)]);
  const fromHtml = html ? extractWrittenInteractionsFromParsedHtml(html, pageTitle) : [];
  const fromWt = wt ? parseWikiVoiceInteractions(wt, pageTitle) : [];
  const rows = mergeVoiceRows(fromHtml, fromWt);
  if (!html && !wt) {
    pageCache.set(pageTitle, { rows: [], exp: Date.now() + PAGE_TTL_MS });
    return [];
  }
  registerRows(rows);
  pageCache.set(pageTitle, { rows, exp: Date.now() + PAGE_TTL_MS });
  return rows;
}

function topSectionLabel(wikiSection: string): string {
  const s = wikiSection.split("›")[0]?.trim() || wikiSection;
  return s || "Intro";
}

function rawOpenAiToPayload(
  r: RawWrittenInteractionFromPage,
  sourceUrl: string,
  sourcePageTitle: string,
): WrittenInteractionPayload {
  const skin = /skin/i.test(r.interactionType) || /skin/i.test(r.section);
  return {
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: topSectionLabel(r.section),
    sourceUrl,
    sourcePageTitle,
    sourceType: WRITTEN_INTERACTION_SOURCE_TYPE,
    isSkinContext: skin,
  };
}

function mergeWrittenPayloadRows(
  primary: WrittenInteractionPayload[],
  secondary: WrittenInteractionPayload[],
): WrittenInteractionPayload[] {
  const m = new Map<string, WrittenInteractionPayload>();
  for (const r of primary) {
    m.set(`${normk(r.speaker)}|${normk(r.target)}|${r.quote}`, r);
  }
  for (const r of secondary) {
    const k = `${normk(r.speaker)}|${normk(r.target)}|${r.quote}`;
    if (!m.has(k)) {
      m.set(k, r);
    }
  }
  return [...m.values()];
}

function toApiRow(r: WikiVoiceInteraction): WrittenInteractionPayload {
  return {
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: topSectionLabel(r.wikiSection),
    sourceUrl: r.sourceUrl,
    sourcePageTitle: r.wikiPageTitle || r.sourceUrl.split("/wiki/").pop()?.split("#")[0]?.replace(/_/g, " ") || "",
    sourceType: WRITTEN_INTERACTION_SOURCE_TYPE,
    isSkinContext: r.isSkinContext,
  };
}

const BUNDLE_LOG = "[fandom-interactions-bundle]";

function logBundle(stage: string, detail: Record<string, unknown>): void {
  console.info(`${BUNDLE_LOG} ${stage}`, detail);
}

function candidatesToChampionLinks(candidates: FandomChampionAudioLinkCandidate[]): ChampionAudioLink[] {
  const out: ChampionAudioLink[] = [];
  for (const c of candidates) {
    const key = wikiChampionKeyFromAudioPageUrl(c.url);
    if (!key) {
      continue;
    }
    out.push({ name: key.replace(/_/g, " "), fullUrl: c.url, wikiKey: key });
  }
  return out;
}

function toMinimalFromPayload(rows: WrittenInteractionPayload[]): FandomInteractionMinimal[] {
  return rows.map((r) => ({
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: r.section,
    sourceUrl: r.sourceUrl,
    sourcePageTitle: r.sourcePageTitle,
    sourceType: r.sourceType,
    isSkinContext: r.isSkinContext,
  }));
}

export async function getChampionListForApi(): Promise<{
  champions: ChampionListEntry[];
  sourceCategory: string;
  count: number;
}> {
  const cat = await fetchAndExtractChampionAudioLinks();
  logBundle("champion_list_category", {
    ok: cat.ok,
    status: cat.status,
    htmlLen: cat.htmlLength,
    linkCount: cat.candidates.length,
  });
  if (process.env.NODE_ENV === "development") {
    console.info(`${BUNDLE_LOG} champion_list_first_candidates`, cat.candidates.slice(0, 10));
  }

  const champions = cat.candidates
    .map((c) => {
      const key = wikiChampionKeyFromAudioPageUrl(c.url);
      const name = key ? key.replace(/_/g, " ") : c.label.replace(/\/LoL\/Audio$/i, "").replace(/_/g, " ");
      return { name, audioPageUrl: c.url };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  logBundle("champion_list_ready", { count: champions.length });
  return { champions, sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL, count: champions.length };
}

export async function getChampionInteractionsBundle(
  championParam: string,
  options: { refresh?: boolean } = {},
): Promise<{
  selectedChampion: string;
  slug: string;
  championAudioPageFound: boolean;
  sourceCategory: string;
  audioPageUrl: string;
  interactions: FandomInteractionMinimal[];
  count: number;
  error?: string;
}> {
  const isDev = process.env.NODE_ENV === "development";
  const raw = decodeURIComponent(championParam.trim());
  const championKey = toWikiChampionKey(raw.replace(/_/g, " "));
  const display = championKey.replace(/_/g, " ");

  if (options.refresh) {
    invalidateFandomInteractionCaches();
  }

  logBundle("selected_champion", { raw, display, slug: championKey });

  const cat = await fetchAndExtractChampionAudioLinks();
  logBundle("category_fetch", {
    ok: cat.ok,
    status: cat.status,
    htmlLen: cat.htmlLength,
    candidateCount: cat.candidates.length,
  });
  if (isDev) {
    console.info(`${BUNDLE_LOG} first_10_candidate_links`, cat.candidates.slice(0, 10));
  }

  const candidates = cat.candidates;
  if (!candidates.length) {
    return {
      selectedChampion: display,
      slug: championKey,
      championAudioPageFound: false,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
      audioPageUrl: "",
      interactions: [],
      count: 0,
      error: "No champion audio links could be extracted from the Fandom category page.",
    };
  }

  const useOpenAi = openAiFandomInteractionAgentEnabled();
  let resolvedUrl = "";
  let linkMatchError = "";

  if (useOpenAi) {
    const aiLink = await findChampionAudioPageWithOpenAI(display, candidates);
    if (isDev) {
      console.info(`${BUNDLE_LOG} openai_link_match_result`, aiLink);
    }
    if (aiLink.found && aiLink.audioPageUrl) {
      resolvedUrl = aiLink.audioPageUrl;
      logBundle("openai_matched_audio_url", { audioPageUrl: resolvedUrl, confidence: aiLink.confidence });
    } else {
      linkMatchError = aiLink.error || "OpenAI could not match the selected champion to any extracted Fandom audio page link.";
      logBundle("openai_link_match_failed", { error: linkMatchError });
    }
  }

  if (!resolvedUrl) {
    const det = findChampionAudioUrl(raw, candidatesToChampionLinks(candidates));
    if (det) {
      resolvedUrl = det.fullUrl;
      logBundle("deterministic_fallback_match", { audioPageUrl: resolvedUrl });
    }
  }

  if (!resolvedUrl) {
    return {
      selectedChampion: display,
      slug: championKey,
      championAudioPageFound: false,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
      audioPageUrl: "",
      interactions: [],
      count: 0,
      error:
        useOpenAi ?
          "OpenAI could not match the selected champion to any extracted Fandom audio page link."
        : linkMatchError ||
          "No champion audio page link matched this champion on the Fandom category page.",
    };
  }

  const keyFromUrl = wikiChampionKeyFromAudioPageUrl(resolvedUrl);
  const resolvedTitle = keyFromUrl ? `${keyFromUrl}/LoL/Audio` : championKeyToLoLAudioPageTitle(championKey);

  const pageRes = await fetchChampionAudioPage(resolvedUrl);
  if (isDev) {
    console.info(`${BUNDLE_LOG} champion_page_fetch_status`, {
      ok: pageRes.ok,
      status: pageRes.status,
      htmlLength: pageRes.html.length,
    });
  }

  let pageText = "";
  if (pageRes.ok && pageRes.html.length > 0) {
    pageText = extractVisibleTextFromChampionAudioPage(pageRes.html);
    logExtractedTextDebug(pageText, "browser_html");
  }

  if (pageText.length < 600) {
    logBundle("visible_text_fallback_parse_api", { priorLen: pageText.length });
    const parseHtml = await fetchFandomParsedHtml(resolvedTitle);
    if (parseHtml) {
      const fromParse = extractVisibleTextFromChampionAudioPage(parseHtml);
      const fromPlain = fandomHtmlToSearchPlainText(parseHtml);
      const best = [pageText, fromParse, fromPlain].reduce((a, b) => (b.length > a.length ? b : a), "");
      if (best.length > pageText.length) {
        pageText = best;
      }
      logExtractedTextDebug(pageText, "parse_api_html");
    }
  }

  logBundle("page_text_ready", { length: pageText.length });
  if (isDev && pageText.length > 0) {
    console.info(`${BUNDLE_LOG} visible_text_preview_1000`, pageText.slice(0, 1000));
  }

  let openAiRows: RawWrittenInteractionFromPage[] = [];
  if (useOpenAi && pageText.length > 200) {
    openAiRows = await extractWrittenInteractionsWithOpenAI(display, resolvedUrl, pageText);
    logBundle("openai_interaction_extract_count", { count: openAiRows.length });
  } else if (useOpenAi) {
    logBundle("openai_interaction_extract_skipped", { reason: "page_text_too_short", length: pageText.length });
  }

  await parseAndCacheLoLAudioPage(resolvedTitle, !!options.refresh);
  const refreshedPrimary = pageCache.get(resolvedTitle)?.rows ?? [];
  const spokenByDeterministic = refreshedPrimary.filter((r) => normk(r.speaker) === normk(display)).map(toApiRow);

  const openAiPayloads = openAiRows.map((r) => rawOpenAiToPayload(r, resolvedUrl, resolvedTitle));
  const spokenBy = mergeWrittenPayloadRows(openAiPayloads, spokenByDeterministic);
  const interactions = toMinimalFromPayload(spokenBy);
  const count = interactions.length;

  logBundle("final_interaction_count", { count });

  const championAudioPageFound = true;

  if (count === 0) {
    return {
      selectedChampion: display,
      slug: championKey,
      championAudioPageFound,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
      audioPageUrl: resolvedUrl,
      interactions: [],
      count: 0,
      error: "No written champion-to-champion interactions were found in the provided page text.",
    };
  }

  return {
    selectedChampion: display,
    slug: championKey,
    championAudioPageFound,
    sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
    audioPageUrl: resolvedUrl,
    interactions,
    count,
  };
}

export async function searchWrittenInteractions(champion: string, target?: string): Promise<WrittenInteractionPayload[]> {
  const cKey = championKeyToLoLAudioPageTitle(toWikiChampionKey(champion));
  await parseAndCacheLoLAudioPage(cKey);
  if (target?.trim()) {
    const tKey = championKeyToLoLAudioPageTitle(toWikiChampionKey(target));
    await parseAndCacheLoLAudioPage(tKey);
  }
  const nc = normk(champion);
  const nt = target?.trim() ? normk(target) : "";
  const out: WrittenInteractionPayload[] = [];
  for (const r of globalList) {
    if (nt) {
      if (
        !(
          (normk(r.speaker) === nc && normk(r.target) === nt) ||
          (normk(r.speaker) === nt && normk(r.target) === nc)
        )
      ) {
        continue;
      }
    } else if (normk(r.speaker) !== nc && normk(r.target) !== nc) {
      continue;
    }
    out.push(toApiRow(r));
  }
  return out;
}
