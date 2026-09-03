"use client";

import { create } from "zustand";

export type DraftStage = "intake" | "review" | "running" | "complete" | "failed" | "queued";

export interface DraftFileMeta {
  name: string;
  size: number;
  type: string;
}

export interface RequirementDraft {
  slotId: string;
  notes: string;
  files: DraftFileMeta[];
  stage: DraftStage;
  reviewedAt: string | null;
}

interface DraftState {
  bySlot: Record<string, RequirementDraft>;
  get: (slotId: string) => RequirementDraft;
  setNotes: (slotId: string, notes: string) => void;
  addFiles: (slotId: string, files: File[]) => void;
  removeFile: (slotId: string, name: string) => void;
  setStage: (slotId: string, stage: DraftStage) => void;
  clear: () => void;
}

const fileBags = new Map<string, File[]>();

export function emptyDraft(slotId: string): RequirementDraft {
  return {
    slotId,
    notes: "",
    files: [],
    stage: "intake",
    reviewedAt: null,
  };
}

function isTerminalStage(stage: DraftStage | undefined): boolean {
  return stage === "queued" || stage === "complete" || stage === "failed";
}

function metaFor(files: File[]): DraftFileMeta[] {
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type,
  }));
}

export function getDraftFiles(slotId: string): File[] {
  return fileBags.get(slotId) ?? [];
}

export const useRequirementDrafts = create<DraftState>((set, get) => ({
  bySlot: {},
  get: (slotId) => get().bySlot[slotId] ?? emptyDraft(slotId),
  setNotes: (slotId, notes) =>
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: { ...emptyDraft(slotId), ...state.bySlot[slotId], notes },
      },
    })),
  addFiles: (slotId, incoming) => {
    const current = fileBags.get(slotId) ?? [];
    const merged = [...current];
    for (const file of incoming) {
      if (!merged.some((entry) => entry.name === file.name && entry.size === file.size)) {
        merged.push(file);
      }
    }
    fileBags.set(slotId, merged);
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: {
          ...emptyDraft(slotId),
          ...state.bySlot[slotId],
          files: metaFor(merged),
          stage: isTerminalStage(state.bySlot[slotId]?.stage)
              ? "review"
              : (state.bySlot[slotId]?.stage ?? "intake"),
        },
      },
    }));
  },
  removeFile: (slotId, name) => {
    const next = (fileBags.get(slotId) ?? []).filter((file) => file.name !== name);
    fileBags.set(slotId, next);
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: {
          ...emptyDraft(slotId),
          ...state.bySlot[slotId],
          files: metaFor(next),
        },
      },
    }));
  },
  setStage: (slotId, stage) =>
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: {
          ...emptyDraft(slotId),
          ...state.bySlot[slotId],
          stage,
          reviewedAt:
            stage === "queued" || stage === "complete" || stage === "failed"
              ? new Date().toISOString()
              : state.bySlot[slotId]?.reviewedAt ?? null,
        },
      },
    })),
  clear: () => {
    fileBags.clear();
    set({ bySlot: {} });
  },
}));
