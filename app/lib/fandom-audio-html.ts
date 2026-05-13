/**
 * Parse rendered Fandom HTML (MediaWiki action=parse) for written champion lines.
 * Ignores <audio>, <source>, and play buttons — only visible <i> dialogue and data-champion targets.
 */

import * as cheerio from "cheerio";
import type { WikiVoiceInteraction } from "@/app/lib/lol-wiki-audio";
import { pageSpeakerFromTitle, wikiFandomArticleUrl } from "@/app/lib/lol-wiki-audio";

const WIKI_API = "https://leagueoflegends.fandom.com/api.php";
const USER_AGENT =
  "Mozilla/5.0 (compatible; LoreoflegendsInteractionExplainer/1.0; +https://github.com/Akuseru971/Loreoflegends; Fandom parse read-only)";

export async function fetchFandomParsedHtml(pageTitle: string): Promise<string | null> {
  try {
    const url = new URL(WIKI_API);
    url.searchParams.set("action", "parse");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("page", pageTitle);
    url.searchParams.set("prop", "text");
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(25_000),
      next: { revalidate: 86_400 },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      parse?: { text?: string | { "*": string } };
    };
    const raw = data.parse?.text;
    const html =
      typeof raw === "string" ? raw
      : raw && typeof raw === "object" && "*" in raw ? (raw as { "*": string })["*"]
      : null;
    return typeof html === "string" && html.length > 0 ? html : null;
  } catch {
    return null;
  }
}

function normSpeaker(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractQuoteFromItalicText(raw: string): string | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  if (t.length < 6) {
    return null;
  }
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 8) {
    return t.slice(1, -1).trim();
  }
  if (t.startsWith('"') && !t.endsWith('"')) {
    return t.slice(1).trim();
  }
  return t;
}

function deriveInteractionLabelFromDt(plainDt: string): string {
  const s = plainDt.toLowerCase();
  if (s.includes("first encounter")) {
    return "First Encounter";
  }
  if (s.includes("upon first encountering")) {
    return "Upon first encountering";
  }
  if (s.includes("taunt response")) {
    return "Taunt response";
  }
  if (s.includes("taunt")) {
    return "Taunt";
  }
  if (s.includes("joke response")) {
    return "Joke response";
  }
  if (s.includes("joke")) {
    return "Joke";
  }
  if (s.includes("killing")) {
    return "Kill line";
  }
  if (s.includes("attack")) {
    return "Attack";
  }
  if (s.includes("champion select") || s.includes("pick")) {
    return "Champion select";
  }
  if (s.includes("first move")) {
    return "First move";
  }
  return plainDt.replace(/\s+/g, " ").trim().slice(0, 80) || "Special interaction";
}

function targetChampionFromDt($: cheerio.CheerioAPI, $dt: cheerio.Cheerio<any>, pageSpeaker: string): string | null {
  const sp = normSpeaker(pageSpeaker);
  const candidates: string[] = [];
  $dt.find("[data-champion]").each((_, el) => {
    const c = $(el).attr("data-champion")?.trim();
    if (!c) {
      return;
    }
    if (normSpeaker(c.replace(/_/g, " ")) === sp) {
      return;
    }
    candidates.push(c.replace(/_/g, " "));
  });
  if (candidates.length) {
    return candidates[0]!;
  }
  const plain = $dt.text().replace(/\s+/g, " ").trim();
  const withM = plain.match(/(?:with|to)\s+([A-Za-z][A-Za-z'’\s-]{1,40})(?:\s*$|[,.])/i);
  if (withM) {
    return withM[1]!.replace(/\s+/g, " ").trim();
  }
  return null;
}

/**
 * Extract champion-directed lines from Fandom parse HTML (mw-parser-output).
 */
export function extractWrittenInteractionsFromParsedHtml(html: string, pageTitle: string): WikiVoiceInteraction[] {
  const $ = cheerio.load(html);
  const root = $(".mw-parser-output").first();
  if (!root.length) {
    return [];
  }

  const speaker = pageSpeakerFromTitle(pageTitle);
  const sourceUrl = wikiFandomArticleUrl(pageTitle);
  const out: WikiVoiceInteraction[] = [];

  root.find("dl").each((_, dlEl) => {
    const $dl = $(dlEl);
    const $dt = $dl.children("dt").first();
    if (!$dt.length) {
      return;
    }

    const $h2 = $dl.prevAll("h2").first();
    const section =
      $h2.length ?
        ($h2.find(".mw-headline").first().text().trim() || $h2.text().replace(/\[.*?\]/g, "").trim())
      : "Intro";

    const plainDt = $dt.text().replace(/\s+/g, " ").trim();
    const target = targetChampionFromDt($, $dt, speaker);
    if (!target) {
      return;
    }

    const interactionType = deriveInteractionLabelFromDt(plainDt);
    const headerLine = plainDt.slice(0, 300);

    const $ul = $dl.next("ul");
    if (!$ul.length) {
      return;
    }

    $ul.children("li").each((_, liEl) => {
      const $li = $(liEl);
      const $work = $li.clone();
      $work.find("audio, source, .ext-audiobutton, sup, .skin-play-button, .navbox, .mw-editsection").remove();

      const quotes: string[] = [];
      $work.find("i").each((__, iEl) => {
        const raw = $(iEl).text();
        const q = extractQuoteFromItalicText(raw);
        if (q && q.length >= 6 && /[A-Za-zÀ-ÿ]/.test(q) && !q.toLowerCase().includes("click here")) {
          quotes.push(q);
        }
      });

      for (const quote of quotes) {
        const skin = /\bprestige\b|\bproject\b|\bstar guardian\b/i.test(plainDt + quote);
        out.push({
          speaker,
          target,
          quote,
          interactionType,
          wikiSection: section,
          wikiPageTitle: pageTitle,
          sourceUrl,
          headerLine,
          isSkinContext: skin,
        });
      }
    });
  });

  return dedupeHtmlRows(out);
}

function dedupeHtmlRows(rows: WikiVoiceInteraction[]): WikiVoiceInteraction[] {
  const seen = new Set<string>();
  const out: WikiVoiceInteraction[] = [];
  for (const r of rows) {
    const k = `${normSpeaker(r.speaker)}|${normSpeaker(r.target)}|${r.quote.replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(r);
  }
  return out;
}
