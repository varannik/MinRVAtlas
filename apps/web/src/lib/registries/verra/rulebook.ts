import { ACCENT } from "@/lib/brand";
import type { RegistryRulebook } from "../rulebook";

export const RULEBOOK: RegistryRulebook = {
  registry: "Verra VCS",
  version: "VCS Standard v5.0",
  submissionLabel: "Verification approval & issuance request",
  platform: "Verra Registry / Project Hub",
  sources: [
    "VCS Standard, v5.0 (Sections 3.4, 3.8)",
    "VCS Registration and Issuance Process (Section 4.2)",
    "VCS Program templates, v5.0A / v5.0B (issued 9 June 2026)",
    "Procedure for Applying the AFOLU Non-Permanence Risk Tool, v5.0",
  ],
  core: [
    {
      id: "vcs-filing",
      code: "RF",
      title: "Registry filing",
      accent: ACCENT.tech,
      items: [
        {
          id: "monitoring-report",
          label: "VCS Monitoring Report (v5.0A/B)",
          kind: "document",
          detail:
            "Template edition is fixed by project start date. Digital monitoring report in the Verra Project Hub where the methodology is digitalized.",
          reference: "VCS Standard v5.0 §3.4.2",
          mandatory: true,
        },
        {
          id: "er-calculation",
          label: "Reduction & removal calculation sheet",
          kind: "dataset",
          detail:
            "Emission reduction and removal calculation spreadsheets behind every number in the monitoring report.",
          reference: "Registration & Issuance Process §4.2.4(5)",
          mandatory: true,
        },
        {
          id: "annual-split",
          label: "Volume split per calendar year",
          kind: "dataset",
          detail:
            "The monitoring report must state reductions and/or removals generated in each calendar year of the monitoring period.",
          reference: "VCS Standard v5.0 §3.4.3",
          mandatory: true,
        },
        {
          id: "verification-report",
          label: "VCS Verification Report",
          kind: "document",
          detail:
            "Completed by the VVB on the matching v5.0A/B template before the request reaches Verra.",
          reference: "VCS Standard v5.0 §3.4.4",
          mandatory: true,
        },
        {
          id: "verification-rep",
          label: "Verification Representation",
          kind: "attestation",
          detail: "Signed deed of representation from the VVB.",
          reference: "Registration & Issuance Process §4.2.4(4)",
          mandatory: true,
        },
        {
          id: "issuance-rep",
          label: "Issuance Representation deed",
          kind: "attestation",
          detail:
            "Single or multiple project proponent edition, signed by every proponent.",
          reference: "Registration & Issuance Process §4.2.4(3)",
          mandatory: true,
        },
      ],
    },
    {
      id: "vcs-evidence",
      code: "EV",
      title: "Evidence pack",
      accent: ACCENT.land,
      items: [
        {
          id: "annexes",
          label: "Annexes & supporting documents",
          kind: "document",
          detail:
            "Everything referenced from the project documentation, in English.",
          reference: "Registration & Issuance Process §4.2.4(6)",
          mandatory: true,
        },
        {
          id: "proof-of-right",
          label: "Proof of right / of contracting",
          kind: "document",
          detail:
            "Evidence the proponent holds the right to the reductions or removals being claimed.",
          reference: "Registration & Issuance Process §4.2.4(7)",
          mandatory: true,
        },
        {
          id: "no-double-counting",
          label: "No double counting evidence",
          kind: "attestation",
          detail:
            "Evidence and representation on cancellation of credits under any other GHG program.",
          reference: "Registration & Issuance Process §4.2.4(8)",
          mandatory: true,
        },
        {
          id: "deviations",
          label: "Deviations & design changes",
          kind: "document",
          detail:
            "Methodology or project description deviations applied during the monitoring period.",
          reference: "VCS Standard v5.0 §3.5",
          mandatory: false,
        },
      ],
    },
  ],
  permanence: {
    id: "vcs-permanence",
    code: "NP",
    title: "Non-permanence",
    accent: ACCENT.alert,
    items: [
      {
        id: "risk-report",
        label: "Non-permanence risk report",
        kind: "document",
        detail:
          "AFOLU Non-Permanence Risk Tool worked through for this monitoring period.",
        reference: "AFOLU Non-Permanence Risk Tool v5.0",
        mandatory: true,
      },
      {
        id: "buffer",
        label: "Buffer account contribution",
        kind: "attestation",
        detail:
          "Withheld credit volume derived from the overall risk rating.",
        reference: "AFOLU Non-Permanence Risk Tool v5.0 §3",
        mandatory: true,
      },
      {
        id: "reversal",
        label: "Reversal monitoring & notification",
        kind: "dataset",
        detail:
          "Loss events detected in the period plus notification status to Verra.",
        reference: "VCS Standard v5.0 §3.16",
        mandatory: true,
      },
    ],
  },
};
