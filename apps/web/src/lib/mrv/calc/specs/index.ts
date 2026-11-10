import type { Project } from "../../../types";
import type { CalcSpec } from "../types";
import { genericSpec } from "./generic";
import { ISOMETRIC_DAC, ISOMETRIC_INSITU } from "./isometric-storage";
import { PURO_BIOCHAR } from "./puro-biochar";
import { PURO_GSC } from "./puro-gsc";

/**
 * Methodology key → crediting tree. Add a methodology by adding a spec file
 * and one line here; the ledger, timeline and calculation view follow.
 */
const SPECS: Record<string, CalcSpec> = {
  "puro-geologically-stored-carbon": PURO_GSC,
  "puro-biochar": PURO_BIOCHAR,
  "isometric-insitu-mineralization": ISOMETRIC_INSITU,
  // Live Certify projects in this org are in-situ mineralisation sites.
  "isometric-certify": ISOMETRIC_INSITU,
  "isometric-dac": ISOMETRIC_DAC,
};

export function calcSpecFor(project: Pick<Project, "methodologyKey" | "registry" | "methodology">): CalcSpec {
  return SPECS[project.methodologyKey] ?? genericSpec(project.registry, project.methodology);
}

export function isGenericSpec(spec: CalcSpec): boolean {
  return spec.id === "generic";
}
