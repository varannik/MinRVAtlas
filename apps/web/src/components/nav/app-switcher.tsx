"use client";

import Link from "next/link";
import { Globe2, Landmark, ShieldCheck, type LucideIcon } from "lucide-react";

type Section = "atlas" | "quality" | "ledger";

const SECTIONS: { id: Section; label: string; href: string; icon: LucideIcon }[] = [
  { id: "atlas", label: "Atlas", href: "/", icon: Globe2 },
  { id: "quality", label: "Quality", href: "/quality", icon: ShieldCheck },
  { id: "ledger", label: "Ledger", href: "/ledger?tab=overview&registry=isometric", icon: Landmark },
];

/** Bottom-centre switcher between the three workspaces, styled like the 3D chain tabs. */
export function AppSwitcher({ active }: { active: Section }) {
  return (
    <nav
      aria-label="Workspaces"
      className="glass pointer-events-auto fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 shadow-[0_10px_30px_rgba(7,8,8,0.10)]"
    >
      {SECTIONS.map(({ id, label, href, icon: Icon }) => {
        const current = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              current ? "bg-rock text-white" : "text-shale hover:bg-white/80"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
