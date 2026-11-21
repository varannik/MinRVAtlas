/**
 * Cortex capability catalogue.
 *
 * Each entry is one pin on the Cortex brain. The catalogue mirrors what the
 * current Data Sentinel service can do (see `source`), so the UI can be built
 * before the new backend exists. Nothing here calls Sentinel.
 */

export type LobeId = "ingest" | "check" | "correct" | "know" | "assure" | "operate";

export type CapabilityId =
  | "datasets"
  | "connectors"
  | "evidence"
  | "rules"
  | "runs"
  | "anomaly"
  | "violations"
  | "corrections"
  | "calibration"
  | "knowledge"
  | "protocols"
  | "models"
  | "verification"
  | "reviewer"
  | "reports"
  | "schedules";

export type IntakeKind = "data" | "document" | "metadata";

export interface Lobe {
  id: LobeId;
  name: string;
  /** What this group of capabilities does for the expert. */
  role: string;
  /** Halo colour on the violet canvas. */
  glow: string;
  /** Text colour on a white panel (AA on white). */
  ink: string;
  /** Soft fill for chips on a white panel. */
  tint: string;
}

export type FieldType = "text" | "number" | "date" | "url" | "select" | "textarea";

export interface FieldSpec {
  id: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  placeholder?: string;
  unit?: string;
  required?: boolean;
  /** Spans both columns of the form grid. */
  wide?: boolean;
}

export interface FileIntake {
  label: string;
  hint: string;
  /** Value for the file input's `accept` attribute. */
  accept: string;
  /** Short list shown to the user, e.g. "CSV, XLSX, Parquet". */
  formats: string;
}

export interface MetadataIntake {
  label: string;
  hint: string;
  fields: readonly FieldSpec[];
  /** Field whose value names the staged entry. */
  titleField: string;
  submitLabel: string;
}

export interface Capability {
  id: CapabilityId;
  name: string;
  lobe: LobeId;
  /** One line: what this pin is. */
  summary: string;
  /** What the expert learns when you feed this pin. */
  learns: readonly string[];
  data?: FileIntake;
  document?: FileIntake;
  metadata?: MetadataIntake;
  /** Where this lives in today's Sentinel service. */
  source: string;
  /** Current console page, kept until the new backend replaces it. */
  consoleHref?: string;
}

export const LOBES: readonly Lobe[] = [
  {
    id: "ingest",
    name: "Ingest",
    role: "What the expert is given",
    glow: "#8FE3FF",
    ink: "#1D6585",
    tint: "#E3F4FB",
  },
  {
    id: "check",
    name: "Check",
    role: "How it judges data",
    glow: "#FFD27A",
    ink: "#855300",
    tint: "#FBF0D9",
  },
  {
    id: "correct",
    name: "Correct",
    role: "How it repairs data",
    glow: "#FFA3CB",
    ink: "#9A2D60",
    tint: "#FBE5EF",
  },
  {
    id: "know",
    name: "Know",
    role: "What it reads and learns",
    glow: "#B9F2B2",
    ink: "#2E6A29",
    tint: "#E5F5E2",
  },
  {
    id: "assure",
    name: "Assure",
    role: "How it proves the result",
    glow: "#D2C4FF",
    ink: "#5536B0",
    tint: "#EEE9FD",
  },
  {
    id: "operate",
    name: "Operate",
    role: "When it works on its own",
    glow: "#FFFFFF",
    ink: "#4A4560",
    tint: "#EFEDF4",
  },
];

const DQA_DIMENSIONS = [
  "Completeness",
  "Integrity",
  "Timeliness",
  "Uniqueness",
  "Accuracy",
  "Consistency",
  "Relevance",
  "Readiness",
] as const;

const REGISTRIES = ["Puro.earth", "Isometric", "Verra", "Gold Standard"] as const;

