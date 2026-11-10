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
  {
    // Puro's CCS methodology, as Sentinel's V&V files it (PURO-CCS-GSC).
    // Items follow the operator's process and measurement block diagram:
    // capture → liquefaction → road transport → surface conditioning → reservoir.
    // Section references are left out until the edition in force is confirmed.
    key: "puro-geologically-stored-carbon",
    name: "Puro Geologically Stored Carbon",
    version: "edition to confirm",
    sources: ["Puro Geologically Stored Carbon methodology (edition to confirm)"],
    group: {
      id: "m-gsc",
      code: "GS",
      title: "Capture, transport & storage monitoring",
      accent: TECH_ACCENT,
      items: [
        {
          id: "lco2-weighing",
          label: "Net liquid CO₂ per tanker trip",
          kind: "dataset",
          detail:
            "Weighing-bridge tickets for every tanker trip from the capture site: gross, tare and net liquid CO₂.",
          reference: "GSC — CO₂ quantification",
          mandatory: true,
        },
        {
          id: "biogenic-c14",
          label: "Biogenic CO₂ content (C-14)",
          kind: "dataset",
          detail:
            "Lab analysis of the CO₂ product for C-14, setting the biogenic share eligible for removal credits.",
          reference: "GSC — eligible CO₂ sources",
          mandatory: true,
        },
        {
          id: "co2-impurities",
          label: "CO₂ product impurities analysis",
          kind: "dataset",
          detail: "Composition of the captured CO₂ product before liquefaction.",
          reference: "GSC — CO₂ stream composition",
          mandatory: true,
        },
        {
          id: "capture-inputs",
          label: "Capture & liquefaction inputs",
          kind: "dataset",
          detail:
            "Metered electricity and flue-gas flows; estimated solvent make-up, used solvent and water for the capture site.",
          reference: "GSC — life-cycle emissions",
          mandatory: true,
        },
        {
          id: "transport-log",
          label: "Tanker trips, distance & fuel",
          kind: "dataset",
          detail:
            "Trip log from the transport provider with distance and fuel per trip, feeding the transport emissions.",
          reference: "GSC — life-cycle emissions",
          mandatory: true,
        },
        {
          id: "losses",
          label: "Venting & transit losses",
          kind: "dataset",
          detail:
            "Estimated CO₂ vented at liquefaction and site conditioning, and leakage in transit, deducted from the stored quantity.",
          reference: "GSC — losses and leakage",
          mandatory: true,
        },
        // Storage-side ids match the in-situ mineralisation checks
        // (isometric/step3.ts), so the same Step-3 maths runs under Puro.
        {
          id: "stream-flow",
          label: "Water, tracer & CO₂ stream flow",
          kind: "sensor-stream",
          detail:
            "Continuous metering of water, tracer and CO₂ into the surface conditioning skid, with power use.",
          reference: "GSC — injection monitoring",
          mandatory: true,
          cadence: "continuous",
        },
        {
          id: "injection-pressure",
          label: "Injection & annulus pressure telemetry",
          kind: "sensor-stream",
          detail: "Wellhead and annulus pressure at the injection well.",
          reference: "GSC — injection monitoring",
          mandatory: true,
          cadence: "continuous",
        },
        {
          id: "injectate-composition",
          label: "Injectate sampling",
          kind: "dataset",
          detail:
            "Chemistry of the injected water, tracer concentration and chemistry of the water + CO₂ + tracer mix.",
          reference: "GSC — injection monitoring",
          mandatory: true,
          cadence: "periodic",
        },
        {
          id: "injected-volume",
          label: "Injected CO₂ quantity & CO₂-water ratio",
          kind: "dataset",
          detail: "Stored CO₂ for the period, reconciled against tanker deliveries less losses.",
          reference: "GSC — CO₂ quantification",
          mandatory: true,
          cadence: "annual",
        },
        {
          id: "usdw",
          label: "Shallow aquifer monitoring",
          kind: "dataset",
          detail: "Shallow-aquifer chemistry and tracer at the monitoring well, showing no upward migration.",
          reference: "GSC — storage monitoring",
          mandatory: true,
          cadence: "periodic",
        },
        {
          id: "seismicity",
          label: "Induced seismicity monitoring",
          kind: "sensor-stream",
          detail: "Downhole seismic monitoring well records.",
          reference: "GSC — storage monitoring",
          mandatory: true,
          cadence: "continuous",
        },
        {
          id: "storage-permit",
          label: "Storage site permit",
          kind: "document",
          detail: "Valid permit for the storage site covering this period's injection.",
          reference: "GSC — regulatory compliance",
          mandatory: true,
        },
      ],
    },
  },
];

export const PURO_METHODOLOGIES: Record<string, MethodologyModule> =
  Object.fromEntries(MODULES.map((module) => [module.key, module]));
