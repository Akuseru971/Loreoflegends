import type { SubtitleStyle, VideoStatus } from "@/lib/types";

export const statusLabels: Record<VideoStatus, string> = {
  draft: "Draft",
  idea_generated: "Idea generated",
  script_generated: "Script generated",
  voice_generated: "Voice generated",
  audio_processed: "Audio processed",
  images_selected: "Images selected",
  rendering: "Rendering",
  completed: "Completed",
  failed: "Failed",
};

export const pipelineSteps: VideoStatus[] = [
  "draft",
  "idea_generated",
  "script_generated",
  "voice_generated",
  "audio_processed",
  "images_selected",
  "rendering",
  "completed",
];

export const defaultSubtitleStyle: SubtitleStyle = {
  fontSize: 58,
  primaryColor: "#ffffff",
  outlineColor: "#050816",
  outlineWidth: 5,
  bottomMargin: 310,
};
