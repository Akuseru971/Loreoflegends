import type { AppSettings, Render, SelectedAsset, VideoLine, VideoProject, VideoScene } from "@/lib/types";

const now = new Date().toISOString();

export const defaultSettings: AppSettings = {
  pauseMs: 180,
  minImageSeconds: 3,
  maxImageSeconds: 4,
  minImageWidth: 1080,
  minImageHeight: 1080,
  subtitleStyle: {
    fontSize: 64,
    primaryColor: "white",
    outlineColor: "black",
    outlineWidth: 8,
    bottomMargin: 310,
  },
};

export const mockProjects: VideoProject[] = [
  {
    id: "demo-shadow-isles",
    title: "Why the Shadow Isles Still Haunt Runeterra",
    championOrTheme: "Shadow Isles",
    durationSeconds: 42,
    style: "Lore mystery",
    lambVoiceId: "lamb-demo",
    wolfVoiceId: "wolf-demo",
    status: "completed",
    idea: "A fast, ominous short explaining why the Ruination still makes Shadow Isles stories feel dangerous.",
    script:
      "Lamb: The Shadow Isles were not born cursed.\nWolf: They were broken by love that refused to die.\nLamb: Every mist-covered ruin is a warning.\nWolf: In League, the scariest monsters are memories with teeth.",
    finalAudioUrl: "/demo/narration.mp3",
    finalVideoUrl: "/demo/shadow-isles.mp4",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "demo-ionia-war",
    title: "The Day Ionia Stopped Being Peaceful",
    championOrTheme: "Ionia vs Noxus",
    durationSeconds: 35,
    style: "Epic history",
    lambVoiceId: "lamb-demo",
    wolfVoiceId: "wolf-demo",
    status: "images_selected",
    idea: "A punchy explainer on how the Noxian invasion turned Ionia from spiritual refuge into a battlefield.",
    script:
      "Lamb: Ionia believed balance could protect it.\nWolf: Then Noxus landed with steel.\nLamb: The war changed every champion it touched.\nWolf: Peace became something Ionia had to fight for.",
    createdAt: now,
    updatedAt: now,
  },
];

export const mockLines: VideoLine[] = [
  {
    id: "line-1",
    videoId: "demo-shadow-isles",
    index: 0,
    speaker: "Lamb",
    text: "The Shadow Isles were not born cursed.",
    pauseAfterMs: 180,
    audioUrl: "/demo/line-1.mp3",
    durationMs: 2500,
    startMs: 0,
    endMs: 2500,
    createdAt: now,
  },
  {
    id: "line-2",
    videoId: "demo-shadow-isles",
    index: 1,
    speaker: "Wolf",
    text: "They were broken by love that refused to die.",
    pauseAfterMs: 180,
    audioUrl: "/demo/line-2.mp3",
    durationMs: 2900,
    startMs: 2680,
    endMs: 5580,
    createdAt: now,
  },
];

export const mockScenes: VideoScene[] = [
  {
    id: "scene-1",
    videoId: "demo-shadow-isles",
    sceneIndex: 0,
    subject: "Blessed Isles",
    summary: "Establish the uncursed Blessed Isles before the fall.",
    visualPrompt: "Cinematic League of Legends island ruins before corruption.",
    searchQueries: ["League of Legends Blessed Isles art", "Shadow Isles before Ruination"],
    startMs: 0,
    endMs: 3800,
    createdAt: now,
  },
  {
    id: "scene-2",
    videoId: "demo-shadow-isles",
    sceneIndex: 1,
    subject: "Black Mist",
    summary: "Show mist, ruins, and a darker cinematic transition.",
    visualPrompt: "Shadow Isles black mist ruins League of Legends art.",
    searchQueries: ["League of Legends Shadow Isles ruins high resolution", "Black Mist League of Legends art"],
    startMs: 3800,
    endMs: 7600,
    createdAt: now,
  },
];

export const mockAssets: SelectedAsset[] = [
  {
    id: "asset-1",
    videoId: "demo-shadow-isles",
    sceneId: "scene-1",
    sourceUrl: "https://www.leagueoflegends.com/",
    storageUrl:
      "https://images.contentstack.io/v3/assets/blt731acb42bb3d1659/blt4d1f8db9f7bd5ad8/5f495fb8a55a0f2fdd4d3e49/Runeterra_01.jpg",
    width: 1920,
    height: 1080,
    rankScore: 91,
    altText: "High-resolution Shadow Isles region art with strong crop potential.",
    reason: "High-resolution region art and strong center framing for vertical crop.",
    createdAt: now,
  },
];

export const mockRenders: Render[] = [
  {
    id: "render-demo",
    videoId: "demo-shadow-isles",
    status: "completed",
    outputUrl: "/demo/shadow-isles.mp4",
    logs: "Demo render completed.",
    createdAt: now,
    updatedAt: now,
  },
];
