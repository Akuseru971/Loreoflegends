/**
 * Live Fandom explorer: fetch category HTML for /LoL/Audio links, match champion deterministically,
 * fetch champion audio HTML and visible text, optionally structure lines with OpenAI from that text only,
 * and merge with HTML+wikitext parsing. No audio download, playback, or transcription.
 */

import { extractWrittenInteractionsFromParsedHtml, fetchFandomParsedHtml, fandomHtmlToSearchPlainText } from "@/app/lib/fandom-audio-html";
import {
  extractWrittenInteractionsWithOpenAiIfConfigured,
  openAiFandomInteractionAgentEnabled,
  type RawWrittenInteractionFromPage,
} from "@/app/lib/fandom-openai-agent";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  championKeyToLoLAudioPageTitle,
  extractChampionAudioPageLinksFromCategory,
  fetchWikitextBatch,
  getChampionLoLAudioWikitext,
  parseWikiVoiceInteractions,
  toWikiChampionKey,
  wikiFandomArticleUrl,
  wikitextReferencesChampionCi,
  type WikiVoiceInteraction,
} from "@/app/lib/lol-wiki-audio";
import {
  extractLinksFromCategoryPage,
  extractVisibleTextFromHtml,
  fetchChampionAudioPage,
  fetchFandomPage,
  findChampionAudioUrl,
  logExtractedTextDebug,
} from "@/app/lib/fandom-page-fetch";

export type FandomInteractionMinimal = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
};

export const WRITTEN_INTERACTION_SOURCE_TYPE = "Written interaction from Fandom champion audio page" as const;

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

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h + s.charCodeAt(i) * (i + 3)) % 10007;
  }
  return h;
}

const MAX_PROBE_PAGES = 72;

async function probePagesMentioningChampion(
  championKey: string,
  championDisplay: string,
  primaryTitle: string,
  allTitles: string[],
): Promise<void> {
  const sorted = [...allTitles].sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    return;
  }
  let probed = 0;
  const offset = hashString(championKey) % sorted.length;
  const skip = new Set<string>([primaryTitle.toLowerCase()]);

  for (let i = 0; i < sorted.length && probed < MAX_PROBE_PAGES; i++) {
    const title = sorted[(offset + i) % sorted.length]!;
    const tl = title.toLowerCase();
    if (skip.has(tl)) {
      continue;
    }
    skip.add(tl);
    const wt = await getChampionLoLAudioWikitext(title);
    if (!wt) {
      continue;
    }
    if (!wikitextReferencesChampionCi(wt, championKey, championDisplay)) {
      continue;
    }
    probed++;
    await parseAndCacheLoLAudioPage(title);
  }
}

const BUNDLE_LOG = "[fandom-interactions-bundle]";

function logBundle(stage: string, detail: Record<string, unknown>): void {
  console.info(`${BUNDLE_LOG} ${stage}`, detail);
}

function toMinimalInteractions(rows: WrittenInteractionPayload[]): FandomInteractionMinimal[] {
  return rows.map((r) => ({
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: r.section,
    sourceUrl: r.sourceUrl,
  }));
}

