import { ACCENT } from "./brand";
import type { ItemKind, ItemState } from "./types";

export const ITEM_STATE_META: Record<
  ItemState,
  { label: string; color: string }
> = {
  submitted: { label: "Submitted", color: ACCENT.land },
  complete: { label: "Ready", color: ACCENT.tech },
  pending: { label: "Partial", color: ACCENT.alert },
  rejected: { label: "Rework", color: ACCENT.reject },
  missing: { label: "Missing", color: ACCENT.neutral },
};

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  document: "Document",
  dataset: "Dataset",
  "sensor-stream": "Sensor stream",
  attestation: "Attestation",
};
