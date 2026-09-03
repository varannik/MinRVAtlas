"use client";

import { useMemo } from "react";
import { applyLocationOverlay } from "@/lib/project-locations";
import { getProject, PROJECTS } from "@/lib/projects";
import { useDashboard } from "@/store/dashboard-store";
import { useLocationStore } from "@/store/location-store";
import type { Project } from "@/lib/types";

export function useVisibleProjects(): Project[] {
  const tenantId = useDashboard((state) => state.tenantId);
  const registryFilter = useDashboard((state) => state.registryFilter);
  const query = useDashboard((state) => state.query);
  const overlay = useLocationStore((state) => state.byId);

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PROJECTS.filter((project) => {
      if (project.tenantId !== tenantId) return false;
      if (registryFilter !== "all" && project.registry !== registryFilter) {
        return false;
      }
      if (!needle) return true;
      return `${project.name} ${project.country} ${project.methodology} ${project.developer}`
        .toLowerCase()
        .includes(needle);
    }).map((project) => applyLocationOverlay(project, overlay));
  }, [tenantId, registryFilter, query, overlay]);
}

/** Catalog project with the operator pin applied, even if search filters hide it. */
export function useResolvedProject(id: string | null): Project | undefined {
  const overlay = useLocationStore((state) => state.byId);
  return useMemo(() => {
    const project = getProject(id);
    return project ? applyLocationOverlay(project, overlay) : undefined;
  }, [id, overlay]);
}
