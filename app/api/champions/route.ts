import { NextResponse } from "next/server";
import { getChampionListForApi } from "@/app/lib/fandom-champion-interaction-service";
import { LOL_WIKI_AUDIO_CATEGORY_URL } from "@/app/lib/lol-wiki-audio";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getChampionListForApi();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/champions]", error);
    return NextResponse.json(
      {
        error: "Failed to load the Fandom champion audio category. Try again later.",
        champions: [] as { name: string; slug: string; audioPageUrl: string }[],
        count: 0,
        sourceCategory: LOL_WIKI_AUDIO_CATEGORY_URL,
      },
      { status: 502 },
    );
  }
}
