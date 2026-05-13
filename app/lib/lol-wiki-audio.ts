/**
 * Fetches champion /Audio wikitext from the League of Legends Fandom wiki
 * (https://wiki.leagueoflegends.com) and extracts champion-to-champion VO snippets.
 *
 * Content is community-maintained (CC-BY-SA). We attribute in sourceReference strings.
 */

const WIKI_API = "https://wiki.leagueoflegends.com/api.php";
const USER_AGENT =
  "LoreoflegendsInteractionExplainer/1.0 (+https://github.com/Akuseru971/Loreoflegends; contact: wiki API read-only)";

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

export type WikiAudioSnippet = {
  speaker: string;
  target: string;
  quote: string;
  wikiSection: string;
  wikiPageTitle: string;
  sourceReference: string;
};

type WikiCacheEntry = { expires: number; snippets: WikiAudioSnippet[] };

const snippetCache = new Map<string, WikiCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

function toWikiChampionKey(displayOrSlug: string): string {
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

function audioPageTitle(championKey: string): string {
  return `${championKey}/Audio`;
}

async function fetchWikitextForTitle(title: string): Promise<string | null> {
  const url = new URL(WIKI_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("titles", title);
  url.searchParams.set("prop", "revisions");
  url.searchParams.set("rvprop", "content");
  url.searchParams.set("rvslots", "main");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(14_000),
    next: { revalidate: 86_400 },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    query?: { pages?: Record<string, { missing?: true; revisions?: { "*": string }[] }> };
  };
  const pages = data.query?.pages;
  if (!pages) {
    return null;
  }

  const page = Object.values(pages)[0];
  if (!page || page.missing || !page.revisions?.[0]) {
    return null;
  }

  return page.revisions[0]["*"] ?? null;
}

function extractCiTargetsFromHeaderLine(line: string, pageSpeaker: string): string[] {
  const names: string[] = [];
  const re = /\{\{ci\|([^}|]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[1].trim().replace(/_/g, " ");
    if (raw.toLowerCase() === pageSpeaker.toLowerCase()) {
      continue;
    }
    names.push(raw);
  }
  return names;
}

/** Lines that usually carry champion-specific interactions. */
function headerSupportsChampionSnippet(headerLine: string): boolean {
  const h = headerLine.toLowerCase();
  return (
    h.includes("first encounter") ||
    h.includes("taunt response to") ||
    h.includes("joke response to") ||
    h.includes("laugh response to") ||
    h.includes("first move with enemy") ||
    h.includes("killing ") ||
    h.includes("kill ") ||
    h.includes("collecting a soul fragment from") ||
    h.includes("scoring a") ||
    h.includes("assist")
  );
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

export function parseWikiAudioSnippets(wikitext: string, pageTitle: string): WikiAudioSnippet[] {
  const speakerUnderscore = pageTitle.replace(/\/Audio$/i, "");
  const speaker = speakerUnderscore.replace(/_/g, " ");
  const snippets: WikiAudioSnippet[] = [];

  let currentSection = "Intro";
  let pendingHeader: string | null = null;

  const lines = wikitext.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine;
    const sectionMatch = line.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      pendingHeader = null;
      continue;
    }

    if (/^\s*;\s/.test(line)) {
      if (headerSupportsChampionSnippet(line) && /\{\{ci\|/.test(line)) {
        pendingHeader = line.trim();
      } else {
        pendingHeader = null;
      }
      continue;
    }

    if (pendingHeader && /^\s*\*\s/.test(line) && line.includes("{{sm2")) {
      const targets = extractCiTargetsFromHeaderLine(pendingHeader, speaker);
      const quote = extractQuotedVoiceFromBullet(line);
      if (quote && targets.length > 0) {
        for (const target of targets) {
          snippets.push({
            speaker,
            target,
            quote,
            wikiSection: currentSection,
            wikiPageTitle: pageTitle,
            sourceReference: `League of Legends Wiki (Fandom) — https://wiki.leagueoflegends.com/wiki/${pageTitle.replace(/ /g, "_")} (CC-BY-SA community /Audio; verify in client)`,
          });
        }
      }
      pendingHeader = null;
    }
  }

  return snippets;
}

function sectionPriority(section: string): number {
  const s = section.toLowerCase();
  if (s.includes("first encounter")) {
    return 0;
  }
  if (s.includes("taunt")) {
    return 1;
  }
  if (s.includes("joke")) {
    return 2;
  }
  if (s.includes("kill")) {
    return 3;
  }
  if (s.includes("movement")) {
    return 4;
  }
  if (s.includes("ability")) {
    return 5;
  }
  return 10;
}

function prioritizeSnippets(snippets: WikiAudioSnippet[]): WikiAudioSnippet[] {
  return [...snippets].sort((a, b) => {
    const d = sectionPriority(a.wikiSection) - sectionPriority(b.wikiSection);
    if (d !== 0) {
      return d;
    }
    return b.quote.length - a.quote.length;
  });
}

export async function fetchChampionAudioSnippetsFromWiki(championInput: string): Promise<WikiAudioSnippet[]> {
  const key = toWikiChampionKey(championInput);
  if (!key) {
    return [];
  }

  const cacheKey = key.toLowerCase();
  const cached = snippetCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.snippets;
  }

  const title = audioPageTitle(key);
  const wikitext = await fetchWikitextForTitle(title);
  if (!wikitext) {
    snippetCache.set(cacheKey, { expires: Date.now() + 60_000, snippets: [] });
    return [];
  }

  const snippets = prioritizeSnippets(parseWikiAudioSnippets(wikitext, title));
  snippetCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, snippets });
  return snippets;
}

export function filterSnippetsByTargetHint(snippets: WikiAudioSnippet[], targetHint: string): WikiAudioSnippet[] {
  const t = targetHint.trim().toLowerCase();
  if (t.length < 2) {
    return snippets;
  }
  const filtered = snippets.filter(
    (s) =>
      s.target.toLowerCase().includes(t) ||
      t.includes(s.target.toLowerCase()) ||
      s.quote.toLowerCase().includes(t),
  );
  return filtered.length ? filtered : snippets;
}

export function formatWikiSnippetsForPrompt(snippets: WikiAudioSnippet[], maxChars: number): string {
  if (!snippets.length) {
    return "";
  }

  const lines: string[] = [];
  let size = 0;
  for (const s of snippets) {
    const row = `- [${s.speaker} → ${s.target}] (${s.wikiSection}) "${s.quote}"`;
    if (size + row.length > maxChars) {
      break;
    }
    lines.push(row);
    size += row.length + 1;
  }
  return lines.join("\n");
}
