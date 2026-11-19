"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { CapabilityId, IntakeKind } from "@/lib/cortex/capabilities";

/**
 * Data files and details the operator has given Cortex, kept in this browser
 * until their backend exists (documents are uploaded; see document-intake.tsx).
 * File contents are never stored, only their description.
 */
export interface StagedItem {
  id: string;
  capabilityId: CapabilityId;
  kind: IntakeKind;
  name: string;
  size?: number;
  mime?: string;
  fields?: Record<string, string>;
  addedAt: string;
}

type Focus = CapabilityId | "core" | null;

type CortexState = {
  selected: Focus;
  hovered: Focus;
  staged: StagedItem[];
  /** Cortex project that documents are sent to (from the tenancy table). */
  projectId: string | null;
  select: (focus: Focus) => void;
  setProject: (projectId: string) => void;
  hover: (focus: Focus) => void;
  stageFiles: (capabilityId: CapabilityId, kind: IntakeKind, files: File[]) => void;
  stageMetadata: (
    capabilityId: CapabilityId,
    name: string,
    fields: Record<string, string>,
  ) => void;
  unstage: (id: string) => void;
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useCortex = create<CortexState>()(
  persist(
    (set) => ({
      selected: null,
      hovered: null,
      staged: [],
      projectId: null,
      select: (focus) => set({ selected: focus }),
      setProject: (projectId) => set({ projectId }),
      hover: (focus) => set({ hovered: focus }),
      stageFiles: (capabilityId, kind, files) =>
        set((state) => ({
          staged: [
            ...files.map((file) => ({
              id: newId(),
              capabilityId,
              kind,
              name: file.name,
              size: file.size,
              mime: file.type || undefined,
              addedAt: new Date().toISOString(),
            })),
            ...state.staged,
          ],
        })),
      stageMetadata: (capabilityId, name, fields) =>
        set((state) => ({
          staged: [
            {
              id: newId(),
              capabilityId,
              kind: "metadata",
              name,
              fields,
              addedAt: new Date().toISOString(),
            },
            ...state.staged,
          ],
        })),
      unstage: (id) =>
        set((state) => ({ staged: state.staged.filter((item) => item.id !== id) })),
    }),
    {
      name: "minrv-cortex-staged-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ staged: state.staged, projectId: state.projectId }),
    },
  ),
);

export function stagedFor(staged: StagedItem[], capabilityId: CapabilityId): StagedItem[] {
  return staged.filter((item) => item.capabilityId === capabilityId);
}
