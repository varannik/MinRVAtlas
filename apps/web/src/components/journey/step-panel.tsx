"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Check, ChevronDown, Lock, X } from "lucide-react";

import { nextStep, stepState, type Plan } from "@/lib/journey/steps";
import type { JourneyStep, StepId, TaskStatus, TaskState } from "@/lib/journey/types";
import { stepProgress, taskState, usePlan, useJourney } from "@/store/journey-store";
import { CortexAvatar, HELP_WORD, KIND_ICON, KIND_WORD, TaskCard } from "./task-card";

export const STATUS_PILL: Record<TaskStatus, { label: string; className: string }> = {
  done: { label: "Done", className: "bg-[#F5C766]/20 text-[#FFE6B0]" },
  flagged: { label: "Check", className: "bg-[#FF8A3D]/22 text-[#FFC48F]" },
  checking: { label: "Checking", className: "bg-[#8F7DF7]/28 text-[#E0D9FF]" },
  open: { label: "To do", className: "bg-white/10 text-white/65" },
};

/** One segment per task, in ring order: the disc ring flattened. */
export function SegmentBar({ step, className = "" }: { step: JourneyStep; className?: string }) {
  const tasks = useJourney((state) => state.tasks);
  const hoveredTask = useJourney((state) => state.hoveredTask);
  return (
    <div className={`flex gap-1 ${className}`} aria-hidden>
      {step.tasks.map((task) => {
        const status = taskState(tasks, task.id).status;
        const colour =
          status === "done"
            ? "bg-[#F5C766] shadow-[0_0_8px_rgba(245,199,102,0.7)]"
            : status === "flagged"
              ? "bg-[#E9862F]"
              : status === "checking"
                ? "animate-pulse bg-[#9C8CFF]"
                : task.optional
                  ? "bg-white/8"
                  : "bg-[#8F93FF]/30";
        return (
          <span
            key={task.id}
            className={`h-1.5 flex-1 rounded-full transition-all ${colour} ${hoveredTask === task.id ? "scale-y-150" : ""}`}
          />
        );
      })}
    </div>
  );
}

function summary(step: JourneyStep, tasks: Record<string, TaskState>, state: ReturnType<typeof stepState>, plan: Plan) {
  const { done, total, flagged, blocking } = stepProgress(step, tasks);
  const pending = !plan.methodology && step.id !== "setup" && step.id !== "methodology";
  if (state === "upcoming") {
    const first = step.tasks.find((task) => !task.optional) ?? step.tasks[0];
    return pending
      ? `These are the items every registry asks for. The rest arrive when you choose the methodology in step 2.`
      : `Nothing to do here yet. When the project gets here there are ${total} things to give, starting with "${first?.label}".`;
  }
  if (done === total) {
    return state === "current"
      ? `Everything here is in. ${step.gate} You can move on.`
      : "Everything here is in. Open any item to see what was given or change it.";
  }
  const left = total - done;
  const firstBlocking = step.tasks.find((task) => task.blocks && taskState(tasks, task.id).status !== "done");
  const parts = [`${left} of ${total} still need${left === 1 ? "s" : ""} you.`];
  if (flagged > 0) parts.push(`${flagged} ${flagged === 1 ? "answer has" : "answers have"} a question from me.`);
  if (blocking > 0 && firstBlocking) {
    parts.push(`${blocking} block${blocking === 1 ? "s" : ""} ${plan.credit.many}; start with ${firstBlocking.label}.`);
  }
  return parts.join(" ");
}

