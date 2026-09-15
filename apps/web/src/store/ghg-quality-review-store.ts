"use client";

import { create } from "zustand";
import {
  parseGhgSeries,
  patchGhgCell,
  patchGhgColumn,
  type GhgSeriesTable,
} from "@/lib/ghg-csv-series";
import type {
  AnomalyView,
  QualityFinding,
  QualityStep,
  ResolutionMode,
} from "@/lib/ghg-quality-findings";

export type GhgCellModification = {
  id: string;
  colIndex: number;
  rowIndex: number;
  entityKey: string;
  entityLabel: string;
  previous: number | null;
  value: number;
  reason: string;
  at: string;
};

export function cellEditKey(colIndex: number, rowIndex: number): string {
  return `${colIndex}:${rowIndex}`;
}

export function latestModifications(
  modifications: GhgCellModification[],
): Map<string, GhgCellModification> {
  const map = new Map<string, GhgCellModification>();
  for (const row of modifications) {
    map.set(cellEditKey(row.colIndex, row.rowIndex), row);
  }
  return map;
}

export type GhgQualityReviewState = {
  overlayOpen: boolean;
  step: QualityStep;
  anomalyView: AnomalyView;
  overlayY: boolean;
  running: boolean;
  selectedFindingId: string | null;
  focusedEntityKey: string | null;
  originalCsv: string | null;
  table: GhgSeriesTable | null;
  resolutions: Record<string, ResolutionMode>;
  modifications: GhgCellModification[];
  identities: { dqa: string; anomaly: string; registry: string };
  open: (csvText: string, fileName: string) => void;
  close: () => void;
  setStep: (step: QualityStep) => void;
  setAnomalyView: (view: AnomalyView) => void;
  setOverlayY: (on: boolean) => void;
  setRunning: (running: boolean) => void;
  selectFinding: (id: string | null) => void;
  focusEntity: (key: string | null) => void;
  resolve: (groupId: string, mode: ResolutionMode) => void;
  approveGroups: (groupIds: string[]) => void;
  editCell: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
  editColumn: (colIndex: number, value: number, reason: string) => void;
  rememberIdentities: (next: { dqa: string; anomaly: string; registry: string }) => void;
  dropLaterResolutions: (fromStep: QualityStep) => void;
  reconcileFindings: (live: QualityFinding[]) => void;
};

const emptyIdentities = { dqa: "", anomaly: "", registry: "" };

export const useGhgQualityReview = create<GhgQualityReviewState>((set) => ({
  overlayOpen: false,
  step: 1,
  anomalyView: "heuristic",
  overlayY: false,
  running: false,
  selectedFindingId: null,
  focusedEntityKey: null,
  originalCsv: null,
  table: null,
  resolutions: {},
  modifications: [],
  identities: emptyIdentities,
  open: (csvText, fileName) =>
    set({
      overlayOpen: true,
      step: 1,
      anomalyView: "heuristic",
      overlayY: false,
      running: true,
      selectedFindingId: null,
      focusedEntityKey: null,
      originalCsv: csvText,
      table: parseGhgSeries(csvText, fileName),
      resolutions: {},
      modifications: [],
      identities: emptyIdentities,
    }),
  close: () =>
    set({
      overlayOpen: false,
      running: false,
      selectedFindingId: null,
      focusedEntityKey: null,
      originalCsv: null,
      table: null,
      resolutions: {},
      modifications: [],
      identities: emptyIdentities,
      step: 1,
    }),
  setStep: (step) => set({ step, selectedFindingId: null, focusedEntityKey: null }),
  setAnomalyView: (anomalyView) => set({ anomalyView }),
  setOverlayY: (overlayY) => set({ overlayY }),
  setRunning: (running) => set({ running }),
  selectFinding: (selectedFindingId) => set({ selectedFindingId }),
  focusEntity: (focusedEntityKey) => set({ focusedEntityKey }),
  resolve: (groupId, mode) =>
    set((state) => ({
      resolutions: { ...state.resolutions, [groupId]: mode },
    })),
  approveGroups: (groupIds) =>
    set((state) => {
      if (groupIds.length === 0) return state;
      const resolutions = { ...state.resolutions };
      for (const id of groupIds) {
        if (!resolutions[id]) resolutions[id] = "approved";
      }
      return { resolutions };
    }),
  editCell: (colIndex, rowIndex, value, reason) =>
    set((state) => {
      if (!state.table) return state;
      const entity = state.table.entities.find((row) => row.colIndex === colIndex);
      const previous = entity?.values[rowIndex] ?? null;
      return {
        table: patchGhgCell(state.table, colIndex, rowIndex, value),
        modifications: [
          ...state.modifications,
          {
            id: `${cellEditKey(colIndex, rowIndex)}:${Date.now()}`,
            colIndex,
            rowIndex,
            entityKey: entity?.key ?? String(colIndex),
            entityLabel: entity?.label ?? "",
            previous,
            value,
            reason: reason.trim(),
            at: new Date().toISOString(),
          },
        ],
      };
    }),
  editColumn: (colIndex, value, reason) =>
    set((state) => {
      if (!state.table) return state;
      const constant = state.table.constants.find((row) => row.colIndex === colIndex);
      const previous = constant?.value ?? null;
      return {
        table: patchGhgColumn(state.table, colIndex, value),
        modifications: [
          ...state.modifications,
          {
            id: `${cellEditKey(colIndex, -1)}:${Date.now()}`,
            colIndex,
            rowIndex: -1,
            entityKey: constant?.header ?? String(colIndex),
            entityLabel: constant?.label ?? "",
            previous,
            value,
            reason: reason.trim(),
            at: new Date().toISOString(),
          },
        ],
      };
    }),
  rememberIdentities: (identities) => set({ identities }),
  dropLaterResolutions: (fromStep) =>
    set((state) => {
      const next = { ...state.resolutions };
      for (const key of Object.keys(next)) {
        if (fromStep <= 1 && key.startsWith("anomaly:")) delete next[key];
        if (fromStep <= 2 && key.startsWith("registry:")) delete next[key];
      }
      return { resolutions: next };
    }),
  reconcileFindings: (live) =>
    set((state) => {
      const liveIds = new Set(live.map((row) => row.groupId));
      const next = { ...state.resolutions };
      for (const key of Object.keys(next)) {
        if (!liveIds.has(key)) {
          const kind = key.split(":")[0];
          if (live.some((row) => row.kind === kind)) delete next[key];
        }
      }
      if (!state.table) return { resolutions: next };
      const edited = latestModifications(state.modifications);
      for (const finding of live) {
        if (next[finding.groupId]) continue;
        if (finding.scope === "factor") {
          const header = finding.entityKeys[0];
          if (
            header &&
            state.modifications.some(
              (row) => row.entityKey === header && row.rowIndex === -1,
            )
          ) {
            next[finding.groupId] = "edited";
          }
          continue;
        }
        if (finding.rowIndex == null) continue;
        for (const key of finding.entityKeys) {
          const entity = state.table.entities.find((row) => row.key === key);
          if (
            entity &&
            edited.has(cellEditKey(entity.colIndex, finding.rowIndex))
          ) {
            next[finding.groupId] = "edited";
            break;
          }
        }
      }
      return { resolutions: next };
    }),
}));
