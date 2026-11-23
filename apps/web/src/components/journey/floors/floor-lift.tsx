"use client";

import { formatPeriod } from "@/lib/journey/cortex";
import { PHASE } from "@/lib/journey/steps";
import { stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { goToFloor, type FloorNumber } from "./floor-anchors";

const FLOORS: { floor: FloorNumber; title: string; note: string }[] = [
  { floor: 1, title: "Facility validation", note: "once per facility" },
  { floor: 2, title: "Removal ledger", note: "every monitoring period" },
  { floor: 3, title: "Calculation tree", note: "for the selected period" },
];

/** The floor the project is on: validation until the facility is listed, then the ledger. */
export function useHereFloor(): FloorNumber {
  return useJourney((state) => (PHASE[state.current] === "verification" ? 2 : 1));
}

/**
 * The lift on the right edge: one stop per floor, the floor in view filled,
 * and an Olivine dot on the floor the project is on.
 */
export function FloorLift({ viewing, hidden }: { viewing: FloorNumber; hidden: boolean }) {
  const here = useHereFloor();
  return (
    <nav
      aria-label="Journey floors"
      className={`journey-panel fixed top-1/2 right-3 z-40 hidden -translate-y-1/2 flex-col gap-1 rounded-2xl p-1.5 transition-opacity duration-300 md:flex lg:right-5 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {FLOORS.map(({ floor, title, note }, index) => {
        const active = viewing === floor;
        return (
          <div key={floor} className="flex flex-col items-center">
            {index > 0 ? <span aria-hidden className="h-3 border-l border-dashed border-calcite/30" /> : null}
            <button
              type="button"
              onClick={() => goToFloor(floor)}
              aria-current={active ? "location" : undefined}
              title={`Floor ${floor} · ${title} · ${note}`}
              className={`group relative grid size-10 place-items-center rounded-xl font-mono text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-calcite ${
                active ? "bg-calcite text-earth" : "text-calcite/75 hover:bg-calcite/10 hover:text-calcite"
              }`}
            >
              {floor}
              {here === floor ? (
                <span aria-label="The project is on this floor" className="absolute -top-0.5 -right-0.5 flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#B2BE8B]/70" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-[#B2BE8B] ring-2 ring-[#1D250A]" />
                </span>
              ) : null}
              <span className="journey-panel pointer-events-none absolute top-1/2 right-full mr-2.5 hidden -translate-y-1/2 rounded-xl px-2.5 py-1.5 text-left font-sans whitespace-nowrap group-hover:block group-focus-visible:block">
                <span className="block text-[12px] font-semibold text-calcite">{title}</span>
                <span className="block text-[10.5px] font-normal text-sand">
                  {note}
                  {here === floor ? " · the project is here" : ""}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Always on screen: where the project is, as floor, step and progress. It
 * takes you to that floor and opens the step.
 */
export function HereBeacon() {
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const tasks = useJourney((state) => state.tasks);
  const selectStep = useJourney((state) => state.selectStep);
  const plan = usePlan();
  const here = useHereFloor();
  const step = plan.stepById[current];
  const { done, total, flagged } = stepProgress(step, tasks);
  const dates = here === 2 ? formatPeriod(tasks["monitor.period"]?.value) : null;

  return (
    <button
      type="button"
      onClick={() => {
        goToFloor(here);
        selectStep(current);
      }}
      title={`Floor ${here}${dates ? ` · ${dates}` : ""} · open ${step.label}`}
      className="journey-panel flex max-w-full items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-3 text-left transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-calcite"
    >
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#B2BE8B]/70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-[#B2BE8B]" />
      </span>
      <span className="shrink-0 text-[9.5px] font-bold tracking-[0.16em] text-[#B2BE8B] uppercase">You are here</span>
      <span className="min-w-0 truncate text-[12px] font-semibold">
        Floor {here} · {here === 2 ? `Period ${laps + 1} · ` : ""}
        {step.label}
      </span>
      <span className="tabular shrink-0 rounded-md bg-calcite/12 px-1.5 py-0.5 text-[10.5px] font-semibold">
        {done}/{total}
      </span>
      {flagged > 0 ? <span className="shrink-0 text-[10.5px] font-semibold text-[#EACD9C]">{flagged} to check</span> : null}
    </button>
  );
}
