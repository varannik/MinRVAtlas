"use client";

import dynamic from "next/dynamic";

/**
 * Cortex is a client-only 3D workspace whose staged items live in this
 * browser, so it skips server rendering entirely.
 */
const CortexWorkspace = dynamic(
  () => import("./cortex-workspace").then((mod) => mod.CortexWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 grid place-items-center bg-earth" style={{ background: "var(--gradient-peridotite)" }}>
        <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-sand uppercase">
          <span className="size-2 animate-pulse rounded-full bg-olivine-300" />
          Waking Cortex
        </div>
      </div>
    ),
  },
);

export function CortexEntry({ pin = null, back = null }: { pin?: string | null; back?: string | null }) {
  return <CortexWorkspace pin={pin} back={back} />;
}
