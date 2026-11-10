import { equation, fixed, reuse, series } from "../build";
import type { CalcSpec } from "../types";

const gross = series("G", "G", "Gross removals", "tCO₂e", "GROSS_REMOVAL_t", "sum", {
  remedy: "Map the monitoring output that reports gross removals to GROSS_REMOVAL_t.",
});

/**
 * Fallback for methodologies whose crediting maths is not transcribed yet:
 * removals less emissions less leakage. The UI says so next to the tree.
 */
export function genericSpec(registry: string, methodology: string): CalcSpec {
  return {
    id: "generic",
    registry,
    methodology,
    edition: "generic tree — methodology not transcribed",
    creditUnit: "credit",
    proxyId: "G",
    sources: [`${methodology} — crediting equations not transcribed yet`],
    root: equation(
      "R",
      "R",
      "Net removal",
      "tCO₂e",
      "difference",
      [
        gross,
        series("E", "E", "Project emissions", "tCO₂e", "PROJECT_EMISSIONS_t", "sum", {
          remedy: "Map project emissions to PROJECT_EMISSIONS_t.",
        }),
        equation("L", "L", "Leakage", "tCO₂e", "product", [
          reuse(gross, "leak"),
          fixed("f_leak", "f_leak", "Leakage fraction", "fraction", "LEAKAGE_FRACTION", "intensity", {
            remedy: "Set LEAKAGE_FRACTION from the leakage assessment.",
          }),
        ]),
      ],
    ),
  };
}
