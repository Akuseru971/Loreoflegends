import { NextRequest, NextResponse } from "next/server";
import { runFindChampionInteractionsPipeline } from "@/app/lib/find-champion-interactions-pipeline";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ champion: string }> }) {
  const { champion } = await context.params;
  if (!champion?.trim()) {
    return NextResponse.json({ error: "Missing champion parameter." }, { status: 400 });
  }
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY on the server.",
          selectedChampion: "",
          slug: "",
          audioPageUrl: "",
          interactions: [],
          count: 0,
        },
        { status: 503 },
      );
    }
    const data = await runFindChampionInteractionsPipeline(champion);
    const status = data.error ? 422 : 200;
    return NextResponse.json(data, { status });
  } catch (error) {
    console.error("[api/champions/.../interactions]", error);
    return NextResponse.json(
      { error: "Failed to load written interactions from Fandom. The wiki may be slow or unreachable." },
      { status: 502 },
    );
  }
}
