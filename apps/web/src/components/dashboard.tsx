"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { ProjectRail } from "./dashboard/project-rail";
import { RequirementWorkspace } from "./dashboard/requirement-workspace";
import { SceneLegend } from "./dashboard/scene-legend";
import { SpatialConnector } from "./dashboard/spatial-connector";
import { SubmissionPanel } from "./dashboard/submission-panel";
import { TopBar } from "./dashboard/top-bar";
import { getSubmissions } from "@/lib/submissions";
import { overlayBatches } from "@/lib/sentinel/overlay";
import { useRequirementSpec } from "@/hooks/use-requirement-spec";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
import { hydratePipelineStore, usePipeline } from "@/store/pipeline-store";
import { useLocationStore } from "@/store/location-store";

const EASE = [0.22, 1, 0.36, 1] as const;

const DmrvScene = dynamic(
  () => import("./scene/dmrv-scene").then((mod) => mod.DmrvScene),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-mist uppercase">
          <span className="size-2 animate-pulse rounded-full bg-carbon-400" />
          Initialising globe
        </div>
      </div>
    ),
  },
);

export function Dashboard() {
  const tenantId = useDashboard((state) => state.tenantId);
  const selectedProjectId = useDashboard((state) => state.selectedProjectId);
  const selectedSubmissionId = useDashboard(
    (state) => state.selectedSubmissionId,
  );
  const selectProject = useDashboard((state) => state.selectProject);
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const selectedSlotId = useDashboard((state) => state.selectedSlotId);
  const setRequirementSpec = useDashboard((state) => state.setRequirementSpec);
  const loadLocations = useLocationStore((state) => state.load);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    hydratePipelineStore();
  }, []);

  useEffect(() => {
    void loadLocations(tenantId);
  }, [loadLocations, tenantId]);

  const project = useResolvedProject(selectedProjectId);
  const { spec, meta } = useRequirementSpec(project);

  // The 3D board reads the resolved spec from the store, so the panel and the
  // scene always render the same requirement set.
  useEffect(() => {
    setRequirementSpec(project?.id ?? null, spec ?? null, meta ?? null);
  }, [meta, project?.id, setRequirementSpec, spec]);

  const rawBatches = useMemo(
    () => (project && spec ? getSubmissions(project, spec) : null),
    [project, spec],
  );
  const batches = useMemo(
    () => (rawBatches ? overlayBatches(rawBatches, pipelineByKey) : null),
    [pipelineByKey, rawBatches],
  );
  const batch =
    batches?.find((entry) => entry.id === selectedSubmissionId) ??
    batches?.[batches.length - 1] ??
    null;
  const selectedItem =
    batch?.items.find((item) => item.slotId === selectedSlotId) ?? null;
  const workspaceOpen = Boolean(selectedItem);
  const selectedSlotIdRef = useRef(selectedSlotId);
  selectedSlotIdRef.current = selectedSlotId;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedSlotIdRef.current) {
          selectRequirement(null);
          return;
        }
        selectProject(null);
        return;
      }
      if (selectedSlotIdRef.current) return;
      if (!batches || !batch) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const index = batches.findIndex((entry) => entry.id === batch.id);
      const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
      if (next < 0 || next >= batches.length) return;
      event.preventDefault();
      selectSubmission(batches[next].id);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [batch, batches, selectProject, selectRequirement, selectSubmission]);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0">
        <DmrvScene />
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AnimatePresence>
          {workspaceOpen ? (
            <motion.button
              key="shade"
              type="button"
              aria-label="Dismiss requirement overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.15 : 0.4, ease: EASE }}
              onClick={() => selectRequirement(null)}
              className="pointer-events-auto fixed inset-0 z-20 cursor-pointer border-0 bg-ink-950/62 p-0 appearance-none"
            />
          ) : null}
        </AnimatePresence>

        <SpatialConnector />
        <TopBar />

        <div className="relative flex min-h-0 flex-1 gap-4 px-5 pt-1">
          <AnimatePresence mode="popLayout">
            {project ? (
              <motion.div
                key="back"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="self-start"
              >
                <button
                  type="button"
                  onClick={() =>
                    workspaceOpen ? selectRequirement(null) : selectProject(null)
                  }
                  className="glass pointer-events-auto relative z-40 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-medium text-mist transition-colors hover:text-frost"
                >
                  <ArrowLeft className="size-4" />
                  {workspaceOpen ? "Back to requirements" : "Back to world map"}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="rail"
                initial={{ opacity: 0, x: -28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex min-h-0"
              >
                <ProjectRail />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {project && batches && batch && selectedItem ? (
              <motion.div
                key="workspace"
                initial={{ opacity: 0, x: 36, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.98 }}
                transition={{
                  duration: reduceMotion ? 0.2 : 0.55,
                  delay: reduceMotion ? 0 : 0.08,
                  ease: EASE,
                }}
                className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-4 lg:inset-y-0 lg:left-auto lg:right-5 lg:w-[min(36rem,46vw)] lg:justify-end lg:px-0"
              >
                <RequirementWorkspace item={selectedItem} batch={batch} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {project && batches && batch ? (
              <motion.div
                key="panel"
                className="absolute inset-y-0 right-5 z-10 flex min-h-0"
                initial={{ opacity: 0, x: 28 }}
                animate={{
                  opacity: 1,
                  x: workspaceOpen ? "calc(100% + 1.25rem)" : 0,
                }}
                exit={{ opacity: 0, x: 28 }}
                transition={{ duration: reduceMotion ? 0.2 : 0.55, ease: EASE }}
                style={{
                  pointerEvents: workspaceOpen ? "none" : "auto",
                }}
              >
                <SubmissionPanel
                  project={project}
                  batches={batches}
                  batch={batch}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <footer className="px-5 py-4">
          <SceneLegend
            mode={project ? (workspaceOpen ? "workspace" : "chain") : "map"}
          />
        </footer>
      </div>
    </main>
  );
}
