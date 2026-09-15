export const CERTIFY_ACCOUNT_URL = "https://registry.isometric.com/account/certify";

export type PddSectionId =
  | "project-setup"
  | "protocol-monitoring"
  | "environmental-social"
  | "stakeholder-input"
  | "pathway-specific";

export type PddSourceCategory =
  | "plan-assessment"
  | "technical-drawing"
  | "specification"
  | "lab-result"
  | "operational-record"
  | "model-calculation"
  | "permit-certificate"
  | "contract-affidavit"
  | "stakeholder-record"
  | "reference-evidence"
  | "other";

export const PDD_SECTION_META: Record<
  PddSectionId,
  { code: string; title: string }
> = {
  "project-setup": { code: "A", title: "Project setup" },
  "protocol-monitoring": { code: "B", title: "Protocol & monitoring" },
  "environmental-social": { code: "C", title: "Environmental & social" },
  "stakeholder-input": { code: "D", title: "Stakeholder input" },
  "pathway-specific": { code: "E", title: "Pathway-specific" },
};

export const PDD_SOURCE_CATEGORIES: { id: PddSourceCategory; label: string }[] = [
  { id: "plan-assessment", label: "Plan / Assessment" },
  { id: "technical-drawing", label: "Technical drawing / Diagram" },
  { id: "specification", label: "Specification" },
  { id: "lab-result", label: "Lab result" },
  { id: "operational-record", label: "Operational record" },
  { id: "model-calculation", label: "Model / Calculation" },
  { id: "permit-certificate", label: "Permit / Certificate" },
  { id: "contract-affidavit", label: "Contract / Affidavit" },
  { id: "stakeholder-record", label: "Stakeholder record" },
  { id: "reference-evidence", label: "Reference / Evidence" },
  { id: "other", label: "Other" },
];

export type PddRequirement = {
  key: string;
  section: PddSectionId;
  title: string;
  hint: string;
  reference: string;
};

const SHARED: PddRequirement[] = [
  {
    key: "organisation",
    section: "project-setup",
    title: "Organisation and project identity",
    hint: "Legal entity, project title, country of operation, and short description as they appear in Certify.",
    reference: "Isometric Standard · Project documentation",
  },
  {
    key: "ownership",
    section: "project-setup",
    title: "Ownership and carbon rights",
    hint: "Evidence the supplier controls the removal and the right to be issued credits.",
    reference: "Isometric Standard · Ownership",
  },
  {
    key: "boundary",
    section: "protocol-monitoring",
    title: "Project boundary and LCA scope",
    hint: "System boundary, included fluxes, and how the GHG entry template will be used.",
    reference: "GHG Accounting module v1.0",
  },
  {
    key: "monitoring-plan",
    section: "protocol-monitoring",
    title: "Monitoring plan",
    hint: "Parameters, methods, frequencies, and responsible parties for operational monitoring.",
    reference: "Certify validation guide",
  },
  {
    key: "qa-qc",
    section: "protocol-monitoring",
    title: "QA/QC and data management",
    hint: "Calibration, chain of custody, data retention, and how raw files will be filed each period.",
    reference: "GHG Accounting module v1.0 §3.4",
  },
  {
    key: "safeguards",
    section: "environmental-social",
    title: "Environmental and social safeguards",
    hint: "EIA/SIA where required, HSE plan, and how protocol safeguard clauses are met.",
    reference: "Isometric Standard · Safeguards",
  },
  {
    key: "reversal-risk",
    section: "environmental-social",
    title: "Reversal and leakage risk",
    hint: "Site-specific reversal assessment and any buffer or insurance treatment.",
    reference: "Isometric Standard · Permanence",
  },
  {
    key: "consultation",
    section: "stakeholder-input",
    title: "Stakeholder consultation",
    hint: "Meeting records, attendance, and how comments were addressed.",
    reference: "Isometric Standard · Stakeholder engagement",
  },
  {
    key: "grievance",
    section: "stakeholder-input",
    title: "Grievance mechanism",
    hint: "How affected parties can raise issues during construction and operation.",
    reference: "Isometric Standard · Stakeholder engagement",
  },
];

const INSITU: PddRequirement[] = [
  ...SHARED,
  {
    key: "site-characterisation",
    section: "pathway-specific",
    title: "Storage site characterisation",
    hint: "Geology, USDW, seismic setting, and why the formation can mineralise injected CO₂.",
    reference: "In-Situ Mineralization v1.2 §2",
  },
  {
    key: "wells-integrity",
    section: "pathway-specific",
    title: "Well construction and mechanical integrity",
    hint: "Well design, materials, MIT programme, and annulus monitoring.",
    reference: "In-Situ Mineralization v1.2 §3.1.2",
  },
  {
    key: "injection-permit",
    section: "pathway-specific",
    title: "Injection permit and MASIP",
    hint: "Competent-authority permit, maximum allowable surface injection pressure, and operating limits.",
    reference: "In-Situ Mineralization v1.2 §3.1.1",
  },
  {
    key: "mmv-plan",
    section: "pathway-specific",
    title: "MMV and closure plan",
    hint: "Near-surface gas, aquifer, seismicity (if required), and post-injection monitoring.",
    reference: "In-Situ Mineralization v1.2 §3.1.3",
  },
];

const DAC: PddRequirement[] = [
  ...SHARED,
  {
    key: "capture-plant",
    section: "pathway-specific",
    title: "Capture plant description",
    hint: "Process flow, sorbent or solvent, energy supply, and delivery to the storage interface.",
    reference: "DAC Protocol v1.3 §5–8",
  },
  {
    key: "storage-conformance",
    section: "pathway-specific",
    title: "Storage module conformance",
    hint: "Evidence the chosen storage module applies and the site meets its requirements.",
    reference: "DAC Protocol v1.3 §7",
  },
];

const GENERIC: PddRequirement[] = [
  ...SHARED,
  {
    key: "pathway-methods",
    section: "pathway-specific",
    title: "Pathway methods and modules",
    hint: "How the selected protocol and modules will be applied at this site. Finish the official checklist in Certify.",
    reference: "Isometric protocol + applicable modules",
  },
];

export function pddCatalogFor(methodologyKey: string | undefined): PddRequirement[] {
  if (methodologyKey === "isometric-insitu-mineralization") return INSITU;
  if (methodologyKey === "isometric-dac") return DAC;
  return GENERIC;
}

export function pddSourcePrefix(section: PddSectionId, key: string): string {
  return `minrv:pdd:${section}:${key}:`;
}

export function feedstockSourcePrefix(feedstockTypeId: string): string {
  return `minrv:feedstock:${feedstockTypeId}:`;
}

export function siteSourcePrefix(locationId: string): string {
  return `minrv:site:${locationId}:`;
}

export function fieldSourcePrefix(): string {
  return "minrv:field:";
}

export function parsePddSourceRef(
  supplierReferenceId: string | null | undefined,
): { section: PddSectionId; key: string } | null {
  if (!supplierReferenceId) return null;
  const match = /^minrv:pdd:([^:]+):([^:]+):/.exec(supplierReferenceId);
  if (!match) return null;
  const section = match[1] as PddSectionId;
  if (!(section in PDD_SECTION_META)) return null;
  return { section, key: match[2] };
}
