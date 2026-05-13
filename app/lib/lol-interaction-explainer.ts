/**
 * Shared contract for POST /api/generate-lol-lore — used by API route and client UI.
 */

export type LoLCanonStatus = "verified" | "partially_verified" | "unconfirmed" | "verified_voice_line";

export type LoLInteractionExplainerResponse = {
  interaction: {
    speaker: string;
    target: string;
    quote: string;
    sourceType: string;
    sourceReference: string;
    interactionType: string;
    canonStatus: LoLCanonStatus;
  };
  canonResearch: {
    confirmedFacts: string[];
    lineSuggests: string[];
    notConfirmed: string[];
  };
  script: {
    title: string;
    hook: string;
    fullScript: string;
    caption: string;
    hashtags: string[];
  };
  metadata: {
    language: string;
    durationTarget: string;
    formatVersion: string;
    sourceCategory: string;
  };
};

export const LOL_INTERACTION_FORMAT_VERSION = "1.0";

/** Shown when no champion-to-champion line could be read from Fandom /Audio pages. */
export const NO_VERIFIED_VOICE_LINE_MESSAGE =
  "No verified voice line interaction was found from the champion audio pages.";

/** OpenAI `json_schema.schema` value (strict mode: every key listed in `required`). */
export const OPENAI_LOL_INTERACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["interaction", "canonResearch", "script", "metadata"],
  properties: {
    interaction: {
      type: "object",
      additionalProperties: false,
      required: ["speaker", "target", "quote", "sourceType", "sourceReference", "interactionType", "canonStatus"],
      properties: {
        speaker: { type: "string" },
        target: { type: "string" },
        quote: { type: "string" },
        sourceType: { type: "string" },
        sourceReference: { type: "string" },
        interactionType: { type: "string" },
        canonStatus: {
          type: "string",
          enum: ["verified", "partially_verified", "unconfirmed", "verified_voice_line"],
        },
      },
    },
    canonResearch: {
      type: "object",
      additionalProperties: false,
      required: ["confirmedFacts", "lineSuggests", "notConfirmed"],
      properties: {
        confirmedFacts: {
          type: "array",
          items: { type: "string" },
        },
        lineSuggests: {
          type: "array",
          items: { type: "string" },
        },
        notConfirmed: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    script: {
      type: "object",
      additionalProperties: false,
      required: ["title", "hook", "fullScript", "caption", "hashtags"],
      properties: {
        title: { type: "string" },
        hook: { type: "string" },
        fullScript: { type: "string" },
        caption: { type: "string" },
        hashtags: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: ["language", "durationTarget", "formatVersion", "sourceCategory"],
      properties: {
        language: { type: "string" },
        durationTarget: { type: "string" },
        formatVersion: { type: "string" },
        sourceCategory: { type: "string" },
      },
    },
  },
} as const;

const CANON_STATUSES: LoLCanonStatus[] = ["verified", "partially_verified", "unconfirmed", "verified_voice_line"];

function ensureString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item : String(item ?? ""))).filter(Boolean);
}

function ensureCanonStatus(value: unknown): LoLCanonStatus {
  return typeof value === "string" && CANON_STATUSES.includes(value as LoLCanonStatus)
    ? (value as LoLCanonStatus)
    : "unconfirmed";
}

const WIKI_AUDIO_CATEGORY_URL = "https://wiki.leagueoflegends.com/en-us/Category:LoL_Champion_audio";

export function failureLoLInteractionResponse(overrides?: {
  notConfirmed?: string[];
  title?: string;
  language?: string;
  durationTarget?: string;
}): LoLInteractionExplainerResponse {
  return {
    interaction: {
      speaker: "",
      target: "",
      quote: "",
      sourceType: "League of Legends champion audio page",
      sourceReference: WIKI_AUDIO_CATEGORY_URL,
      interactionType: "",
      canonStatus: "unconfirmed",
    },
    canonResearch: {
      confirmedFacts: [],
      lineSuggests: [],
      notConfirmed:
        overrides?.notConfirmed?.length ?
          overrides.notConfirmed
        : [NO_VERIFIED_VOICE_LINE_MESSAGE],
    },
    script: {
      title: overrides?.title ?? "No verified voice line found",
      hook: "",
      fullScript: "",
      caption: "",
      hashtags: [],
    },
    metadata: {
      language: overrides?.language ?? "en",
      durationTarget: overrides?.durationTarget ?? "45-60s",
      formatVersion: LOL_INTERACTION_FORMAT_VERSION,
      sourceCategory: WIKI_AUDIO_CATEGORY_URL,
    },
  };
}

