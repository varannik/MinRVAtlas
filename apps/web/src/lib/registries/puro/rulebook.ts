import { ACCENT } from "@/lib/brand";
import type { RegistryRulebook } from "../rulebook";

export const RULEBOOK: RegistryRulebook = {
  registry: "Puro.earth",
  version: "Puro Standard General Rules 4.3",
  submissionLabel: "Output audit & CORC issuance",
  platform: "Puro Registry",
  sources: [
    "Puro Standard General Rules 4.3 (Sections 2.3.2, 3.2)",
    "Puro Biochar Methodology, Edition 2025 (Sections 3.1, 5)",
  ],
  core: [
    {
      id: "puro-output",
      code: "OR",
      title: "Output report",
      accent: ACCENT.land,
      items: [
        {
          id: "output-report",
          label: "Output Report for the period",
          kind: "document",
          detail:
            "Submitted per production facility per monitoring period; starts the Output Audit.",
          reference: "General Rules 4.3 §2.3.2.1",
          mandatory: true,
        },
        {
          id: "production-records",
          label: "Continuous production records",
          kind: "dataset",
          detail:
            "Unbroken record keeping for the whole period, including significant changes or stops in production.",
          reference: "Biochar Methodology 2025 §5.3.1(i)",
          mandatory: true,
        },
        {
          id: "dry-mass",
          label: "Dry mass quantification method",
          kind: "dataset",
          detail:
            "Data and method used to calculate the dry mass of biochar produced and sold.",
          reference: "Biochar Methodology 2025 §5.3.1(ii)",
          mandatory: true,
        },
        {
          id: "info-system",
          label: "Time-stamped monitoring records",
          kind: "dataset",
          detail:
            "Information system holding quantitative, time-stamped records of every monitored parameter, accessible to the auditor and retained at least two years past the crediting period.",
          reference: "Biochar Methodology 2025 §5 (monitoring records)",
          mandatory: true,
        },
        {
          id: "qc",
          label: "Documented QA/QC procedures",
          kind: "document",
          detail:
            "Quality control over the GHG inventory: relevance, completeness, consistency, accuracy, transparency, conservativeness.",
          reference: "Biochar Methodology 2025 §4 (GHG inventory QC)",
          mandatory: true,
        },
      ],
    },
    {
      id: "puro-audit",
      code: "AU",
      title: "Audit trail",
      accent: ACCENT.alert,
      items: [
        {
          id: "facility-audit",
          label: "Valid Production Facility Audit",
          kind: "attestation",
          detail:
            "Initial on-site third-party facility audit must be in place before any CORC issuance.",
          reference: "Biochar Methodology 2025 §3.1.2",
          mandatory: true,
        },
        {
          id: "output-audit",
          label: "Output Audit Report & Statement",
          kind: "document",
          detail:
            "Third-party desk study plus site visit confirming the reported net CO2 removal; published on the registry.",
          reference: "General Rules 4.3 §2.3.2.3–2.3.2.5",
          mandatory: true,
        },
        {
          id: "corrective-actions",
          label: "Corrective action status",
          kind: "document",
          detail:
            "Status of every corrective action raised by auditors in earlier periods.",
          reference: "Biochar Methodology 2025 §3.1.4",
          mandatory: true,
        },
        {
          id: "change-notice",
          label: "Equipment & capacity change notices",
          kind: "document",
          detail:
            "Capacity expansions notified within 30 days of the financial decision; other material changes notified promptly.",
          reference: "Biochar Methodology 2025 §3.1.5",
          mandatory: false,
        },
      ],
    },
  ],
};
