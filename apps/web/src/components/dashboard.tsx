"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PortfolioOverview } from "./dashboard/portfolio-overview";
import { ProjectRail } from "./dashboard/project-rail";
import { TopBar } from "./dashboard/top-bar";
import { AppSwitcher } from "./nav/app-switcher";
import { useIsometricProjects } from "@/hooks/use-isometric-projects";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
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

const ChainView = dynamic(
  () => import("./site/chain-view").then((mod) => mod.ChainView),
  {
    ssr: false,
    loading: () => (
      <div className="journey-floor--validation fixed inset-0 z-[70] grid place-items-center">
        <div className="journey-panel flex items-center gap-3 rounded-full px-4 py-2 text-xs tracking-[0.2em] uppercase">
          <span className="size-2 animate-pulse rounded-full bg-olivine-300" />
          Building the live chain
        </div>
      </div>
    ),
  },
);

/**
 * The Atlas: every project on the globe, the list on the left and the
 * portfolio on the right. A project's live dashboard is its live chain, over
 * the whole screen, on every registry; where no 3D model is built yet, the
 * chain page says so.
 */
export function Dashboard() {
  const tenantId = useDashboard((state) => state.tenantId);
  const selectedProjectId = useDashboard((state) => state.selectedProjectId);
  const selectProject = useDashboard((state) => state.selectProject);
  const focusProject = useDashboard((state) => state.focusProject);
  const loadLocations = useLocationStore((state) => state.load);
  const reduceMotion = useReducedMotion();
  useIsometricProjects();

  useEffect(() => {
    void loadLocations(tenantId);
  }, [loadLocations, tenantId]);

  const project = useResolvedProject(selectedProjectId);

  // Esc leaves an open project for the map, then clears the map's focus.
  // A full-screen view inside the chain catches Esc first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useDashboard.getState().selectedProjectId) selectProject(null);
      else focusProject(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusProject, selectProject]);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <div className="atlas-backdrop absolute inset-0">
        <DmrvScene />
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="relative z-50">
          <TopBar />
        </div>
        <div className="relative min-h-0 flex-1" />

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

      {project ? <ChainView project={project} onClose={() => selectProject(null)} /> : null}
    </main>
  );
}