export type NormalizeDefaults = {
  language: string;
  durationTarget: string;
};

/**
 * Coerces any parsed JSON into the contract. Never throws.
 */
export function normalizeLoLInteractionResponse(
  input: unknown,
  defaults: NormalizeDefaults,
): LoLInteractionExplainerResponse {
  const base = failureLoLInteractionResponse({
    notConfirmed: ["Response was normalized due to missing or invalid fields."],
    language: defaults.language,
    durationTarget: defaults.durationTarget,
  });

  if (!input || typeof input !== "object") {
    return base;
  }

  const root = input as Record<string, unknown>;
  const interaction = root.interaction && typeof root.interaction === "object" ? (root.interaction as Record<string, unknown>) : {};
  const canonResearch =
    root.canonResearch && typeof root.canonResearch === "object" ? (root.canonResearch as Record<string, unknown>) : {};
  const script = root.script && typeof root.script === "object" ? (root.script as Record<string, unknown>) : {};
  const metadata = root.metadata && typeof root.metadata === "object" ? (root.metadata as Record<string, unknown>) : {};

  return {
    interaction: {
      speaker: ensureString(interaction.speaker),
      target: ensureString(interaction.target),
      quote: ensureString(interaction.quote),
      sourceType: ensureString(interaction.sourceType),
      sourceReference: ensureString(interaction.sourceReference),
      interactionType: ensureString(interaction.interactionType),
      canonStatus: ensureCanonStatus(interaction.canonStatus),
    },
    canonResearch: {
      confirmedFacts: ensureStringArray(canonResearch.confirmedFacts),
      lineSuggests: ensureStringArray(canonResearch.lineSuggests),
      notConfirmed: ensureStringArray(canonResearch.notConfirmed),
    },
    script: {
      title: ensureString(script.title, base.script.title),
      hook: ensureString(script.hook),
      fullScript: ensureString(script.fullScript),
      caption: ensureString(script.caption),
      hashtags: ensureStringArray(script.hashtags),
    },
    metadata: {
      language: ensureString(metadata.language, defaults.language) || defaults.language,
      durationTarget: ensureString(metadata.durationTarget, defaults.durationTarget) || defaults.durationTarget,
      formatVersion: ensureString(metadata.formatVersion, LOL_INTERACTION_FORMAT_VERSION) || LOL_INTERACTION_FORMAT_VERSION,
      sourceCategory: ensureString(metadata.sourceCategory, WIKI_AUDIO_CATEGORY_URL) || WIKI_AUDIO_CATEGORY_URL,
    },
  };
}

/** Strip ```json fences and extract first JSON object if needed. */
export function parseOpenAiJsonContent(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let s = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(s);
  if (fenced) {
    s = fenced[1].trim();
  }

  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (firstError) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(s.slice(start, end + 1)) };
      } catch {
        /* fall through */
      }
    }
    return {
      ok: false,
      error: firstError instanceof Error ? firstError.message : "JSON.parse failed",
    };
  }
}

export function devLoreLog(label: string, data: unknown) {
  if (process.env.NODE_ENV === "development") {
    const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    console.log(`[generate-lol-lore] ${label}`, payload);
  }
}

export function uiLanguageToMetadataCode(label: string): string {
  if (label === "French") {
    return "fr";
  }
  if (label === "Spanish") {
    return "es";
  }
  return "en";
}

export function sourceCategoryToSourceTypeLabel(category: string): string {
  switch (category) {
    case "league_base_special":
      return "League of Legends — base / special in-game champion interaction";
    case "league_skin":
      return "League of Legends — skin voice line";
    case "cinematic_or_story":
      return "Official Riot cinematic or Universe story dialogue";
    case "lor":
      return "Legends of Runeterra";
    case "wild_rift":
      return "Wild Rift";
    case "old_removed":
      return "Old / removed or legacy voice content (labeled)";
    default:
      return "Unknown — verify manually";
  }
}
