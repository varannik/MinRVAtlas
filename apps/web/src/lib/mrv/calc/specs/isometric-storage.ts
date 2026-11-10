import { geologicStorageSpec } from "./geologic-storage";

/**
 * Isometric subsurface storage. Isometric discounts net removal for
 * measurement uncertainty before it issues credits.
 */
export const ISOMETRIC_INSITU = geologicStorageSpec({
  id: "isometric-insitu",
  registry: "Isometric",
  methodology: "In-situ mineralisation storage",
  edition: "Isometric Standard — module edition to confirm",
  creditUnit: "credit",
  rootLabel: "Net CO₂e removed",
  refPrefix: "Isometric storage module",
  sources: ["Isometric Standard and subsurface storage module (edition to confirm)"],
  eligibleShare: true,
  captureLabel: "Capture",
  uncertaintyDiscount: true,
});

/** Direct air capture into storage: all captured CO₂ is atmospheric. */
export const ISOMETRIC_DAC = geologicStorageSpec({
  id: "isometric-dac",
  registry: "Isometric",
  methodology: "Direct air capture with storage",
  edition: "Isometric DAC protocol — edition to confirm",
  creditUnit: "credit",
  rootLabel: "Net CO₂e removed",
  refPrefix: "Isometric DAC protocol",
  sources: ["Isometric Direct Air Capture protocol (edition to confirm)"],
  eligibleShare: false,
  captureLabel: "Direct air capture",
  uncertaintyDiscount: true,
});
