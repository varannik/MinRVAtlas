"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ProjectDefinition } from "@/lib/project-definition";
import type { Project } from "@/lib/types";

type DefinitionState = {
  byId: Record<string, ProjectDefinition>;
  loadingId: string | null;
  remember: (projectId: string, definition: ProjectDefinition) => void;
  setLoading: (projectId: string | null) => void;
};

const useDefinitionStore = create<DefinitionState>((set) => ({
  byId: {},
  loadingId: null,
  remember: (projectId, definition) =>
    set((state) => ({
      byId: { ...state.byId, [projectId]: definition },
      loadingId: state.loadingId === projectId ? null : state.loadingId,
    })),
  setLoading: (projectId) => set({ loadingId: projectId }),
}));

export function useProjectDefinition(project: Project | undefined) {
  const definition = useDefinitionStore((state) =>
    project ? state.byId[project.id] ?? null : null,
  );
  const loadingId = useDefinitionStore((state) => state.loadingId);
  const remember = useDefinitionStore((state) => state.remember);
  const setLoading = useDefinitionStore((state) => state.setLoading);

  useEffect(() => {
    if (!project || project.registry !== "Isometric") return;
    const cached = useDefinitionStore.getState().byId[project.id];
    const lcaStale = cached?.artifacts.some(
      (artifact) => artifact.kind === "lca" && !artifact.recipe,
    );
    if (cached && !lcaStale) return;

    const controller = new AbortController();
    setLoading(project.id);
    fetch(
      `/api/registry/definition?projectId=${encodeURIComponent(project.id)}`,
      {
        headers: { "x-tenant-id": project.tenantId },
        signal: controller.signal,
      },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: ProjectDefinition | null) => {
        if (payload) remember(project.id, payload);
        else setLoading(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(null);
      });
    return () => controller.abort();
  }, [project, remember, setLoading]);

  return {
    definition,
    loading: Boolean(project) && !definition && loadingId === project?.id,
  };
}
