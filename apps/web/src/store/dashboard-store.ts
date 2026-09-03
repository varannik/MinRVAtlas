"use client";

import { create } from "zustand";
import { getProject } from "@/lib/projects";
import { getLatestSubmissionId } from "@/lib/submissions";
import { DEFAULT_TENANT_ID } from "@/lib/tenants";
import type { LiveSpecMeta } from "@/lib/registries";
import type { Registry, RequirementSpec } from "@/lib/types";

type RegistryFilter = Registry | "all";

interface DashboardState {
  tenantId: string;
  selectedProjectId: string | null;
  selectedSubmissionId: string | null;
  hoveredProjectId: string | null;
  hoveredSlotId: string | null;
  /** Requirement currently open in the floating intake popup. */
  selectedSlotId: string | null;
  registryFilter: RegistryFilter;
  query: string;
  /** Requirements in force for the selected project, and where they came from. */
  specProjectId: string | null;
  requirementSpec: RequirementSpec | null;
  specMeta: LiveSpecMeta | null;
  setRequirementSpec: (
    projectId: string | null,
    spec: RequirementSpec | null,
    meta: LiveSpecMeta | null,
  ) => void;
  setTenant: (id: string) => void;
  selectProject: (id: string | null) => void;
  selectSubmission: (id: string) => void;
  hoverProject: (id: string | null) => void;
  hoverSlot: (id: string | null) => void;
  selectRequirement: (slotId: string | null) => void;
  setRegistryFilter: (registry: RegistryFilter) => void;
  setQuery: (query: string) => void;
}

export const useDashboard = create<DashboardState>((set) => ({
  tenantId: DEFAULT_TENANT_ID,
  selectedProjectId: null,
  selectedSubmissionId: null,
  hoveredProjectId: null,
  hoveredSlotId: null,
  selectedSlotId: null,
  registryFilter: "all",
  query: "",
  specProjectId: null,
  requirementSpec: null,
  specMeta: null,
  setRequirementSpec: (projectId, spec, meta) =>
    set({ specProjectId: projectId, requirementSpec: spec, specMeta: meta }),
  setTenant: (id) =>
    set({
      tenantId: id,
      selectedProjectId: null,
      selectedSubmissionId: null,
      hoveredProjectId: null,
      hoveredSlotId: null,
      selectedSlotId: null,
      registryFilter: "all",
      specProjectId: null,
      requirementSpec: null,
      specMeta: null,
    }),
  selectProject: (id) => {
    const project = getProject(id);
    set({
      selectedProjectId: project ? project.id : null,
      selectedSubmissionId: project ? getLatestSubmissionId(project) : null,
      hoveredSlotId: null,
      selectedSlotId: null,
    });
  },
  selectSubmission: (id) =>
    set({ selectedSubmissionId: id, hoveredSlotId: null, selectedSlotId: null }),
  hoverProject: (id) => set({ hoveredProjectId: id }),
  hoverSlot: (id) => set({ hoveredSlotId: id }),
  selectRequirement: (slotId) => set({ selectedSlotId: slotId, hoveredSlotId: slotId }),
  setRegistryFilter: (registry) => set({ registryFilter: registry }),
  setQuery: (query) => set({ query }),
}));