export const CAPABILITIES: readonly Capability[] = [
  // ── Ingest ────────────────────────────────────────────────────────────────
  {
    id: "datasets",
    name: "Datasets",
    lobe: "ingest",
    summary: "Time-series sensor data the expert checks.",
    learns: [
      "What each column measures and in which unit",
      "The sampling cadence it should expect",
      "The normal range of every stream",
    ],
    data: {
      label: "Sensor data",
      hint: "One file per stream or one wide file. Headers are mapped on upload.",
      accept: ".csv,.tsv,.xlsx,.xls,.parquet,.json",
      formats: "CSV, TSV, XLSX, Parquet, JSON",
    },
    metadata: {
      label: "Describe the stream",
      hint: "Tell the expert how to read the file before it checks it.",
      titleField: "stream",
      submitLabel: "Add stream details",
      fields: [
        { id: "stream", label: "Stream name", type: "text", placeholder: "CO2 injection skid A", required: true, wide: true },
        { id: "interval", label: "Sampling interval", type: "select", options: ["1 minute", "5 minutes", "15 minutes", "Hourly", "Daily"] },
        { id: "timezone", label: "Timestamps in", type: "select", options: ["UTC", "Site local time", "Other"] },
        { id: "owner", label: "Data owner", type: "text", placeholder: "Site operations" },
        { id: "units", label: "Unit system", type: "select", options: ["SI", "Imperial", "Mixed"] },
      ],
    },
    source: "/v1/datasets · /v1/ingest",
    consoleHref: "/quality/datasets",
  },
  {
    id: "connectors",
    name: "Connectors",
    lobe: "ingest",
    summary: "Live sources the expert pulls from on its own.",
    learns: [
      "Where new data and documents arrive",
      "How often to look for them",
      "Who owns each source",
    ],
    metadata: {
      label: "Add a source",
      hint: "Credentials are set by an administrator, never typed here.",
      titleField: "name",
      submitLabel: "Add source",
      fields: [
        { id: "name", label: "Source name", type: "text", placeholder: "Fujairah lab exports", required: true, wide: true },
        { id: "kind", label: "Type", type: "select", options: ["SharePoint folder", "S3 prefix", "Shared folder", "Webhook", "SCADA historian"], required: true },
        { id: "cadence", label: "Check every", type: "select", options: ["15 minutes", "Hour", "Day", "Week"] },
        { id: "location", label: "Location", type: "url", placeholder: "s3://bucket/prefix or https://…", wide: true },
      ],
    },
    source: "/v1/connectors · /v1/webhooks · engines/vv/folder_connector",
  },
  {
    id: "evidence",
    name: "Evidence",
    lobe: "ingest",
    summary: "Documents a verifier will ask to see.",
    learns: [
      "Which document proves which claim",
      "Who issued it and until when it is valid",
      "What is missing before verification",
    ],
    document: {
      label: "Evidence documents",
      hint: "Lab results, certificates, chain of custody, site photos.",
      accept: ".pdf,.docx,.doc,.xlsx,.png,.jpg,.jpeg",
      formats: "PDF, DOCX, XLSX, PNG, JPG",
    },
    metadata: {
      label: "Describe a document",
      hint: "Add details the file itself does not carry.",
      titleField: "title",
      submitLabel: "Add document details",
      fields: [
        { id: "title", label: "Document", type: "text", placeholder: "Q3 CO2 purity certificate", required: true, wide: true },
        { id: "type", label: "Type", type: "select", options: ["Lab certificate", "Calibration certificate", "Chain of custody", "Site photo", "Project design document", "Monitoring report"] },
        { id: "issuer", label: "Issued by", type: "text", placeholder: "SGS Gulf" },
        { id: "validUntil", label: "Valid until", type: "date" },
      ],
    },
    source: "/v2/vv/projects/{id}/documents",
    consoleHref: "/quality/vv",
  },

  // ── Check ─────────────────────────────────────────────────────────────────
  {
    id: "rules",
    name: "Rules",
    lobe: "check",
    summary: "Checks across the eight data quality dimensions.",
    learns: [
      "What good data looks like for each field",
      "Which failures block a submission and which only warn",
      "Rules written in plain English, turned into logic",
    ],
    data: {
      label: "Import a rule set",
      hint: "A library exported from another project or a spreadsheet of rules.",
      accept: ".json,.yaml,.yml,.csv,.xlsx",
      formats: "JSON, YAML, CSV, XLSX",
    },
    metadata: {
      label: "Write a rule",
      hint: "Describe the check in words. The expert turns it into logic.",
      titleField: "name",
      submitLabel: "Add rule",
      fields: [
        { id: "name", label: "Rule name", type: "text", placeholder: "Injection pressure in range", required: true, wide: true },
        { id: "dimension", label: "Dimension", type: "select", options: DQA_DIMENSIONS, required: true },
        { id: "severity", label: "Severity", type: "select", options: ["Blocker", "Warning", "Note"] },
        { id: "field", label: "Field", type: "text", placeholder: "INJECTION_PRESSURE", wide: true },
        { id: "condition", label: "Condition", type: "textarea", placeholder: "Between 10 and 200 bar while the pump is running", wide: true },
      ],
    },
    source: "/v1/rules · /v1/rule-studio · engines/dqa",
    consoleHref: "/quality/rules",
  },
  {
    id: "runs",
    name: "Runs",
    lobe: "check",
    summary: "Run every check over a dataset and score readiness.",
    learns: [
      "How readiness changes from one run to the next",
      "Which rules fail most often on this project",
    ],
    metadata: {
      label: "Plan a run",
      hint: "Runs start once the new backend is connected.",
      titleField: "dataset",
      submitLabel: "Queue run",
      fields: [
        { id: "dataset", label: "Dataset", type: "text", placeholder: "Skid A — October", required: true, wide: true },
        { id: "dimensions", label: "Dimensions", type: "select", options: ["All eight", ...DQA_DIMENSIONS] },
        { id: "trigger", label: "Trigger", type: "select", options: ["Now", "On every upload", "On a schedule"] },
      ],
    },
    source: "/v1/runs · engines/dqa · sentinel-worker",
    consoleHref: "/quality/runs",
  },
  {
    id: "anomaly",
    name: "Anomaly",
    lobe: "check",
    summary: "Finds readings that break a pattern, not only a limit.",
    learns: [
      "Hard limits and critical limits per parameter",
      "Statistical outliers by IQR and Z-score",
      "Unusual combinations, through an Isolation Forest model",
    ],
    data: {
      label: "Labelled history",
      hint: "Past readings marked as real issues or false alarms sharpen detection.",
      accept: ".csv,.xlsx,.parquet",
      formats: "CSV, XLSX, Parquet",
    },
    metadata: {
      label: "Set limits for a parameter",
      hint: "Readings outside the critical limits are always flagged.",
      titleField: "parameter",
      submitLabel: "Add limits",
      fields: [
        { id: "parameter", label: "Parameter", type: "text", placeholder: "INJECTION_PRESSURE", required: true },
        { id: "unit", label: "Unit", type: "text", placeholder: "bar" },
        { id: "min", label: "Normal min", type: "number", placeholder: "10" },
        { id: "max", label: "Normal max", type: "number", placeholder: "200" },
        { id: "criticalMin", label: "Critical min", type: "number", placeholder: "5" },
        { id: "criticalMax", label: "Critical max", type: "number", placeholder: "250" },
      ],
    },
    source: "/v1/anomaly · engines/anomaly",
    consoleHref: "/quality/anomaly",
  },
  {
    id: "violations",
    name: "Violations",
    lobe: "check",
    summary: "Findings that wait for a human decision.",
    learns: [
      "Which findings people confirm and which they dismiss",
      "When a recurring finding is accepted risk",
    ],
    metadata: {
      label: "Judge a finding",
      hint: "Each verdict teaches the expert what matters on this project.",
      titleField: "finding",
      submitLabel: "Record verdict",
      fields: [
        { id: "finding", label: "Finding", type: "text", placeholder: "Pressure gap 02:00–04:00, 14 Oct", required: true, wide: true },
        { id: "verdict", label: "Verdict", type: "select", options: ["Real issue", "False alarm", "Accepted risk"], required: true },
        { id: "note", label: "Why", type: "textarea", placeholder: "Pump maintenance window, logged in the site diary", wide: true },
      ],
    },
    source: "/v1/violations",
    consoleHref: "/quality/violations",
  },

  // ── Correct ───────────────────────────────────────────────────────────────
  {
    id: "corrections",
    name: "Corrections",
    lobe: "correct",
    summary: "Fixes the expert may apply, and who approves them.",
    learns: [
      "How to fill a gap or replace a bad reading",
      "Which fixes are safe to apply alone",
      "Which fixes a person must approve",
    ],
    metadata: {
      label: "Add a correction",
      hint: "Paired with a rule, a correction runs when that rule fails.",
      titleField: "field",
      submitLabel: "Add correction",
      fields: [
        { id: "field", label: "Field", type: "text", placeholder: "CO2_FLOW_RATE", required: true },
        { id: "strategy", label: "Fix", type: "select", options: ["Interpolate", "Carry last value", "Use reference meter", "Model suggestion", "Flag only"], required: true },
        { id: "maxGap", label: "Longest gap to fill", type: "text", placeholder: "30 minutes" },
        { id: "approval", label: "Approval", type: "select", options: ["Apply automatically", "Needs review"] },
      ],
    },
    source: "/v1/corrections · engines/correction",
    consoleHref: "/quality/corrections",
  },
  {
    id: "calibration",
    name: "Calibration",
    lobe: "correct",
    summary: "The instrument health behind every reading.",
    learns: [
      "Which instrument produced each reading",
      "When a sensor is out of calibration",
      "How much drift to allow before flagging",
    ],
    document: {
      label: "Calibration certificates",
      hint: "The expert reads dates and tolerances from the certificate.",
      accept: ".pdf,.png,.jpg,.jpeg",
      formats: "PDF, PNG, JPG",
    },
    metadata: {
      label: "Register an instrument",
      hint: "Readings from an overdue instrument are flagged.",
      titleField: "instrument",
      submitLabel: "Add instrument",
      fields: [
        { id: "instrument", label: "Instrument ID", type: "text", placeholder: "FT-101", required: true },
        { id: "measures", label: "Measures", type: "text", placeholder: "CO2_FLOW_RATE" },
        { id: "calibratedOn", label: "Calibrated on", type: "date" },
        { id: "nextDue", label: "Next due", type: "date" },
        { id: "drift", label: "Allowed drift", type: "number", placeholder: "0.5", unit: "%" },
      ],
    },
    source: "/v1/calibration",
  },

  // ── Know ──────────────────────────────────────────────────────────────────
  {
    id: "knowledge",
    name: "Knowledge",
    lobe: "know",
    summary: "What the expert reads before it answers.",
    learns: [
      "Your procedures and project design documents",
      "The standards and papers behind your methods",
      "Site context that no dataset carries",
    ],
    document: {
      label: "Reference documents",
      hint: "SOPs, project design documents, monitoring plans, standards and papers. Registry rules go on Protocols.",
      accept: ".pdf,.docx,.doc,.md,.txt,.html",
      formats: "PDF, DOCX, Markdown, TXT, HTML",
    },
    metadata: {
      label: "Add a note",
      hint: "Short facts the expert should always keep in mind.",
      titleField: "title",
      submitLabel: "Add note",
      fields: [
        { id: "title", label: "Title", type: "text", placeholder: "Skid A bypass valve", required: true, wide: true },
        { id: "appliesTo", label: "Applies to", type: "select", options: ["Whole programme", ...REGISTRIES] },
        { id: "source", label: "Source", type: "text", placeholder: "Site engineer, 3 Nov" },
        { id: "body", label: "Note", type: "textarea", placeholder: "Flow below 0.1 kg/hr during bypass is expected, not a fault.", wide: true },
      ],
    },
    source: "/v1/knowledge-base · engines/ai",
    consoleHref: "/quality/knowledge",
  },
  {
    id: "protocols",
    name: "Protocols",
    lobe: "know",
    summary: "Registry methodologies and the version in force.",
    learns: [
      "Which checkpoints each methodology requires",
      "When a registry publishes a new version",
    ],
    document: {
      label: "Methodology documents",
      hint: "A registry's rules and methodologies. The expert extracts checkpoints from the PDF.",
      accept: ".pdf,.docx",
      formats: "PDF, DOCX",
    },
    metadata: {
      label: "Track a methodology",
      hint: "The source page is checked every Monday at 06:00 UTC.",
      titleField: "methodology",
      submitLabel: "Track methodology",
      fields: [
        { id: "registry", label: "Registry", type: "select", options: REGISTRIES, required: true },
        { id: "methodology", label: "Methodology", type: "text", placeholder: "Geologically Stored Carbon", required: true },
        { id: "version", label: "Version", type: "text", placeholder: "v1.2" },
        { id: "effective", label: "Effective from", type: "date" },
        { id: "url", label: "Source page", type: "url", placeholder: "https://…", wide: true },
      ],
    },
    source: "/v2/protocols · engines/vv/protocol_monitor",
    consoleHref: "/quality/protocols",
  },
  {
    id: "models",
    name: "Models",
    lobe: "know",
    summary: "The learned models behind detection and correction.",
    learns: [
      "Patterns in your own history, not a generic baseline",
      "When a model has drifted and needs retraining",
    ],
    data: {
      label: "Training data",
      hint: "Clean, representative history for the selected model.",
      accept: ".csv,.parquet,.xlsx",
      formats: "CSV, Parquet, XLSX",
    },
    metadata: {
      label: "Set up training",
      hint: "Models retrain at 02:00 and 02:30 UTC today.",
      titleField: "model",
      submitLabel: "Save training plan",
      fields: [
        { id: "model", label: "Model", type: "select", options: ["Anomaly — Isolation Forest", "Correction — XGBoost", "Data quality classifier"], required: true, wide: true },
        { id: "from", label: "History from", type: "date" },
        { id: "to", label: "History to", type: "date" },
        { id: "retrain", label: "Retrain", type: "select", options: ["Nightly", "Weekly", "Only when asked"] },
      ],
    },
    source: "/v1/ml · ml/model_store · sentinel-beat",
    consoleHref: "/quality/models",
  },

  // ── Assure ────────────────────────────────────────────────────────────────
  {
    id: "verification",
    name: "Verification",
    lobe: "assure",
    summary: "Evidence matched against every protocol checkpoint.",
    learns: [
      "Which checkpoint each document satisfies",
      "How complete a monitoring period is",
      "Expiring documents before a verifier finds them",
    ],
    metadata: {
      label: "Open a verification",
      hint: "Ties a monitoring period to a registry methodology.",
      titleField: "project",
      submitLabel: "Open verification",
      fields: [
        { id: "project", label: "Project", type: "text", placeholder: "Fujairah", required: true },
        { id: "registry", label: "Registry", type: "select", options: REGISTRIES, required: true },
        { id: "from", label: "Period from", type: "date" },
        { id: "to", label: "Period to", type: "date" },
        { id: "verifier", label: "Verifier", type: "text", placeholder: "VVB name", wide: true },
      ],
    },
    source: "/v2/vv · engines/vv/verification_engine",
    consoleHref: "/quality/vv",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    lobe: "assure",
    summary: "Verifier assignments, findings and statements.",
    learns: [
      "What each verifier asked for and how it was answered",
      "Which corrective actions are still open",
    ],
    document: {
      label: "Reviewer correspondence",
      hint: "Corrective action requests, responses, verification reports and statements.",
      accept: ".pdf,.docx,.eml,.msg",
      formats: "PDF, DOCX, EML, MSG",
    },
    metadata: {
      label: "Log an assignment",
      hint: "Not reachable from the app today. Kept here for the new backend.",
      titleField: "reference",
      submitLabel: "Log assignment",
      fields: [
        { id: "reference", label: "Assignment ref", type: "text", placeholder: "ISO-VVB-2026-014", required: true },
        { id: "vvb", label: "Verifier", type: "text", placeholder: "VVB name" },
        { id: "due", label: "Due", type: "date" },
        { id: "status", label: "Status", type: "select", options: ["Incoming", "Accepted", "In review", "Statement issued"] },
      ],
    },
    source: "/v2/reviewer · integrations/isometric",
  },
  {
    id: "reports",
    name: "Reports",
    lobe: "assure",
    summary: "Every check, change and decision on record.",
    learns: [
      "Who needs which report and how often",
      "The audit trail a registry will ask for",
    ],
    metadata: {
      label: "Set up a report",
      hint: "Reports draw on runs, anomalies, corrections and the audit trail.",
      titleField: "type",
      submitLabel: "Add report",
      fields: [
        { id: "type", label: "Report", type: "select", options: ["Data quality summary", "Anomaly digest", "Readiness checklist", "Audit trail export"], required: true, wide: true },
        { id: "period", label: "Covers", type: "select", options: ["Last 7 days", "Last month", "Monitoring period"] },
        { id: "recipients", label: "Send to", type: "text", placeholder: "mrv@4401.earth" },
      ],
    },
    source: "/v1/reports · /v1/audit · /v1/digest",
    consoleHref: "/quality/reports",
  },

  // ── Operate ───────────────────────────────────────────────────────────────
  {
    id: "schedules",
    name: "Schedules",
    lobe: "operate",
    summary: "When the expert works without being asked.",
    learns: [
      "Which checks to run, on what data, and when",
      "Who to tell when a scheduled check fails",
    ],
    metadata: {
      label: "Schedule a job",
      hint: "Times are in UTC.",
      titleField: "job",
      submitLabel: "Add schedule",
      fields: [
        { id: "job", label: "Job", type: "select", options: ["Data quality run", "Anomaly scan", "Protocol check", "Model retrain", "Digest email"], required: true },
        { id: "cadence", label: "Every", type: "select", options: ["Hour", "Day", "Week", "Month"] },
        { id: "time", label: "At (UTC)", type: "text", placeholder: "02:00" },
        { id: "target", label: "On", type: "text", placeholder: "All streams" },
      ],
    },
    source: "/v1/schedules · sentinel-beat",
    consoleHref: "/quality/schedules",
  },
];

