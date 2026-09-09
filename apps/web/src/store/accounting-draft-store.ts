"use client";

import { create } from "zustand";
import { defaultUnit } from "@/lib/accounting";

export type InputDraft = {
  magnitude: string;
  unit: string;
  stddev: string;
  notes: string;
  datapointId?: string;
};

type AccountingDraftState = {
  byKey: Record<string, InputDraft>;
  selectedEntryId: string | null;
  selectedComponentId: string | null;
  setInput: (key: string, patch: Partial<InputDraft>) => void;
  setInputs: (
    rows: {
      batchId: string;
      componentId: string;
      inputKey: string;
      magnitude: number;
      unit: string;
      quantityKind?: string;
    }[],
  ) => void;
  clearInput: (key: string) => void;
  selectEntry: (id: string | null) => void;
  selectComponent: (id: string | null) => void;
};

export function inputDraftKey(
  batchId: string,
  componentId: string,
  inputKey: string,
): string {
  return `${batchId}:${componentId}:${inputKey}`;
}

export function emptyInputDraft(unit: string): InputDraft {
  return { magnitude: "", unit, stddev: "", notes: "" };
}

export const useAccountingDrafts = create<AccountingDraftState>((set) => ({
  byKey: {},
  selectedEntryId: null,
  selectedComponentId: null,
  setInput: (key, patch) =>
    set((state) => ({
      byKey: {
        ...state.byKey,
        [key]: { ...(state.byKey[key] ?? emptyInputDraft("kg")), ...patch },
      },
    })),
  setInputs: (rows) =>
    set((state) => {
      const byKey = { ...state.byKey };
      for (const row of rows) {
        const key = inputDraftKey(row.batchId, row.componentId, row.inputKey);
        const unit = row.unit || defaultUnit(row.quantityKind);
        byKey[key] = {
          ...(byKey[key] ?? emptyInputDraft(unit)),
          magnitude: String(row.magnitude),
          unit,
        };
      }
      return { byKey };
    }),
  clearInput: (key) =>
    set((state) => {
      const next = { ...state.byKey };
      delete next[key];
      return { byKey: next };
    }),
  selectEntry: (id) => set({ selectedEntryId: id }),
  selectComponent: (id) => set({ selectedComponentId: id }),
}));
