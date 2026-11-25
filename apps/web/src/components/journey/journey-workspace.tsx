"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, CircleAlert, Cloud, LoaderCircle, RotateCcw, X } from "lucide-react";

import { useCortexProjects } from "@/components/cortex/cortex-projects";
import { atlasSeed, type AtlasProjectHint } from "@/lib/journey/atlas";
import { formatLocation } from "@/lib/journey/cortex";
import { stepState } from "@/lib/journey/steps";
import type { Tasks } from "@/lib/journey/engine";
import type { ScenarioId } from "@/lib/journey/types";
import { stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { FLOOR_IDS, type FloorNumber } from "./floors/floor-anchors";
import { FloorLinks } from "./floors/floor-links";
import { FloorLift, HereBeacon, useHereFloor } from "./floors/floor-lift";
import { FloorHeading, StepDot, WhereCard } from "./floors/floor-parts";
import { JourneyQuality } from "./floors/journey-quality";
import { LowerFloors } from "./floors/lower-floors";
import { onValidationFloor } from "./layout";
import { StepPanel } from "./step-panel";

const EASE = [0.22, 1, 0.36, 1] as const;

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-strata-700 uppercase">
        <span className="size-2 animate-pulse rounded-full bg-olivine-600" />
        Laying out the journey
      </div>
    </div>
  );
}

const JourneyScene = dynamic(() => import("./journey-scene").then((mod) => mod.JourneyScene), {
  ssr: false,
  loading: Loading,
});

// ── Validation steps, on the top floor ─────────────────────────────────────

