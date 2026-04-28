"use server";

import { redirect } from "next/navigation";
import { createVideo } from "@/lib/services/database";
import { newVideoSchema } from "@/lib/types";

export async function createVideoAction(formData: FormData) {
  const input = newVideoSchema.parse({
    championOrTheme: formData.get("championOrTheme"),
    durationSeconds: Number(formData.get("durationSeconds") ?? 45),
    style: formData.get("style"),
    lambVoiceId: formData.get("lambVoiceId"),
    wolfVoiceId: formData.get("wolfVoiceId"),
  });

  const video = await createVideo(input);
  redirect(`/videos/${video.id}`);
}
