import { NextResponse } from "next/server";
import { runVideoPipeline } from "@/lib/services/video-pipeline";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await runVideoPipeline(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run video pipeline" },
      { status: 500 },
    );
  }
}
