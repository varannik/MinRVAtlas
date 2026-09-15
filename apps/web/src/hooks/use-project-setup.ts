"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import type { SetupAction } from "@/lib/registries/isometric/setup-types";
import type {
  ProjectSetupSnapshot,
  SetupWriteResult,
} from "@/lib/registries/isometric/setup-types";
import type { Project } from "@/lib/types";
import { rememberProjectDefinition } from "./use-project-definition";

type SetupState = {
  byId: Record<string, ProjectSetupSnapshot>;
  loadingId: string | null;
  remember: (projectId: string, snapshot: ProjectSetupSnapshot) => void;
  setLoading: (projectId: string | null) => void;
};

const useSetupStore = create<SetupState>((set) => ({
  byId: {},
  loadingId: null,
  remember: (projectId, snapshot) =>
    set((state) => ({
      byId: { ...state.byId, [projectId]: snapshot },
      loadingId: state.loadingId === projectId ? null : state.loadingId,
    })),
  setLoading: (projectId) => set({ loadingId: projectId }),
}));

export function useProjectSetup(project: Project | undefined) {
  const snapshot = useSetupStore((state) =>
    project ? state.byId[project.id] ?? null : null,
  );
  const loadingId = useSetupStore((state) => state.loadingId);
  const remember = useSetupStore((state) => state.remember);
  const setLoading = useSetupStore((state) => state.setLoading);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (force = false) => {
      if (!project || project.registry !== "Isometric") return null;
      if (!force && useSetupStore.getState().byId[project.id]) {
        return useSetupStore.getState().byId[project.id] ?? null;
      }
      const controller = new AbortController();
      setLoading(project.id);
      try {
        const response = await fetch(
          `/api/registry/setup?projectId=${encodeURIComponent(project.id)}`,
          {
            headers: { "x-tenant-id": project.tenantId },
            signal: controller.signal,
          },
        );
        const payload = response.ok
          ? ((await response.json()) as ProjectSetupSnapshot)
          : null;
        if (payload) remember(project.id, payload);
        else setLoading(null);
        return payload;
      } catch {
        if (!controller.signal.aborted) setLoading(null);
        return null;
      }
    },
    [project, remember, setLoading],
  );

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const submit = useCallback(
    async (payload: SetupAction, files: File[] = []): Promise<SetupWriteResult> => {
      if (!project) {
        return {
          ok: false,
          error: "No project selected",
          warnings: [],
          sourceIds: [],
          ids: [],
        };
      }
      setSaving(true);
      setError(null);
      try {
        const form = new FormData();
        form.set("project_id", project.id);
        form.set("payload", JSON.stringify(payload));
        for (const file of files) form.append("file", file);
        const response = await fetch("/api/registry/setup", {
          method: "POST",
          headers: { "x-tenant-id": project.tenantId },
          body: form,
        });
        const result = (await response.json()) as SetupWriteResult;
        if (result.snapshot) remember(project.id, result.snapshot);
        if (result.snapshot?.definition) {
          rememberProjectDefinition(project.id, result.snapshot.definition);
        }
        if (!result.ok) {
          setError(result.blocked || result.error || "Certify write failed");
        }
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Certify write failed";
        setError(message);
        return {
          ok: false,
          error: message,
          warnings: [],
          sourceIds: [],
          ids: [],
        };
      } finally {
        setSaving(false);
      }
    },
    [project, remember],
  );

  return {
    snapshot,
    loading: Boolean(project) && !snapshot && loadingId === project?.id,
    saving,
    error,
    reload: () => reload(true),
    submit,
  };
}
