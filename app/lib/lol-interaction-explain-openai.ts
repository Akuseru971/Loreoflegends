/**
 * POST /api/interactions/explain — cross-source lore + timed short-form script (strict JSON).
 */

import OpenAI from "openai";
import {
  callOpenAiWithSchema,
  countWords,
  quoteAnchorsScript,
  scriptOpensWithWhenPattern,
} from "@/app/lib/lol-openai-expansion";
import type { GatheredResearchSource } from "@/app/lib/lol-interaction-research-fetch";
import { parseOpenAiJsonContent } from "@/app/lib/lol-interaction-explainer";

const LOG = "[lol-interaction-explain]";

const SOURCE_TYPE_ENUM = ["official_riot", "fandom", "cinematic", "short_story", "champion_bio"] as const;

const TIMED_ENUM = ["0-3s", "7s", "14s", "21s", "28s", "35s", "42s", "50s"] as const;

export const INTERACTION_EXPLAIN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["interaction", "research", "script"],
  properties: {
    interaction: {
      type: "object",
      additionalProperties: false,
      required: ["speaker", "target", "quote", "interactionType", "sourceUrl"],
      properties: {
        speaker: { type: "string" },
        target: { type: "string" },
        quote: { type: "string" },
        interactionType: { type: "string" },
        sourceUrl: { type: "string" },
      },
    },
    research: {
      type: "object",
      additionalProperties: false,
      required: [
        "officialCanonFacts",
        "fandomContext",
        "whatTheLineMeans",
        "whatTheLineSuggests",
        "notConfirmed",
        "sourcesUsed",
      ],
      properties: {
        officialCanonFacts: { type: "array", items: { type: "string" } },
        fandomContext: { type: "array", items: { type: "string" } },
        whatTheLineMeans: { type: "array", items: { type: "string" } },
        whatTheLineSuggests: { type: "array", items: { type: "string" } },
        notConfirmed: { type: "array", items: { type: "string" } },
        sourcesUsed: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "url", "type"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              type: { type: "string", enum: [...SOURCE_TYPE_ENUM] },
            },
          },
        },
      },
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["title", "hook", "fullScript", "timedStructure", "caption", "hashtags"],
      properties: {
        title: { type: "string" },
        hook: { type: "string" },
        fullScript: { type: "string" },
        timedStructure: {
          type: "array",
          minItems: 8,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["time", "purpose", "text"],
            properties: {
              time: { type: "string", enum: [...TIMED_ENUM] },
              purpose: { type: "string" },
              text: { type: "string" },
            },
          },
        },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export type InteractionExplainInput = {
  speaker: string;
  target: string;
  quote: string;
  interactionType: string;
  section: string;
  sourceUrl: string;
  isSkinContext: boolean;
};

export type InteractionExplainApiResponse = {
  interaction: {
    speaker: string;
    target: string;
    quote: string;
    interactionType: string;
    sourceUrl: string;
  };
  research: {
    officialCanonFacts: string[];
    fandomContext: string[];
    whatTheLineMeans: string[];
    whatTheLineSuggests: string[];
    notConfirmed: string[];
    sourcesUsed: Array<{ title: string; url: string; type: (typeof SOURCE_TYPE_ENUM)[number] }>;
  };
  script: {
    title: string;
    hook: string;
    fullScript: string;
    timedStructure: Array<{ time: string; purpose: string; text: string }>;
    caption: string;
    hashtags: string[];
  };
  error?: string;
};

function log(stage: string, detail: Record<string, unknown>): void {
  console.info(`${LOG} ${stage}`, detail);
}

function quoteInBody(quote: string, body: string): boolean {
  const b = body.replace(/\u00a0/g, " ");
  const q = quote.replace(/\u00a0/g, " ");
  if (b.includes(q)) {
    return true;
  }
  return b.replace(/\s+/g, " ").includes(q.replace(/\s+/g, " "));
}

function mergeSourcesUsed(
  modelRows: InteractionExplainApiResponse["research"]["sourcesUsed"],
  fetched: GatheredResearchSource[],
): InteractionExplainApiResponse["research"]["sourcesUsed"] {
  const seen = new Set<string>();
  const out: InteractionExplainApiResponse["research"]["sourcesUsed"] = [];
  for (const r of modelRows) {
    const k = `${r.url}|${r.title}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  for (const f of fetched) {
    const k = `${f.url}|${f.title}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    const t = SOURCE_TYPE_ENUM.includes(f.type as (typeof SOURCE_TYPE_ENUM)[number]) ? f.type : "fandom";
    out.push({
      title: f.title,
      url: f.url,
      type: t as (typeof SOURCE_TYPE_ENUM)[number],
    });
  }
  return out;
}

