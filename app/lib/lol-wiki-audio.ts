/**
 * League of Legends Fandom — written champion interactions on `Champion/LoL/Audio` pages
 * (Category:LoL_Champion_audio). We only use MediaWiki **wikitext** (already transcribed on the wiki).
 * We never download, play, or transcribe .ogg / .mp3 / .wav files.
 *
 * Content is community-maintained (CC-BY-SA). Always attribute with sourceUrl.
 */

const WIKI_API = "https://leagueoflegends.fandom.com/api.php";
const USER_AGENT =
  "Mozilla/5.0 (compatible; LoreoflegendsInteractionExplainer/1.0; +https://github.com/Akuseru971/Loreoflegends; Fandom API read-only)";

/** Human-readable index; API uses the same category title on the fandom.org host. */
export const LOL_WIKI_AUDIO_CATEGORY_URL =
  "https://leagueoflegends.fandom.com/wiki/Category:LoL_Champion_audio";

const CATEGORY_TITLE = "Category:LoL_Champion_audio";

const ROMAN_NUMERALS = new Set([
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
]);

export type WikiVoiceInteraction = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  wikiSection: string;
  wikiPageTitle: string;
  sourceUrl: string;
  headerLine: string;
  isSkinContext: boolean;
};

type TitleCacheEntry = { expires: number; titles: string[] };

let categoryTitlesCache: TitleCacheEntry | null = null;
const CATEGORY_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

