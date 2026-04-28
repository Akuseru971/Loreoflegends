"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function VideoCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(formData: FormData) {
    setError(null);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        durationSeconds: Number(payload.durationSeconds),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Unable to create video");
      return;
    }

    const { video } = await response.json();
    startTransition(() => router.push(`/videos/${video.id}`));
  }

  return (
    <form action={submit} className="grid gap-5 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
      <label>
        Champion or theme
        <input name="championOrTheme" placeholder="Kindred, Arcane, Noxus..." required />
      </label>
      <label>
        Duration
        <select name="durationSeconds" defaultValue="45">
          <option value="30">30 seconds</option>
          <option value="45">45 seconds</option>
          <option value="60">60 seconds</option>
        </select>
      </label>
      <label>
        Style
        <select name="style" defaultValue="mythic lore reveal">
          <option value="mythic lore reveal">Mythic lore reveal</option>
          <option value="high-retention facts">High-retention facts</option>
          <option value="dark champion documentary">Dark champion documentary</option>
          <option value="patch/event explainer">Patch/event explainer</option>
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          Lamb voice ID
          <input name="lambVoiceId" placeholder="ElevenLabs voice id" required />
        </label>
        <label>
          Wolf voice ID
          <input name="wolfVoiceId" placeholder="ElevenLabs voice id" required />
        </label>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <button className="btn-primary" disabled={isPending} type="submit">
        {isPending ? "Creating..." : "Create video project"}
      </button>
    </form>
  );
}

export function RunPipelineForm({ id, disabled = false }: { id: string; disabled?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function run() {
    setMessage("Pipeline started. Rendering jobs can be moved to the Railway worker with the same service call.");
    const response = await fetch(`/api/videos/${id}/run`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setMessage(body.error ?? "Pipeline failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-5">
      <button className="btn-primary w-full" disabled={disabled || isPending} onClick={run} type="button">
        {isPending ? "Running..." : "Run full generation pipeline"}
      </button>
      {message ? <p className="mt-3 text-sm text-slate-300">{message}</p> : null}
    </div>
  );
}
