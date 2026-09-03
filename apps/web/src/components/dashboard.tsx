"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BoardSlot } from "./dashboard/board-slot";
import { ProjectRail } from "./dashboard/project-rail";
import { RequirementWorkspace } from "./dashboard/requirement-workspace";
import { SpatialConnector } from "./dashboard/spatial-connector";
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
  const portfolioOpen = useDashboard((state) => state.portfolioOpen);
  const setPortfolioOpen = useDashboard((state) => state.setPortfolioOpen);
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
        if (useDashboard.getState().portfolioOpen) {
          setPortfolioOpen(false);
          return;
        }
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
  }, [batch, batches, selectProject, selectRequirement, selectSubmission, setPortfolioOpen]);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <div className="absolute inset-0">
        <DmrvScene />
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <SpatialConnector />
        <div className="relative z-50">
          <TopBar
            project={project}
            batches={batches}
            activeBatchId={batch?.id}
          />
        </div>

        {project ? (
          <div
            className={`relative z-25 min-h-0 flex-1 px-5 pt-1 pb-1 ${
              workspaceOpen
                ? "grid grid-cols-5 gap-4"
                : "flex justify-center"
            }`}
          >
            <div
              className={
                workspaceOpen
                  ? "col-span-2 min-h-0 min-w-0"
                  : "h-full w-full max-w-5xl"
              }
            >
              <BoardSlot />
            </div>

            <AnimatePresence>
              {batches && batch && selectedItem ? (
                <motion.div
                  key="workspace"
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{
                    duration: reduceMotion ? 0.2 : 0.45,
                    ease: EASE,
                  }}
                  className="pointer-events-none col-span-3 flex min-h-0 min-w-0"
                >
                  <RequirementWorkspace item={selectedItem} batch={batch} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1" />
        )}

        <AnimatePresence>
          {portfolioOpen ? (
            <>
              <motion.button
                key="portfolio-shade"
                type="button"
                aria-label="Close portfolio"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0.15 : 0.25, ease: EASE }}
                onClick={() => setPortfolioOpen(false)}
                className="pointer-events-auto absolute inset-x-0 top-16 bottom-0 z-30 cursor-pointer border-0 bg-off-white/40 p-0 appearance-none"
              />
              <motion.div
                key="portfolio-drawer"
                id="portfolio-drawer"
                initial={{ opacity: 0, x: -28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: reduceMotion ? 0.2 : 0.35, ease: EASE }}
                className="pointer-events-auto absolute top-16 bottom-5 left-5 z-40 flex min-h-0"
              >
                <ProjectRail />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
