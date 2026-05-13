import { NextRequest, NextResponse } from "next/server";
import { getChampionInteractionsBundle } from "@/app/lib/fandom-champion-interaction-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ champion: string }> }) {
  const { champion } = await context.params;
  if (!champion?.trim()) {
    return NextResponse.json({ error: "Missing champion parameter." }, { status: 400 });
  }
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const data = await getChampionInteractionsBundle(champion, { refresh });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/champions/.../interactions]", error);
    return NextResponse.json(
      { error: "Failed to load written interactions from Fandom. The wiki may be slow or unreachable." },
      { status: 502 },
    );
  }
}
