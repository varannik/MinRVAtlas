import type { SupplyLayout, SupplyRole, SupplyRoute } from "@/lib/site-layouts";

export type Commodity = SupplyLayout["commodity"];

export const ROLE_COLOR: Record<SupplyRole, string> = {
  capture: "#E39A1E",
  primary: "#4F8A2F",
  backup: "#7FA05A",
  site: "#D9473A",
};

export const ROLE_LABEL: Record<SupplyRole, string> = {
  capture: "CO₂ capture site",
  primary: "Primary supply",
  backup: "Back-up supply",
  site: "CO₂ storage site",
};

export const ROUTE_COLOR: Record<Commodity, Record<SupplyRoute["role"], string>> = {
  co2: { primary: "#F08A2E", backup: "#F5B26B" },
  water: { primary: "#3D82F0", backup: "#8DB4F5" },
};

/** Loaded tanker colour; empty tankers on the way back are grey. */
export const TANKER_COLOR: Record<Commodity, string> = {
  co2: "#F08A2E",
  water: "#3D82F0",
};
