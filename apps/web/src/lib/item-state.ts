import { ACCENT } from "./brand";
import type { ItemKind, ItemState } from "./types";

export const ITEM_STATE_META: Record<
  ItemState,
  { label: string; color: string }
> = {
  complete: { label: "Verified", color: ACCENT.land },
  pending: { label: "In review", color: ACCENT.alert },
  rejected: { label: "Rejected", color: ACCENT.reject },
  missing: { label: "Missing", color: ACCENT.neutral },
};

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  document: "Document",
  dataset: "Dataset",
  "sensor-stream": "Sensor stream",
  attestation: "Attestation",
};
