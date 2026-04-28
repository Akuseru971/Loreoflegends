import Link from "next/link";
import { notFound } from "next/navigation";
import { RunPipelineForm } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  getLatestRenderForVideo,
  getLinesForVideo,
  getScenesForVideo,
  getSelectedAssetsForVideo,
  getVideo,
} from "@/lib/services/database";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await getVideo(id);
  if (!video) notFound();

  const [lines, scenes, assets, render] = await Promise.all([
    getLinesForVideo(video.id),
    getScenesForVideo(video.id),
    getSelectedAssetsForVideo(video.id),
    getLatestRenderForVideo(video.id),
  ]);

  return (
    <div className="space-y-8">
      <div className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Project</p>
            <h1 className="mt-3 text-4xl font-black">{video.title}</h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              {video.championOrTheme} · {video.durationSeconds}s · {video.style}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={video.status} />
            <RunPipelineForm id={video.id} disabled={video.status === "rendering"} />
          </div>
        </div>
        {video.errorMessage ? <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{video.errorMessage}</p> : null}
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel">
          <p className="eyebrow">Idea</p>
          <h2 className="mt-3 text-2xl font-bold">{video.idea ?? "Run the pipeline to generate a League of Legends idea."}</h2>
          <p className="mt-5 whitespace-pre-wrap text-slate-300">{video.script ?? "The two-speaker Lamb/Wolf script will appear here after script generation."}</p>
        </div>
        <div className="panel">
          <p className="eyebrow">Final output</p>
          {video.finalVideoUrl ? (
            <div className="mt-4 space-y-4">
              <video className="aspect-[9/16] max-h-[560px] rounded-3xl border border-white/10 bg-black" controls src={video.finalVideoUrl} />
              <Link className="button secondary inline-flex" href={video.finalVideoUrl}>
                Download MP4
              </Link>
            </div>
          ) : (
            <div className="mt-4 rounded-3xl border border-dashed border-white/15 p-8 text-slate-400">The 1080x1920 MP4 will appear here once rendering completes.</div>
          )}
          {video.finalAudioUrl ? (
            <audio className="mt-5 w-full" controls src={video.finalAudioUrl} />
          ) : null}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Generated voice lines</p>
        <div className="mt-5 grid gap-3">
          {lines.length ? (
            lines.map((line) => (
              <div key={line.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-bold text-violet-100">{line.speaker}</span>
                  <span className="text-xs text-slate-500">Line {line.index + 1}</span>
                </div>
                <p className="mt-2 text-slate-200">{line.text}</p>
                {line.audioUrl ? <audio className="mt-3 w-full" controls src={line.audioUrl} /> : null}
              </div>
            ))
          ) : (
            <p className="text-slate-400">Each script line is generated and stored separately before concatenation.</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel">
          <p className="eyebrow">Visual beats</p>
          <div className="mt-5 space-y-4">
            {scenes.length ? (
              scenes.map((scene) => (
                <article key={scene.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Scene {scene.sceneIndex + 1}</span>
                    <span>{scene.startMs / 1000}s - {scene.endMs / 1000}s</span>
                  </div>
                  <h3 className="mt-2 font-bold">{scene.subject}</h3>
                  <p className="mt-2 text-sm text-slate-300">{scene.visualPrompt}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scene.searchQueries.map((query) => (
                      <span key={query} className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">{query}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="text-slate-400">Scene breakdown and search queries are generated by OpenAI.</p>
            )}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Selected assets</p>
          <div className="mt-5 grid gap-4">
            {assets.length ? (
              assets.map((asset) => (
                <article key={asset.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                  <img className="aspect-video w-full object-cover" src={asset.storageUrl} alt={asset.altText} />
                  <div className="p-4">
                    <p className="font-semibold">{asset.altText}</p>
                    <p className="mt-1 text-xs text-slate-500">Score {asset.rankScore}/100 · {asset.width}x{asset.height}</p>
                    <a className="mt-2 inline-block text-xs text-cyan-200" href={asset.sourceUrl}>Source</a>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-slate-400">Ranked, deduplicated image selections will be shown here.</p>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Render status</p>
        <pre className="mt-4 overflow-auto rounded-2xl bg-black/40 p-4 text-xs text-slate-300">
          {JSON.stringify(render ?? { status: "waiting", note: "No render has been started." }, null, 2)}
        </pre>
      </section>
    </div>
  );
}
