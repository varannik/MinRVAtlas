"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { formatPeriod } from "@/lib/journey/cortex";
import { nextStep, stepState } from "@/lib/journey/steps";
import { firstOpenTask, stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { SegmentBar } from "../step-panel";
import { CortexAvatar } from "../task-card";
import type { FloorNumber } from "./floor-anchors";

/** A floor's name, set on the floor itself: dark ink on the light floors, Calcite at depth. */
export function FloorHeading({
  floor,
  eyebrow,
  title,
  sub,
  dark = false,
  children,
}: {
  floor: FloorNumber;
  eyebrow: string;
  title: string;
  sub?: string;
  dark?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.2em] uppercase ${dark ? "text-sand" : "text-strata-700"}`}
      >
        <span
          className={`grid size-5 place-items-center rounded-md font-mono text-[10.5px] tracking-normal ${
            dark ? "bg-calcite/12 text-calcite ring-1 ring-calcite/25" : "bg-earth/8 text-earth ring-1 ring-earth/20"
          }`}
        >
          {floor}
        </span>
        Floor {floor} · {eyebrow}
      </p>
      <h2 className={`mt-1.5 text-[26px] leading-tight font-semibold tracking-tight lg:text-[32px] ${dark ? "text-calcite" : "text-earth"}`}>
        {title}
      </h2>
      {sub ? <p className={`mt-1 max-w-2xl text-[13px] leading-snug ${dark ? "text-sand" : "text-strata-700"}`}>{sub}</p> : null}
      {children}
    </div>
  );
}

/** A step's state as a small dot: Calcite tick when done, Olivine ring for the current step. */
export function StepDot({ state }: { state: ReturnType<typeof stepState> }) {
  if (state === "done") {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-calcite text-earth shadow-[0_0_10px_rgba(234,218,199,0.6)]">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return <span className="size-4 shrink-0 rounded-full border-[3px] border-[#B2BE8B]/40 bg-[#B2BE8B] bg-clip-padding" />;
  }
  return <span className="size-4 shrink-0 rounded-full border border-calcite/35" />;
}

/**
 * Where the project is: the step it is on, how much of it is in, and what
 * Cortex asks for next. It sits on the floor the step belongs to.
 */
export function WhereCard() {
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const tasks = useJourney((state) => state.tasks);
  const selectTask = useJourney((state) => state.selectTask);
  const selectStep = useJourney((state) => state.selectStep);
  const plan = usePlan();
  const step = plan.stepById[current];
  const progress = stepProgress(step, tasks);
  const next = progress.complete ? null : step.tasks.find((task) => task.id === firstOpenTask(step, tasks));
  const inLoop = step.phase === "verification";
  const dates = formatPeriod(tasks["monitor.period"]?.value);

  return (
    <section aria-label="Where the project is" className="journey-panel rounded-2xl p-3.5">
      <p className="text-[10px] font-semibold tracking-[0.18em] text-sand uppercase">
        {inLoop ? `Verification · monitoring period ${laps + 1}` : "Validation · facility setup"}
      </p>
      {inLoop && dates ? <p className="mt-0.5 text-[11.5px] text-calcite/75">{dates}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#B2BE8B]/70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#B2BE8B]" />
        </span>
        <h3 className="text-[19px] leading-none font-semibold tracking-tight">{step.label}</h3>
      </div>
      <p className="mt-1 text-[12px] text-calcite/75">{step.sub}</p>

      <div className="mt-3 flex items-center gap-2.5">
        <SegmentBar step={step} className="flex-1" />
        <span className="tabular text-[11.5px] font-semibold">
          {progress.done}/{progress.total}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-calcite/70">
        {progress.complete
          ? "All in. Open the step to move on."
          : [
              `${progress.total - progress.done} to go`,
              progress.flagged ? `${progress.flagged} to check` : null,
              progress.blocking ? `${progress.blocking} block ${plan.credit.many}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
      </p>

      {next ? (
        <button
          type="button"
          onClick={() => selectTask(next.id)}
          className="mt-3 flex w-full items-start gap-2 rounded-xl bg-calcite/10 px-2.5 py-2 text-left transition-colors hover:bg-calcite/16 focus-visible:outline-2 focus-visible:outline-calcite"
        >
          <CortexAvatar size={22} />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.14em] text-sand uppercase">
              {next.cortex.role === "none" ? "Next for you" : "Cortex asks"}
            </span>
            <span className="block text-[12.5px] leading-snug">{next.ask}</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => selectStep(current)}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-[#8B9C44]/22 px-2.5 py-2 text-left transition-colors hover:bg-[#8B9C44]/32 focus-visible:outline-2 focus-visible:outline-calcite"
        >
          <CortexAvatar size={22} />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.14em] text-[#B2BE8B] uppercase">Cortex is satisfied</span>
            <span className="block text-[12.5px] leading-snug">
              {current === "issued" ? "Close this period and open the next" : `Ready to move to ${plan.stepById[nextStep(current)].label}`}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