export function StepPanel({ stepId }: { stepId: StepId }) {
  const plan = usePlan();
  const step = plan.stepById[stepId];
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const tasks = useJourney((state) => state.tasks);
  const selectedTask = useJourney((state) => state.selectedTask);
  const selectTask = useJourney((state) => state.selectTask);
  const selectStep = useJourney((state) => state.selectStep);
  const hoverTask = useJourney((state) => state.hoverTask);
  const advance = useJourney((state) => state.advance);
  const listRef = useRef<HTMLDivElement>(null);

  const state = stepState(stepId, current);
  const progress = stepProgress(step, tasks);
  const next = plan.stepById[nextStep(stepId)];
  const currentStep = plan.stepById[current];
  const verification = step.phase === "verification";

  // Keep the open task in view when it is chosen from the canvas. Scroll the
  // list itself: scrollIntoView would also scroll the page behind the canvas.
  useEffect(() => {
    const list = listRef.current;
    if (!selectedTask || !list) return;
    const row = list.querySelector<HTMLElement>(`[data-task="${CSS.escape(selectedTask)}"]`);
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 8) list.scrollTo({ top: top - 8, behavior: "smooth" });
    else if (bottom > list.scrollTop + list.clientHeight - 8) {
      list.scrollTo({ top: Math.min(top - 8, bottom - list.clientHeight + 8), behavior: "smooth" });
    }
  }, [selectedTask]);

  const phaseChip = verification ? `Verification · period ${laps + 1}` : "Validation · once per facility";
  const lockedReason = `Opens when the project reaches ${step.label}. It is at ${currentStep.label} now.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-white/10 px-5 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  verification ? "bg-[#8F7DF7]/25 text-[#E0D9FF]" : "bg-white/10 text-white/75"
                }`}
              >
                {phaseChip}
              </span>
              {plan.registry ? (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-white/75">
                  {plan.registry.label}
                </span>
              ) : null}
              {state === "current" ? (
                <span className="rounded-full bg-[#FF8A3D] px-2 py-0.5 text-[10.5px] font-bold text-[#2A1405]">You are here</span>
              ) : state === "done" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#F5C766]/20 px-2 py-0.5 text-[10.5px] font-semibold text-[#FFE6B0]">
                  <Check className="size-3" /> Passed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-white/60">
                  <Lock className="size-3" /> Later
                </span>
              )}
            </div>
            <h2 className="mt-2 text-[21px] leading-tight font-semibold tracking-tight text-white">{step.label}</h2>
            <p className="text-[12px] text-white/60">{step.sub}</p>
          </div>
          <button
            type="button"
            onClick={() => selectStep(null)}
            aria-label="Close step"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-white/75">{step.caption}</p>
        <div className="mt-3 flex items-center gap-3">
          <SegmentBar step={step} className="flex-1" />
          <span className="tabular shrink-0 text-[11.5px] font-semibold text-white">
            {progress.done}/{progress.total}
          </span>
        </div>
      </header>

      <div ref={listRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <div className="mb-3 flex items-start gap-2">
          <CortexAvatar />
          <p className="rounded-2xl rounded-tl-sm bg-[#8F7DF7]/[0.16] px-3 py-2 text-[12.5px] leading-snug text-white ring-1 ring-[#A99BFF]/20">
            {summary(step, tasks, state, plan)}
          </p>
        </div>

        <h3 className="mb-1.5 px-1 text-[10.5px] font-semibold tracking-[0.14em] text-white/50 uppercase">Needed to move on</h3>
        <ul className="grid gap-1.5">
          {step.tasks.map((task) => {
            const taskSt = taskState(tasks, task.id);
            const open = selectedTask === task.id;
            const Icon = KIND_ICON[task.kind];
            const pill = STATUS_PILL[taskSt.status];
            const withCortex = task.cortex.role !== "none";
            return (
              <li
                key={task.id}
                data-task={task.id}
                onMouseEnter={() => hoverTask(task.id)}
                onMouseLeave={() => hoverTask(null)}
                className={`rounded-xl border transition-colors ${
                  open ? "border-[#A99BFF]/40 bg-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.25)]" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.07]"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => selectTask(open ? null : task.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                      taskSt.status === "done" ? "bg-[#F5C766]/20 text-[#FFE6B0]" : "bg-[#8F7DF7]/22 text-[#D9D2FF]"
                    }`}
                    title={KIND_WORD[task.kind]}
                  >
                    {taskSt.status === "done" ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-white">{task.label}</span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-white/55">
                      {withCortex ? <CortexAvatar size={9} /> : null}
                      <span className={withCortex ? "text-[#CFC5FF]" : ""}>{HELP_WORD[task.cortex.role]}</span>
                      <span>· {KIND_WORD[task.kind]}</span>
                      {task.optional ? <span>· optional</span> : null}
                      {task.blocks && taskSt.status !== "done" ? (
                        <span className="font-semibold text-[#FF9F8A]">· blocks {plan.credit.many}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${pill.className}`}>{pill.label}</span>
                  <ChevronDown className={`size-3.5 shrink-0 text-white/50 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? (
                  <div className="border-t border-white/10 px-3 pt-3 pb-3.5">
                    <TaskCard
                      key={`${task.id}:${taskSt.status}`}
                      task={task}
                      state={taskSt}
                      locked={state === "upcoming"}
                      lockedReason={lockedReason}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="border-t border-white/10 px-5 py-3.5">
        <p className="text-[11.5px] leading-snug text-white/70">
          <span className="font-semibold text-white">To move on: </span>
          {step.gate}
        </p>
        {state === "current" ? (
          <button
            type="button"
            disabled={!progress.complete}
            onClick={advance}
            className="mt-2.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-semibold text-[#1B1846] transition-colors hover:bg-[#E9E5FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45"
          >
            {stepId === "issued" ? `Close period ${laps + 1} and open period ${laps + 2}` : `Move to ${next.label}`}
            <ArrowRight className="size-4" />
          </button>
        ) : (
          <p className="mt-2 text-[11.5px] text-white/55">
            {state === "done" ? "This step is passed." : `The project is at ${currentStep.label}.`}{" "}
            <button
              type="button"
              onClick={() => selectStep(current)}
              className="font-semibold text-[#CFC5FF] underline-offset-2 hover:underline"
            >
              Go to where you are
            </button>
          </p>
        )}
        {state === "current" && !progress.complete ? (
          <p className="mt-1.5 text-center text-[11px] text-white/50">
            {progress.total - progress.done} left before {stepId === "issued" ? "the next period" : next.label}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
