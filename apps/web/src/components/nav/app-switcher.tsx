"use client";

import Link from "next/link";
import { BrainCircuit, Globe2, Landmark, ShieldCheck, type LucideIcon } from "lucide-react";

type Section = "atlas" | "cortex" | "quality" | "ledger";

const SECTIONS: { id: Section; label: string; href: string; icon: LucideIcon }[] = [
  { id: "atlas", label: "Atlas", href: "/", icon: Globe2 },
  { id: "cortex", label: "Cortex", href: "/cortex", icon: BrainCircuit },
  { id: "quality", label: "Quality", href: "/quality", icon: ShieldCheck },
  { id: "ledger", label: "Ledger", href: "/ledger?tab=overview&registry=isometric", icon: Landmark },
];

/** Bottom-centre switcher between the three workspaces: a glass track with a white thumb. */
export function AppSwitcher({ active }: { active: Section }) {
  return (
    <nav
      aria-label="Workspaces"
      className="glass pointer-events-auto fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1"
    >
      {SECTIONS.map(({ id, label, href, icon: Icon }) => {
        const current = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500 ${
              current ? "glass-thumb text-earth" : "text-strata-700 hover:bg-white/60 hover:text-earth"
            }`}
          >
            <Icon className={`size-3.5 ${current ? "text-olivine-700" : ""}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