export async function getChampionListForApi(): Promise<{
  champions: ChampionListEntry[];
  sourceCategory: string;
  count: number;
}> {
  const catRes = await fetchFandomPage(LOL_WIKI_AUDIO_CATEGORY_URL);
  logBundle("category_fetch", { ok: catRes.ok, status: catRes.status, htmlLen: catRes.html.length });

  let links =
    catRes.ok && catRes.html.length > 500 ? extractLinksFromCategoryPage(catRes.html) : [];

  if (links.length < 8) {
    logBundle("category_links_fallback_api", { priorCount: links.length });
    const titles = await extractChampionAudioPageLinksFromCategory();
    links = titles.map((t) => {
      const wikiKey = t.replace(/\/LoL\/Audio$/i, "");
      return {
        name: wikiKey.replace(/_/g, " "),
        fullUrl: wikiFandomArticleUrl(t),
        wikiKey,
      };
    });
  }

  const champions = links
    .map((l) => ({ name: l.name, audioPageUrl: l.fullUrl }))
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
  interactionCount: number;
  spokenByChampion: WrittenInteractionPayload[];
  spokenToChampion: WrittenInteractionPayload[];
  allInteractions: WrittenInteractionPayload[];
  count: {
    spokenByChampion: number;
    spokenToChampion: number;
    spokenByFirstEncounter: number;
    total: number;
  };
  extractionNote: string;
  error?: string;
}> {
  const raw = decodeURIComponent(championParam.trim());
  const championKey = toWikiChampionKey(raw.replace(/_/g, " "));
  const display = championKey.replace(/_/g, " ");
  const primaryTitle = championKeyToLoLAudioPageTitle(championKey);

  if (options.refresh) {
    invalidateFandomInteractionCaches();
  }

  const catRes = await fetchFandomPage(LOL_WIKI_AUDIO_CATEGORY_URL);
  logBundle("category_fetch", { ok: catRes.ok, status: catRes.status, htmlLen: catRes.html.length });

  let links =
    catRes.ok && catRes.html.length > 500 ? extractLinksFromCategoryPage(catRes.html) : [];

  if (links.length < 8) {
    logBundle("category_links_fallback_api", { priorCount: links.length });
    const titles = await extractChampionAudioPageLinksFromCategory();
    links = titles.map((t) => {
      const wikiKey = t.replace(/\/LoL\/Audio$/i, "");
      return {
        name: wikiKey.replace(/_/g, " "),
        fullUrl: wikiFandomArticleUrl(t),
        wikiKey,
      };
    });
  }

  logBundle("links_ready", { count: links.length, selectedChampion: display });

  const match = findChampionAudioUrl(raw, links);
  if (!match) {
    logBundle("champion_url_not_matched", { selectedChampion: display, slug: championKey });
    return {
      selectedChampion: display,
      slug: championKey,
      championAudioPageFound: false,
      sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
      audioPageUrl: "",
      interactions: [],
      interactionCount: 0,
      spokenByChampion: [],
      spokenToChampion: [],
      allInteractions: [],
      count: {
        spokenByChampion: 0,
        spokenToChampion: 0,
        spokenByFirstEncounter: 0,
        total: 0,
      },
      extractionNote:
        "The category page was fetched and parsed for /wiki/*/LoL/Audio links; no link matched this champion name after normalization.",
      error: "No champion audio page link matched this champion on the Fandom category page.",
    };
  }

  const resolvedUrl = match.fullUrl;
  const resolvedTitle = `${match.wikiKey}/LoL/Audio`;
  const championAudioPageFound = true;

  logBundle("matched_audio_url", { audioPageUrl: resolvedUrl, wikiKey: match.wikiKey });

  const pageRes = await fetchChampionAudioPage(resolvedUrl);
  logBundle("champion_page_fetch", { ok: pageRes.ok, status: pageRes.status, htmlLen: pageRes.html.length });

  let pageText = "";
  if (pageRes.ok && pageRes.html.length > 0) {
    pageText = extractVisibleTextFromHtml(pageRes.html);
    logExtractedTextDebug(pageText, "browser_html");
  }

  if (pageText.length < 600) {
    logBundle("visible_text_fallback_parse_api", { priorLen: pageText.length });
    const parseHtml = await fetchFandomParsedHtml(resolvedTitle);
    if (parseHtml) {
      const fromParse = extractVisibleTextFromHtml(parseHtml);
      const fromPlain = fandomHtmlToSearchPlainText(parseHtml);
      const best = [pageText, fromParse, fromPlain].reduce((a, b) => (b.length > a.length ? b : a), "");
      if (best.length > pageText.length) {
        pageText = best;
      }
      logExtractedTextDebug(pageText, "parse_api_html");
    }
  }

  logBundle("page_text_ready", { length: pageText.length });

  const useAgent = openAiFandomInteractionAgentEnabled();
  let openAiSpokenBy: WrittenInteractionPayload[] = [];

  if (useAgent && pageText.length > 200) {
    const rawRows = await extractWrittenInteractionsWithOpenAiIfConfigured(display, pageText, resolvedUrl);
    logBundle("openai_extract_rows", { count: rawRows.length });
    openAiSpokenBy = rawRows.map((r) => rawOpenAiToPayload(r, resolvedUrl, resolvedTitle));
  } else if (useAgent) {
    logBundle("openai_extract_skipped", { reason: "page_text_too_short", length: pageText.length });
  }

  const allTitles = links.map((l) => `${l.wikiKey}/LoL/Audio`);

  await parseAndCacheLoLAudioPage(resolvedTitle, !!options.refresh);

  const primaryRows = pageCache.get(resolvedTitle)?.rows ?? [];
  const relatedTitles: string[] = [];
  for (const r of primaryRows) {
    if (normk(r.speaker) === normk(display)) {
      const t = championKeyToLoLAudioPageTitle(toWikiChampionKey(r.target));
      if (t.toLowerCase() !== resolvedTitle.toLowerCase()) {
        relatedTitles.push(t);
      }
    }
  }
  const uniqueRelated = [...new Set(relatedTitles)].slice(0, 16);
  if (uniqueRelated.length) {
    const batch = await fetchWikitextBatch(uniqueRelated);
    for (const t of uniqueRelated) {
      if (batch.get(t)) {
        await parseAndCacheLoLAudioPage(t);
      }
    }
  }

  await probePagesMentioningChampion(championKey, display, resolvedTitle, allTitles);

  const refreshedPrimary = pageCache.get(resolvedTitle)?.rows ?? [];
  const spokenByDeterministic = refreshedPrimary.filter((r) => normk(r.speaker) === normk(display)).map(toApiRow);
  const spokenBy = mergeWrittenPayloadRows(openAiSpokenBy, spokenByDeterministic);
  const spokenTo = (globalByTarget.get(normk(display)) ?? []).map(toApiRow);

  const merged = new Map<string, WrittenInteractionPayload>();
  for (const x of [...spokenBy, ...spokenTo]) {
    merged.set(`${normk(x.speaker)}|${normk(x.target)}|${x.quote}`, x);
  }
  const all = [...merged.values()].sort((a, b) => b.quote.length - a.quote.length);
  const total = all.length;
  const firstEnc = spokenBy.filter((x) => x.interactionType === "First Encounter");

  const interactions = toMinimalInteractions(spokenBy);
  const interactionCount = interactions.length;

  return {
    selectedChampion: display,
    slug: championKey,
    championAudioPageFound,
    sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
    audioPageUrl: resolvedUrl,
    interactions,
    interactionCount,
    spokenByChampion: spokenBy,
    spokenToChampion: spokenTo,
    allInteractions: all,
    count: {
      spokenByChampion: spokenBy.length,
      spokenToChampion: spokenTo.length,
      spokenByFirstEncounter: firstEnc.length,
      total,
    },
    extractionNote:
      useAgent ?
        "URLs come from fetched category HTML (Cheerio) with API fallback; the champion page is fetched server-side, visible text is extracted, then OpenAI structures interactions only from that text (quotes validated against the text). HTML+wikitext parsing is merged as fallback. No model-driven browsing."
      : "Written lines are parsed from Fandom rendered HTML (Cheerio on MediaWiki action=parse) and merged with wikitext for coverage. Audio elements are ignored. No .ogg playback or transcription.",
    ...(total === 0 ?
      {
        error:
          useAgent && championAudioPageFound && pageText.length > 400 ?
            "No written champion-to-champion interactions found in the provided page text."
          : "No verified written champion interactions found on the Fandom audio pages.",
      }
    : {}),
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