export const CAPABILITY_BY_ID: Record<CapabilityId, Capability> = Object.fromEntries(
  CAPABILITIES.map((capability) => [capability.id, capability]),
) as Record<CapabilityId, Capability>;

export const LOBE_BY_ID: Record<LobeId, Lobe> = Object.fromEntries(
  LOBES.map((lobe) => [lobe.id, lobe]),
) as Record<LobeId, Lobe>;

export function capabilitiesIn(lobe: LobeId): Capability[] {
  return CAPABILITIES.filter((capability) => capability.lobe === lobe);
}

export function isCapabilityId(value: string | null | undefined): value is CapabilityId {
  return Boolean(value && value in CAPABILITY_BY_ID);
}

/** Where each pin sits on the brain, as a unit direction. Lobes share a sector. */
export function pinDirection(id: CapabilityId): [number, number, number] {
  const capability = CAPABILITY_BY_ID[id];
  const lobeIndex = LOBES.findIndex((lobe) => lobe.id === capability.lobe);
  const siblings = capabilitiesIn(capability.lobe);
  const index = siblings.findIndex((item) => item.id === id);
  const count = siblings.length;

  const sector = (Math.PI * 2) / LOBES.length;
  // Offset so the first lobe opens slightly left of the viewer.
  const centre = lobeIndex * sector - 0.35;
  const latSpan = count > 1 ? 0.62 : 0;
  const lat = count > 1 ? latSpan - (index / (count - 1)) * latSpan * 2 : 0.18;
  const lon = centre + (index % 2 === 0 ? -0.2 : 0.2) * (count > 1 ? 1 : 0);

  const cosLat = Math.cos(lat);
  return [Math.sin(lon) * cosLat, Math.sin(lat), Math.cos(lon) * cosLat];
}
