import { runVideoPipeline } from "@/lib/services/video-pipeline";

async function main() {
  const videoId = process.env.VIDEO_ID;

  if (!videoId) {
    throw new Error("Set VIDEO_ID to process a render job.");
  }

  await runVideoPipeline(videoId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
