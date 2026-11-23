"use client";

import dynamic from "next/dynamic";

import type { JourneyRequest } from "./journey-workspace";

/** The journey is a client-only 3D workspace, so it skips server rendering. */
const JourneyWorkspace = dynamic(
  () => import("./journey-workspace").then((mod) => mod.JourneyWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="journey-floor--validation fixed inset-0 grid place-items-center">
        <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-strata-700 uppercase">
          <span className="size-2 animate-pulse rounded-full bg-olivine-600" />
          Laying out the journey
        </div>
      </div>
    ),
  },
);

export function JourneyEntry({ request }: { request: JourneyRequest }) {
  return <JourneyWorkspace request={request} />;
}
