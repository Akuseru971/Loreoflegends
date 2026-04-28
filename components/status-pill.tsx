import clsx from "clsx";
import { statusLabels } from "@/lib/constants";
import { VideoStatus } from "@/lib/types";

const statusClasses: Record<VideoStatus, string> = {
  draft: "border-slate-700 bg-slate-900 text-slate-300",
  idea_generated: "border-indigo-500/40 bg-indigo-500/10 text-indigo-200",
  script_generated: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200",
  voice_generated: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
  audio_processed: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  images_selected: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  rendering: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  failed: "border-rose-500/40 bg-rose-500/10 text-rose-200",
};

export function StatusPill({ status }: { status: VideoStatus }) {
  return (
    <span className={clsx("rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]", statusClasses[status])}>
      {statusLabels[status]}
    </span>
  );
}
