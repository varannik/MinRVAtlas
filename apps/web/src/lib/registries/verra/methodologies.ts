import { ACCENT } from "@/lib/brand";
import type { MethodologyModule } from "../types";

const REDD_ACCENT = ACCENT.land;
const LAND_ACCENT = ACCENT.tech;

const MODULES: MethodologyModule[] = [
  {
    key: "vm0007",
    name: "REDD+ Methodology Framework",
    version: "VM0007 v1.6",
    sources: ["VM0007 REDD+MF v1.6", "VM0048 Reduced Emissions from Deforestation and Degradation v1.0"],
    group: {
      id: "m-redd",
      code: "MP",
      title: "REDD+ monitoring",
      accent: REDD_ACCENT,
      items: [
        {
          id: "activity-data",
          label: "Wall-to-wall activity data map",
          kind: "dataset",
          detail:
            "Annual forest / non-forest change map covering the whole project area and reference region for the monitoring period.",
          reference: "VM0007 §8.1",
          mandatory: true,
        },
        {
          id: "map-accuracy",
          label: "Map accuracy assessment",
          kind: "document",
          detail:
            "Sample-based accuracy assessment of the change map with confidence intervals per class.",
          reference: "VM0007 Module BL-UP",
          mandatory: true,
        },
        {
          id: "stock-inventory",
          label: "Forest carbon stock inventory",
          kind: "dataset",
          detail:
            "Permanent plot remeasurement with allometric equations and the pools included in the accounting.",
          reference: "VM0007 §8.2",
          mandatory: true,
        },
        {
          id: "leakage-belt",
          label: "Leakage belt monitoring",
          kind: "dataset",
          detail:
            "Deforestation observed inside the leakage belt and the share attributed to displaced agents.",
          reference: "VM0007 §8.3",
          mandatory: true,
        },
        {
          id: "allocated-baseline",
          label: "Allocated jurisdictional baseline",
          kind: "dataset",
          detail:
            "Baseline allocated from jurisdictional deforestation data under the VM0048 transition, replacing project-specific projections.",
          reference: "VCS Standard v5.0 §3.6 / VM0048",
          mandatory: true,
        },
        {
          id: "uncertainty",
          label: "Uncertainty deduction",
          kind: "dataset",
          detail:
            "Combined uncertainty across activity data and stock estimates, with the resulting deduction.",
          reference: "VM0007 §8.5",
          mandatory: true,
        },
      ],
    },
  },
  {
    key: "vm0009",
    name: "Avoided Ecosystem Conversion",
    version: "VM0009 v4.0",
    sources: ["VM0009 v4.0", "VM0048 v1.0"],
    group: {
      id: "m-aec",
      code: "MP",
      title: "Avoided conversion monitoring",
      accent: REDD_ACCENT,
      items: [
        {
          id: "conversion-map",
          label: "Ecosystem conversion mapping",
          kind: "dataset",
          detail:
            "Change detection across the project area, reference region and leakage belt for the period.",
          reference: "VM0009 §9.1",
          mandatory: true,
        },
        {
          id: "stock-inventory",
          label: "Biomass & soil stock inventory",
          kind: "dataset",
          detail:
            "Plot remeasurement across all selected pools, including soil where claimed.",
          reference: "VM0009 §9.2",
          mandatory: true,
        },
        {
          id: "agent-analysis",
          label: "Conversion agent & driver analysis",
          kind: "document",
          detail:
            "Updated assessment of who is converting land and why, supporting the baseline rate.",
          reference: "VM0009 §8.1",
          mandatory: true,
        },
        {
          id: "grazing",
          label: "Livestock & land-use activity data",
          kind: "dataset",
          detail:
            "Stocking, grazing and settlement activity inside the project boundary.",
          reference: "VM0009 §9.3",
          mandatory: true,
        },
        {
          id: "allocated-baseline",
          label: "Allocated jurisdictional baseline",
          kind: "dataset",
          detail:
            "Jurisdictional allocation applied at the baseline reassessment under VM0048.",
          reference: "VCS Standard v5.0 §3.6 / VM0048",
          mandatory: true,
        },
        {
          id: "community",
          label: "Community monitoring records",
          kind: "document",
          detail:
            "Ranger patrol logs and community engagement evidence for the period.",
          reference: "VM0009 §9.4",
          mandatory: false,
        },
      ],
    },
  },
  {
    key: "vm0047",
    name: "Afforestation, Reforestation and Revegetation",
    version: "VM0047 v1.1",
    sources: ["VM0047 ARR v1.1"],
    group: {
      id: "m-arr",
      code: "MP",
      title: "ARR monitoring",
      accent: LAND_ACCENT,
      items: [
        {
          id: "canopy",
          label: "Remote-sensed canopy assessment",
          kind: "dataset",
          detail:
            "High-resolution tree cover per stratum, used for the census or sampling approach.",
          reference: "VM0047 §9.1",
          mandatory: true,
        },
        {
          id: "plots",
          label: "Permanent plot inventory",
          kind: "dataset",
          detail:
            "DBH, height and stocking density measured in permanent plots per stratum.",
          reference: "VM0047 §9.2",
          mandatory: true,
        },
        {
          id: "allometry",
          label: "Allometric models & pools",
          kind: "document",
          detail:
            "Species-appropriate allometric equations and the carbon pools claimed.",
          reference: "VM0047 §8.2",
          mandatory: true,
        },
        {
          id: "planting",
          label: "Planting & survival records",
          kind: "dataset",
          detail:
            "Species mix, planting dates and survival counts per parcel.",
          reference: "VM0047 §9.3",
          mandatory: true,
        },
        {
          id: "disturbance",
          label: "Disturbance & harvest log",
          kind: "dataset",
          detail: "Fire, grazing, disease and any harvest events in the period.",
          reference: "VM0047 §9.4",
          mandatory: true,
        },
        {
          id: "uncertainty",
          label: "Sampling error & deduction",
          kind: "dataset",
          detail:
            "Uncertainty across strata and the deduction applied to net removals.",
          reference: "VM0047 §8.6",
          mandatory: true,
        },
      ],
    },
  },
  {
    key: "vm0042",
    name: "Improved Agricultural Land Management",
    version: "VM0042 v2.1",
    sources: [
      "VM0042 v2.1 (Sections 8.1, 8.2, 8.6, Appendix 6)",
      "VM0042 Soil Sampling and Analysis Handbook (draft, Feb 2026)",
      "Verra program notice: depth requirements for soil carbon data",
    ],
    group: {
      id: "m-alm",
      code: "MP",
      title: "Soil carbon monitoring",
      accent: LAND_ACCENT,
      items: [
        {
          id: "soc-depth",
          label: "SOC sampling to at least 30 cm",
          kind: "dataset",
          detail:
            "30 cm is the hard floor for model inputs (approach 1) or measured values (approach 2); 50 cm recommended. Shallower government datasets are only usable for model calibration.",
          reference: "VM0042 v2.1 §8.2 / Verra program notice",
          mandatory: true,
        },
        {
          id: "bulk-density",
          label: "Bulk density measurements",
          kind: "dataset",
          detail:
            "Core, excavation or clod method in the field, oven-dried in the lab.",
          reference: "VM0042 v2.1 §8.2",
          mandatory: true,
        },
        {
          id: "esm",
          label: "Equivalent Soil Mass correction",
          kind: "dataset",
          detail:
            "Stock change reported on an ESM basis. Re-sampling must be taken as contiguous cores split into at least two increments.",
          reference: "VM0042 C&C §8.2.1(7)(c)",
          mandatory: true,
        },
        {
          id: "strata",
          label: "Stratified random sampling design",
          kind: "dataset",
          detail:
            "Strata built from covariates predictive of SOC: texture, slope, historical land use and management history.",
          reference: "VM0042 v2.1 Appendix 6",
          mandatory: true,
        },
        {
          id: "lab",
          label: "Accredited lab analysis",
          kind: "document",
          detail:
            "Dry combustion (Dumas) as the primary method in an ISO/IEC 17025 lab. NIR/MIR spectroscopy may supplement but not replace it.",
          reference: "VM0042 SSA Handbook §4",
          mandatory: true,
        },
        {
          id: "true-up",
          label: "Model true-up remeasurement",
          kind: "dataset",
          detail:
            "Paired remeasurement every five years. A Welch's test at ≥95% power must show model bias on the practice-change scenario is no larger than on the baseline.",
          reference: "VM0042 SSA Handbook §Model true-up",
          mandatory: true,
        },
        {
          id: "model-error",
          label: "Model prediction & sampling error",
          kind: "dataset",
          detail:
            "Both error terms behind the uncertainty deduction, with the model term matched to the length of this verification period.",
          reference: "VM0042 v2.1 §8.6",
          mandatory: true,
        },
        {
          id: "practice-records",
          label: "ALM practice implementation records",
          kind: "dataset",
          detail:
            "Tillage, cover crop, residue, nutrient and irrigation events per quantification unit.",
          reference: "VM0042 v2.1 §8.1",
          mandatory: true,
        },
      ],
    },
  },
  {
    key: "vm0032",
    name: "Adoption of Sustainable Grasslands",
    version: "VM0032 v1.1",
    sources: ["VM0032 v1.1"],
    group: {
      id: "m-grass",
      code: "MP",
      title: "Grassland monitoring",
      accent: LAND_ACCENT,
      items: [
        {
          id: "grazing",
          label: "Grazing management records",
          kind: "dataset",
          detail:
            "Rotation plan actually executed: paddock moves, rest periods and exclusion.",
          reference: "VM0032 §9.1",
          mandatory: true,
        },
        {
          id: "stocking",
          label: "Stocking rate & herd data",
          kind: "dataset",
          detail: "Animal units per hectare over the period, by class.",
          reference: "VM0032 §9.2",
          mandatory: true,
        },
        {
          id: "soc",
          label: "SOC & bulk density sampling",
          kind: "dataset",
          detail:
            "Stratified soil sampling with bulk density for stock change on an equivalent mass basis.",
          reference: "VM0032 §8.3",
          mandatory: true,
        },
        {
          id: "biomass",
          label: "Above & below-ground biomass",
          kind: "dataset",
          detail: "Clipped biomass and root:shoot factors per stratum.",
          reference: "VM0032 §8.2",
          mandatory: true,
        },
        {
          id: "productivity",
          label: "Remote-sensed forage productivity",
          kind: "dataset",
          detail:
            "Seasonal NDVI or productivity index used to stratify and cross-check field data.",
          reference: "VM0032 §9.3",
          mandatory: true,
        },
        {
          id: "disturbance",
          label: "Fire & drought disturbance log",
          kind: "dataset",
          detail: "Events that reset stocks during the monitoring period.",
          reference: "VM0032 §9.4",
          mandatory: true,
        },
      ],
    },
  },
];

export const VERRA_METHODOLOGIES: Record<string, MethodologyModule> =
  Object.fromEntries(MODULES.map((module) => [module.key, module]));
