"use client";

import { useDashboard } from "@/store/dashboard-store";
import { useStage } from "@/store/stage-store";

type DashboardSlice = { selectedProjectId: string | null; setupOpen: boolean; siteOpen: boolean; selectedSlotId: string | null };

function stageFrom(dashboard: DashboardSlice, deskOpen: boolean): boolean {
  const covered = dashboard.setupOpen || dashboard.siteOpen || Boolean(dashboard.selectedSlotId);
  return Boolean(dashboard.selectedProjectId) && !covered && !deskOpen;
}

/**
 * True while an open project shows its stage: globe in the middle, ledger on
 * the left, site pulse on the right. Setup, the filing desk and the 3D chain
 * each take the screen instead.
 */
export function useStageMode(): boolean {
  const dashboard = useDashboard((state) => stageFrom(state, false));
  const deskOpen = useStage((state) => state.deskOpen);
  return dashboard && !deskOpen;
}

/** Same rule outside React, for pointer handlers and frame loops. */
export function isStageMode(): boolean {
  return stageFrom(useDashboard.getState(), useStage.getState().deskOpen);
}
