"use client";

import { create } from "zustand";

import { pipelineKey } from "@/lib/sentinel/pipeline-types";

export type RegistrySubmitRecord = {
  projectId: string;
  batchId: string;
  slotId: string;
  ok: boolean;
  blocked?: string;
  sourceIds: string[];
  datapointIds: string[];
  submissionIds: string[];
  warnings: string[];
  error?: string;
  status: "running" | "submitted" | "failed";
  updatedAt: string;
};

type SubmitState = {
  byKey: Record<string, RegistrySubmitRecord>;
  put: (record: RegistrySubmitRecord) => void;
};

export const useRegistrySubmit = create<SubmitState>((set) => ({
  byKey: {},
  put: (record) =>
    set((state) => {
      const key = pipelineKey(record.projectId, record.batchId, record.slotId);
      const byKey = { ...state.byKey, [key]: record };
      return { byKey };
    }),
}));

