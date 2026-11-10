"use client";

import { create } from "zustand";
import { DEFAULT_TENANT_ID } from "@/lib/tenants";
import type { LiveSpecMeta } from "@/lib/registries";
import type { SetupTabId } from "@/lib/registries/isometric/setup-types";
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
  /** Project setup / PDD desk, exclusive with the requirement popup. */
  setupOpen: boolean;
  /** Full-screen 3D model of the selected project's site. */
  siteOpen: boolean;
  setupTab: SetupTabId;
  registryFilter: RegistryFilter;
  query: string;
  /**
   * Project highlighted on the map: the globe turns to it and the overview
   * shows its figures. Opening it (selectedProjectId) enters the workspace.
   */
  focusedProjectId: string | null;
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
  selectSubmission: (id: string | null) => void;
  hoverProject: (id: string | null) => void;
  hoverSlot: (id: string | null) => void;
  selectRequirement: (slotId: string | null) => void;
  openSetup: (tab?: SetupTabId) => void;
  closeSetup: () => void;
  openSite: () => void;
  closeSite: () => void;
  setSetupTab: (tab: SetupTabId) => void;
  setRegistryFilter: (registry: RegistryFilter) => void;
  setQuery: (query: string) => void;
  focusProject: (id: string | null) => void;
}

export const useDashboard = create<DashboardState>((set) => ({
  tenantId: DEFAULT_TENANT_ID,
  selectedProjectId: null,
  selectedSubmissionId: null,
  hoveredProjectId: null,
  hoveredSlotId: null,
  selectedSlotId: null,
  setupOpen: false,
  siteOpen: false,
  setupTab: "design",
  registryFilter: "Isometric",
  query: "",
  focusedProjectId: null,
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
      setupOpen: false,
      siteOpen: false,
      setupTab: "design",
      registryFilter: "Isometric",
      specProjectId: null,
      requirementSpec: null,
      specMeta: null,
      focusedProjectId: null,
    }),
  selectProject: (id) => {
    set((state) => ({
      selectedProjectId: id,
      // Leaving the workspace keeps the project focused on the map.
      focusedProjectId: id ?? state.selectedProjectId ?? state.focusedProjectId,
      selectedSubmissionId: null,
      hoveredSlotId: null,
      selectedSlotId: null,
      setupOpen: false,
      siteOpen: false,
    }));
  },
  selectSubmission: (id) =>
    set({ selectedSubmissionId: id, hoveredSlotId: null, selectedSlotId: null }),
  hoverProject: (id) => set({ hoveredProjectId: id }),
  hoverSlot: (id) => set({ hoveredSlotId: id }),
  selectRequirement: (slotId) =>
    set({ selectedSlotId: slotId, hoveredSlotId: slotId, setupOpen: false }),
  openSetup: (tab) =>
    set({
      setupOpen: true,
      setupTab: tab ?? "design",
      selectedSlotId: null,
      hoveredSlotId: null,
    }),
  closeSetup: () => set({ setupOpen: false }),
  openSite: () => set({ siteOpen: true, setupOpen: false, selectedSlotId: null }),
  closeSite: () => set({ siteOpen: false }),
  setSetupTab: (tab) => set({ setupTab: tab }),
  // A new registry filter can hide the focused project, so clear it.
  setRegistryFilter: (registry) => set({ registryFilter: registry, focusedProjectId: null }),
  setQuery: (query) => set({ query }),
  focusProject: (id) => set({ focusedProjectId: id }),
}));
