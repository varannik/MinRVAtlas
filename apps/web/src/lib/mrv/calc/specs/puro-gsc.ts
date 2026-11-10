import { geologicStorageSpec } from "./geologic-storage";

/** Puro.earth Geologically Stored Carbon — one CORC per tonne of net removal. */
export const PURO_GSC = geologicStorageSpec({
  id: "puro-gsc",
  registry: "Puro.earth",
  methodology: "Geologically Stored Carbon",
  edition: "edition to confirm",
  creditUnit: "CORC",
  rootLabel: "CORCs",
  refPrefix: "GSC",
  sources: ["Puro Geologically Stored Carbon methodology (edition to confirm)"],
  eligibleShare: true,
  captureLabel: "Point-source capture",
  uncertaintyDiscount: false,
});
