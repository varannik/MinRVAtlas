"use client";

import { create } from "zustand";

/** The chosen project rides in the address (?project=), so a reload keeps it without browser storage. */
const PARAM = "project";

function setParam(value: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(PARAM, value);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url);
}

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
    setParam(catalogProjectId);
    set({
      catalogProjectId,
      projectId: sentinelProjectId,
      projectName: name,
    });
  },
  clearProject: () => {
    setParam(null);
    set({ catalogProjectId: null, projectId: null, projectName: null });
  },
}));

/** The project the address asks for, if any. */
export function requestedQualityCatalogId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}
