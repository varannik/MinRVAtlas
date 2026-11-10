"use client";

import { create } from "zustand";
import type { MrvDataset } from "@/lib/mrv/types";
import type { Project } from "@/lib/types";

type Entry =
  | { status: "loading" }
  | { status: "ready"; dataset: MrvDataset }
  | { status: "error"; error: string };

interface MrvDataState {
  byProject: Record<string, Entry>;
  load: (project: Pick<Project, "id" | "tenantId">, force?: boolean) => Promise<void>;
}

/** Monitoring datasets per project, fetched once per session view. */
export const useMrvData = create<MrvDataState>((set, get) => ({
  byProject: {},
  load: async (project, force = false) => {
    const current = get().byProject[project.id];
    if (!force && current && current.status !== "error") return;
    set((state) => ({ byProject: { ...state.byProject, [project.id]: { status: "loading" } } }));
    try {
      const response = await fetch(`/api/mrv/dataset?projectId=${encodeURIComponent(project.id)}`, {
        headers: { "x-tenant-id": project.tenantId },
      });
      const body = (await response.json().catch(() => null)) as MrvDataset | { error?: string } | null;
      if (!response.ok || !body || !("days" in body)) {
        const message = body && "error" in body && body.error ? body.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      set((state) => ({ byProject: { ...state.byProject, [project.id]: { status: "ready", dataset: body } } }));
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [project.id]: { status: "error", error: error instanceof Error ? error.message : "Could not load data" },
        },
      }));
    }
  },
}));
