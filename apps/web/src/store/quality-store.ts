"use client";

import { create } from "zustand";

const STORAGE_KEY = "minrv-quality-project-id";

type QualityState = {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
};

export const useQuality = create<QualityState>((set) => ({
  projectId: null,
  setProjectId: (id) => {
    if (typeof window !== "undefined") {
      if (id) sessionStorage.setItem(STORAGE_KEY, id);
      else sessionStorage.removeItem(STORAGE_KEY);
    }
    set({ projectId: id });
  },
}));

export function readStoredQualityProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}
