"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BoardSlot } from "./dashboard/board-slot";
import { PortfolioOverview } from "./dashboard/portfolio-overview";
import { ProjectRail } from "./dashboard/project-rail";
import { AppSwitcher } from "./nav/app-switcher";
import { ProjectSetupWorkspace } from "./dashboard/project-setup/workspace";
import { RequirementWorkspace } from "./dashboard/requirement-workspace";
import { PeriodDesk } from "./dashboard/period-desk";
import { SpatialConnector } from "./dashboard/spatial-connector";
import { ProjectStage } from "./stage/project-stage";
import { TopBar } from "./dashboard/top-bar";
import { getSubmissions } from "@/lib/submissions";
import { overlayBatches } from "@/lib/sentinel/overlay";
import { useIsometricProjects } from "@/hooks/use-isometric-projects";
import { useReportingPeriods } from "@/hooks/use-reporting-periods";
import { useRequirementSpec } from "@/hooks/use-requirement-spec";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { useStageMode } from "@/hooks/use-stage-mode";
import { useDashboard } from "@/store/dashboard-store";
import { hydratePipelineStore, usePipeline } from "@/store/pipeline-store";
import { useRegistrySubmit } from "@/store/registry-submit-store";
import { useLocationStore } from "@/store/location-store";
import { useStage } from "@/store/stage-store";
import { siteLayoutFor } from "@/lib/site-layouts";

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

const ChainView = dynamic(
  () => import("./site/chain-view").then((mod) => mod.ChainView),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-off-white">
        <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-mist uppercase">
          <span className="size-2 animate-pulse rounded-full bg-carbon-400" />
          Building the 3D chain
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
  const setupOpen = useDashboard((state) => state.setupOpen);
  const closeSetup = useDashboard((state) => state.closeSetup);
  const siteOpen = useDashboard((state) => state.siteOpen);
  const closeSite = useDashboard((state) => state.closeSite);
  const focusProject = useDashboard((state) => state.focusProject);
  const setRequirementSpec = useDashboard((state) => state.setRequirementSpec);
  const loadLocations = useLocationStore((state) => state.load);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const submitByKey = useRegistrySubmit((state) => state.byKey);
  const reduceMotion = useReducedMotion();
  const stageMode = useStageMode();
  const enterStage = useStage((state) => state.enter);
  const closeDesk = useStage((state) => state.closeDesk);
  useIsometricProjects();

  useEffect(() => {
    enterStage(selectedProjectId);
  }, [enterStage, selectedProjectId]);

  useEffect(() => {
    hydratePipelineStore();
  }, []);

  useEffect(() => {
    void loadLocations(tenantId);
  }, [loadLocations, tenantId]);

  const project = useResolvedProject(selectedProjectId);
  const siteLayout = siteLayoutFor(project?.id);
  const { spec, meta } = useRequirementSpec(project);
  const { periods, latestId } = useReportingPeriods(project);

  // The 3D board reads the resolved spec from the store, so the panel and the
  // scene always render the same requirement set.
  useEffect(() => {
    setRequirementSpec(project?.id ?? null, spec ?? null, meta ?? null);
  }, [meta, project?.id, setRequirementSpec, spec]);

  const rawBatches = useMemo(
    () => (project && spec ? getSubmissions(project, spec, periods) : null),
    [periods, project, spec],
  );
  const batches = useMemo(
    () =>
      rawBatches
        ? overlayBatches(rawBatches, pipelineByKey, submitByKey)
        : null,
    [pipelineByKey, rawBatches, submitByKey],
  );
  const batch =
    batches?.find((entry) => entry.id === selectedSubmissionId) ??
    batches?.[batches.length - 1] ??
    null;
  const selectedItem =
    batch?.items.find((item) => item.slotId === selectedSlotId) ?? null;
  const workspaceOpen = Boolean(selectedItem) || setupOpen;

  useEffect(() => {
    if (!batches?.length) {
      if (selectedSubmissionId) selectSubmission(null);
      return;
    }
    if (!batches.some((entry) => entry.id === selectedSubmissionId) && latestId) {
      selectSubmission(latestId);
    }
  }, [batches, latestId, selectSubmission, selectedSubmissionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const state = useDashboard.getState();
        const stage = useStage.getState();
        if (stage.calc) {
          stage.closeCalc();
          return;
        }
        if (stage.ledgerOpen && !stage.deskOpen) {
          // Inside the ledger page, Escape first drops the selection.
          if (stage.selection || stage.focusedBlockId) stage.focusBlock(null);
          else stage.closeLedger();
          return;
        }
        if (state.siteOpen) {
          closeSite();
          return;
        }
        if (state.setupOpen) {
          closeSetup();
          return;
        }
        if (state.selectedSlotId) {
          selectRequirement(null);
          return;
        }
        if (stage.deskOpen) {
          stage.closeDesk();
          return;
        }
        if (stage.selection || stage.focusedBlockId) {
          stage.focusBlock(null);
          return;
        }
        if (state.selectedProjectId) {
          selectProject(null);
          return;
        }
        focusProject(null);
        return;
      }
      if (useDashboard.getState().selectedSlotId) return;
      if (useDashboard.getState().siteOpen) return;
      // Period arrows belong to the filing desk; the stage has its own keys.
      if (!useStage.getState().deskOpen && !useDashboard.getState().setupOpen) return;
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
  }, [batch, batches, closeSetup, closeSite, focusProject, selectProject, selectRequirement, selectSubmission]);

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
            stageMode={stageMode}
            onBackToStage={closeDesk}
          />
        </div>

        {project && stageMode ? (
          <ProjectStage project={project} batches={batches} />
        ) : project ? (
          <div
            className={`relative z-25 min-h-0 flex-1 px-5 pt-1 pb-1 ${
              workspaceOpen
                ? "grid grid-cols-5 gap-4"
                : "flex justify-center gap-4"
            }`}
          >
            <div
              className={
                workspaceOpen
                  ? "col-span-2 min-h-0 min-w-0"
                  : "h-full min-w-0 flex-1"
              }
            >
              <BoardSlot>
                {project && batch ? (
                  <PeriodDesk project={project} batch={batch} />
                ) : null}
              </BoardSlot>
            </div>

            <AnimatePresence>
              {project && setupOpen ? (
                <motion.div
                  key="setup-workspace"
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{
                    duration: reduceMotion ? 0.2 : 0.45,
                    ease: EASE,
                  }}
                  className="pointer-events-none col-span-3 flex min-h-0 min-w-0"
                >
                  <ProjectSetupWorkspace project={project} />
                </motion.div>
              ) : batches && batch && selectedItem ? (
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

        {/* Map: projects on the left, overview on the right, globe between. */}
        <AnimatePresence>
          {!project ? (
            <>
              <motion.div
                key="project-rail"
                initial={{ opacity: 0, x: -28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: reduceMotion ? 0.2 : 0.35, ease: EASE }}
                className="pointer-events-auto absolute top-16 bottom-5 left-5 z-40 flex min-h-0"
              >
                <ProjectRail />
              </motion.div>
              <motion.div
                key="portfolio-overview"
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 28 }}
                transition={{ duration: reduceMotion ? 0.2 : 0.35, ease: EASE }}
                className="pointer-events-auto absolute top-16 right-5 bottom-5 z-40 flex min-h-0"
              >
                <PortfolioOverview />
              </motion.div>
              <AppSwitcher active="atlas" />
            </>
          ) : null}
        </AnimatePresence>
      </div>

      {project && siteLayout && siteOpen ? (
        <ChainView project={project} layout={siteLayout} onClose={closeSite} />
      ) : null}
    </main>
  );
}
