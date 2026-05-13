/**
 * Fandom explorer helpers: champion list from category, cached HTML/wikitext parsing for searchWrittenInteractions.
 * Live interaction discovery uses POST /api/find-champion-interactions (see find-champion-interactions-pipeline).
 */

import { extractWrittenInteractionsFromParsedHtml, fetchFandomParsedHtml } from "@/app/lib/fandom-audio-html";
import { wikiChampionKeyFromAudioPageUrl } from "@/app/lib/fandom-openai-agent";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  championKeyToLoLAudioPageTitle,
  getChampionLoLAudioWikitext,
  parseWikiVoiceInteractions,
  toWikiChampionKey,
  type WikiVoiceInteraction,
} from "@/app/lib/lol-wiki-audio";
import { fetchAndExtractChampionAudioLinks } from "@/app/lib/fandom-page-fetch";

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
