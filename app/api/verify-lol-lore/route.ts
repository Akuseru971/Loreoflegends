import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const verdicts = ["LEGIT", "MOSTLY_LEGIT", "NEEDS_FIXES", "NOT_LEGIT"] as const;
const contentTypes = ["Lore Event", "Champion Lore", "Lore Fun Fact"] as const;
const languages = ["English", "French", "Spanish"] as const;
const MAX_SCRIPT_LENGTH = 7000;

type VerificationRequest = {
  script?: string;
  topic?: string;
  contentType?: string;
  language?: string;
};

type ClaimNote = {
  claim: string;
  explanation: string;
};

type ProblemClaim = {
  claim: string;
  problem: string;
  correction: string;
};

type RiskyClaim = {
  claim: string;
  risk: string;
  saferWording: string;
};

type VerificationResult = {
  verdict: (typeof verdicts)[number];
  accuracyScore: number;
  shortSummary: string;
  correctFacts: ClaimNote[];
  incorrectOrNonCanonClaims: ProblemClaim[];
  uncertainOrRiskyClaims: RiskyClaim[];
  correctedScript: string;
  summaryOfChanges: string[];
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeOption<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isClaimNoteArray(value: unknown): value is ClaimNote[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).claim === "string" &&
        typeof (item as Record<string, unknown>).explanation === "string",
    )
  );
}

function isProblemClaimArray(value: unknown): value is ProblemClaim[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).claim === "string" &&
        typeof (item as Record<string, unknown>).problem === "string" &&
        typeof (item as Record<string, unknown>).correction === "string",
    )
  );
}

function isRiskyClaimArray(value: unknown): value is RiskyClaim[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).claim === "string" &&
        typeof (item as Record<string, unknown>).risk === "string" &&
        typeof (item as Record<string, unknown>).saferWording === "string",
    )
  );
}

function validateVerificationResult(value: unknown): VerificationResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as Record<string, unknown>;
  const verdict = result.verdict;
  const accuracyScore = Number(result.accuracyScore);

  if (
    typeof verdict !== "string" ||
    !verdicts.includes(verdict as (typeof verdicts)[number]) ||
    !Number.isFinite(accuracyScore) ||
    typeof result.shortSummary !== "string" ||
    !isClaimNoteArray(result.correctFacts) ||
    !isProblemClaimArray(result.incorrectOrNonCanonClaims) ||
    !isRiskyClaimArray(result.uncertainOrRiskyClaims) ||
    typeof result.correctedScript !== "string" ||
    !isStringArray(result.summaryOfChanges)
  ) {
    return null;
  }

  return {
    verdict: verdict as VerificationResult["verdict"],
    accuracyScore: Math.min(Math.max(Math.round(accuracyScore), 0), 100),
    shortSummary: result.shortSummary,
    correctFacts: result.correctFacts,
    incorrectOrNonCanonClaims: result.incorrectOrNonCanonClaims,
    uncertainOrRiskyClaims: result.uncertainOrRiskyClaims,
    correctedScript: result.correctedScript,
    summaryOfChanges: result.summaryOfChanges,
  };
}

