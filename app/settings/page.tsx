import { AppShell } from "@/components/app-shell";
import { getSettings } from "@/lib/services/database";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <AppShell>
      <section className="panel space-y-6">
        <div>
          <p className="eyebrow">Environment managed</p>
          <h1>Settings</h1>
          <p className="muted mt-2 max-w-3xl">
            API credentials stay in environment variables. This page exposes runtime creative defaults that are safe to
            store in the database and read by workers.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card">
            <span>Line pause</span>
            <strong>{settings.pauseMs}ms</strong>
            <p>Controlled gap between separately generated Lamb/Wolf lines.</p>
          </div>
          <div className="metric-card">
            <span>Image duration</span>
            <strong>
              {settings.minImageSeconds}-{settings.maxImageSeconds}s
            </strong>
            <p>Keeps each visual beat in the 3 to 4 second short-form rhythm.</p>
          </div>
          <div className="metric-card">
            <span>Subtitle style</span>
            <strong>{settings.subtitleStyle.fontSize}px</strong>
            <p>
              {settings.subtitleStyle.primaryColor} text over {settings.subtitleStyle.outlineColor} outline.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
          <h2>Required environment keys</h2>
          <ul className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
            <li>OPENAI_API_KEY</li>
            <li>ELEVENLABS_API_KEY</li>
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>SUPABASE_SERVICE_ROLE_KEY</li>
            <li>SUPABASE_ASSET_BUCKET</li>
            <li>BING_IMAGE_SEARCH_KEY or SERPAPI_API_KEY</li>
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
