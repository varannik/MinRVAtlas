import type { RegistryRulebook } from "../rulebook";

export const RULEBOOK: RegistryRulebook = {
  registry: "Gold Standard",
  version: "GS4GG Principles & Requirements v2.0",
  submissionLabel: "Performance certification request",
  platform: "Gold Standard Assurance Platform",
  sources: [
    "GS4GG Principles & Requirements, v2.0 (Sections 3.1, 5.1)",
    "Gold Standard Certification Process Step-by-Step (Jan 2026)",
  ],
  core: [
    {
      id: "gs-platform",
      code: "MR",
      title: "Monitoring submission",
      accent: "#4cc4ff",
      items: [
        {
          id: "monitoring-report",
          label: "Gold Standard Monitoring Report",
          kind: "document",
          detail:
            "Reports emission reductions plus every certified SDG impact and its monitoring parameters.",
          reference: "GS4GG P&R v2.0 §3.1.4.4",
          mandatory: true,
        },
        {
          id: "expost-calc",
          label: "Ex-post ER / removal calculation sheet",
          kind: "dataset",
          detail:
            "Calculation workbook submitted alongside the monitoring report.",
          reference: "Certification Process Step-by-Step, Step 5",
          mandatory: true,
        },
        {
          id: "sdg-tool",
          label: "Digital SDG Impact Tool export",
          kind: "dataset",
          detail:
            "SDG impact reporting and the Safeguarding Principles Assessment.",
          reference: "GS4GG P&R v2.0 §3.1.3.3",
          mandatory: true,
        },
        {
          id: "primary-data",
          label: "Primary monitoring data & evidence",
          kind: "dataset",
          detail:
            "Raw survey, meter and sensor records behind the monitoring parameters.",
          reference: "Certification Process Step-by-Step, Step 5",
          mandatory: true,
        },
        {
          id: "annual-report",
          label: "Annual Report (non-verified years)",
          kind: "document",
          detail:
            "Required for each monitoring year where verification is not completed by the end of the next calendar year. Missing it de-certifies the project.",
          reference: "GS4GG P&R v2.0 §5.1.39",
          mandatory: false,
        },
      ],
    },
    {
      id: "gs-review",
      code: "PR",
      title: "Performance review",
      accent: "#9b8cff",
      items: [
        {
          id: "verification-report",
          label: "Final VVB Verification Report",
          kind: "document",
          detail:
            "Uploaded by the GS-approved VVB with a positive verification opinion.",
          reference: "Certification Process Step-by-Step, Step 6",
          mandatory: true,
        },
        {
          id: "vvb-approved-mr",
          label: "VVB-approved Monitoring Report",
          kind: "attestation",
          detail:
            "The monitoring report as signed off by the VVB, not the draft.",
          reference: "Certification Process Step-by-Step, Step 6",
          mandatory: true,
        },
        {
          id: "stakeholder",
          label: "Stakeholder feedback & grievance log",
          kind: "document",
          detail:
            "Continuous engagement record, inputs received and the response to each.",
          reference: "GS4GG P&R v2.0 §5.1.42(b)(c)",
          mandatory: true,
        },
        {
          id: "consultation",
          label: "Global stakeholder consultation",
          kind: "attestation",
          detail:
            "Two-week global consultation run in parallel with the performance review.",
          reference: "Certification Process Step-by-Step, Step 6",
          mandatory: true,
        },
        {
          id: "fee",
          label: "Performance review fee",
          kind: "attestation",
          detail: "Fee settled per the Gold Standard Fee Schedule.",
          reference: "Certification Process Step-by-Step, Step 6",
          mandatory: true,
        },
      ],
    },
  ],
};
