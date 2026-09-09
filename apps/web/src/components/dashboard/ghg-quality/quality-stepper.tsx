"use client";

import type { QualityStep } from "@/lib/ghg-quality-findings";

const STEPS: { id: QualityStep; label: string }[] = [
  { id: 1, label: "Data quality" },
  { id: 2, label: "Anomaly detection" },
  { id: 3, label: "Registry rules" },
];

export function QualityStepper({
  step,
  maxReached,
  onSelect,
}: {
  step: QualityStep;
  maxReached: QualityStep;
  onSelect: (step: QualityStep) => void;
}) {
  return (
    <nav className="flex items-center justify-center gap-2" aria-label="Quality steps">
      {STEPS.map((item, index) => {
        const locked = item.id > maxReached;
        const active = item.id === step;
        return (
          <div key={item.id} className="flex items-center gap-2">
            {index > 0 ? (
              <span className="h-px w-8 bg-line" aria-hidden />
            ) : null}
            <button
              type="button"
              disabled={locked}
              onClick={() => onSelect(item.id)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide ${
                active
                  ? "bg-carbon-400 text-off-white"
                  : locked
                    ? "bg-ink-800/40 text-mist"
                    : "bg-off-white text-frost ring-1 ring-line/70"
              }`}
            >
              {item.id} {item.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
