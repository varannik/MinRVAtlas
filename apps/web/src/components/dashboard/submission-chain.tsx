"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound } from "lucide-react";
import { statusFill } from "@/lib/brand";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { useDashboard } from "@/store/dashboard-store";
import type { SubmissionBatch } from "@/lib/types";

const WINDOW_SIZE = 3;

export function SubmissionChain({
  batches,
  activeId,
}: {
  batches: SubmissionBatch[];
  activeId: string;
}) {
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const activeIndex = batches.findIndex((b) => b.id === activeId);

  const defaultStart = Math.max(
    0,
    Math.min(batches.length - WINDOW_SIZE, activeIndex - 1),
  );
  const [windowStart, setWindowStart] = useState(defaultStart);

  const clampedStart = useMemo(() => {
    const ideal = Math.max(
      0,
      Math.min(batches.length - WINDOW_SIZE, activeIndex - 1),
    );
    if (activeIndex < windowStart || activeIndex >= windowStart + WINDOW_SIZE) {
      return ideal;
    }
    return windowStart;
  }, [activeIndex, batches.length, windowStart]);

  const start = Math.max(0, clampedStart);
  const end = Math.min(batches.length, start + WINDOW_SIZE);
  const visible = batches.slice(start, end);

  const hasOlder = start > 0;
  const hasNewer = end < batches.length;

  return (
    <nav
      aria-label="Submission chain"
      className="pointer-events-auto flex h-12 items-center justify-center gap-1"
    >
      <button
        type="button"
        disabled={!hasOlder}
        onClick={() => setWindowStart(Math.max(0, start - 1))}
        aria-label="Show older submissions"
        className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
          hasOlder
            ? "bg-white text-frost ring-1 ring-line hover:ring-carbon-400/40"
            : "text-transparent"
        }`}
      >
        <ChevronLeft className="size-4" />
      </button>

      {hasOlder ? (
        <div className="flex w-6 items-center">
          <div
            className="h-0 w-full border-t-2 border-dashed border-sand"
            style={{
              maskImage: "linear-gradient(to right, transparent, black)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black)",
            }}
          />
        </div>
      ) : null}

      {visible.map((batch, i) => {
        const active = batch.id === activeId;
        const status = SUBMISSION_STATUS_META[batch.status];
        const prevBatch = i > 0 ? visible[i - 1] : null;

        return (
          <div key={batch.id} className="flex shrink-0 items-center">
            {prevBatch ? (
              <div className="relative mx-1 flex h-8 w-12 items-center sm:w-14">
                <div
                  className={`w-full border-t-2 border-dashed ${
                    prevBatch.id === activeId || active
                      ? "border-olivine"
                      : "border-sand"
                  }`}
                />
                <div
                  className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md bg-white px-1 py-px ring-1 ${
                    prevBatch.id === activeId || active
                      ? "ring-olivine/45"
                      : "ring-line/70"
                  }`}
                >
                  <KeyRound
                    className={`size-2 shrink-0 ${
                      prevBatch.id === activeId || active
                        ? "text-carbon-400"
                        : "text-mist"
                    }`}
                  />
                  <span className="font-mono text-[7px] leading-none text-mist">
                    {prevBatch.hash.slice(0, 6)}
                  </span>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => selectSubmission(batch.id)}
              aria-pressed={active}
              className={`w-36 shrink-0 rounded-xl bg-white px-2 py-1 text-center ring-1 transition-shadow ${
                active
                  ? "ring-2 ring-carbon-400 shadow-sm"
                  : "ring-line/80 hover:ring-line"
              }`}
            >
              <div className="font-mono text-[10px] font-semibold text-frost">
                B{batch.sequence}
              </div>
              <div className="whitespace-nowrap text-[9px] font-medium text-mist">
                {status.label} · {batch.completion}%
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-off-white">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${batch.completion}%`,
                    background: statusFill(batch.status),
                  }}
                />
              </div>
            </button>
          </div>
        );
      })}

      {hasNewer ? (
        <div className="flex w-6 items-center">
          <div
            className="h-0 w-full border-t-2 border-dashed border-sand"
            style={{
              maskImage: "linear-gradient(to left, transparent, black)",
              WebkitMaskImage: "linear-gradient(to left, transparent, black)",
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        disabled={!hasNewer}
        onClick={() =>
          setWindowStart(Math.min(batches.length - WINDOW_SIZE, start + 1))
        }
        aria-label="Show newer submissions"
        className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
          hasNewer
            ? "bg-white text-frost ring-1 ring-line hover:ring-carbon-400/40"
            : "text-transparent"
        }`}
      >
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
