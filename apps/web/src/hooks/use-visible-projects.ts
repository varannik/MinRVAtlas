"use client";

import { useMemo } from "react";
import { applyLocationOverlay } from "@/lib/project-locations";
import { uniqueProjects } from "@/lib/registries/isometric/project-map";
import { catalogProject, useCatalogLoaded } from "@/store/catalog-store";
import { useDashboard } from "@/store/dashboard-store";
import { useLiveProjects } from "@/store/live-projects-store";
import { useLocationStore } from "@/store/location-store";
import type { Project } from "@/lib/types";

function matchesQuery(project: Project, needle: string): boolean {
  if (!needle) return true;
  return `${project.name} ${project.country} ${project.methodology} ${project.developer}`
    .toLowerCase()
    .includes(needle);
}

export function useVisibleProjects(): Project[] {
  const tenantId = useDashboard((state) => state.tenantId);
  const registryFilter = useDashboard((state) => state.registryFilter);
  const query = useDashboard((state) => state.query);
  const overlay = useLocationStore((state) => state.byId);
  const liveProjects = useLiveProjects((state) => state.projects);
  const liveOrigin = useLiveProjects((state) => state.origin);
  const liveTenant = useLiveProjects((state) => state.tenantId);
  const { projects } = useCatalogLoaded();

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    const catalog = projects.filter((project) => {
      if (project.tenantId !== tenantId) return false;
      if (registryFilter !== "all" && project.registry !== registryFilter) {
        return false;
      }
      return matchesQuery(project, needle);
    });

    const liveReady =
      liveTenant === tenantId &&
      liveOrigin === "live" &&
      (registryFilter === "all" || registryFilter === "Isometric");

    if (liveReady) {
      const isometric = liveProjects.filter(
        (project) =>
          project.tenantId === tenantId && matchesQuery(project, needle),
      );
      const liveIds = new Set(isometric.map((project) => project.id));
      const others = catalog.filter(
        (project) =>
          project.registry !== "Isometric" && !liveIds.has(project.id),
      );
      return uniqueProjects(
        [...isometric, ...others].map((project) =>
          applyLocationOverlay(project, overlay),
        ),
      );
    }

    return uniqueProjects(
      catalog.map((project) => applyLocationOverlay(project, overlay)),
    );
  }, [
    liveOrigin,
    liveProjects,
    liveTenant,
    overlay,
    projects,
    query,
    registryFilter,
    tenantId,
  ]);
}

/** Catalog or Certify-fetched project with the operator pin applied. */
export function useResolvedProject(id: string | null): Project | undefined {
  const overlay = useLocationStore((state) => state.byId);
  const liveProjects = useLiveProjects((state) => state.projects);
  const { projects } = useCatalogLoaded();
  return useMemo(() => {
    if (!id) return undefined;
    const project =
      liveProjects.find((entry) => entry.id === id) ?? catalogProject(projects, id);
    return project ? applyLocationOverlay(project, overlay) : undefined;
  }, [id, liveProjects, overlay, projects]);
}
