"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ListTree, RotateCcw, X } from "lucide-react";

import { formatLocation, formatPeriod } from "@/lib/journey/cortex";
import { SCENARIOS, SCENARIO_BY_ID } from "@/lib/journey/scenarios";
import { nextStep, stepState } from "@/lib/journey/steps";
import type { Phase, ScenarioId } from "@/lib/journey/types";
import { firstOpenTask, stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { SegmentBar, StepPanel } from "./step-panel";
import { CortexAvatar } from "./task-card";

const EASE = [0.22, 1, 0.36, 1] as const;

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-white/75 uppercase">
        <span className="size-2 animate-pulse rounded-full bg-[#FF8A3D]" />
        Laying out the journey
      </div>
    </div>
  );
}

const JourneyScene = dynamic(() => import("./journey-scene").then((mod) => mod.JourneyScene), {
  ssr: false,
  loading: Loading,
});

const PHASES: { id: Phase; title: string; note: string }[] = [
  { id: "validation", title: "Validation", note: "once per facility" },
  { id: "verification", title: "Verification", note: "every monitoring period" },
];

// ── Where the project is ────────────────────────────────────────────────────

function WhereCard() {
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
    <section
      aria-label="Where the project is"
      className="rounded-2xl border border-white/15 bg-[#141235]/55 p-3.5 text-white shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl"
    >
      <p className="text-[10px] font-semibold tracking-[0.18em] text-white/60 uppercase">
        {inLoop ? `Verification · monitoring period ${laps + 1}` : "Validation · facility setup"}
      </p>
      {inLoop && dates ? <p className="mt-0.5 text-[11.5px] text-white/70">{dates}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#FF8A3D]/70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#FF8A3D]" />
        </span>
        <h2 className="text-[19px] leading-none font-semibold tracking-tight">{step.label}</h2>
      </div>
      <p className="mt-1 text-[12px] text-white/70">{step.sub}</p>

      <div className="mt-3 flex items-center gap-2.5">
        <SegmentBar step={step} className="flex-1" />
        <span className="tabular text-[11.5px] font-semibold">
          {progress.done}/{progress.total}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-white/65">
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
          className="mt-3 flex w-full items-start gap-2 rounded-xl bg-white/10 px-2.5 py-2 text-left transition-colors hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-white"
        >
          <CortexAvatar size={22} />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.14em] text-white/60 uppercase">
              {next.cortex.role === "none" ? "Next for you" : "Cortex asks"}
            </span>
            <span className="block text-[12.5px] leading-snug">{next.ask}</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => selectStep(current)}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-[#FFE6B0]/15 px-2.5 py-2 text-left transition-colors hover:bg-[#FFE6B0]/25 focus-visible:outline-2 focus-visible:outline-white"
        >
          <CortexAvatar size={22} />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.14em] text-[#FFE6B0]/80 uppercase">Cortex is satisfied</span>
            <span className="block text-[12.5px] leading-snug">
              {current === "issued" ? "Close this period and open the next" : `Ready to move to ${plan.stepById[nextStep(current)].label}`}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}

