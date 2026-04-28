import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Pace Cleaner",
  description: "Turn slow AI narration into dynamic short-form audio.",
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