function buildVerificationPrompt({
  script,
  topic,
  contentType,
  language,
}: {
  script: string;
  topic: string;
  contentType: string;
  language: string;
}) {
  return `Verify and edit this short-form League of Legends lore script.

Return ONLY valid JSON. No markdown. No text outside JSON.

JSON schema:
{
  "verdict": "LEGIT" | "MOSTLY_LEGIT" | "NEEDS_FIXES" | "NOT_LEGIT",
  "accuracyScore": number,
  "shortSummary": string,
  "correctFacts": [{ "claim": string, "explanation": string }],
  "incorrectOrNonCanonClaims": [{ "claim": string, "problem": string, "correction": string }],
  "uncertainOrRiskyClaims": [{ "claim": string, "risk": string, "saferWording": string }],
  "correctedScript": string,
  "summaryOfChanges": string[]
}

Context:
- Topic: ${topic || "Not specified"}
- Content type: ${contentType}
- Language: ${language}

SCRIPT TO VERIFY:
${script}

SYSTEM LOGIC:
You are a strict League of Legends lore accuracy verifier and editor.
Your job is to verify whether this short-form League of Legends lore script is accurate to current official Riot Games canon.

Be conservative.
If something is not confirmed by official Riot lore, do not allow it as a factual claim.
If something sounds plausible but is unsupported, mark it as risky.
If something comes from old removed lore, old League institution framing, or outdated champion backgrounds, mark it as non-canon or outdated.
If something is interpretation, mark it as interpretation unless the wording is clearly speculative.

Check for:
- invented factions
- invented titles
- invented relationships
- invented causes
- invented motives
- invented powers
- wrong regions
- wrong timelines
- outdated League of Legends institution references
- unsupported emotional claims
- unsupported political consequences
- fan theories
- exaggerated claims
- confusion between old lore and current Runeterra canon

Do not rewrite everything unnecessarily.
Keep what is accurate.
Only fix what is inaccurate, risky, outdated, or misleading.

Corrected script requirements:
- Preserve the same topic.
- Keep the same language as the input: ${language}.
- Keep it voice-ready for ElevenLabs.
- Keep short sentences and strong TikTok / Shorts retention.
- Keep educational value and approximate duration.
- Replace fake lore with confirmed lore.
- If a detail cannot be verified, remove it or use safer wording.
- Do not create new claims to fill gaps.
- Do not add citations inside the narration.
- Do not add constant disclaimers like "according to Riot", "officially", or "in canon".
- Viewer-facing script should sound natural, not like a verification report.

Verdict definitions:
- LEGIT: no meaningful lore issue detected.
- MOSTLY_LEGIT: minor wording risks or small unclear claims.
- NEEDS_FIXES: several inaccurate, outdated, or unsupported claims.
- NOT_LEGIT: the script relies heavily on invented or wrong lore.

Accuracy score:
- 90-100: safe to publish.
- 75-89: mostly safe but needs minor review.
- 50-74: needs corrections before publishing.
- Below 50: not safe to publish.

Analysis requirements:
- Explain clearly what is correct.
- Explain clearly what is false, outdated, non-canon, or unsupported.
- Mark uncertain claims as risky instead of pretending they are true.
- Summary of changes should be concise and useful to a creator.

Example behavior:
If a script says "Jax belonged to the Order of the Lantern and protected the balance of magic after the Rune Wars", flag "Order of the Lantern" as non-canon, "protected the balance of magic" as unsupported, and the Rune Wars framing as incorrect for current Jax lore. Rewrite around safer confirmed elements such as Saijax Cail-Rynx Icath'un, Icathia, the Kohari, the Void, the last light of Icathia, and his search for warriors strong enough to face the Void.`;
}

async function verifyWithOpenAI(openai: OpenAI, prompt: string) {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict League of Legends lore accuracy verifier and editor. You are conservative, current-canon focused, and never invent facts.",
      },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("The model returned an empty response.");
  }

  return JSON.parse(content) as unknown;
}

export async function POST(request: NextRequest) {
  let payload: VerificationRequest;
  try {
    payload = (await request.json()) as VerificationRequest;
  } catch {
    return jsonError("Invalid request body.");
  }

  const script = payload.script?.trim() ?? "";
  const topic = payload.topic?.trim() ?? "";
  const contentType = normalizeOption(payload.contentType, contentTypes, "Champion Lore");
  const language = normalizeOption(payload.language, languages, "English");

  if (!script) {
    return jsonError("Please write or generate a script before verifying lore accuracy.");
  }

  if (script.length > MAX_SCRIPT_LENGTH) {
    return jsonError(`Script is too long to verify. Keep it under ${MAX_SCRIPT_LENGTH} characters.`);
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError("Missing OpenAI API key. Add OPENAI_API_KEY in your environment.", 500);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const prompt = buildVerificationPrompt({ script, topic, contentType, language });
    const rawResult = await verifyWithOpenAI(openai, prompt);
    const result = validateVerificationResult(rawResult);

    if (!result) {
      return jsonError("Invalid response format from the lore verifier.", 502);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return jsonError("Lore verification failed. Please try again or review the script manually.", 500);
  }
}
