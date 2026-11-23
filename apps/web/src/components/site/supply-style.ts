import type { SupplyLayout, SupplyRole, SupplyRoute } from "@/lib/site-layouts";

export type Commodity = SupplyLayout["commodity"];

export const ROLE_COLOR: Record<SupplyRole, string> = {
  capture: "#414F1B",
  primary: "#6F663F",
  backup: "#A8A087",
  site: "#0D1802",
};

export const ROLE_LABEL: Record<SupplyRole, string> = {
  capture: "CO₂ capture site",
  primary: "Primary supply",
  backup: "Back-up supply",
  site: "CO₂ storage site",
};

export const ROUTE_COLOR: Record<Commodity, Record<SupplyRoute["role"], string>> = {
  co2: { primary: "#414F1B", backup: "#8B9C44" },
  water: { primary: "#6F663F", backup: "#A8A087" },
};

/** Loaded tanker colour; empty tankers on the way back are grey. */
export const TANKER_COLOR: Record<Commodity, string> = {
  co2: "#414F1B",
  water: "#6F663F",
};