function StepRail() {
  const current = useJourney((state) => state.current);
  const tasks = useJourney((state) => state.tasks);
  const selectedStep = useJourney((state) => state.selectedStep);
  const hoveredStep = useJourney((state) => state.hoveredStep);
  const selectStep = useJourney((state) => state.selectStep);
  const hoverStep = useJourney((state) => state.hoverStep);
  const plan = usePlan();

  return (
    <nav aria-label="Journey steps" className="grid gap-3">
      {PHASES.map((phase) => (
        <div key={phase.id} className="grid gap-0.5">
          <p className="mb-0.5 px-2 text-[10px] font-semibold tracking-[0.16em] text-white/55 uppercase">
            {phase.title} <span className="font-medium normal-case tracking-normal text-white/45">· {phase.note}</span>
          </p>
          {plan.steps.filter((step) => step.phase === phase.id).map((step) => {
            const state = stepState(step.id, current);
            const { done, total } = stepProgress(step, tasks);
            const active = selectedStep === step.id || hoveredStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => selectStep(selectedStep === step.id ? null : step.id)}
                onMouseEnter={() => hoverStep(step.id)}
                onMouseLeave={() => hoverStep(null)}
                onFocus={() => hoverStep(step.id)}
                onBlur={() => hoverStep(null)}
                aria-current={state === "current" ? "step" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                  active ? "bg-white/15 text-white" : state === "upcoming" ? "text-white/55 hover:bg-white/8" : "text-white/88 hover:bg-white/8"
                }`}
              >
                <StepDot state={state} />
                <span className="min-w-0 flex-1 truncate">{step.label}</span>
                <span className="tabular text-[11px] text-white/55">
                  {done}/{total}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function StepDot({ state }: { state: ReturnType<typeof stepState> }) {
  if (state === "done") {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#FFE6B0] text-[#5A3E06] shadow-[0_0_10px_rgba(255,230,176,0.6)]">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return <span className="size-4 shrink-0 rounded-full border-[3px] border-[#FF8A3D]/40 bg-[#FF8A3D] bg-clip-padding" />;
  }
  return <span className="size-4 shrink-0 rounded-full border border-white/35" />;
}

// ── Scenario and legend ─────────────────────────────────────────────────────

function ScenarioSwitch() {
  const scenarioId = useJourney((state) => state.scenarioId);
  const load = useJourney((state) => state.load);

  const choose = (id: ScenarioId) => {
    load(id);
    // Keep the link shareable without a router navigation (which would remount the page).
    window.history.replaceState(null, "", `?project=${id}`);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label="Project"
        className="flex items-center gap-1 rounded-2xl border border-white/15 bg-[#141235]/55 p-1 backdrop-blur-xl"
      >
        {SCENARIOS.map((scenario) => {
          const on = scenario.id === scenarioId;
          return (
            <button
              key={scenario.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(scenario.id)}
              className={`rounded-xl px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                on ? "bg-white text-[#1B1846]" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <span className="block max-w-44 truncate text-[12px] leading-tight font-semibold">
                {scenario.id === "new" ? "New project" : scenario.name}
              </span>
              <span className={`block text-[10.5px] ${on ? "text-[#1B1846]/60" : "text-white/55"}`}>{scenario.tag}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => load(scenarioId)}
        title="Start this project again from its starting point"
        aria-label="Reset"
        className="grid size-10 place-items-center rounded-xl border border-white/15 bg-[#141235]/55 text-white/75 backdrop-blur-xl hover:text-white"
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );
}

function Legend() {
  const items = [
    { label: "Step complete", swatch: "border-[#FFE6B0] shadow-[0_0_10px_rgba(255,230,176,0.8)]" },
    { label: "Work left", swatch: "border-[#7FB4FF] shadow-[0_0_8px_rgba(127,180,255,0.6)]" },
    { label: "You are here", swatch: "border-[#FF8A3D] bg-[#FF8A3D]" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-full border border-white/12 bg-[#141235]/50 px-3.5 py-1.5 text-[11px] text-white/75 backdrop-blur-xl">
      <li className="font-semibold text-white/85">Open a step to see one disc per item</li>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full border-2 ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ── Workspace ───────────────────────────────────────────────────────────────

export function JourneyWorkspace({ initialScenario }: { initialScenario: ScenarioId }) {
  const scenarioId = useJourney((state) => state.scenarioId);
  const selectedStep = useJourney((state) => state.selectedStep);
  const selectStep = useJourney((state) => state.selectStep);
  const load = useJourney((state) => state.load);
  const reduce = useReducedMotion();
  const plan = usePlan();
  const scenario = SCENARIO_BY_ID[scenarioId];
  // The header follows what has been answered, so a new project fills in as it goes.
  const name = useJourney((state) => state.tasks["setup.name"]?.value) || scenario.name;
  const location = useJourney((state) => state.tasks["setup.location"]?.value);
  const place = scenarioId === "new" && location ? formatLocation(location) : scenario.place;
  const methodology = plan.methodology
    ? [plan.methodology.label, plan.methodology.version].filter(Boolean).join(" ")
    : "Methodology not chosen yet";
  // The left column folds into a bar while a step is open; it can be opened over the canvas.
  const [railOpen, setRailOpen] = useState(false);
  const [railFor, setRailFor] = useState(selectedStep);
  if (railFor !== selectedStep) {
    setRailFor(selectedStep);
    setRailOpen(false);
  }

  // Keep this tab's journey (for example after a trip to Cortex) unless the
  // link asks for a different project.
  useEffect(() => {
    if (useJourney.getState().scenarioId !== initialScenario) load(initialScenario);
  }, [initialScenario, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && useJourney.getState().selectedStep) selectStep(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectStep]);

  const panelOpen = selectedStep !== null;
  const folded = panelOpen && !railOpen;

  return (
    <main className="fixed inset-0 overflow-clip bg-[#0A0919] text-white">
      <JourneyScene />

      {folded ? (
        <div className="pointer-events-auto fixed top-5 left-5 z-30 flex max-w-[calc(100vw-2.5rem)] items-center gap-1 rounded-2xl border border-white/15 bg-[#141235]/60 p-1 backdrop-blur-xl max-lg:hidden lg:top-6 lg:left-6 lg:max-w-[calc(100vw-min(470px,42vw)-4rem)]">
          <Link
            href="/"
            aria-label="Back to Atlas"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="min-w-0 truncate px-1 text-[12.5px] font-semibold">{name}</span>
          <span className="hidden shrink-0 text-[11px] text-white/55 xl:inline">· {plan.registry?.label ?? "No registry yet"}</span>
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-2.5 text-[11.5px] font-semibold text-white/85 hover:bg-white/16"
          >
            <ListTree className="size-3.5" />
            Steps
          </button>
        </div>
      ) : null}

      <div
        className={`pointer-events-none fixed top-5 left-5 z-30 flex max-h-[calc(100vh-2.5rem)] w-[min(19rem,calc(100vw-2.5rem))] flex-col gap-3 transition-opacity duration-300 lg:top-6 lg:left-6 ${
          panelOpen ? "max-lg:opacity-0" : ""
        } ${folded ? "lg:hidden" : ""}`}
      >
        <header className="pointer-events-auto">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/65 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              Atlas
            </Link>
            {panelOpen ? (
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Fold the steps away"
                className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-[10.5px] font-semibold tracking-[0.2em] text-white/60 uppercase">
            Project journey · {plan.registry?.label ?? "no registry yet"}
          </p>
          <h1 className="mt-1 text-[26px] leading-[1.05] font-semibold tracking-tight lg:text-[30px]">{name}</h1>
          <p className="mt-1.5 text-[12.5px] text-white/70">
            {methodology} · {place}
          </p>
        </header>
        <div className="pointer-events-auto">
          <WhereCard />
        </div>
        <div className="scroll-slim pointer-events-auto hidden min-h-0 overflow-y-auto rounded-2xl border border-white/12 bg-[#141235]/45 p-2 backdrop-blur-xl lg:block">
          <StepRail />
        </div>
      </div>

      <div
        className={`fixed top-5 right-5 z-30 transition-opacity duration-300 lg:top-6 lg:right-6 ${
          panelOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <ScenarioSwitch />
      </div>

      <div
        className={`pointer-events-none fixed inset-x-0 bottom-5 z-30 hidden justify-center transition-opacity duration-300 md:flex ${
          panelOpen ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <Legend />
          <p className="text-[11px] text-white/55">Drag to look around · Scroll to zoom · Click a step or a disc · Esc closes</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {panelOpen && selectedStep ? (
          <motion.aside
            key={selectedStep}
            aria-label={`${plan.stepById[selectedStep].label} step`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="fixed inset-x-3 bottom-3 z-40 flex max-h-[62vh] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#141235]/55 text-white shadow-[0_24px_70px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl backdrop-saturate-150 lg:inset-x-auto lg:top-5 lg:right-5 lg:bottom-5 lg:max-h-none lg:w-[min(470px,42vw)]"
          >
            <StepPanel stepId={selectedStep} />
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
