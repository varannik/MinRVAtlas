"use client";

import { create } from "zustand";

import { pipelineKey } from "@/lib/sentinel/pipeline-types";

const STORAGE_KEY = "minrv-registry-submits";

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

function readStored(): Record<string, RegistrySubmitRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, RegistrySubmitRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(byKey: Record<string, RegistrySubmitRecord>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
}

export const useRegistrySubmit = create<SubmitState>((set) => ({
  byKey: {},
  put: (record) =>
    set((state) => {
      const key = pipelineKey(record.projectId, record.batchId, record.slotId);
      const byKey = { ...state.byKey, [key]: record };
      writeStored(byKey);
      return { byKey };
    }),
}));

export function hydrateRegistrySubmitStore() {
  const stored = readStored();
  if (Object.keys(stored).length === 0) return;
  useRegistrySubmit.setState({
    byKey: { ...stored, ...useRegistrySubmit.getState().byKey },
  });
}

if (typeof window !== "undefined") {
  hydrateRegistrySubmitStore();
}
