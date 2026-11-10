import { constant, equation, fixed, series } from "../build";
import type { CalcSpec } from "../types";

/** Puro.earth Biochar — stored carbon that persists, less life-cycle emissions. */
export const PURO_BIOCHAR: CalcSpec = {
  id: "puro-biochar",
  registry: "Puro.earth",
  methodology: "Biochar",
  edition: "edition to confirm",
  creditUnit: "CORC",
  proxyId: "m_bc",
  sources: ["Puro Biochar methodology (edition to confirm)"],
  root: equation(
    "R",
    "R",
    "CORCs",
    "tCO₂e",
    "difference",
    [
      equation(
        "S",
        "S",
        "Persistent carbon stored",
        "tCO₂e",
        "product",
        [
          series("m_bc", "m_bc", "Biochar produced (dry)", "t", "BIOCHAR_DRY_MASS_t", "sum", {
            remedy: "Load production weights for the window.",
            reference: "Biochar — carbon content",
          }),
          fixed("C_org", "C_org", "Organic carbon content", "fraction", "ORGANIC_CARBON_FRACTION", "intensity", {
            remedy: "Upload the lab analysis of organic carbon for this production batch.",
            reference: "Biochar — carbon content",
          }),
          fixed("F_p", "F_p", "Persistence factor", "fraction", "PERSISTENCE_FRACTION", "intensity", {
            remedy: "Set the persistence factor from H/C_org and soil temperature.",
            reference: "Biochar — persistence",
          }),
          constant("c2co2", "44/12", "Carbon to CO₂", "tCO₂/tC", 44 / 12, "Molar mass ratio"),
        ],
        { note: "Dry mass × carbon × persistence × 44/12." },
      ),
      equation(
        "E",
        "E",
        "Life-cycle emissions",
        "tCO₂e",
        "sum",
        [
          series("E_prod", "E_prod", "Production emissions", "tCO₂e", "PRODUCTION_EMISSIONS_t", "sum", {
            remedy: "Load metered energy and fuel for the pyrolysis unit.",
          }),
          fixed("E_bm", "E_bm", "Biomass sourcing", "tCO₂e", "BIOMASS_EMISSIONS_t", "prorata", {
            remedy: "Add biomass sourcing emissions from the LCA.",
          }),
          fixed("E_use", "E_use", "End use & transport", "tCO₂e", "USE_EMISSIONS_t", "prorata", {
            remedy: "Add end-use emissions from the LCA.",
          }),
        ],
      ),
    ],
    { note: "Persistent carbon − life-cycle emissions." },
  ),
};
