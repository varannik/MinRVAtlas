"use client";

import { create } from "zustand";

import {
  pipelineKey,
  type PipelineResult,
} from "@/lib/sentinel/pipeline-types";

const STORAGE_KEY = "minrv-pipeline-results";

type PipelineState = {
  byKey: Record<string, PipelineResult>;
  put: (result: PipelineResult) => void;
};

function readStored(): Record<string, PipelineResult> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PipelineResult>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(byKey: Record<string, PipelineResult>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
}

export const usePipeline = create<PipelineState>((set) => ({
  byKey: {},
  put: (result) =>
    set((state) => {
      const key = pipelineKey(result.projectId, result.batchId, result.slotId);
      const byKey = { ...state.byKey, [key]: result };
      writeStored(byKey);
      return { byKey };
    }),
}));

export function hydratePipelineStore() {
  const stored = readStored();
  if (Object.keys(stored).length === 0) return;
  usePipeline.setState({ byKey: { ...stored, ...usePipeline.getState().byKey } });
}

export function lookupPipeline(
  projectId: string,
  batchId: string,
  slotId: string,
): PipelineResult | undefined {
  return usePipeline.getState().byKey[pipelineKey(projectId, batchId, slotId)];
}

if (typeof window !== "undefined") {
  hydratePipelineStore();
}
