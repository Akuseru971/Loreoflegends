import { NextResponse } from "next/server";
import { runFindChampionInteractionsPipeline } from "@/app/lib/find-champion-interactions-pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { champion?: string };
    const champion = typeof body.champion === "string" ? body.champion.trim() : "";
    if (!champion) {
      return NextResponse.json({ error: "Missing champion in JSON body.", count: 0, interactions: [] }, { status: 400 });
    }
    const data = await runFindChampionInteractionsPipeline(champion);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/find-champion-interactions]", error);
    return NextResponse.json(
      {
        error: "Pipeline failed unexpectedly.",
        selectedChampion: "",
        slug: "",
        audioPageUrl: "",
        interactions: [],
        count: 0,
      },
      { status: 502 },
    );
  }
}
