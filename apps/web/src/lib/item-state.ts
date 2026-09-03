import type { ItemKind, ItemState } from "./types";

export const ITEM_STATE_META: Record<
  ItemState,
  { label: string; color: string }
> = {
  complete: { label: "Verified", color: "#34e0a1" },
  pending: { label: "In review", color: "#f5b544" },
  rejected: { label: "Rejected", color: "#f2647c" },
  missing: { label: "Missing", color: "#5b6b85" },
};

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  document: "Document",
  dataset: "Dataset",
  "sensor-stream": "Sensor stream",
  attestation: "Attestation",
};