function buildExplainPrompt(input: InteractionExplainInput, researchBlock: string): string {
  return `You are a League of Legends canon lore researcher and short-form scriptwriter.

You are given a verified written champion interaction extracted from a Fandom champion audio page.

Your task is to explain the lore behind this interaction by cross-referencing:
- the official Riot biography of the speaker;
- the official Riot biography of the target;
- official Riot short stories related to both champions;
- official Riot cinematics or narrative events if available (only if present in excerpts);
- Fandom pages for both champions;
- the Fandom audio page where the quote was found.

Rules:
- Do not invent lore.
- Do not invent motivations.
- Do not rewrite the quote.
- Do not present theories as facts.
- Prioritize Riot official sources over Fandom.
- Use Fandom as secondary context only.
- Clearly separate confirmed canon facts from interpretation.
- If something is not officially confirmed, say so clearly (you may include the exact sentence: "This is not officially confirmed in canon." when appropriate).
- The final script must be based on the exact quote and must be in English.
- If an excerpt block says FAILED_OR_EMPTY, do not fabricate content for that URL; mention the gap in notConfirmed or sourcesUsed notes implicitly via notConfirmed.

Interaction:
Speaker: ${input.speaker}
Target: ${input.target}
Quote: ${input.quote}
Interaction type: ${input.interactionType}
Wiki section: ${input.section}
Source URL: ${input.sourceUrl}
Skin-specific VO context: ${input.isSkinContext ? "yes — label skin VO clearly where relevant" : "no"}

Provided research excerpts (server-fetched HTML text only; you are not browsing):
${researchBlock}

Return JSON only with:
- interaction (must echo the same speaker, target, quote, interactionType, sourceUrl as above)
- research (officialCanonFacts, fandomContext, whatTheLineMeans, whatTheLineSuggests, notConfirmed, sourcesUsed)
- script (English; fullScript must include beat markers on their own lines: [0-3s], [7s], [14s], [21s], [28s], [35s], [42s], [50s] before each timed segment's prose in fullScript OR keep fullScript as continuous prose that still reflects those beats — timedStructure must mirror the beats)

The script must start with exactly this pattern (straight double quotes around the quote):
When ${input.speaker} says "${input.quote}" to ${input.target}, ...

timedStructure must contain exactly 8 objects with these time values once each: 0-3s, 7s, 14s, 21s, 28s, 35s, 42s, 50s.

Do not use generic filler. Every segment must add tension, canon, or clarification.`;
}

