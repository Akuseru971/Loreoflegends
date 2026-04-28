import { NextResponse } from "next/server";
import { createVideo, listVideos } from "@/lib/services/database";
import { newVideoSchema } from "@/lib/types";

export async function GET() {
  const videos = await listVideos();
  return NextResponse.json({ videos });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = newVideoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const video = await createVideo(parsed.data);
  return NextResponse.json(video, { status: 201 });
}
