"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Project, Tenant } from "@/lib/types";

/**
 * The Atlas catalogue in this page's memory: the tenants and projects the
 * signed-in person may see, read from /api/atlas/catalog (the Atlas table).
 * Nothing is written to browser storage; a reload reads it again.
 */

type CatalogStatus = "idle" | "loading" | "ready" | "error";

interface CatalogState {
  status: CatalogStatus;
  error?: string;
  tenants: Tenant[];
  projects: Project[];
  load: () => Promise<void>;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  status: "idle",
  tenants: [],
  projects: [],
  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading", error: undefined });
    try {
      const response = await fetch("/api/atlas/catalog", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { tenants?: Tenant[]; projects?: Project[]; error?: string };
      if (!response.ok) {
        set({ status: "error", error: payload.error ?? `The catalogue did not load (${response.status}).` });
        return;
      }
      set({ status: "ready", tenants: payload.tenants ?? [], projects: payload.projects ?? [] });
    } catch {
      set({ status: "error", error: "The catalogue did not load." });
    }
  },
}));

/** Loads the catalogue once per page, and returns it. */
export function useCatalogLoaded(): CatalogState {
  const state = useCatalog();
  const { status, load } = state;
  useEffect(() => {
    if (status === "idle") void load();
  }, [load, status]);
  return state;
}

export function catalogProject(projects: Project[], id: string | null | undefined): Project | undefined {
  return id ? projects.find((project) => project.id === id) : undefined;
}
