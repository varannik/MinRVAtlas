import { ACCENT } from "@/lib/brand";
import type { MethodologyModule } from "../types";

const TECH_ACCENT = ACCENT.tech;

const MODULES: MethodologyModule[] = [
  {
    key: "puro-biochar",
    name: "Puro Biochar",
    version: "Edition 2025",
    sources: ["Puro Biochar Methodology, Edition 2025 (Sections 4, 5)"],
    group: {
      id: "m-biochar",
      code: "MP",
      title: "Biochar monitoring",
      accent: TECH_ACCENT,
      items: [
        {
          id: "output-metering",
          label: "Biochar output metering",
          kind: "dataset",
          detail:
            "Metered mass produced and sold, with moisture correction to dry mass.",
          reference: "Biochar 2025 §4.2",
          mandatory: true,
        },
        {
          id: "h-corg",
          label: "H/Corg molar ratio analysis",
          kind: "dataset",
          detail:
            "Lab analysis per production batch establishing the permanence class of the carbon.",
          reference: "Biochar 2025 §4.3",
          mandatory: true,
        },
        {
          id: "feedstock",
          label: "Feedstock sourcing records",
          kind: "document",
          detail:
            "Origin, type and eligibility of biomass feedstock, including competing-use screening.",
          reference: "Biochar 2025 §5.4",
          mandatory: true,
        },
        {
          id: "process-energy",
          label: "Process energy & fuel use",
          kind: "dataset",
          detail:
            "Electricity, heat and auxiliary fuel consumed by the production facility in the period.",
          reference: "Biochar 2025 §4.4",
          mandatory: true,
        },
        {
          id: "end-use",
          label: "End-use application tracking",
          kind: "dataset",
          detail:
            "Where each batch went, application rate and evidence the use qualifies as long-term storage.",
          reference: "Biochar 2025 §5.5",
          mandatory: true,
        },
        {
          id: "transport",
          label: "Transport distances & modes",
          kind: "dataset",
          detail:
            "Feedstock inbound and biochar outbound logistics feeding the emission inventory.",
          reference: "Biochar 2025 §4.5",
          mandatory: true,
        },
        {
          id: "safeguards",
          label: "Environmental & social safeguards",
          kind: "document",
          detail:
            "Safeguard evidence for the facility and its supply chain in this period.",
          reference: "Biochar 2025 §6",
          mandatory: true,
        },
      ],
    },
  },
];

export const PURO_METHODOLOGIES: Record<string, MethodologyModule> =
  Object.fromEntries(MODULES.map((module) => [module.key, module]));
