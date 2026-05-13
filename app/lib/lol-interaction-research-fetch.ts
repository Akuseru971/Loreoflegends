/**
 * Server-side HTML fetch for lore explain: Riot official champion / universe pages + Fandom champion pages.
 * Extracts visible text only; no browsing by the model.
 */

import * as cheerio from "cheerio";
import { extractVisibleTextFromChampionAudioPage, fetchFandomPage } from "@/app/lib/fandom-page-fetch";
import { toWikiChampionKey, wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

const LOG = "[lol-interaction-research-fetch]";

const UA =
  process.env.FANDOM_FETCH_USER_AGENT?.trim() ||
  "Mozilla/5.0 LoreInteractionExplain/1.0 (+https://github.com/Akuseru971/Loreoflegends; read-only lore research)";

const EXCERPT_MAX = 9_000;
const STORY_LINKS_MAX = 2;

export type ResearchSourceKind = "official_riot" | "fandom" | "cinematic" | "short_story" | "champion_bio";

export type GatheredResearchSource = {
  title: string;
  url: string;
  type: ResearchSourceKind;
  ok: boolean;
  status: number;
  excerpt: string;
  note?: string;
};

function log(stage: string, detail: Record<string, unknown>): void {
  console.info(`${LOG} ${stage}`, detail);
}

function clip(text: string, max = EXCERPT_MAX): string {
  const t = text.replace(/\u00a0/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}\n\n[EXCERPT_TRUNCATED]`;
}

/** Riot leagueoflegends.com champion slug: Lee_Sin → lee-sin, Kai'Sa → kai-sa */
export function riotChampionSlugFromWikiKey(wikiKey: string): string {
  return wikiKey
    .split("_")
    .map((w) => w.replace(/\./g, "").replace(/'/g, "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function slugVariants(wikiKey: string): string[] {
  const hyphen = riotChampionSlugFromWikiKey(wikiKey);
  const compact = wikiKey
    .split("_")
    .map((w) => w.replace(/\./g, "").replace(/'/g, ""))
    .join("")
    .toLowerCase();
  return [...new Set([hyphen, compact].filter(Boolean))];
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string; finalUrl: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    const html = await res.text();
    const finalUrl = res.url || url;
    log("fetch", { url, status: res.status, finalUrl, len: html.length });
    return {
      ok: res.ok,
      status: res.status,
      html,
      finalUrl,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("fetch_error", { url, message });
    return { ok: false, status: 0, html: "", finalUrl: url, error: message };
  }
}

function extractUniverseStoryUrls(html: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    if (out.length >= limit) {
      return false;
    }
    const raw = $(el).attr("href")?.trim() ?? "";
    if (!raw.toLowerCase().includes("/story/")) {
      return;
    }
    let abs = raw;
    if (raw.startsWith("//")) {
      abs = `https:${raw}`;
    } else if (raw.startsWith("/")) {
      abs = `https://www.leagueoflegends.com${raw}`;
    } else if (!raw.startsWith("http")) {
      return;
    }
    try {
      const u = new URL(abs);
      if (!seen.has(u.href)) {
        seen.add(u.href);
        out.push(u.href);
      }
    } catch {
      /* ignore */
    }
  });
  return out;
}

