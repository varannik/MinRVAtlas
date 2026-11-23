"use client";

import { create } from "zustand";
import type { DateRange } from "@/lib/mrv/types";

/** What the calculation view is opened on. */
export type CalcTarget =
  | { kind: "block"; blockId: string }
  | { kind: "range"; range: DateRange };

/**
 * UI state of the project stage (ledger, site pulse, calculation view).
 * Reset whenever a different project is opened.
 */
interface StageState {
  projectId: string | null;
  /** Window dragged on the timeline, not yet a block. */
  selection: DateRange | null;
  focusedBlockId: string | null;
  hoveredBlockId: string | null;
  calc: CalcTarget | null;
  /** Node to open the calculation view on. */
  calcNodeId: string | null;
  /** Full removal ledger page, opened from its stage card. */
  ledgerOpen: boolean;
  /** Classic filing desk (requirements board, GHG entries, statements). */
  deskOpen: boolean;
  enter: (projectId: string | null) => void;
  setSelection: (range: DateRange | null) => void;
  focusBlock: (id: string | null) => void;
  hoverBlock: (id: string | null) => void;
  openCalc: (target: CalcTarget, nodeId?: string | null) => void;
  closeCalc: () => void;
  openLedger: () => void;
  closeLedger: () => void;
  openDesk: () => void;
  closeDesk: () => void;
}

const CLEAR = {
  selection: null,
  focusedBlockId: null,
  hoveredBlockId: null,
  calc: null,
  calcNodeId: null,
  ledgerOpen: false,
  deskOpen: false,
} as const;

export const useStage = create<StageState>((set, get) => ({
  projectId: null,
  ...CLEAR,
  enter: (projectId) => {
    if (get().projectId === projectId) return;
    set({ projectId, ...CLEAR });
  },
  setSelection: (range) => set({ selection: range, focusedBlockId: null }),
  focusBlock: (id) => set({ focusedBlockId: id, selection: null }),
  hoverBlock: (id) => set({ hoveredBlockId: id }),
  openCalc: (target, nodeId = null) => set({ calc: target, calcNodeId: nodeId }),
  closeCalc: () => set({ calc: null, calcNodeId: null }),
  openLedger: () => set({ ledgerOpen: true }),
  // Leaving the ledger page drops its selection, so the stage starts clean.
  closeLedger: () => set({ ledgerOpen: false, selection: null, focusedBlockId: null, hoveredBlockId: null }),
  // The ledger stays open underneath, so closing the desk lands back on it.
  openDesk: () => set({ deskOpen: true, calc: null }),
  closeDesk: () => set({ deskOpen: false }),
}));
