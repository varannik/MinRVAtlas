"use client";

import { create } from "zustand";

const STORAGE_KEY = "minrv-quality-catalog-project-id";

type QualityState = {
  catalogProjectId: string | null;
  projectId: string | null;
  projectName: string | null;
  setBoundProject: (
    catalogProjectId: string,
    sentinelProjectId: string,
    name: string,
  ) => void;
  clearProject: () => void;
};

export const useQuality = create<QualityState>((set) => ({
  catalogProjectId: null,
  projectId: null,
  projectName: null,
  setBoundProject: (catalogProjectId, sentinelProjectId, name) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, catalogProjectId);
    }
    set({
      catalogProjectId,
      projectId: sentinelProjectId,
      projectName: name,
    });
  },
  clearProject: () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    set({ catalogProjectId: null, projectId: null, projectName: null });
  },
}));

export function readStoredQualityCatalogId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}
