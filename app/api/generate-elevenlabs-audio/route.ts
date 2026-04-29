import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowedModels = new Set(["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"]);
const MAX_TEXT_LENGTH = 5000;

type ElevenLabsRequest = {
  apiKey?: string;
  voiceId?: string;
  text?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function clampSetting(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(numeric, 0), 1);
}

function parseElevenLabsError(status: number, payload: unknown) {
  const detail =
    payload &&
    typeof payload === "object" &&
    "detail" in payload
      ? (payload as { detail?: unknown }).detail
      : undefined;
  const message =
    typeof detail === "string"
      ? detail
      : detail && typeof detail === "object" && "message" in detail
        ? String((detail as { message?: unknown }).message)
        : "";
  const lowerMessage = message.toLowerCase();

  if (status === 401 || status === 403) {
    return "Invalid ElevenLabs API key.";
  }

  if (status === 404 || lowerMessage.includes("invalid id")) {
    return "Invalid ElevenLabs Voice ID.";
  }

  if (status === 429 || lowerMessage.includes("quota") || lowerMessage.includes("limit")) {
    return "ElevenLabs quota exceeded or rate limit reached.";
  }

  if (status === 422 || lowerMessage.includes("text")) {
    return message || "Text is too long or invalid for ElevenLabs.";
  }

  return message || "Audio generation failed. Please check your ElevenLabs settings.";
}

async function requestElevenLabsAudio({
  apiKey,
  voiceId,
  text,
  modelId,
  stability,
  similarityBoost,
  style,
  speakerBoost,
  includeOutputFormat,
}: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  includeOutputFormat: boolean;
}) {
  const outputFormat = includeOutputFormat ? "?output_format=mp3_44100_128" : "";

  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${outputFormat}`, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: speakerBoost,
      },
    }),
  });
}

export async function POST(request: NextRequest) {
  let payload: ElevenLabsRequest;
  try {
    payload = (await request.json()) as ElevenLabsRequest;
  } catch {
    return jsonError("Invalid request body.");
  }

  const apiKey = payload.apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim() || "";
  const voiceId = payload.voiceId?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || "";
  const text = payload.text?.trim() ?? "";
  const modelId =
    typeof payload.modelId === "string" && allowedModels.has(payload.modelId)
      ? payload.modelId
      : "eleven_multilingual_v2";

  if (!apiKey) {
    return jsonError("Missing ElevenLabs API key. Add ELEVENLABS_API_KEY to your environment or enter an API key.");
  }

  if (!voiceId) {
    return jsonError("Missing ElevenLabs Voice ID. Add ELEVENLABS_VOICE_ID to your environment or enter a Voice ID.");
  }

  if (!text) {
    return jsonError("Please write or generate a script first.");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return jsonError(`Script is too long for this MVP. Keep it under ${MAX_TEXT_LENGTH} characters.`);
  }

  const stability = clampSetting(payload.stability, 0.35);
  const similarityBoost = clampSetting(payload.similarityBoost, 0.85);
  const style = clampSetting(payload.style, 0.35);
  const speakerBoost = payload.speakerBoost !== false;

  let response = await requestElevenLabsAudio({
    apiKey,
    voiceId,
    text,
    modelId,
    stability,
    similarityBoost,
    style,
    speakerBoost,
    includeOutputFormat: true,
  });

  if (response.status === 400 || response.status === 422) {
    response = await requestElevenLabsAudio({
      apiKey,
      voiceId,
      text,
      modelId,
      stability,
      similarityBoost,
      style,
      speakerBoost,
      includeOutputFormat: false,
    });
  }

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    return jsonError(parseElevenLabsError(response.status, errorPayload), response.status >= 500 ? 502 : response.status);
  }

  const audio = await response.arrayBuffer();

  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": 'attachment; filename="raw-elevenlabs-audio.mp3"',
      "Cache-Control": "no-store",
    },
  });
}
