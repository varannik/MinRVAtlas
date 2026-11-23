import { ACCENT } from "./brand";
import type { ProjectStatus, Registry } from "./types";

/**
 * Project constants for the UI. The projects themselves live in the Atlas
 * table (lib/atlas) and reach the browser through /api/atlas/catalog.
 */

export const REGISTRIES: Registry[] = [
  "Verra VCS",
  "Gold Standard",
  "Puro.earth",
  "Isometric",
];

export const STATUS_META: Record<
  ProjectStatus,
  { label: string; color: string }
> = {
  draft: { label: "Draft", color: ACCENT.neutral },
  validation: { label: "Validation", color: ACCENT.alert },
  monitoring: { label: "Monitoring", color: ACCENT.tech },
  verification: { label: "Verification", color: ACCENT.storage },
  issued: { label: "Issued", color: ACCENT.land },
};
