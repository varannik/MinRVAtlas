import type { SubsurfaceModel } from "./types";

/**
 * Fujairah subsurface reference scenario.
 *
 * Depth zones and site parameters are the published Fujairah figures from the
 * 2025 independent assessment (University of Bern / ETH Zürich for the Swiss
 * Federal Office for the Environment), as summarised in the "3D subsurface
 * visualisation for CO₂ mineralisation sites" research brief. They are mapped
 * onto this site plan's wells (HASA 1–4). The fracture network is generated
 * from assumed statistics, not from Fujairah image logs.
 */
export const FUJAIRAH_SUBSURFACE: SubsurfaceModel = {
  // The 700 × 300 m surface TEM survey area, centred on the injection well.
  block: { length: 700, width: 300, bottom: 950 },
  centreOn: "hasa-4",
  reservoir: { top: 650, base: 900 },
  layers: [
    {
      id: "surface",
      name: "Surface & alluvial sediments",
      top: 0,
      base: 15,
      color: "#C9BEA7",
      evidence: "interpreted",
      description: "Wadi gravels and weathered surface material. Thickness assumed.",
    },
    {
      id: "aquifer",
      name: "Shallow freshwater aquifer",
      top: 15,
      base: 100,
      color: "#5E9CC4",
      evidence: "interpreted",
      description:
        "Highly fractured, weathered rock holding the shallow freshwater aquifer (0–100 m). A separate system from the injection reservoir.",
    },
    {
      id: "upper",
      name: "Upper ultramafic: groundwater-bearing fractures",
      top: 100,
      base: 400,
      color: "#B39E7A",
      evidence: "interpreted",
      description: "Peridotite with a groundwater-bearing fracture network (100–400 m).",
    },
    {
      id: "serpentinised",
      name: "Serpentinised peridotite",
      top: 400,
      base: 650,
      color: "#5F8A5A",
      evidence: "interpreted",
      description:
        "Higher resistivity, less conductive groundwater and lower fracture porosity. Most fractures here are sealed. The degree of serpentinisation is assumed.",
    },
    {
      id: "reservoir",
      name: "Deep fractured injection reservoir",
      top: 650,
      base: 900,
      color: "#7A5E48",
      evidence: "interpreted",
      description:
        "Selected mineralisation interval (650–900 m). Low matrix porosity: fluid moves through discrete, connected fractures. Reported temperature 60–90 °C.",
    },
    {
      id: "below",
      name: "Peridotite below drilled depth",
      top: 900,
      base: 950,
      color: "#8C8A84",
      evidence: "interpreted",
      description: "Below the ~900 m wells; not characterised.",
    },
  ],
  wells: [
    {
      objectId: "hasa-4",
      role: "injection",
      evidence: "measured",
      note: "Depth from the assessment's two ~900 m wells; mapping them to HASA 4 and HASA 3 is this plan's assumption.",
      intervals: [
        { label: "Casing & cement", top: 0, base: 650, kind: "casing" },
        { label: "Perforated injection interval", top: 650, base: 900, kind: "perforated" },
      ],
      sensors: [{ label: "Downhole pressure & temperature", depth: 645, kind: "pressure-temperature" }],
    },
    {
      objectId: "hasa-3",
      role: "observation",
      evidence: "measured",
      note: "About 21 m from HASA 4 in this plan; the assessment's reference observation well sat about 15 m from the injector.",
      intervals: [
        { label: "Casing & cement", top: 0, base: 650, kind: "casing" },
        { label: "Screened sampling interval", top: 650, base: 900, kind: "screen" },
      ],
      sensors: [
        { label: "Groundwater sampling (tracer, pH, DIC, Mg, Ca, C-14)", depth: 700, kind: "sampling" },
        { label: "Pressure & temperature", depth: 760, kind: "pressure-temperature" },
        { label: "Groundwater sampling (tracer, pH, DIC, Mg, Ca, C-14)", depth: 840, kind: "sampling" },
      ],
    },
    {
      objectId: "hasa-2",
      role: "shallow-aquifer",
      evidence: "interpreted",
      note: "Depth assumed to span the 0–100 m shallow aquifer.",
      intervals: [
        { label: "Casing", top: 0, base: 30, kind: "casing" },
        { label: "Aquifer screen", top: 30, base: 100, kind: "screen" },
      ],
      sensors: [{ label: "Aquifer sampling (CO₂ tracer, chemistry)", depth: 65, kind: "sampling" }],
    },
    {
      objectId: "hasa-1",
      role: "seismic",
      evidence: "interpreted",
      note: "Depth and geophone spacing assumed.",
      intervals: [
        { label: "Casing", top: 0, base: 300, kind: "casing" },
        { label: "Downhole geophone array", top: 300, base: 600, kind: "geophones" },
      ],
      sensors: [
        { label: "Geophone", depth: 350, kind: "geophone" },
        { label: "Geophone", depth: 450, kind: "geophone" },
        { label: "Geophone", depth: 550, kind: "geophone" },
      ],
    },
  ],
  dfn: {
    seed: 4401,
    sets: [
      { name: "Steep NE-dipping set", dip: [60, 85], azimuth: [30, 70] },
      { name: "Steep NW-dipping set", dip: [55, 80], azimuth: [300, 340] },
      { name: "Low-angle veins", dip: [5, 25], azimuth: [0, 360] },
    ],
    zones: [
      {
        layerId: "aquifer",
        count: 60,
        radius: 340,
        length: [6, 24],
        aperture: [0.2, 2],
        states: { open: 0.6, partial: 0.3, sealed: 0.1 },
        filling: "weathering products",
      },
      {
        layerId: "upper",
        count: 110,
        radius: 340,
        length: [8, 40],
        aperture: [0.1, 1.2],
        states: { open: 0.45, partial: 0.35, sealed: 0.2 },
        filling: "serpentine, carbonate",
      },
      {
        layerId: "serpentinised",
        count: 45,
        radius: 300,
        length: [5, 20],
        aperture: [0.05, 0.4],
        states: { open: 0.05, partial: 0.2, sealed: 0.75 },
        filling: "serpentine",
      },
      {
        // Dense enough to percolate: about half connect to the injection interval.
        layerId: "reservoir",
        count: 240,
        radius: 140,
        length: [18, 80],
        aperture: [0.1, 1],
        states: { open: 0.55, partial: 0.3, sealed: 0.15 },
        filling: "serpentine, minor carbonate",
      },
    ],
  },
  tem: { stationSpacing: 50, evidence: "measured" },
  parameters: [
    { label: "Well depth (two wells)", value: "~900 m", evidence: "measured" },
    { label: "Deep reservoir interval", value: "650–900 m", evidence: "interpreted" },
    { label: "Surface TEM survey area", value: "700 × 300 m", evidence: "measured" },
    { label: "Reservoir temperature", value: "60–90 °C", evidence: "measured" },
    { label: "TEM time-lapse test", value: "150 m³ CO₂-bearing water", evidence: "measured" },
    { label: "Injector–observation spacing", value: "≈21 m (plan) · ≈15 m (assessment)", evidence: "interpreted" },
  ],
  sources: [
    "44.01 — Monitoring, Measurement, Reporting and Verification framework (2024)",
    "University of Bern / ETH Zürich — Geological storage of CO₂ by in-situ mineralisation, for the Swiss Federal Office for the Environment (2025)",
    "Characterizing flow paths in peridotite formations (2025)",
  ],
  notes: [
    "Reference scenario from public sources, mapped onto this site plan. Not 44.01's proprietary reservoir data.",
    "The fracture network is generated from assumed sets, densities and apertures. Image-log interpretations would replace it.",
    "Fluid migration, reaction and carbonate precipitation are illustrative, not a reactive-transport simulation.",
    "TEM measures electrical resistivity, not carbonate: a low-resistivity anomaly shows where conductive injected fluid went.",
    "The 2025 assessment did not report direct observation of new carbonate at depth, so mineralised carbon is shown as simulated.",
  ],
};
