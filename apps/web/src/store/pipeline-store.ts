"use client";

import { create } from "zustand";

import {
  pipelineKey,
  type PipelineResult,
} from "@/lib/sentinel/pipeline-types";

type PipelineState = {
  byKey: Record<string, PipelineResult>;
  put: (result: PipelineResult) => void;
};

export const usePipeline = create<PipelineState>((set) => ({
  byKey: {},
  put: (result) =>
    set((state) => {
      const key = pipelineKey(result.projectId, result.batchId, result.slotId);
      const byKey = { ...state.byKey, [key]: result };
      return { byKey };
    }),
}));

export function lookupPipeline(
  projectId: string,
  batchId: string,
  slotId: string,
): PipelineResult | undefined {
  return usePipeline.getState().byKey[pipelineKey(projectId, batchId, slotId)];
}

