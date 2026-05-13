/**
 * Live Fandom explorer: list champions from Category:LoL_Champion_audio, parse written
 * champion-to-champion lines from Champion/LoL/Audio pages (HTML via Cheerio + wikitext merge).
 * No audio download, playback, or transcription.
 */

import { extractWrittenInteractionsFromParsedHtml, fetchFandomParsedHtml } from "@/app/lib/fandom-audio-html";
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

export async function getChampionListForApi(): Promise<{
  champions: ChampionListEntry[];
  sourceCategory: string;
  count: number;
}> {
  const titles = await extractChampionAudioPageLinksFromCategory();
  const champions = titles
    .map((t) => {
      const key = t.replace(/\/LoL\/Audio$/i, "");
      const displayName = key.replace(/_/g, " ");
      return {
        name: displayName,
        audioPageUrl: wikiFandomArticleUrl(t),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { champions, sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL, count: champions.length };
}

export async function getChampionInteractionsBundle(
  championParam: string,
  options: { refresh?: boolean } = {},
): Promise<{
  selectedChampion: string;
  slug: string;
  audioPageUrl: string;
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

  const allTitles = await extractChampionAudioPageLinksFromCategory();
  await parseAndCacheLoLAudioPage(primaryTitle, !!options.refresh);

  const primaryRows = pageCache.get(primaryTitle)?.rows ?? [];
  const relatedTitles: string[] = [];
  for (const r of primaryRows) {
    if (normk(r.speaker) === normk(display)) {
      const t = championKeyToLoLAudioPageTitle(toWikiChampionKey(r.target));
      if (t.toLowerCase() !== primaryTitle.toLowerCase()) {
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

  await probePagesMentioningChampion(championKey, display, primaryTitle, allTitles);

  const refreshedPrimary = pageCache.get(primaryTitle)?.rows ?? [];
  const spokenBy = refreshedPrimary.filter((r) => normk(r.speaker) === normk(display)).map(toApiRow);
  const spokenTo = (globalByTarget.get(normk(display)) ?? []).map(toApiRow);

  const merged = new Map<string, WrittenInteractionPayload>();
  for (const x of [...spokenBy, ...spokenTo]) {
    merged.set(`${normk(x.speaker)}|${normk(x.target)}|${x.quote}`, x);
  }
  const all = [...merged.values()].sort((a, b) => b.quote.length - a.quote.length);
  const total = all.length;
  const firstEnc = spokenBy.filter((x) => x.interactionType === "First Encounter");

  return {
    selectedChampion: display,
    slug: championKey,
    audioPageUrl: wikiFandomArticleUrl(primaryTitle),
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
      "Written lines are parsed from Fandom rendered HTML (Cheerio on MediaWiki action=parse) and merged with wikitext for coverage. Audio <source> URLs are ignored for dialogue text. No .ogg playback or transcription.",
    ...(total === 0 ?
      {
        error: "No verified written champion interactions found on the Fandom audio pages.",
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