function StepRail() {
  const current = useJourney((state) => state.current);
  const tasks = useJourney((state) => state.tasks);
  const selectedStep = useJourney((state) => state.selectedStep);
  const hoveredStep = useJourney((state) => state.hoveredStep);
  const selectStep = useJourney((state) => state.selectStep);
  const hoverStep = useJourney((state) => state.hoverStep);
  const plan = usePlan();

  return (
    <nav aria-label="Validation steps" className="grid gap-0.5">
      <p className="mb-0.5 px-2 text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">
        Validation <span className="font-medium tracking-normal text-calcite/55 normal-case">· once per facility</span>
      </p>
      {plan.steps
        .filter((step) => onValidationFloor(step.id))
        .map((step) => {
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
              className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-calcite ${
                active ? "bg-calcite/15 text-calcite" : state === "upcoming" ? "text-calcite/55 hover:bg-calcite/8" : "text-calcite/90 hover:bg-calcite/8"
              }`}
            >
              <StepDot state={state} />
              <span className="min-w-0 flex-1 truncate">{step.label}</span>
              <span className="tabular text-[11px] text-sand">
                {done}/{total}
              </span>
            </button>
          );
        })}
    </nav>
  );
}

// ── Project and save state ──────────────────────────────────────────────────

/** What the page was asked to open: a stored Cortex project, or a practice scenario. */
export interface JourneyRequest {
  project: string | null;
  practice: string | null;
  /** An Atlas project, for when Cortex has no journey saved for it. */
  atlas: AtlasProjectHint | null;
}

/** Whether what is shown is saved, being saved, read only or practice. */
function SyncNote() {
  const project = useJourney((state) => state.project);
  const sync = useJourney((state) => state.sync);
  const dismiss = useJourney((state) => state.dismissError);
  const scenarioId = useJourney((state) => state.scenarioId);
  const practiceSeed = useJourney((state) => state.practiceSeed);
  const load = useJourney((state) => state.load);
  const base = "journey-panel flex max-w-80 items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] leading-snug";

  if (sync.state === "error") {
    return (
      <p role="alert" className={`${base} border-[#E0A79D]/35 bg-[#3F2811]/90 text-[#E0A79D]`}>
        <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{sync.message}</span>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="ml-1 shrink-0 text-calcite/60 hover:text-calcite">
          <X className="size-3.5" />
        </button>
      </p>
    );
  }
  if (sync.state === "loading" || sync.state === "saving" || !project) {
    return (
      <p role="status" className={`${base} text-calcite/75`}>
        <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin" aria-hidden />
        {sync.state === "saving" ? "Saving…" : "Opening the journey…"}
      </p>
    );
  }
  if (project.practice) {
    return (
      <p className={`${base} items-center text-calcite/75`}>
        Practice: saved for you only.
        <button
          type="button"
          onClick={() => void load(scenarioId, practiceSeed ?? undefined, true)}
          title="Start this practice journey again from its starting point"
          className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-calcite hover:bg-calcite/10"
        >
          <RotateCcw className="size-3" />
          Start again
        </button>
      </p>
    );
  }
  return (
    <p className={`${base} text-calcite/75`}>
      <Cloud className="mt-px size-3.5 shrink-0" aria-hidden />
      {!project.canEdit
        ? "Read only: your role can see this journey but not change it."
        : project.stored
          ? "Saved for everyone on this project."
          : "Nothing saved yet: your first answer saves the journey for the team."}
    </p>
  );
}

function Legend() {
  const items = [
    { label: "Step complete", swatch: "border-olivine-500 bg-olivine-500" },
    { label: "Work left", swatch: "border-strata-700" },
    { label: "You are here", swatch: "border-olivine-800 bg-olivine-600 shadow-[0_0_0_3px_rgba(178,190,139,0.5)]" },
    { label: "Cortex, the moon over your step", swatch: "border-serpentine-500 bg-serpentine-300" },
  ];
  return (
    <ul className="glass flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-full px-3.5 py-1.5 text-[11px] text-strata-700">
      <li className="font-semibold text-earth">Open a step to see one disc per item</li>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full border-2 ${item.swatch}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ── Which floor is in view ──────────────────────────────────────────────────

function useFloorInView(root: React.RefObject<HTMLElement | null>): FloorNumber {
  const [viewing, setViewing] = useState<FloorNumber>(1);
  useEffect(() => {
    const scroller = root.current;
    if (!scroller) return;
    const shares = new Map<FloorNumber, number>();
    const floors = (Object.entries(FLOOR_IDS) as [string, string][]).map(([floor, id]) => ({
      floor: Number(floor) as FloorNumber,
      node: document.getElementById(id),
    }));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const floor = floors.find((row) => row.node === entry.target)?.floor;
          // Share of the viewport the floor covers, so a tall floor is not penalised.
          if (floor) shares.set(floor, entry.intersectionRect.height / Math.max(1, entry.rootBounds?.height ?? 1));
        }
        let best: FloorNumber = 1;
        let most = -1;
        for (const [floor, share] of shares) {
          if (share > most) {
            most = share;
            best = floor;
          }
        }
        setViewing(best);
      },
      { root: scroller, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    for (const { node } of floors) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [root]);
  return viewing;
}

// ── Workspace ───────────────────────────────────────────────────────────────

/**
 * A project's journey as floors, from the surface down: facility validation
 * (once per facility, in 3D, with Cortex as a moon over the current step),
 * the removal ledger (one block per monitoring period, each through the
 * verification steps), and the calculation tree of the period selected on
 * the ledger. Dashed lines join the floors; the page always shows where the
 * project is.
 */
export function JourneyWorkspace({ request }: { request: JourneyRequest }) {
  const scenarioId = useJourney((state) => state.scenarioId);
  const project = useJourney((state) => state.project);
  const selectedStep = useJourney((state) => state.selectedStep);
  const selectStep = useJourney((state) => state.selectStep);
  const load = useJourney((state) => state.load);
  const openProject = useJourney((state) => state.openProject);
  const { reply, error: projectsError } = useCortexProjects();
  const reduce = useReducedMotion();
  const plan = usePlan();
  const scenario = useJourney((state) => state.scenario);
  const here = useHereFloor();
  const scrollRef = useRef<HTMLElement>(null);
  const viewing = useFloorInView(scrollRef);
  // The header follows what has been answered, so a new project fills in as it goes.
  const name = useJourney((state) => state.tasks["setup.name"]?.value) || project?.name || scenario?.name || "";
  const location = useJourney((state) => state.tasks["setup.location"]?.value);
  const place =
    project && !project.practice
      ? location
        ? formatLocation(location)
        : "Location not given yet"
      : scenarioId === "new" && location
        ? formatLocation(location)
        : (scenario?.place ?? "");
  const projects = useMemo(() => (reply?.configured && reply.tenantStatus === "active" ? reply.projects : []), [reply]);
  const methodology = plan.methodology
    ? [plan.methodology.label, plan.methodology.version].filter(Boolean).join(" ")
    : "Methodology not chosen yet";

  // Open what the link asks for, once the user's Cortex projects are known: one of
  // them is read from the server; a practice scenario keeps this tab's answers
  // (for example after a trip to Cortex) unless the link asks for another one.
  // The project is chosen before the journey opens, so there is no switcher here.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!reply && !projectsError)) return;
    opened.current = true;
    // Practice journeys are kept on the server, one per person, so opening one
    // again picks up where it was left.
    const practise = (id: ScenarioId, seed?: Tasks) => void load(id, seed);
    const wanted = request.project ?? (request.practice ? null : projects[0]?.id ?? null);
    const stored = wanted ? projects.find((option) => option.id === wanted) : undefined;
    void (async () => {
      const scenarios = await fetch("/api/journey/scenarios", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ scenarios: { id: string }[] }>) : { scenarios: [] }))
        .catch(() => ({ scenarios: [] }));
      const known = new Set(scenarios.scenarios.map((entry) => entry.id));
      if (stored) {
        const result = await openProject(stored.id, stored.name);
        // Journeys not set up on this deployment: practise on the same scenario if there is one.
        if (result === "unavailable") practise(known.has(stored.id) ? stored.id : "new");
        return;
      }
      const scenarioWanted = request.practice ?? request.project;
      if (scenarioWanted && known.has(scenarioWanted)) {
        practise(scenarioWanted);
        return;
      }
      // An Atlas project without a saved journey, on any registry: practise on it as itself.
      if (request.atlas) {
        practise("new", atlasSeed(request.atlas));
        return;
      }
      practise("fujairah-mineral");
    })();
  }, [reply, projectsError, projects, request, load, openProject]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && useJourney.getState().selectedStep) selectStep(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectStep]);

  const panelOpen = selectedStep !== null;
  // A validation step opened on the top floor takes the scene; the left column steps aside.
  const floorStepOpen = panelOpen && onValidationFloor(selectedStep);

  return (
    <JourneyQuality requested={request.project}>
    <main ref={scrollRef} className="journey-strata scroll-slim fixed inset-0 overflow-x-clip overflow-y-auto">
      <div className="relative">
        {/* Floor 1 · facility validation */}
        <section
          id={FLOOR_IDS[1]}
          aria-label="Floor 1, facility validation"
          className="journey-floor journey-floor--validation h-[100svh] min-h-[640px] overflow-clip"
        >
          <JourneyScene active={viewing === 1} />

          <div
            className={`pointer-events-none absolute top-20 left-4 z-10 flex max-h-[calc(100%-6rem)] w-[min(19rem,calc(100vw-2rem))] flex-col gap-3 transition-opacity duration-300 sm:left-6 lg:left-8 ${
              floorStepOpen ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            <header className="pointer-events-auto">
              <FloorHeading floor={1} eyebrow="once per facility" title="Facility validation" sub={`${methodology} · ${place}`} />
            </header>
            {here === 1 ? (
              <div className="pointer-events-auto">
                <WhereCard />
              </div>
            ) : null}
            <div className="journey-panel scroll-slim pointer-events-auto hidden min-h-0 overflow-y-auto rounded-2xl p-2 lg:block">
              <StepRail />
            </div>
          </div>

          <div
            className={`pointer-events-none absolute inset-x-0 bottom-5 z-10 hidden justify-center transition-opacity duration-300 md:flex ${
              floorStepOpen ? "opacity-0" : "opacity-100"
            }`}
          >
            <div className="pointer-events-auto flex flex-col items-center gap-2">
              <Legend />
              <p className="text-[11px] text-strata-700">
                Drag to look around · Pinch or ⌘-scroll to zoom · Click a step or a disc · Scroll down for the ledger
              </p>
            </div>
          </div>
        </section>

        {/* Floors 2 and 3 · removal ledger and calculation tree */}
        <LowerFloors requested={request.project} />

        <FloorLinks hubLabel="Crediting period starts" calcLabel="How it is calculated" />
      </div>

      {/* Always on screen: the project, where it is, and whether it is saved. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start gap-3 px-4 pt-4 sm:px-6">
        <div className="journey-panel pointer-events-auto flex min-w-0 items-center gap-1 rounded-2xl p-1">
          <Link
            href="/"
            aria-label="Back to Atlas"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-calcite/70 hover:bg-calcite/10 hover:text-calcite"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="min-w-0 truncate px-1 text-[12.5px] font-semibold">{name}</span>
          <span className="hidden shrink-0 pr-2 text-[11px] text-sand xl:inline">· {plan.registry?.label ?? "No registry yet"}</span>
        </div>
        <div className="pointer-events-auto mx-auto hidden min-w-0 md:block">
          <HereBeacon />
        </div>
        <div className={`pointer-events-auto ml-auto hidden shrink-0 transition-opacity duration-300 sm:block ${panelOpen ? "lg:opacity-0" : ""}`}>
          <SyncNote />
        </div>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 md:hidden">
        <div className={`pointer-events-auto min-w-0 ${panelOpen ? "hidden" : ""}`}>
          <HereBeacon />
        </div>
      </div>

      <FloorLift viewing={viewing} hidden={panelOpen} />

      <AnimatePresence mode="wait">
        {panelOpen && selectedStep ? (
          <motion.aside
            key={selectedStep}
            aria-label={`${plan.stepById[selectedStep].label} step`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="journey-panel journey-panel--solid fixed inset-x-3 bottom-3 z-50 flex max-h-[62vh] flex-col overflow-hidden rounded-2xl text-calcite shadow-[0_24px_70px_rgba(13,24,2,0.5)] lg:inset-x-auto lg:top-5 lg:right-5 lg:bottom-5 lg:max-h-none lg:w-[min(470px,42vw)]"
          >
            <StepPanel stepId={selectedStep} />
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </main>
    </JourneyQuality>
  );
}
