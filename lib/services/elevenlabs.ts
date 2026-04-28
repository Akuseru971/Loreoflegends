import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, hasElevenLabs } from "@/lib/config";
import type { Speaker } from "@/lib/types";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1/text-to-speech";

type GenerateLineAudioInput = {
  videoId: string;
  lineId: string;
  text: string;
  voiceId: string;
  speaker: Speaker;
  workDir: string;
};

async function createMockAudio(input: GenerateLineAudioInput, outputPath: string) {
  const wavHeaderText = `Mock audio for ${input.speaker}: ${input.text}`;
  await writeFile(outputPath, Buffer.from(wavHeaderText, "utf8"));
}

export async function generateLineAudio(input: GenerateLineAudioInput) {
  await mkdir(input.workDir, { recursive: true });
  const localPath = path.join(input.workDir, `${input.lineId}-${input.speaker.toLowerCase()}.mp3`);

  if (!hasElevenLabs || !input.voiceId) {
    await createMockAudio(input, localPath);
  } else {
    const response = await fetch(`${ELEVENLABS_API}/${input.voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: input.text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs failed for line ${input.lineId}: ${response.status} ${await response.text()}`);
    }

    await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  }

  return {
    localPath,
    durationMs: Math.max(900, Math.round((input.text.length / 15) * 1000)),
  };
}
