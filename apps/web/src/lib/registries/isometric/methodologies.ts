import { ACCENT } from "@/lib/brand";
import type { MethodologyModule } from "../types";

const TECH_ACCENT = ACCENT.tech;

const STORAGE_ACCENT = ACCENT.storage;

const MODULES: MethodologyModule[] = [
  {
    key: "isometric-insitu-mineralization",
    name: "CO₂ Storage via In-situ Mineralization in Mafic and Ultramafic Formations",
    version: "Isometric In-Situ Mineralization v1.0",
    sources: [
      "Isometric module: CO₂ Storage via In-situ Mineralization in Mafic and Ultramafic Formations, v1.0 (Sections 2, 3.1, 3.2)",
      "Isometric Direct Air Capture Protocol, v1.3 §7.4 (mass of CO₂ injected)",
    ],
    group: {
      id: "m-insitu",
      code: "MP",
      title: "In-situ mineralisation monitoring",
      accent: STORAGE_ACCENT,
      items: [
        {
          id: "injection-pressure",
          label: "Injection & annulus pressure telemetry",
          kind: "sensor-stream",
          cadence: "continuous",
          detail:
            "Continuous recording devices on injection pressure and the annulus between tubing and long string casing, held below the maximum allowable surface injection pressure in the permit.",
          reference: "In-Situ Mineralization v1.0 §3.1.1",
          mandatory: true,
        },
        {
          id: "stream-flow",
          label: "CO₂ & water stream flow and temperature",
          kind: "sensor-stream",
          cadence: "continuous",
          detail:
            "Mass flow rate and temperature of both the CO₂ and water streams entering the injection well, from calibrated continuous instruments.",
          reference: "In-Situ Mineralization v1.0 §3.1.1",
          mandatory: true,
        },
        {
          id: "bubble-point",
          label: "Bubble point & solubility trapping check",
          kind: "dataset",
          cadence: "monthly",
          detail:
            "Bubble point pressure recalculated at least monthly with geochemical tools such as PHREEQC, showing reservoir pressure stays over 5 bar above it so dissolved CO₂ is trapped on entry.",
          reference: "In-Situ Mineralization v1.0 §3.1.1",
          mandatory: true,
        },
        {
          id: "injectate-composition",
          label: "Injectate composition analysis",
          kind: "dataset",
          cadence: "periodic",
          detail:
            "pH, temperature, CO₂ concentration, density and gas or dissolved gas impurities that could alter corrosivity or reservoir reactivity, plus major ions for dissolved injection.",
          reference: "In-Situ Mineralization v1.0 §3.1.1",
          mandatory: true,
        },
        {
          id: "injected-volume",
          label: "Cumulative injected mass & CO₂-water ratio",
          kind: "dataset",
          cadence: "annual",
          detail:
            "Injected rate, volume and cumulative mass with the CO₂-to-water ratio proving full dissolution. Reported to the competent authority at least annually.",
          reference: "In-Situ Mineralization v1.0 §3.1.1 / DAC Protocol §7.4.1.4",
          mandatory: true,
        },
        {
          id: "internal-integrity",
          label: "Internal mechanical integrity demonstration",
          kind: "document",
          cadence: "semiannual",
          detail:
            "Every six months, covering loss of mass or thickness, cracking, pitting and corrosion against API or ASTM material standards, including monitoring wells.",
          reference: "In-Situ Mineralization v1.0 §3.1.2",
          mandatory: true,
        },
        {
          id: "external-integrity",
          label: "External integrity & pressure fall-off test",
          kind: "document",
          cadence: "annual",
          detail:
            "Annual external mechanical integrity evidence — oxygen activation, temperature or noise log — together with the annual pressure fall-off test.",
          reference: "In-Situ Mineralization v1.0 §3.1.2",
          mandatory: true,
        },
        {
          id: "near-surface",
          label: "Near-surface gas monitoring",
          kind: "sensor-stream",
          cadence: "continuous",
          detail:
            "Wellhead CO₂ concentrations and operator detectors, plus a surface CO₂, H₂ and CH₄ flux survey against the baseline spatial distribution at least every two years.",
          reference: "In-Situ Mineralization v1.0 §3.1.3.1",
          mandatory: true,
        },
        {
          id: "usdw",
          label: "USDW geochemistry & aquifer pressure",
          kind: "dataset",
          cadence: "periodic",
          detail:
            "Periodic groundwater sampling for pH, temperature, conductivity and major ions in underground sources of drinking water, with pressure monitored in any overlying aquifer.",
          reference: "In-Situ Mineralization v1.0 §3.1.3.1",
          mandatory: true,
        },
        {
          id: "reservoir-model",
          label: "Reservoir model review vs measured behaviour",
          kind: "document",
          cadence: "every-5-years",
          detail:
            "Site characterisation and predictive reservoir models reviewed at least every five years, comparing pre-injection assumptions against observed plume extent and operating conditions.",
          reference: "In-Situ Mineralization v1.0 §2.4",
          mandatory: true,
        },
        {
          id: "seismicity",
          label: "Induced seismicity monitoring",
          kind: "sensor-stream",
          cadence: "continuous",
          detail:
            "Where the site-specific seismic study identifies risk, permit criteria apply a traffic-light system limiting injection. Not applicable where the regulator found no such risk.",
          reference: "In-Situ Mineralization v1.0 §2.3",
          mandatory: false,
        },
      ],
    },
  },
  {
    key: "isometric-dac",
    name: "Direct Air Capture",
    version: "Isometric DAC v1.3",
    sources: [
      "Isometric Direct Air Capture Protocol, v1.3 (Sections 5, 6, 8)",
      "Isometric GHG Accounting module, v1.0",
    ],
    group: {
      id: "m-dac",
      code: "MP",
      title: "DAC monitoring",
      accent: TECH_ACCENT,
      items: [
        {
          id: "co2-captured",
          label: "CO2 captured metering",
          kind: "sensor-stream",
          detail:
            "Metered mass of CO2 captured and delivered to the storage interface, with instrument calibration records.",
          reference: "DAC Protocol v1.3 §8",
          mandatory: true,
        },
        {
          id: "energy",
          label: "Electricity & heat procurement",
          kind: "dataset",
          detail:
            "Consumption plus procurement evidence and the emission factors applied, including any hourly matching claims.",
          reference: "DAC Protocol v1.3 §6",
          mandatory: true,
        },
        {
          id: "sorbent",
          label: "Sorbent / solvent consumption",
          kind: "dataset",
          detail:
            "Make-up quantities and degradation losses with embodied emission factors.",
          reference: "DAC Protocol v1.3 §6",
          mandatory: true,
        },
        {
          id: "storage",
          label: "Injection & storage monitoring",
          kind: "sensor-stream",
          detail:
            "Injected volumes plus the MMV programme required by the applicable storage module.",
          reference: "DAC Protocol v1.3 §7 / storage module",
          mandatory: true,
        },
        {
          id: "storage-conformance",
          label: "Storage site conformance",
          kind: "document",
          detail:
            "Evidence the storage site meets the requirements of the relevant storage module.",
          reference: "DAC Protocol v1.3 §7",
          mandatory: true,
        },
        {
          id: "reversal",
          label: "Leakage & reversal monitoring",
          kind: "dataset",
          detail:
            "Detection results for any loss of stored CO2 during the period.",
          reference: "DAC Protocol v1.3 §7",
          mandatory: true,
        },
        {
          id: "mrv-sampling",
          label: "MRV sampling emissions",
          kind: "dataset",
          detail:
            "Embodied, energy and transport emissions caused by sampling for MRV, including shipping samples for lab analysis.",
          reference: "DAC Protocol v1.3 §6 (sampling required for MRV)",
          mandatory: true,
        },
      ],
    },
  },
];

export const ISOMETRIC_METHODOLOGIES: Record<string, MethodologyModule> =
  Object.fromEntries(MODULES.map((module) => [module.key, module]));
