"use client";

import { create } from "zustand";
import { uniqueProjects } from "@/lib/registries/isometric/project-map";
import type { Project } from "@/lib/types";

type LiveOrigin = "idle" | "loading" | "live" | "fallback";

interface LiveProjectsState {
  tenantId: string | null;
  projects: Project[];
  origin: LiveOrigin;
  warning?: string;
  load: (tenantId: string) => Promise<void>;
}

export const useLiveProjects = create<LiveProjectsState>((set, get) => ({
  tenantId: null,
  projects: [],
  origin: "idle",
  warning: undefined,
  load: async (tenantId) => {
    const current = get();
    if (
      current.tenantId === tenantId &&
      current.origin === "loading"
    ) {
      return;
    }
    set({ tenantId, origin: "loading", warning: undefined });
    try {
      const response = await fetch("/api/registry/projects", {
        headers: { "x-tenant-id": tenantId },
        cache: "no-store",
      });
      if (!response.ok) {
        set({ origin: "fallback", warning: "Could not list Certify projects." });
        return;
      }
      const payload = (await response.json()) as {
        projects?: Project[];
        origin?: "registry-api" | "bundled";
        warning?: string;
      };
      const projects = uniqueProjects(payload.projects ?? []);
      set({
        tenantId,
        projects,
        origin: payload.origin === "registry-api" ? "live" : "fallback",
        warning: payload.warning,
      });
    } catch {
      set({ origin: "fallback", warning: "Could not list Certify projects." });
    }
  },
}));