export async function runInteractionExplainWithOpenAI(
  openai: OpenAI,
  input: InteractionExplainInput,
  fetchedSources: GatheredResearchSource[],
): Promise<InteractionExplainApiResponse> {
  const researchBlock =
    fetchedSources.length > 0 ?
      fetchedSources.map((s) => formatSourceBlock(s)).join("\n\n---\n\n")
    : "(No server-side excerpts could be fetched — state this clearly in notConfirmed and keep facts minimal.)";

  const user = buildExplainPrompt(input, researchBlock);

  log("openai_request", {
    speaker: input.speaker,
    target: input.target,
    quoteLen: input.quote.length,
    excerptBlocks: fetchedSources.length,
  });

  const raw = await callOpenAiWithSchema(openai, {
    system:
      "You output only valid JSON matching the schema. You never invent voice lines. You never claim a fetch succeeded when the excerpt says FAILED_OR_EMPTY.",
    user,
    schemaName: "lol_interaction_explain_v2",
    schema: INTERACTION_EXPLAIN_SCHEMA,
    temperature: 0.35,
  });

  if (process.env.NODE_ENV === "development") {
    log("openai_raw_preview", { len: raw.length, preview: raw.slice(0, 2500) });
  }

  const parsed = parseOpenAiJsonContent(raw);
  if (!parsed.ok) {
    return buildErrorResponse(input, `Model JSON parse error: ${parsed.error}`);
  }

  const v = parsed.value;
  if (!v || typeof v !== "object") {
    return buildErrorResponse(input, "Model returned empty object.");
  }

  const root = v as Record<string, unknown>;
  const research = root.research as Record<string, unknown> | undefined;
  const script = root.script as Record<string, unknown> | undefined;
  if (!research || !script) {
    return buildErrorResponse(input, "Model response missing research or script.");
  }

  const timed = script.timedStructure;
  if (!Array.isArray(timed) || timed.length !== 8) {
    return buildErrorResponse(input, "timedStructure must have exactly 8 entries.");
  }
  const times = new Set<string>();
  for (const row of timed) {
    if (!row || typeof row !== "object") {
      return buildErrorResponse(input, "Invalid timedStructure row.");
    }
    const t = (row as Record<string, unknown>).time;
    if (typeof t !== "string" || !TIMED_ENUM.includes(t as (typeof TIMED_ENUM)[number])) {
      return buildErrorResponse(input, "Invalid timedStructure.time value.");
    }
    times.add(t);
  }
  if (times.size !== 8) {
    return buildErrorResponse(input, "timedStructure must include each beat exactly once.");
  }

  const fullScript = typeof script.fullScript === "string" ? script.fullScript.trim() : "";
  if (!fullScript || !quoteInBody(input.quote, fullScript)) {
    return buildErrorResponse(input, "Script must include the exact quote as a substring.");
  }
  if (!scriptOpensWithWhenPattern(fullScript, input.speaker, input.quote, input.target)) {
    return buildErrorResponse(input, "Script must open with: When [speaker] says \"[quote]\" to [target], ...");
  }
  if (!quoteAnchorsScript(input.quote, fullScript)) {
    return buildErrorResponse(input, "Script does not stay anchored closely enough to the quote.");
  }

  const wc = countWords(fullScript);
  if (wc < 115 || wc > 185) {
    log("word_count_note", { words: wc, hint: "Target ~45-60s narration" });
  }

  const modelSources = ensureSourcesUsed(research.sourcesUsed);
  const mergedSources = mergeSourcesUsed(modelSources, fetchedSources);

  const out: InteractionExplainApiResponse = {
    interaction: {
      speaker: input.speaker,
      target: input.target,
      quote: input.quote,
      interactionType: input.interactionType,
      sourceUrl: input.sourceUrl,
    },
    research: {
      officialCanonFacts: ensureStrArr(research.officialCanonFacts),
      fandomContext: ensureStrArr(research.fandomContext),
      whatTheLineMeans: ensureStrArr(research.whatTheLineMeans),
      whatTheLineSuggests: ensureStrArr(research.whatTheLineSuggests),
      notConfirmed: ensureStrArr(research.notConfirmed),
      sourcesUsed: mergedSources,
    },
    script: {
      title: typeof script.title === "string" ? script.title : "Interaction breakdown",
      hook: typeof script.hook === "string" ? script.hook : "",
      fullScript,
      timedStructure: timed.map((row) => {
        const o = row as Record<string, unknown>;
        return {
          time: String(o.time ?? ""),
          purpose: String(o.purpose ?? ""),
          text: String(o.text ?? ""),
        };
      }),
      caption: typeof script.caption === "string" ? script.caption : "",
      hashtags: ensureStrArr(script.hashtags),
    },
  };

  log("ok", { words: wc, sourcesUsed: out.research.sourcesUsed.length });
  return out;
}

function formatSourceBlock(s: GatheredResearchSource): string {
  const status = s.ok ? "OK" : "FAILED_OR_EMPTY";
  return `=== ${s.title} ===
URL: ${s.url}
TYPE: ${s.type}
FETCH: ${status}${s.note ? ` (${s.note})` : ""}

${s.ok ? s.excerpt : "(No usable excerpt.)"}`;
}

function ensureStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map((x) => (typeof x === "string" ? x.trim() : String(x ?? ""))).filter(Boolean);
}

function ensureSourcesUsed(v: unknown): InteractionExplainApiResponse["research"]["sourcesUsed"] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: InteractionExplainApiResponse["research"]["sourcesUsed"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const type = o.type;
    const t =
      typeof type === "string" && SOURCE_TYPE_ENUM.includes(type as (typeof SOURCE_TYPE_ENUM)[number]) ?
        (type as (typeof SOURCE_TYPE_ENUM)[number])
      : "fandom";
    out.push({
      title: typeof o.title === "string" ? o.title : "",
      url: typeof o.url === "string" ? o.url : "",
      type: t,
    });
  }
  return out.filter((r) => r.url);
}

function buildErrorResponse(input: InteractionExplainInput, message: string): InteractionExplainApiResponse {
  log("error_response", { message });
  return {
    interaction: {
      speaker: input.speaker,
      target: input.target,
      quote: input.quote,
      interactionType: input.interactionType,
      sourceUrl: input.sourceUrl,
    },
    research: {
      officialCanonFacts: [],
      fandomContext: [],
      whatTheLineMeans: [],
      whatTheLineSuggests: [],
      notConfirmed: [message, "This is not officially confirmed in canon."],
      sourcesUsed: [],
    },
    script: {
      title: "Explanation unavailable",
      hook: "",
      fullScript: "",
      timedStructure: TIMED_ENUM.map((time) => ({
        time,
        purpose: "—",
        text: time === "0-3s" ? message : "",
      })),
      caption: "",
      hashtags: [],
    },
    error: message,
  };
}
