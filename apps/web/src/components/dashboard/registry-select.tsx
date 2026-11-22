"use client";

import { Segmented } from "../nav/segmented";
import { useDashboard } from "@/store/dashboard-store";
import type { Registry } from "@/lib/types";

const REGISTRY_OPTIONS = [
  { value: "Isometric", label: "Isometric" },
  { value: "Puro.earth", label: "Puro.earth" },
] as const satisfies readonly { value: Registry; label: string }[];

type AtlasRegistry = (typeof REGISTRY_OPTIONS)[number]["value"];

/**
 * Segmented registry filter in the Atlas menu. It narrows the map, the project
 * list and the overview; it plays no part in creating a project.
 */
export function RegistrySwitch() {
  const registryFilter = useDashboard((state) => state.registryFilter);
  const setRegistryFilter = useDashboard((state) => state.setRegistryFilter);
  const selected: AtlasRegistry = REGISTRY_OPTIONS.some((option) => option.value === registryFilter)
    ? (registryFilter as AtlasRegistry)
    : REGISTRY_OPTIONS[0].value;

  return (
    <Segmented
      label="Registry"
      thumbId="atlas-registry-thumb"
      options={REGISTRY_OPTIONS}
      value={selected}
      onChange={setRegistryFilter}
    />
  );
}
