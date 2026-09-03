import type { MethodologyModule } from "../types";

const LAND_ACCENT = "#34e0a1";
const TECH_ACCENT = "#4cc4ff";

const MODULES: MethodologyModule[] = [
  {
    key: "ar-acm0003",
    name: "Afforestation and reforestation of lands except wetlands",
    version: "AR-ACM0003 v2.0",
    sources: ["AR-ACM0003 v2.0 (CDM, GS-approved)"],
    group: {
      id: "m-ar",
      code: "MP",
      title: "A/R monitoring",
      accent: LAND_ACCENT,
      items: [
        {
          id: "strata",
          label: "Stratification & area survey",
          kind: "dataset",
          detail:
            "Updated strata boundaries and areas actually planted, GPS surveyed.",
          reference: "AR-ACM0003 §Monitoring",
          mandatory: true,
        },
        {
          id: "inventory",
          label: "Tree biomass inventory",
          kind: "dataset",
          detail: "DBH and height in permanent sample plots per stratum.",
          reference: "AR-ACM0003 §Monitoring",
          mandatory: true,
        },
        {
          id: "allometry",
          label: "Allometric equations & BEF",
          kind: "document",
          detail:
            "Equations, biomass expansion factors and root:shoot ratios with their sources.",
          reference: "AR-ACM0003 §Parameters",
          mandatory: true,
        },
        {
          id: "eligibility",
          label: "Pre-project land eligibility",
          kind: "document",
          detail:
            "Evidence the land was not forest for the required period before the project start date.",
          reference: "A/R eligibility tool",
          mandatory: true,
        },
        {
          id: "leakage",
          label: "Displacement & fuelwood leakage",
          kind: "dataset",
          detail:
            "Survey of displaced grazing, cropping and fuelwood collection.",
          reference: "AR-ACM0003 §Leakage",
          mandatory: true,
        },
        {
          id: "disturbance",
          label: "Fire & harvest record",
          kind: "dataset",
          detail: "Disturbance events and any thinning or harvest in the period.",
          reference: "AR-ACM0003 §Monitoring",
          mandatory: true,
        },
      ],
    },
  },
  {
    key: "ar-ams0007",
    name: "Small-scale A/R on agricultural lands",
    version: "AR-AMS0007 v3.0",
    sources: ["AR-AMS0007 v3.0 (CDM small-scale, GS-approved)"],
    group: {
      id: "m-agro",
      code: "MP",
      title: "Agroforestry monitoring",
      accent: LAND_ACCENT,
      items: [
        {
          id: "plot-register",
          label: "Smallholder plot register",
          kind: "dataset",
          detail:
            "GPS polygon and grower record for every participating parcel, reconciled against last period.",
          reference: "AR-AMS0007 §Monitoring",
          mandatory: true,
        },
        {
          id: "survival",
          label: "Tree survival sampling",
          kind: "dataset",
          detail:
            "Survival counts and replanting per cohort, sampled across the grower base.",
          reference: "AR-AMS0007 §Monitoring",
          mandatory: true,
        },
        {
          id: "threshold",
          label: "Small-scale threshold check",
          kind: "attestation",
          detail:
            "Net anthropogenic removals stay within the small-scale limit for the crediting period.",
          reference: "Small-scale A/R eligibility",
          mandatory: true,
        },
        {
          id: "practice",
          label: "Agroforestry practice records",
          kind: "dataset",
          detail:
            "Species mix, spacing, pruning and intercropping actually applied.",
          reference: "AR-AMS0007 §Monitoring",
          mandatory: true,
        },
        {
          id: "leakage",
          label: "Fuelwood & grazing leakage survey",
          kind: "dataset",
          detail: "Household survey covering displaced activities.",
          reference: "AR-AMS0007 §Leakage",
          mandatory: true,
        },
        {
          id: "participation",
          label: "Grower participation & benefit record",
          kind: "document",
          detail:
            "Agreements, payments and grievances across the grower cohort.",
          reference: "GS4GG safeguards",
          mandatory: false,
        },
      ],
    },
  },
  {
    key: "tpddtec",
    name: "Technologies and Practices to Displace Decentralized Thermal Energy Consumption",
    version: "TPDDTEC v4.0",
    sources: ["Gold Standard TPDDTEC v4.0", "GS Methodology for Metered & Measured Energy Cooking"],
    group: {
      id: "m-stove",
      code: "MP",
      title: "Cookstove monitoring",
      accent: TECH_ACCENT,
      items: [
        {
          id: "distribution",
          label: "Distribution & serial register",
          kind: "dataset",
          detail:
            "Cumulative stoves distributed with serial numbers, household IDs and geolocation.",
          reference: "TPDDTEC v4.0 §Monitoring",
          mandatory: true,
        },
        {
          id: "usage-survey",
          label: "Annual usage survey",
          kind: "dataset",
          detail:
            "Statistically representative sample at 90/10 precision, establishing the usage rate and continued use.",
          reference: "TPDDTEC v4.0 §Sampling",
          mandatory: true,
        },
        {
          id: "sums",
          label: "Stove use monitoring telemetry",
          kind: "sensor-stream",
          detail:
            "SUMs temperature loggers or metered telemetry cross-checking the survey-based usage rate.",
          reference: "TPDDTEC v4.0 §Monitoring",
          mandatory: false,
        },
        {
          id: "fuel-test",
          label: "Baseline & project fuel consumption",
          kind: "dataset",
          detail:
            "Kitchen performance or water boiling test results establishing specific fuel consumption in both scenarios.",
          reference: "TPDDTEC v4.0 §Parameters",
          mandatory: true,
        },
        {
          id: "fnrb",
          label: "fNRB value & justification",
          kind: "dataset",
          detail:
            "Fraction of non-renewable biomass applied, with the source dataset and vintage.",
          reference: "TPDDTEC v4.0 §fNRB",
          mandatory: true,
        },
        {
          id: "stacking",
          label: "Fuel stacking & rebound",
          kind: "document",
          detail:
            "Evidence on continued use of the baseline stove and any rebound in fuel demand.",
          reference: "TPDDTEC v4.0 §Leakage",
          mandatory: true,
        },
        {
          id: "drop-off",
          label: "Drop-off adjustment",
          kind: "dataset",
          detail:
            "Decay in operating stoves over time applied to the credited population.",
          reference: "TPDDTEC v4.0 §Monitoring",
          mandatory: true,
        },
      ],
    },
  },
];

export const GOLD_STANDARD_METHODOLOGIES: Record<string, MethodologyModule> =
  Object.fromEntries(MODULES.map((module) => [module.key, module]));
