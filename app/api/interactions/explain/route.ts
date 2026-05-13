import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { gatherInteractionResearchSources } from "@/app/lib/lol-interaction-research-fetch";
import { runInteractionExplainWithOpenAI, type InteractionExplainInput } from "@/app/lib/lol-interaction-explain-openai";

export const runtime = "nodejs";

type ExplainBody = {
  speaker?: string;
  target?: string;
  quote?: string;
  interactionType?: string;
  section?: string;
  sourceUrl?: string;
  isSkinContext?: boolean;
  tone?: string;
  platform?: string;
  duration?: string;
  narrativeAngle?: string;
  audienceLevel?: string;
  creatorGoal?: string;
  language?: string;
};

export async function POST(request: NextRequest) {
  let body: ExplainBody;
  try {
    body = (await request.json()) as ExplainBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const speaker = body.speaker?.trim() ?? "";
  const target = body.target?.trim() ?? "";
  const quote = body.quote?.trim() ?? "";
  const sourceUrl = body.sourceUrl?.trim() ?? "";
  const interactionType = body.interactionType?.trim() || "Written interaction";
  const section = body.section?.trim() || "";

  if (!speaker || !target || !quote || !sourceUrl) {
    return NextResponse.json(
      { error: "Missing required fields: speaker, target, quote, and sourceUrl are required." },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY on the server." }, { status: 503 });
  }

  const input: InteractionExplainInput = {
    speaker,
    target,
    quote,
    interactionType,
    section,
    sourceUrl,
    isSkinContext: !!body.isSkinContext,
  };

  console.info("[api/interactions/explain] start", {
    speaker,
    target,
    quoteLen: quote.length,
    sourceUrl,
  });

  const fetched = await gatherInteractionResearchSources(speaker, target, sourceUrl);
  console.info("[api/interactions/explain] fetched_sources", {
    count: fetched.length,
    ok: fetched.filter((s) => s.ok).length,
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await runInteractionExplainWithOpenAI(openai, input, fetched);

  const status = result.error ? 422 : 200;
  return NextResponse.json(result, { status });
}
