import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lore of Legends Studio",
  description: "Create premium League of Legends short-form videos from web imagery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>
          <header className="hero">
            <div>
              <p className="eyebrow">League shorts automation</p>
              <h1>Lore of Legends Studio</h1>
              <p>
                Generate Lamb and Wolf narrated TikToks, Reels, and Shorts using
                ranked web images, tight audio pacing, and cinematic FFmpeg edits.
              </p>
            </div>
            <Link className="button primary" href="/videos/new">
              New video
            </Link>
          </header>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
