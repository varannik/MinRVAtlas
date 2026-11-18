"use client";

import dynamic from "next/dynamic";

import type { ScenarioId } from "@/lib/journey/types";

/** The journey is a client-only 3D workspace, so it skips server rendering. */
const JourneyWorkspace = dynamic(
  () => import("./journey-workspace").then((mod) => mod.JourneyWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 grid place-items-center bg-[#0A0919]">
        <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-white/75 uppercase">
          <span className="size-2 animate-pulse rounded-full bg-[#FF8A3D]" />
          Laying out the journey
        </div>
      </div>
    ),
  },
);

export function JourneyEntry({ initialScenario }: { initialScenario: ScenarioId }) {
  return <JourneyWorkspace initialScenario={initialScenario} />;
}
