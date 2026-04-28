import Link from "next/link";
import { ReactNode } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/videos/new", label: "New video" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#050712] text-slate-100">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(125,92,255,0.26),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(3,169,244,0.16),_transparent_35%)]" />
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-cyan-400/15 text-lg font-black text-cyan-200 ring-1 ring-cyan-300/25">
              LoL
            </span>
            <div>
              <p className="text-sm uppercase tracking-[0.34em] text-cyan-200/70">Lore of Legends</p>
              <h1 className="text-xl font-semibold">Short-form video studio</h1>
            </div>
          </Link>
          <nav className="flex gap-2">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-full px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  );
}
