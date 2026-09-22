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
  columnBindings: Record<string, string>;
}

interface DraftState {
  bySlot: Record<string, RequirementDraft>;
  get: (slotId: string) => RequirementDraft;
  setNotes: (slotId: string, notes: string) => void;
  addFiles: (slotId: string, files: File[]) => void;
  setFiles: (slotId: string, files: File[]) => void;
  removeFile: (slotId: string, name: string) => void;
  setStage: (slotId: string, stage: DraftStage) => void;
  setBinding: (slotId: string, header: string, canonical: string) => void;
  clearBinding: (slotId: string, header: string) => void;
  replaceFile: (slotId: string, name: string, file: File) => void;
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
    columnBindings: {},
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
  setFiles: (slotId, incoming) => {
    fileBags.set(slotId, [...incoming]);
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: {
          ...emptyDraft(slotId),
          ...state.bySlot[slotId],
          files: metaFor(incoming),
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
  setBinding: (slotId, header, canonical) =>
    set((state) => {
      const current = state.bySlot[slotId] ?? emptyDraft(slotId);
      return {
        bySlot: {
          ...state.bySlot,
          [slotId]: {
            ...current,
            columnBindings: { ...current.columnBindings, [header]: canonical },
          },
        },
      };
    }),
  clearBinding: (slotId, header) =>
    set((state) => {
      const current = state.bySlot[slotId] ?? emptyDraft(slotId);
      const columnBindings = { ...current.columnBindings };
      delete columnBindings[header];
      return {
        bySlot: {
          ...state.bySlot,
          [slotId]: { ...current, columnBindings },
        },
      };
    }),
  replaceFile: (slotId, name, file) => {
    const current = fileBags.get(slotId) ?? [];
    const mapped = current.map((entry) => (entry.name === name ? file : entry));
    const stored = mapped.some((entry) => entry.name === file.name)
      ? mapped
      : [...mapped.filter((entry) => entry.name !== name), file];
    fileBags.set(slotId, stored);
    set((state) => ({
      bySlot: {
        ...state.bySlot,
        [slotId]: {
          ...emptyDraft(slotId),
          ...state.bySlot[slotId],
          files: metaFor(stored),
        },
      },
    }));
  },
  clear: () => {
    fileBags.clear();
    set({ bySlot: {} });
  },
}));
