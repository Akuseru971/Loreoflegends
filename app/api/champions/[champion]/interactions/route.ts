import { NextRequest, NextResponse } from "next/server";
import { runFindChampionInteractionsPipeline } from "@/app/lib/find-champion-interactions-pipeline";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ champion: string }> }) {
  const { champion } = await context.params;
  if (!champion?.trim()) {
    return NextResponse.json({ error: "Missing champion parameter." }, { status: 400 });
  }
  try {
    const data = await runFindChampionInteractionsPipeline(champion);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/champions/.../interactions]", error);
    return NextResponse.json(
      { error: "Failed to load written interactions from Fandom. The wiki may be slow or unreachable." },
      { status: 502 },
    );
  }
}
