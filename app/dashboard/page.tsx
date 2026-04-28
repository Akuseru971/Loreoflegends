import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { listVideos } from "@/lib/services/database";
import { statusLabels } from "@/lib/constants";

export default async function DashboardPage() {
  const videos = await listVideos();

  return (
    <AppShell>
      <section className="hero-card">
        <div>
          <p className="eyebrow">Production dashboard</p>
          <h1>League shorts pipeline</h1>
          <p className="muted">
            Track every video from idea discovery through scripting, voice generation, image selection,
            rendering, and export.
          </p>
        </div>
        <Link className="button primary" href="/videos/new">
          New video
        </Link>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Projects</p>
            <h2>All video projects</h2>
          </div>
          <span className="muted">{videos.length} total</span>
        </div>
        <div className="project-list">
          {videos.map((video) => (
            <Link className="project-row" href={`/videos/${video.id}`} key={video.id}>
              <div>
                <h3>{video.title}</h3>
                <p>
                  {video.championOrTheme} · {video.durationSeconds}s · {video.style}
                </p>
              </div>
              <div className="row-actions">
                <StatusPill status={video.status} />
                <span className="muted">{statusLabels[video.status]}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