async function fetchRiotChampionPack(wikiKey: string, label: string): Promise<GatheredResearchSource[]> {
  const out: GatheredResearchSource[] = [];
  const variants = slugVariants(wikiKey);
  const tried = new Set<string>();

  const pushSource = (
    url: string,
    type: ResearchSourceKind,
    title: string,
    r: { ok: boolean; status: number; html: string; finalUrl: string; error?: string },
  ) => {
    const text = r.ok && r.html.length > 200 ? clip(extractVisibleTextFromChampionAudioPage(r.html)) : "";
    out.push({
      title,
      url: r.finalUrl || url,
      type,
      ok: r.ok && text.length > 80,
      status: r.status,
      excerpt: text,
      note: r.ok ? undefined : r.error || `HTTP ${r.status}`,
    });
  };

  for (const slug of variants) {
    const url = `https://www.leagueoflegends.com/en-us/champions/${slug}/`;
    if (tried.has(url)) {
      continue;
    }
    tried.add(url);
    const r = await fetchHtml(url);
    pushSource(url, "champion_bio", `${label} — Riot champions page (${slug})`, r);
    if (r.ok && r.html.length > 200) {
      break;
    }
  }

  for (const slug of variants) {
    const url = `https://www.leagueoflegends.com/en-us/universe/champion/${slug}/`;
    if (tried.has(url)) {
      continue;
    }
    tried.add(url);
    const r = await fetchHtml(url);
    pushSource(url, "official_riot", `${label} — Riot Universe champion hub (${slug})`, r);
    if (r.ok && r.html.length > 200) {
      const storyUrls = extractUniverseStoryUrls(r.html, STORY_LINKS_MAX);
      for (const su of storyUrls) {
        if (tried.has(su)) {
          continue;
        }
        tried.add(su);
        const sr = await fetchHtml(su);
        pushSource(su, "short_story", `${label} — linked Universe story`, sr);
      }
      break;
    }
  }

  return out;
}

async function fetchFandomWikiPage(wikiKey: string, label: string): Promise<GatheredResearchSource> {
  const url = wikiFandomArticleUrl(wikiKey);
  const r = await fetchFandomPage(url);
  const text = r.ok && r.html.length > 200 ? clip(extractVisibleTextFromChampionAudioPage(r.html)) : "";
  return {
    title: `${label} — Fandom champion page`,
    url: r.finalUrl || url,
    type: "fandom",
    ok: r.ok && text.length > 80,
    status: r.status,
    excerpt: text,
    note: r.ok ? undefined : r.error || `HTTP ${r.status}`,
  };
}

async function fetchFandomAudioPage(sourceUrl: string): Promise<GatheredResearchSource> {
  const r = await fetchFandomPage(sourceUrl.trim());
  const text = r.ok && r.html.length > 200 ? clip(extractVisibleTextFromChampionAudioPage(r.html)) : "";
  return {
    title: "Fandom — voice line source page",
    url: r.finalUrl || sourceUrl.trim(),
    type: "fandom",
    ok: r.ok && text.length > 80,
    status: r.status,
    excerpt: text,
    note: r.ok ? undefined : r.error || `HTTP ${r.status}`,
  };
}

/**
 * Fetches Riot + Fandom HTML for speaker, target, and the provided audio source URL; returns excerpts for the model.
 */
export async function gatherInteractionResearchSources(
  speaker: string,
  target: string,
  sourceAudioUrl: string,
): Promise<GatheredResearchSource[]> {
  const speakerKey = toWikiChampionKey(speaker);
  const targetKey = toWikiChampionKey(target);

  const sources: GatheredResearchSource[] = [];

  sources.push(await fetchFandomAudioPage(sourceAudioUrl));
  sources.push(await fetchFandomWikiPage(speakerKey, `Speaker (${speaker})`));
  sources.push(await fetchFandomWikiPage(targetKey, `Target (${target})`));

  sources.push(...(await fetchRiotChampionPack(speakerKey, `Speaker (${speaker})`)));
  sources.push(...(await fetchRiotChampionPack(targetKey, `Target (${target})`)));

  log("gather_done", {
    speakerKey,
    targetKey,
    count: sources.length,
    okCount: sources.filter((s) => s.ok).length,
  });

  return sources;
}

export function formatResearchSourcesForPrompt(sources: GatheredResearchSource[]): string {
  const blocks: string[] = [];
  for (const s of sources) {
    const status = s.ok ? "OK" : "FAILED_OR_EMPTY";
    blocks.push(
      `=== ${s.title} ===\nURL: ${s.url}\nTYPE: ${s.type}\nFETCH: ${status}${s.note ? ` (${s.note})` : ""}\n\n${s.ok ? s.excerpt : "(No usable excerpt — do not invent content for this URL.)"}\n`,
    );
  }
  return blocks.join("\n---\n\n");
}
