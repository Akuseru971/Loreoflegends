/**
 * Deterministic Fandom fetching: category HTML → champion /LoL/Audio link candidates → page HTML → visible text.
 * No audio download or playback.
 */

import * as cheerio from "cheerio";
import {
  LOL_WIKI_AUDIO_CATEGORY_URL,
  extractChampionAudioPageLinksFromCategory,
  toWikiChampionKey,
  wikiFandomArticleUrl,
} from "@/app/lib/lol-wiki-audio";

const FANDOM_ORIGIN = "https://leagueoflegends.fandom.com";

/** Browser-like UA: some Fandom edges return 403 to non-browser or custom-bot user agents. */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

function parseRetryCount(): number {
  const raw = process.env.FANDOM_FETCH_RETRIES?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 4;
  if (!Number.isFinite(n)) {
    return 4;
  }
  return Math.min(8, Math.max(1, n));
}

function shouldRetryFandomFetch(prev: FetchFandomPageResult, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  if (prev.status === 0 && prev.error) {
    return true;
  }
  const st = prev.status;
  return st === 403 || st === 408 || st === 425 || st === 429 || st === 500 || st === 502 || st === 503 || st === 504;
}

async function fetchFandomPageOnce(url: string, ua: string): Promise<FetchFandomPageResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://leagueoflegends.fandom.com/",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
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

/**
 * Server-side GET of a Fandom URL with redirects followed and limited retries on transient failures.
 */
export async function fetchFandomPage(url: string): Promise<FetchFandomPageResult> {
  const ua = process.env.FANDOM_FETCH_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
  const maxAttempts = parseRetryCount();
  let last: FetchFandomPageResult = { ok: false, status: 0, html: "", finalUrl: url, error: "fetch not started" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fetchFandomPageOnce(url, ua);
    if (last.ok && last.html.length > 0) {
      return last;
    }
    if (!shouldRetryFandomFetch(last, attempt, maxAttempts)) {
      return last;
    }
    const delayMs = Math.min(8000, 500 * 2 ** (attempt - 1));
    log("fetch_retry_scheduled", { url, attempt, maxAttempts, delayMs, status: last.status, err: last.error });
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

export type ChampionAudioLink = {
  /** Display name, e.g. "Lee Sin" */
  name: string;
  fullUrl: string;
  /** Wiki file name segment, e.g. "Lee_Sin" */
  wikiKey: string;
};

/** Link row extracted from the category page (for OpenAI disambiguation). */
export type FandomChampionAudioLinkCandidate = {
  label: string;
  href: string;
  url: string;
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

/**
 * Same links as {@link extractLinksFromCategoryPage}, with anchor label + href preserved for LLM matching.
 */
export function extractChampionAudioLinkCandidatesFromCategoryHtml(html: string): FandomChampionAudioLinkCandidate[] {
  const rows = extractLinksFromCategoryPage(html);
  if (!html?.trim() || !rows.length) {
    return [];
  }
  const $ = cheerio.load(html);
  const byUrl = new Map<string, { label: string; href: string }>();

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
    if (!m?.[1] || /:/i.test(m[1])) {
      return;
    }
    const wikiKey = decodeURIComponent(m[1]).replace(/ /g, "_");
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
    const url = wikiFandomArticleUrl(`${wikiKey}/LoL/Audio`);
    const label = $(el).text().replace(/\s+/g, " ").trim() || `${wikiKey}/LoL/Audio`;
    const href = `/wiki/${wikiKey}/LoL/Audio`;
    if (!byUrl.has(url)) {
      byUrl.set(url, { label, href });
    }
  });

  const out: FandomChampionAudioLinkCandidate[] = [];
  for (const r of rows) {
    const meta = byUrl.get(r.fullUrl);
    out.push({
      label: meta?.label ?? `${r.wikiKey}/LoL/Audio`,
      href: meta?.href ?? `/wiki/${r.wikiKey}/LoL/Audio`,
      url: r.fullUrl,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/**
 * Fetch the LoL champion audio category page and extract /LoL/Audio link candidates.
 * Falls back to MediaWiki API if the HTML fetch yields too few links.
 */
export async function fetchAndExtractChampionAudioLinks(): Promise<{
  ok: boolean;
  status: number;
  htmlLength: number;
  candidates: FandomChampionAudioLinkCandidate[];
  error?: string;
}> {
  const catRes = await fetchFandomPage(LOL_WIKI_AUDIO_CATEGORY_URL);
  let candidates =
    catRes.ok && catRes.html.length > 500 ? extractChampionAudioLinkCandidatesFromCategoryHtml(catRes.html) : [];

  if (candidates.length < 8) {
    log("fetch_candidates_fallback_api", { priorCount: candidates.length });
    const titles = await extractChampionAudioPageLinksFromCategory();
    candidates = titles.map((t) => {
      const wikiKey = t.replace(/\/LoL\/Audio$/i, "");
      const url = wikiFandomArticleUrl(t);
      return {
        label: `${wikiKey}/LoL/Audio`,
        href: `/wiki/${wikiKey}/LoL/Audio`,
        url,
      };
    });
  }

  log("fetch_and_extract_done", { status: catRes.status, htmlLength: catRes.html.length, candidateCount: candidates.length });
  return {
    ok: catRes.ok,
    status: catRes.status,
    htmlLength: catRes.html.length,
    candidates,
    ...(catRes.ok ? {} : { error: catRes.error ?? `HTTP ${catRes.status}` }),
  };
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

/** Fetch a champion LoL audio wiki page; logs HTTP status (always) and extra detail in development. */
export async function fetchChampionAudioPage(audioPageUrl: string): Promise<FetchFandomPageResult> {
  const res = await fetchFandomPage(audioPageUrl);
  log("champion_audio_page_fetch", { url: audioPageUrl, ok: res.ok, status: res.status, htmlLength: res.html.length });
  if (process.env.NODE_ENV === "development") {
    console.info(`${LOG_PREFIX} champion_audio_page_fetch_dev`, { finalUrl: res.finalUrl, error: res.error });
  }
  return res;
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
  $('a[href$=".ogg"], a[href*=".ogg"]').remove();

  const root = $(".mw-parser-output").first();
  const text = root.length ? root.text() : $("article .mw-body-content").text() || $("body").text();

  const collapsed = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return collapsed;
}

/** Visible article text from a champion /LoL/Audio HTML document (browser or parse API). */
export function extractVisibleTextFromChampionAudioPage(html: string): string {
  return extractVisibleTextFromHtml(html);
}

export function logExtractedTextDebug(extractedText: string, stage: string): void {
  const len = extractedText.length;
  log("visible_text", { stage, length: len });
  if (process.env.NODE_ENV === "development" && len > 0) {
    console.info(`${LOG_PREFIX} visible_text_preview`, extractedText.slice(0, 1000));
  }
}
