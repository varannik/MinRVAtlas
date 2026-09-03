import type { RegistryRulebook } from "../rulebook";

export const RULEBOOK: RegistryRulebook = {
  registry: "Isometric",
  version: "Isometric Standard + GHG Accounting v1.0",
  submissionLabel: "Certify verification cycle",
  platform: "Isometric Certify",
  sources: [
    "Isometric GHG Accounting module, v1.0",
    "Isometric Direct Air Capture Protocol, v1.3",
    "Isometric Certify validation & verification user guide",
  ],
  core: [
    {
      id: "iso-statement",
      code: "GS",
      title: "GHG statement",
      accent: "#5ce1e6",
      items: [
        {
          id: "ghg-statement",
          label: "GHG Statement",
          kind: "dataset",
          detail:
            "Emissions, removals and counterfactuals presented together in net tCO2e.",
          reference: "GHG Accounting v1.0 §2",
          mandatory: true,
        },
        {
          id: "ghg-report",
          label: "GHG Statement Report",
          kind: "document",
          detail: "Qualitative narrative supporting the GHG Statement.",
          reference: "GHG Accounting v1.0 §2",
          mandatory: true,
        },
        {
          id: "raw-data",
          label: "Raw data & quality justification",
          kind: "dataset",
          detail:
            "Copies of raw data used, with justification wherever medium or low quality data feeds a calculation.",
          reference: "GHG Accounting v1.0 §3.4",
          mandatory: true,
        },
        {
          id: "lca",
          label: "Life cycle assessment inputs",
          kind: "dataset",
          detail:
            "Transport, energy and embodied emissions across the full life cycle.",
          reference: "DAC Protocol v1.3 §6",
          mandatory: true,
        },
        {
          id: "api-stream",
          label: "Certify Open API MRV stream",
          kind: "sensor-stream",
          detail:
            "Continuous monitoring data pushed through the Certify Open API or an integrated MRV provider.",
          reference: "Isometric Certify (data submission)",
          mandatory: true,
        },
        {
          id: "disclosure",
          label: "Public data disclosure set",
          kind: "attestation",
          detail:
            "All numerical data behind the removal is published, minus explicitly restricted licensed emission factors.",
          reference: "DAC Protocol v1.3 §10 (data sharing)",
          mandatory: true,
        },
      ],
    },
    {
      id: "iso-vv",
      code: "VV",
      title: "Validation & verification",
      accent: "#9b8cff",
      items: [
        {
          id: "pdd",
          label: "Project Design Document",
          kind: "document",
          detail:
            "Current PDD in Certify, including the monitoring plan and required records.",
          reference: "Certify validation guide",
          mandatory: true,
        },
        {
          id: "validation-report",
          label: "Validation report",
          kind: "document",
          detail:
            "VVB assessment against the Isometric Standard and applicable protocol, published on the registry.",
          reference: "Certify validation guide",
          mandatory: true,
        },
        {
          id: "verification-report",
          label: "Verification report",
          kind: "document",
          detail:
            "VVB opinion that the GHG Statement is materially correct for the period.",
          reference: "Certify verification guide",
          mandatory: true,
        },
        {
          id: "safeguards",
          label: "Environmental & social safeguards",
          kind: "document",
          detail: "Evidence against the protocol safeguards section.",
          reference: "DAC Protocol v1.3 §5",
          mandatory: true,
        },
      ],
    },
  ],
};
