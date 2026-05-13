/**
 * Live Fandom explorer: list champions from Category:LoL_Champion_audio, parse written
 * champion-to-champion lines from `Champion/LoL/Audio` wikitext (MediaWiki API). No audio I/O.
 */

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
  slug: string;
  audioPageUrl: string;
};

export type WrittenInteractionPayload = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
  sourceType: typeof WRITTEN_INTERACTION_SOURCE_TYPE;
  isSkinContext: boolean;
};

function normk(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function rowKey(r: WikiVoiceInteraction): string {
  return `${normk(r.speaker)}|${normk(r.target)}|${r.quote}`;
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
  const wt = await getChampionLoLAudioWikitext(pageTitle);
  if (!wt) {
    pageCache.set(pageTitle, { rows: [], exp: Date.now() + PAGE_TTL_MS });
    return [];
  }
  const rows = parseWikiVoiceInteractions(wt, pageTitle);
  registerRows(rows);
  pageCache.set(pageTitle, { rows, exp: Date.now() + PAGE_TTL_MS });
  return rows;
}

function toApiRow(r: WikiVoiceInteraction): WrittenInteractionPayload {
  return {
    speaker: r.speaker,
    target: r.target,
    quote: r.quote,
    interactionType: r.interactionType,
    section: r.wikiSection,
    sourceUrl: r.sourceUrl,
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

const MAX_PROBE_PAGES = 40;

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
        slug: key,
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
  count: { spokenByChampion: number; spokenToChampion: number; total: number };
  extractionNote: string;
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
      total: all.length,
    },
    extractionNote:
      "Interactions are read from Fandom wikitext via the MediaWiki API (revision slots). The previous bug that read an empty revision field is fixed, so champion-to-champion lines resolve again. No audio files are downloaded.",
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