export function toWikiChampionKey(displayOrSlug: string): string {
  const parts = displayOrSlug
    .trim()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((word) => {
      const upper = word.toUpperCase();
      if (ROMAN_NUMERALS.has(upper)) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("_");
}

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Canonical reader URL for a Fandom content page (written wiki HTML; we still fetch wikitext via API). */
export function wikiFandomArticleUrl(pageTitle: string): string {
  const slug = pageTitle.replace(/ /g, "_");
  return `https://leagueoflegends.fandom.com/wiki/${slug}`;
}

export function championKeyToLoLAudioPageTitle(championKey: string): string {
  return `${championKey}/LoL/Audio`;
}

async function wikiGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 86_400 },
  });
  if (!response.ok) {
    throw new Error(`Wiki HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * All member page titles under Category:LoL_Champion_audio (e.g. "Swain/LoL/Audio").
 */
export async function extractChampionAudioPageLinksFromCategory(): Promise<string[]> {
  if (categoryTitlesCache && categoryTitlesCache.expires > Date.now()) {
    return categoryTitlesCache.titles;
  }

  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      list: "categorymembers",
      cmtitle: CATEGORY_TITLE,
      cmlimit: "500",
      cmtype: "page",
    };
    if (cmcontinue) {
      params.cmcontinue = cmcontinue;
    }

    const data = (await wikiGet(params)) as {
      continue?: { cmcontinue?: string };
      query?: { categorymembers?: { title: string }[] };
    };

    const batch = data.query?.categorymembers ?? [];
    for (const m of batch) {
      if (m.title.endsWith("/LoL/Audio")) {
        titles.push(m.title);
      }
    }
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);

  categoryTitlesCache = { expires: Date.now() + CATEGORY_CACHE_TTL_MS, titles };
  return titles;
}

export async function getChampionLoLAudioWikitext(pageTitle: string): Promise<string | null> {
  try {
    const data = (await wikiGet({
      action: "query",
      format: "json",
      titles: pageTitle,
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
    })) as {
      query?: { pages?: Record<string, { missing?: true; revisions?: { "*": string }[] }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    if (!page || page.missing || !page.revisions?.[0]) {
      return null;
    }
    return page.revisions[0]["*"] ?? null;
  } catch {
    return null;
  }
}

export async function fetchWikitextBatch(titles: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const chunkSize = 8;
  for (let i = 0; i < titles.length; i += chunkSize) {
    const chunk = titles.slice(i, i + chunkSize);
    try {
      const data = (await wikiGet({
        action: "query",
        format: "json",
        titles: chunk.join("|"),
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
      })) as {
        query?: { pages?: Record<string, { title?: string; missing?: true; revisions?: { "*": string }[] }> };
      };
      const pages = data.query?.pages ?? {};
      for (const p of Object.values(pages)) {
        const t = p.title;
        if (!t) {
          continue;
        }
        if (p.missing || !p.revisions?.[0]) {
          out.set(t, null);
        } else {
          out.set(t, p.revisions[0]["*"] ?? null);
        }
      }
    } catch {
      for (const t of chunk) {
        out.set(t, null);
      }
    }
  }
  return out;
}

function extractCiNamesFromLine(line: string, pageSpeaker: string): string[] {
  const names: string[] = [];
  const re = /\{\{ci\|([^}|#]+)(?:\|[^}]*)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[1].trim().replace(/_/g, " ");
    if (raw.toLowerCase() === pageSpeaker.toLowerCase()) {
      continue;
    }
    names.push(raw);
  }
  return [...new Set(names)];
}

function isSkinContextLine(line: string): boolean {
  return /\{\{csl\|/i.test(line) || /\bPROJECT\b|\bStar Guardian\b|\bPrestige\b/i.test(line);
}

function headerSupportsDirectedChampionLine(headerLine: string): boolean {
  if (!/\{\{ci\|/.test(headerLine)) {
    return false;
  }
  const h = headerLine.toLowerCase();
  if (h.includes("pick") && h.includes("champion select")) {
    return true;
  }
  return (
    h.includes("first encounter") ||
    h.includes("upon first encounter") ||
    h.includes("taunt response to") ||
    h.includes("taunt") ||
    h.includes("joke response to") ||
    h.includes("joke") ||
    h.includes("laugh response to") ||
    h.includes("first move with enemy") ||
    h.includes("killing ") ||
    h.includes("kill ") ||
    h.includes("collecting a soul fragment from") ||
    h.includes("assist") ||
    h.includes("scoring a") ||
    h.includes("attacking ") ||
    h.includes("attack ") ||
    h.includes("respawn") ||
    h.includes("recall") ||
    h.includes("champion-specific") ||
    h.includes("special interaction")
  );
}

function deriveInteractionType(headerLine: string, wikiSection: string): string {
  const h = headerLine.toLowerCase();
  if (h.includes("upon first encounter") || h.includes("first encounter")) {
    return "First encounter";
  }
  if (h.includes("taunt response to")) {
    return "Taunt response";
  }
  if (h.includes("taunt")) {
    return "Taunt";
  }
  if (h.includes("joke response")) {
    return "Joke response";
  }
  if (h.includes("killing {{ci") || (h.includes("killing") && h.includes("{{ci"))) {
    return "Kill line";
  }
  if (h.includes("collecting a soul fragment")) {
    return "Soul fragment (ability)";
  }
  if (h.includes("first move with enemy")) {
    return "First move (enemy champion)";
  }
  if (h.includes("champion select") || h.includes("pick")) {
    return "Champion select";
  }
  return `Special interaction (${wikiSection})`;
}

function extractQuotedVoiceFromBullet(line: string): string | null {
  const balancedDouble = line.match(/''\\?"((?:[^"\\]|\\.){6,420})"\\?''/);
  if (balancedDouble) {
    return balancedDouble[1].replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
  }

  const simple = line.match(/''"([^"]{6,420})"''/);
  if (simple) {
    return simple[1].trim();
  }

  const loose = line.match(/''\\?"([^'']{10,420})''/);
  if (loose) {
    const inner = loose[1].replace(/^\\?"+/, "").replace(/\\?"+$/, "").trim();
    if (inner.length >= 10 && /[A-Za-zÀ-ÿ]/.test(inner) && !inner.includes("{{")) {
      return inner;
    }
  }

  return null;
}

function pageSpeakerFromTitle(pageTitle: string): string {
  const base = pageTitle.replace(/\/LoL\/Audio$/i, "").replace(/\/Audio$/i, "");
  return base.replace(/_/g, " ");
}

/**
 * Parse champion-to-champion lines from one /Audio wikitext page.
 */
export function parseWikiVoiceInteractions(wikitext: string, pageTitle: string): WikiVoiceInteraction[] {
  const speaker = pageSpeakerFromTitle(pageTitle);
  const out: WikiVoiceInteraction[] = [];
  let currentSection = "Intro";
  let pendingHeader: string | null = null;

  const lines = wikitext.split(/\r?\n/);

  const pushRows = (header: string, quote: string, targets: string[]) => {
    if (!quote || targets.length === 0) {
      return;
    }
    const interactionType = deriveInteractionType(header, currentSection);
    const skin = isSkinContextLine(header) || isSkinContextLine(quote);
    for (const target of targets) {
      out.push({
        speaker,
        target,
        quote,
        interactionType,
        wikiSection: currentSection,
        wikiPageTitle: pageTitle,
        sourceUrl: wikiFandomArticleUrl(pageTitle),
        headerLine: header,
        isSkinContext: skin,
      });
    }
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      pendingHeader = null;
      continue;
    }

    if (/^\s*;\s/.test(line)) {
      if (headerSupportsDirectedChampionLine(line)) {
        pendingHeader = line.trim();
      } else {
        pendingHeader = null;
      }
      continue;
    }

    if (pendingHeader && /^\s*\*\s/.test(line) && line.includes("{{sm2")) {
      const targets = extractCiNamesFromLine(pendingHeader, speaker);
      const quote = extractQuotedVoiceFromBullet(line);
      if (quote) {
        pushRows(pendingHeader, quote, targets);
      }
      pendingHeader = null;
      continue;
    }

    if (/^\s*\*\s/.test(line) && line.includes("{{sm2") && line.includes("{{ci|")) {
      const inlineTargets = extractCiNamesFromLine(line, speaker);
      const quote = extractQuotedVoiceFromBullet(line);
      if (quote && inlineTargets.length > 0) {
        pushRows(`(inline in ${currentSection})`, quote, inlineTargets);
      }
    }
  }

  return out;
}

function dedupeInteractions(rows: WikiVoiceInteraction[]): WikiVoiceInteraction[] {
  const seen = new Set<string>();
  const out: WikiVoiceInteraction[] = [];
  for (const r of rows) {
    const k = `${r.speaker}|${r.target}|${r.quote}`.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function scoreInteractionForShortFormContent(row: WikiVoiceInteraction): number {
  let s = 0;
  const q = row.quote.toLowerCase();
  const drama = [
    "secret",
    "betray",
    "traitor",
    "kill",
    "die",
    "death",
    "hate",
    "love",
    "never",
    "always",
    "remember",
    "sister",
    "brother",
    "mother",
    "father",
    "dark",
    "truth",
    "lie",
    "promise",
    "war",
    "empire",
    "fear",
    "pain",
    "broken",
    "trust",
  ];
  for (const w of drama) {
    if (q.includes(w)) {
      s += 2;
    }
  }
  if (row.interactionType.includes("First encounter")) {
    s += 12;
  }
  if (row.interactionType.includes("Kill")) {
    s += 10;
  }
  if (row.interactionType.includes("Soul fragment")) {
    s += 9;
  }
  if (row.interactionType.includes("Taunt")) {
    s += 7;
  }
  if (row.interactionType.includes("First move")) {
    s += 6;
  }
  if (q.length > 90) {
    s += 3;
  } else if (q.length > 45) {
    s += 1;
  }
  if (row.isSkinContext) {
    s -= 18;
  }
  if (row.interactionType.startsWith("Special")) {
    s += 1;
  }
  return s;
}

function scoreForFocus(
  row: WikiVoiceInteraction,
  focusPrimary: string,
  focusSecondary: string | undefined,
): number {
  let s = scoreInteractionForShortFormContent(row);
  const pk = normalizeNameKey(focusPrimary);
  const sk = focusSecondary ? normalizeNameKey(focusSecondary) : "";
  const sp = normalizeNameKey(row.speaker);
  const tg = normalizeNameKey(row.target);

  if (sk) {
    if ((sp === pk && tg === sk) || (sp === sk && tg === pk)) {
      s += 40;
    } else if (sp === pk || tg === pk || sp === sk || tg === sk) {
      s += 12;
    }
  } else {
    if (sp === pk || tg === pk) {
      s += 18;
    }
  }
  return s;
}

function rowInvolvesChampion(row: WikiVoiceInteraction, name: string): boolean {
  const k = normalizeNameKey(name);
  return normalizeNameKey(row.speaker) === k || normalizeNameKey(row.target) === k;
}

function rowMatchesPair(row: WikiVoiceInteraction, a: string, b: string): boolean {
  const ak = normalizeNameKey(a);
  const bk = normalizeNameKey(b);
  const sp = normalizeNameKey(row.speaker);
  const tg = normalizeNameKey(row.target);
  return (sp === ak && tg === bk) || (sp === bk && tg === ak);
}

/** True if raw wikitext references this champion in a {{ci|…}} template (common reverse-line signal). */
export function wikitextReferencesChampionCi(wikitext: string, primaryKey: string, primaryName: string): boolean {
  const variants = [
    `{{ci|${primaryKey}}`,
    `{{ci|${primaryName}}`,
    `{{ci|${primaryKey.replace(/_/g, " ")}}`,
  ];
  const low = wikitext.toLowerCase();
  return variants.some((v) => low.includes(v.toLowerCase()));
}

export type FindVoiceLineOptions = {
  /** Primary champion display name (e.g. "Jinx", "jarvan iv"). */
  primaryDisplay: string;
  /** Optional second champion when the user names a pair. */
  secondaryDisplay?: string;
};

export type FindVoiceLineResult = {
  selected: WikiVoiceInteraction;
  candidatesConsidered: number;
};

/**
 * Locates a written champion-to-champion interaction from Fandom Champion/LoL/Audio pages listed in
 * Category:LoL_Champion_audio, including reverse lookups via related champions' pages.
 */
export async function findWrittenChampionInteractions(opts: FindVoiceLineOptions): Promise<FindVoiceLineResult | null> {
  if (process.env.LOL_WIKI_FETCH === "0") {
    return null;
  }

  const primaryKey = toWikiChampionKey(opts.primaryDisplay);
  if (!primaryKey) {
    return null;
  }

  const secondaryKey = opts.secondaryDisplay?.trim() ? toWikiChampionKey(opts.secondaryDisplay) : undefined;
  const primaryName = primaryKey.replace(/_/g, " ");
  const secondaryName = secondaryKey?.replace(/_/g, " ");

  let allTitles: string[] = [];
  try {
    allTitles = await extractChampionAudioPageLinksFromCategory();
  } catch {
    allTitles = [];
  }

  const primaryTitle = championKeyToLoLAudioPageTitle(primaryKey);
  const titleSet = new Set(allTitles.map((t) => t.toLowerCase()));

  const wikitextPrimary = await getChampionLoLAudioWikitext(primaryTitle);
  if (!wikitextPrimary) {
    return null;
  }

  const rowsPrimary = parseWikiVoiceInteractions(wikitextPrimary, primaryTitle);

  const relatedTitles = new Set<string>();
  if (secondaryKey) {
    relatedTitles.add(championKeyToLoLAudioPageTitle(secondaryKey));
  }
  for (const r of rowsPrimary) {
    const tk = toWikiChampionKey(r.target);
    const tTitle = championKeyToLoLAudioPageTitle(tk);
    if (titleSet.has(tTitle.toLowerCase())) {
      relatedTitles.add(tTitle);
    }
  }

  const MAX_RELATED = 22;
  const relatedList = [...relatedTitles].filter((t) => t.toLowerCase() !== primaryTitle.toLowerCase()).slice(0, MAX_RELATED);

  const batchTexts = relatedList.length ? await fetchWikitextBatch(relatedList) : new Map<string, string | null>();

  let merged: WikiVoiceInteraction[] = [...rowsPrimary];
  for (const t of relatedList) {
    const wt = batchTexts.get(t);
    if (wt) {
      merged.push(...parseWikiVoiceInteractions(wt, t));
    }
  }

  merged = dedupeInteractions(merged);

  if (!secondaryName && allTitles.length > 0) {
    const primaryHits = merged.filter((r) => rowInvolvesChampion(r, primaryName));
    if (primaryHits.length < 12) {
      const sorted = [...allTitles].sort((a, b) => a.localeCompare(b));
      let h = 0;
      for (let i = 0; i < primaryName.length; i++) {
        h = (h + primaryName.charCodeAt(i) * (i + 1)) % 997;
      }
      const offset = sorted.length ? h % sorted.length : 0;
      const skip = new Set<string>([primaryTitle.toLowerCase(), ...relatedList.map((x) => x.toLowerCase())]);
      const probe: string[] = [];
      for (let i = 0; i < sorted.length && probe.length < 20; i++) {
        const t = sorted[(offset + i) % sorted.length]!;
        const tl = t.toLowerCase();
        if (!skip.has(tl)) {
          skip.add(tl);
          probe.push(t);
        }
      }
      const probeTexts = probe.length ? await fetchWikitextBatch(probe) : new Map<string, string | null>();
      for (const t of probe) {
        const wt = probeTexts.get(t);
        if (!wt) {
          continue;
        }
        if (!wikitextReferencesChampionCi(wt, primaryKey, primaryName)) {
          continue;
        }
        merged.push(...parseWikiVoiceInteractions(wt, t));
      }
      merged = dedupeInteractions(merged);
    }
  }

  let pool = merged.filter((r) => rowInvolvesChampion(r, primaryName));
  if (secondaryName) {
    const pairOnly = pool.filter((r) => rowMatchesPair(r, primaryName, secondaryName));
    if (pairOnly.length) {
      pool = pairOnly;
    } else {
      pool = pool.filter((r) => rowInvolvesChampion(r, secondaryName));
    }
  }

  pool = pool.filter((r) => r.quote.length >= 8 && r.target.length >= 2 && r.speaker.length >= 2);

  if (!pool.length) {
    return null;
  }

  const scored = pool
    .map((r) => ({ r, s: scoreForFocus(r, primaryName, secondaryName) }))
    .sort((a, b) => b.s - a.s);

  const best = scored[0]?.r;
  if (!best) {
    return null;
  }

  return { selected: best, candidatesConsidered: pool.length };
}

/** Same parser as parseWikiVoiceInteractions — explicit name for written lines only. */
export { parseWikiVoiceInteractions as extractChampionToChampionInteractionsFromWikitext };

/** @deprecated Prefer findWrittenChampionInteractions. */
export const findChampionVoiceLineInteraction = findWrittenChampionInteractions;
