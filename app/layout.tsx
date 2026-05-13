import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoL Interaction Explainer — Canon Voice Lines & Lore",
  description:
    "Analyze League of Legends champion interactions, voice lines, and relationships with strict Riot canon attribution. Then voice and tighten audio for short-form.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
