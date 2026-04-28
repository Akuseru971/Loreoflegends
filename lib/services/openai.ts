import OpenAI from "openai";

import { env, hasOpenAI } from "@/lib/config";
import type { GeneratedScript, ImageCandidate, ScriptLine, VideoProject, VideoScene } from "@/lib/types";

const client = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function generateIdea(input: Pick<VideoProject, "championOrTheme" | "durationSeconds" | "style">): Promise<string> {
  if (!client) return `Why ${input.championOrTheme} is darker than most League players remember`;

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: [
      {
        role: "system",
        content:
          "Create one high-retention short-form League of Legends video idea. Focus on lore, champions, regions, events, or player curiosity. Return only the idea.",
      },
      {
        role: "user",
        content: `Subject: ${input.championOrTheme}\nDuration: ${input.durationSeconds}s\nStyle: ${input.style}`,
      },
    ],
  });

  return response.output_text.trim();
}

export async function generateScriptAndScenes(project: VideoProject): Promise<GeneratedScript> {
  const fallbackLines: ScriptLine[] = [
    {
      index: 0,
      speaker: "Lamb",
      text: `${project.championOrTheme} looks like a simple League story at first.`,
      pauseAfterMs: 180,
    },
    {
      index: 1,
      speaker: "Wolf",
      text: "Then you notice what Riot hid in the background.",
      pauseAfterMs: 180,
    },
    {
      index: 2,
      speaker: "Lamb",
      text: "The symbols, the region, and the old conflicts all point to one wound.",
      pauseAfterMs: 190,
    },
    {
      index: 3,
      speaker: "Wolf",
      text: "And once you see it, the champion feels completely different.",
      pauseAfterMs: 200,
    },
    {
      index: 4,
      speaker: "Lamb",
      text: "That is why this lore still works so well in a thirty second short.",
      pauseAfterMs: 160,
    },
  ];
  const averageMs = Math.max(3000, Math.min(4000, Math.round((project.durationSeconds * 1000) / fallbackLines.length)));
  const fallbackScenes = fallbackLines.map((line, index) => ({
    sceneIndex: index,
    subject: project.championOrTheme,
    summary: line.text,
    visualPrompt: `${project.championOrTheme} League of Legends cinematic art, premium lore visual`,
    searchQueries: [
      `${project.championOrTheme} League of Legends splash art`,
      `${project.championOrTheme} Runeterra official art high resolution`,
    ],
    startMs: index * averageMs,
    endMs: (index + 1) * averageMs,
    createdAt: new Date().toISOString(),
  }));

  if (!client) {
    return { idea: project.idea ?? (await generateIdea(project)), lines: fallbackLines, scenes: fallbackScenes };
  }

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: [
      {
        role: "system",
        content:
          'You are a premium TikTok/Reels/Shorts League of Legends producer. Return strict JSON: {"idea":"...","lines":[{"speaker":"Lamb|Wolf","text":"...","pauseAfterMs":180}],"scenes":[{"subject":"...","summary":"...","visualPrompt":"...","searchQueries":["..."]}]}',
      },
      {
        role: "user",
        content: JSON.stringify({
          subject: project.championOrTheme,
          style: project.style,
          durationSeconds: project.durationSeconds,
          idea: project.idea,
          rules: [
            "Every line is generated separately by ElevenLabs later.",
            "Every line must have speaker Lamb or Wolf.",
            "Use tight, high-retention, mobile-first narration.",
            "Split visuals into beats averaging 3 to 4 seconds each.",
            "Search queries must target existing web images, not generated video.",
          ],
        }),
      },
    ],
  });

  const parsed = safeJson<{
    idea?: string;
    lines?: Array<Omit<ScriptLine, "index">>;
    scenes?: Array<Pick<VideoScene, "subject" | "summary" | "visualPrompt" | "searchQueries">>;
  }>(response.output_text, {});

  const lines = (parsed.lines?.length ? parsed.lines : fallbackLines).map((line, index) => ({
    index,
    speaker: line.speaker,
    text: line.text,
    pauseAfterMs: line.pauseAfterMs ?? 180,
  }));
  const sceneAverageMs = Math.max(3000, Math.min(4000, Math.round((project.durationSeconds * 1000) / Math.max(1, parsed.scenes?.length ?? lines.length))));
  const scenes = (parsed.scenes?.length ? parsed.scenes : fallbackScenes).map((scene, index) => ({
    sceneIndex: index,
    subject: scene.subject,
    summary: scene.summary,
    visualPrompt: scene.visualPrompt,
    searchQueries: scene.searchQueries,
    startMs: index * sceneAverageMs,
    endMs: (index + 1) * sceneAverageMs,
    createdAt: new Date().toISOString(),
  }));

  return { idea: parsed.idea ?? project.idea ?? (await generateIdea(project)), lines, scenes };
}

export async function generateSceneSearchQueries(project: VideoProject, scene: VideoScene): Promise<string[]> {
  if (!client) {
    return scene.searchQueries.length
      ? scene.searchQueries
      : [`${scene.subject} League of Legends official art`, `${project.championOrTheme} cinematic splash art`];
  }

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: `Generate 4 concise web image search queries for this League of Legends visual beat. Return JSON array only.\nSubject: ${project.championOrTheme}\nScene: ${scene.summary}`,
  });
  return safeJson<string[]>(response.output_text, scene.searchQueries);
}

export async function rankImageCandidate(candidate: ImageCandidate, scene: VideoScene): Promise<number> {
  const heuristic =
    Math.min(35, Math.min(candidate.width, candidate.height) / 60) +
    (candidate.height >= candidate.width ? 25 : 8) +
    (candidate.hasWatermark ? -80 : 0);

  if (!client) return Math.max(0, Math.min(100, Math.round(heuristic + 35)));

  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    input: `Score 0-100 for relevance, resolution, no watermark, visual quality, and 9:16 crop suitability. Return number only.\nScene: ${scene.summary}\nCandidate: ${JSON.stringify(candidate)}`,
  });
  const score = Number.parseFloat(response.output_text);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : heuristic;
}
