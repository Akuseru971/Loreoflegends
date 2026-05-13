import { NextRequest, NextResponse } from "next/server";
import { searchWrittenInteractions } from "@/app/lib/fandom-champion-interaction-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const champion = request.nextUrl.searchParams.get("champion")?.trim();
  const target = request.nextUrl.searchParams.get("target")?.trim();
  if (!champion) {
    return NextResponse.json({ error: "Query parameter \"champion\" is required." }, { status: 400 });
  }
  try {
    const interactions = await searchWrittenInteractions(champion, target || undefined);
    return NextResponse.json({
      champion,
      target: target ?? null,
      interactions,
      count: interactions.length,
    });
  } catch (error) {
    console.error("[api/interactions/search]", error);
    return NextResponse.json({ error: "Search failed.", interactions: [], count: 0 }, { status: 502 });
  }
}
