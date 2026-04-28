import { nanoid } from "nanoid";
import { env, hasImageSearch } from "@/lib/config";
import type { ImageCandidate, SelectedAsset, VideoScene } from "@/lib/types";

function likelyWatermarked(text: string) {
  return /watermark|shutterstock|getty|alamy|stock|depositphotos|dreamstime/i.test(text);
}

function score(candidate: ImageCandidate, subject: string) {
  const resolution = Math.min(35, Math.min(candidate.width, candidate.height) / 60);
  const crop = candidate.height >= candidate.width ? 28 : 18;
  const text = `${candidate.title} ${candidate.description ?? ""}`.toLowerCase();
  const relevance = subject
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 2 && text.includes(part)).length * 12;
  return Math.max(0, Math.min(100, Math.round(resolution + crop + relevance - (candidate.hasWatermark ? 80 : 0))));
}

async function searchCandidates(query: string): Promise<ImageCandidate[]> {
  if (!hasImageSearch) return [];
  const url = new URL(env.IMAGE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("count", "10");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.IMAGE_SEARCH_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Image search failed: ${response.status} ${await response.text()}`);

  const payload = (await response.json()) as {
    results?: Array<{ url: string; thumbnail?: string; width: number; height: number; title?: string; description?: string }>;
  };

  return (payload.results ?? []).map((item) => {
    const description = item.description ?? item.title ?? "";
    return {
      sourceUrl: item.url,
      previewUrl: item.thumbnail ?? item.url,
      width: item.width,
      height: item.height,
      title: item.title ?? "League of Legends visual",
      description,
      hasWatermark: likelyWatermarked(description),
    };
  });
}

function fallbackAsset(videoId: string, scene: VideoScene): SelectedAsset {
  const query = encodeURIComponent(`${scene.subject} League of Legends splash art`);
  return {
    id: nanoid(),
    videoId,
    sceneId: scene.id,
    sourceUrl: `https://www.google.com/search?tbm=isch&q=${query}`,
    storageUrl: `https://placehold.co/1080x1920/080b16/e0f2fe?text=${query}`,
    width: 1080,
    height: 1920,
    rankScore: 72,
    altText: `${scene.subject} League of Legends visual reference`,
    reason: "Fallback vertical placeholder; configure image search for production assets.",
    createdAt: new Date().toISOString(),
  };
}

export async function searchAndSelectImage(videoId: string, scene: VideoScene, minWidth: number, minHeight: number): Promise<SelectedAsset> {
  const candidates = (
    await Promise.all(scene.searchQueries.map((query) => searchCandidates(query).catch(() => [])))
  )
    .flat()
    .filter((candidate) => candidate.width >= minWidth && candidate.height >= minHeight)
    .filter((candidate) => !candidate.hasWatermark);

  const deduped = new Map<string, ImageCandidate>();
  for (const candidate of candidates) deduped.set(candidate.previewUrl, candidate);

  const ranked = [...deduped.values()]
    .map((candidate) => ({ candidate, rankScore: score(candidate, scene.subject) }))
    .sort((a, b) => b.rankScore - a.rankScore);

  const best = ranked[0];
  if (!best) return fallbackAsset(videoId, scene);

  return {
    id: nanoid(),
    videoId,
    sceneId: scene.id,
    sourceUrl: best.candidate.sourceUrl,
    storageUrl: best.candidate.previewUrl,
    width: best.candidate.width,
    height: best.candidate.height,
    rankScore: best.rankScore,
    altText: best.candidate.title,
    reason: "Ranked for resolution, relevance, no watermark, visual quality, and 9:16 crop suitability.",
    createdAt: new Date().toISOString(),
  };
}
