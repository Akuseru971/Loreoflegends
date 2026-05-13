/**
 * Deterministic Fandom fetching: category HTML → champion /LoL/Audio links → page HTML → visible text.
 * OpenAI is not used here. No audio download or playback.
 */

import * as cheerio from "cheerio";
import { toWikiChampionKey, wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

const FANDOM_ORIGIN = "https://leagueoflegends.fandom.com";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 LeagueInteractionExplorer/1.0 (compatible; +https://github.com/Akuseru971/Loreoflegends; Fandom read-only)";

const LOG_PREFIX = "[fandom-page-fetch]";

function log(stage: string, detail: Record<string, unknown>): void {
  console.info(`${LOG_PREFIX} ${stage}`, detail);
}

export type FetchFandomPageResult = {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
  error?: string;
};

/**
 * Server-side GET of a Fandom URL with redirects followed.
 */
export async function fetchFandomPage(url: string): Promise<FetchFandomPageResult> {
  const ua = process.env.FANDOM_FETCH_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    const finalUrl = response.url || url;
    log("fetch_done", { url, status: response.status, finalUrl, htmlLength: html.length });
    return {
      ok: response.ok,
      status: response.status,
      html,
      finalUrl,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("fetch_error", { url, message });
    return { ok: false, status: 0, html: "", finalUrl: url, error: message };
  }
}

export type ChampionAudioLink = {
  /** Display name, e.g. "Lee Sin" */
  name: string;
  fullUrl: string;
  /** Wiki file name segment, e.g. "Lee_Sin" */
  wikiKey: string;
};

/**
 * Parse category HTML for links matching /wiki/[Champion]/LoL/Audio
 */
export function extractLinksFromCategoryPage(html: string): ChampionAudioLink[] {
  if (!html?.trim()) {
    return [];
  }
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: ChampionAudioLink[] = [];

  $('a[href*="/LoL/Audio"]').each((_, el) => {
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) {
      return;
    }
    let pathname: string;
    try {
      const u = new URL(rawHref, FANDOM_ORIGIN);
      if (!u.hostname.toLowerCase().endsWith("fandom.com")) {
        return;
      }
      pathname = u.pathname;
    } catch {
      return;
    }
    const m = pathname.match(/^\/wiki\/([^#]+?)\/LoL\/Audio\/?$/i);
    if (!m?.[1]) {
      return;
    }
    const encoded = m[1];
    if (/:/i.test(encoded)) {
      return;
    }
    const wikiKey = decodeURIComponent(encoded).replace(/ /g, "_");
    const lower = wikiKey.toLowerCase();
    if (
      lower.startsWith("category:") ||
      lower.startsWith("file:") ||
      lower.startsWith("template:") ||
      lower.startsWith("special:") ||
      lower.startsWith("user:")
    ) {
      return;
    }
    const canonicalUrl = wikiFandomArticleUrl(`${wikiKey}/LoL/Audio`);
    if (seen.has(canonicalUrl)) {
      return;
    }
    seen.add(canonicalUrl);
    const name = wikiKey.replace(/_/g, " ");
    out.push({ name, fullUrl: canonicalUrl, wikiKey });
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  log("links_extracted", { count: out.length });
  return out;
}

/** Fold string for fuzzy champion matching (accents, punctuation, apostrophes, ampersand). */
export function normalizeChampionMatchKey(input: string): string {
  const s = input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[''`´]/g, "")
    .replace(/\s*&\s*/g, "and")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "");
  return s;
}

/**
 * Resolve the champion's /LoL/Audio URL from links extracted from the category page.
 */
export function findChampionAudioUrl(championName: string, links: ChampionAudioLink[]): ChampionAudioLink | null {
  const raw = championName.trim();
  if (!raw || !links.length) {
    return null;
  }
  const wikiKey = toWikiChampionKey(raw.replace(/_/g, " "));
  const keyLower = wikiKey.toLowerCase();

  for (const l of links) {
    if (l.wikiKey.toLowerCase() === keyLower) {
      log("champion_match", { kind: "wikiKey_exact", wikiKey: l.wikiKey, url: l.fullUrl });
      return l;
    }
  }

  const target = normalizeChampionMatchKey(raw.replace(/_/g, " "));
  const targetFromKey = normalizeChampionMatchKey(wikiKey.replace(/_/g, " "));

  for (const l of links) {
    if (normalizeChampionMatchKey(l.wikiKey.replace(/_/g, " ")) === target) {
      log("champion_match", { kind: "wikiKey_normalized", wikiKey: l.wikiKey, url: l.fullUrl });
      return l;
    }
    if (normalizeChampionMatchKey(l.name) === target) {
      log("champion_match", { kind: "display_normalized", wikiKey: l.wikiKey, url: l.fullUrl });
      return l;
    }
    if (normalizeChampionMatchKey(l.name) === targetFromKey) {
      log("champion_match", { kind: "display_vs_param_key", wikiKey: l.wikiKey, url: l.fullUrl });
      return l;
    }
  }

  log("champion_match_fail", { championName: raw, wikiKey, linkCount: links.length });
  return null;
}

/** Convenience: fetch a champion audio article by absolute URL. */
export async function fetchChampionAudioPage(audioPageUrl: string): Promise<FetchFandomPageResult> {
  return fetchFandomPage(audioPageUrl);
}

/**
 * Strip chrome/noise and return visible article text (prefers .mw-parser-output).
 */
export function extractVisibleTextFromHtml(html: string): string {
  if (!html?.trim()) {
    return "";
  }
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, svg, iframe, link[rel='stylesheet'], meta, picture source",
  ).remove();
  $(
    "[role='navigation'], nav, header, footer, #mixed-content-footer, .global-navigation, .WikiaRail, .rail-placeholder, .gpt-ad, .ad-slot, .adsbygoogle",
  ).remove();
  $("audio, video, source, .ext-audiobutton, .skin-play-button, .audio-button").remove();

  const root = $(".mw-parser-output").first();
  const text = root.length ? root.text() : $("article .mw-body-content").text() || $("body").text();

  const collapsed = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return collapsed;
}

export function logExtractedTextDebug(extractedText: string, stage: string): void {
  const len = extractedText.length;
  log("visible_text", { stage, length: len });
  if (process.env.NODE_ENV === "development" && len > 0) {
    console.info(`${LOG_PREFIX} visible_text_preview`, extractedText.slice(0, 1000));
  }
}
