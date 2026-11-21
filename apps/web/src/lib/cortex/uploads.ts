/**
 * Rules for documents the Cortex page sends to the knowledge pipeline.
 *
 * Pure functions, used by the browser (to decide what to send) and by the
 * server (which decides again: the browser is never trusted). Uploads land in
 * the intake bucket under the project, and the pipeline scans, admits, parses
 * and indexes them (infra/lib/cortex/knowledge-stack.ts).
 */

import { CAPABILITIES, CAPABILITY_BY_ID, isCapabilityId, type CapabilityId } from "./capabilities";

/** What Bedrock Data Automation parses into rule passages today. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};
export const UPLOAD_FORMATS = "PDF, DOCX, DOC";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Tenant and project ids: same pattern as the Cortex tenancy table (infra/lib/config.ts). */
export const CORTEX_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Roles that see every project in their tenant; the gateway uses the same rule. */
const TENANT_WIDE_ROLES = new Set(["platform_admin", "tenant_admin"]);
/** Roles that may give Cortex documents (viewers only read). */
const UPLOAD_ROLES = new Set(["platform_admin", "tenant_admin", "quality_engineer", "operator"]);

/** Pins whose documents go to the knowledge pipeline. */
export const DOCUMENT_PINS: ReadonlySet<CapabilityId> = new Set(
  CAPABILITIES.filter((capability) => capability.document).map((capability) => capability.id),
);

export function canUploadAs(role: string): boolean {
  return UPLOAD_ROLES.has(role);
}

/**
 * Where a document is given: one project, or the whole organisation (every project
 * in the tenant searches it). Registry documents (shared/) are added by operators.
 */
export type DocumentScope = "project" | "tenant";

/** Pins whose documents can apply across projects: methods and rules, not one site's evidence. */
export const ORGANISATION_PINS: ReadonlySet<CapabilityId> = new Set<CapabilityId>(["knowledge", "protocols", "reviewer"]);

/** Organisation-wide documents reach every project, so only admins add or remove them. */
export function canShareAcrossOrganisation(role: string): boolean {
  return TENANT_WIDE_ROLES.has(role);
}

export function isDocumentScope(value: unknown): value is DocumentScope {
  return value === "project" || value === "tenant";
}

/** Projects a user may work on inside their tenant. A grant for a project the tenant no longer has does not count. */
export function allowedProjects(role: string, tenantProjects: string[], memberProjects: string[]): string[] {
  const tenant = new Set(tenantProjects);
  if (TENANT_WIDE_ROLES.has(role)) return [...tenant].sort();
  return [...new Set(memberProjects)].filter((id) => tenant.has(id)).sort();
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Content type for a file Cortex can read, or null. */
export function uploadType(fileName: string): string | null {
  return UPLOAD_TYPES[extension(fileName)] ?? null;
}

/** Why a file cannot be sent, or null when it can. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!uploadType(file.name)) return `Cortex reads ${UPLOAD_FORMATS} for now`;
  if (file.size <= 0) return "The file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return `Larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`;
  return null;
}

/**
 * A file name that is safe as the last part of an S3 key: no folders, no
 * spaces (event payloads encode them), only letters, digits and . _ - ( ).
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = extension(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._()-]+/g, "-")
    .replace(/^[.\-_]+|[.\-_]+$/g, "")
    .slice(0, 120);
  return `${stem || "document"}${ext ? `.${ext}` : ""}`;
}

/** The document a file would replace: same pin and project, same name once made safe. */
export function sameDocument<T extends { name: string }>(fileName: string, documents: readonly T[]): T | undefined {
  const name = safeFileName(fileName);
  return documents.find((doc) => doc.name === name);
}

/** Where a project's document for one pin goes in the intake bucket (and later the knowledge bucket). */
export function documentPrefix(tenantId: string, projectId: string, pin: CapabilityId): string {
  if (!CORTEX_ID.test(tenantId) || !CORTEX_ID.test(projectId)) throw new Error("Unknown tenant or project.");
  if (!DOCUMENT_PINS.has(pin)) throw new Error("This pin does not take documents.");
  return `tenants/${tenantId}/projects/${projectId}/${pin}/`;
}

/** Where an organisation's document for one pin goes: tenants/<tenant>/tenant/<pin>/ (scope "tenant" in Cortex). */
export function organisationPrefix(tenantId: string, pin: CapabilityId): string {
  if (!CORTEX_ID.test(tenantId)) throw new Error("Unknown tenant.");
  if (!ORGANISATION_PINS.has(pin)) throw new Error("This pin only takes project documents.");
  return `tenants/${tenantId}/tenant/${pin}/`;
}

export function scopePrefix(scope: DocumentScope, tenantId: string, projectId: string, pin: CapabilityId): string {
  return scope === "tenant" ? organisationPrefix(tenantId, pin) : documentPrefix(tenantId, projectId, pin);
}

export function documentKey(
  tenantId: string,
  projectId: string,
  pin: CapabilityId,
  fileName: string,
  scope: DocumentScope = "project",
): string {
  return `${scopePrefix(scope, tenantId, projectId, pin)}${safeFileName(fileName)}`;
}

// ── What a project searches ────────────────────────────────────────────────

/** A registry document's place: shared/<registry>/<methodology>/<edition>/<file>. */
export function sharedPlace(key: string): { registry: string; methodology: string; edition: string; name: string } | null {
  const parts = key.split("/");
  if (parts[0] !== "shared" || parts.length < 5 || key.endsWith("/")) return null;
  const [, registry, methodology, edition, ...rest] = parts;
  return { registry, methodology, edition, name: rest.join("/") };
}

/**
 * Whether a project searches a registry document. Same rule as the search filter
 * (infra/lib/cortex/lambda/access.py, retrieval_filter): the project's methodology
 * and edition, or documents filed under "any".
 */
export function searchesShared(
  project: { methodology?: string; edition?: string },
  place: { methodology: string; edition: string },
): boolean {
  const methodology = !project.methodology || place.methodology === project.methodology || place.methodology === "any";
  const edition = !project.edition || place.edition === project.edition || place.edition === "any";
  return methodology && edition;
}

/** "knowledge/General_Rules_4_4.pdf" under a project or organisation prefix: the pin and the file. */
export function pinAndName(rest: string): { pin: string | null; name: string } {
  const slash = rest.indexOf("/");
  return slash < 0 ? { pin: null, name: rest } : { pin: rest.slice(0, slash), name: rest.slice(slash + 1) };
}

/** One document a project's searches read, from any scope. */
export interface KnowledgeDocument extends CortexDocument {
  /** shared: registry document; tenant: every project in the organisation; project: this project. */
  scope: "shared" | DocumentScope;
  pin: string | null;
  /** Rule passages Cortex made from it; null when not counted (still processing, or no access yet). */
  passages: number | null;
  registry?: string;
  methodology?: string;
  edition?: string;
}

// ── Labels ──────────────────────────────────────────────────────────────────
//
// Cortex labels every admitted document with Claude: what it is, its title and
// version (infra/lib/cortex/lambda/labels.py). From the kind it knows the pin the
// document belongs on and whether it applies to every project, so it can suggest a
// move; and it holds a document out of search when it is not MRV material or is
// the same document as one already searched. The model proposes; a person decides.

export type LabelKind =
  | "registry_rules"
  | "organisation_procedure"
  | "reference"
  | "project_design"
  | "evidence"
  | "calibration"
  | "verifier_correspondence"
  | "not_mrv";

const LABEL_KINDS: ReadonlySet<string> = new Set<LabelKind>([
  "registry_rules",
  "organisation_procedure",
  "reference",
  "project_design",
  "evidence",
  "calibration",
  "verifier_correspondence",
  "not_mrv",
]);

/** How a kind reads in a sentence: "Looks like registry rules". */
export const KIND_PHRASE: Record<LabelKind, string> = {
  registry_rules: "registry rules",
  organisation_procedure: "an organisation procedure",
  reference: "reference material",
  project_design: "a project design document",
  evidence: "project evidence",
  calibration: "a calibration record",
  verifier_correspondence: "verifier correspondence",
  not_mrv: "not MRV material",
};

/** Who decided and when. */
export interface Decision {
  by: string;
  at: string;
}

export interface DocumentLabel {
  /** False when Claude could not label it: it is searched, unlabelled. */
  checked: boolean;
  kind?: LabelKind;
  /** The pin Cortex thinks it belongs on; null for material that is not MRV. */
  pin?: string | null;
  appliesTo?: "every_project" | "one_project" | null;
  title?: string;
  issuer?: string;
  version?: string;
  summary?: string;
  reason?: string;
  /** Title and version as Cortex compares them ("general rules", "4.4"). */
  titleKey?: string;
  versionKey?: string;
  /** Why it is held out of search, if it is. */
  held?: "not_mrv" | "same_as" | null;
  sameAs?: { key: string; title?: string; version?: string } | null;
  /** Someone kept it in Cortex although it was held. */
  released?: Decision | null;
  /** Someone kept it where it is although Cortex suggested a move. */
  placementKept?: Decision | null;
  labelledAt: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function decision(value: unknown): Decision | null {
  if (!value || typeof value !== "object") return null;
  const { by, at } = value as Record<string, unknown>;
  return typeof at === "string" ? { by: str(by) ?? "", at } : null;
}

/** A label file (labels/<key>.json, snake_case) as the web uses it; null when it is not one. */
export function parseLabel(raw: unknown): DocumentLabel | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const labelledAt = str(value.labelled_at);
  if (!labelledAt || typeof value.checked !== "boolean") return null;
  const kind = str(value.kind);
  const held = value.held === "not_mrv" || value.held === "same_as" ? value.held : null;
  const sameAs = value.same_as && typeof value.same_as === "object" ? (value.same_as as Record<string, unknown>) : null;
  return {
    checked: value.checked,
    kind: kind && LABEL_KINDS.has(kind) ? (kind as LabelKind) : undefined,
    pin: str(value.pin) ?? null,
    appliesTo: value.applies_to === "every_project" || value.applies_to === "one_project" ? value.applies_to : null,
    title: str(value.title),
    issuer: str(value.issuer),
    version: str(value.version),
    summary: str(value.summary),
    reason: str(value.reason),
    titleKey: str(value.title_key),
    versionKey: str(value.version_key),
    held,
    sameAs: sameAs && str(sameAs.key) ? { key: str(sameAs.key) as string, title: str(sameAs.title), version: str(sameAs.version) } : null,
    released: decision(value.released),
    placementKept: decision(value.placement_kept),
    labelledAt,
  };
}

/** Held out of search, and nobody has kept it in Cortex since. */
export function isHeld(label: DocumentLabel | null | undefined): boolean {
  return Boolean(label?.held) && !label?.released;
}

/**
 * A document's status once its label is known. A label written before the document
 * was last admitted belongs to an earlier file of that name, so it is ignored until
 * the new one is labelled.
 */
export function withLabel(
  doc: { status: DocumentStatus; detail: string },
  label: DocumentLabel | null,
  admittedAt?: Date,
): { status: DocumentStatus; detail: string; label: DocumentLabel | null } {
  if (!label || doc.status !== "in_cortex") return { ...doc, label: null };
  if (admittedAt && new Date(label.labelledAt).getTime() < admittedAt.getTime() - 1000) return { ...doc, label: null };
  if (isHeld(label)) {
    return {
      status: "held",
      detail:
        label.held === "not_mrv"
          ? "Held out of search: it does not look like MRV material."
          : "Held out of search: Cortex already has this document.",
      label,
    };
  }
  return { status: "in_cortex", detail: "In search.", label };
}

/** "General Rules 4.4 (Puro.earth)" */
export function labelTitle(label: DocumentLabel): string {
  const title = [label.title, label.version].filter(Boolean).join(" ");
  return label.issuer && title ? `${title} (${label.issuer})` : title || label.issuer || "";
}

/** What Cortex suggests for one document, if anything. */
export type Advice =
  | { kind: "held"; text: string; canDecide: boolean }
  | { kind: "move"; text: string; to: { pin: CapabilityId; scope: DocumentScope }; action: string; canDecide: boolean };

/**
 * Held documents ask whether to keep them in search. A document on a pin other than
 * the one its kind belongs on, or given to one project when it applies to every
 * project (registry rules, procedures), gets a move, until someone keeps it where it is.
 */
export function adviceFor(
  doc: { scope: KnowledgeDocument["scope"]; pin: string | null; label?: DocumentLabel | null },
  context: { canUpload: boolean; canShare: boolean; placeOf: (key: string) => string },
): Advice | null {
  const label = doc.label;
  if (doc.scope === "shared" || !label?.checked || !label.kind) return null;
  const canChange = context.canUpload && (doc.scope === "project" || context.canShare);
  const titled = labelTitle(label);

  if (isHeld(label)) {
    const text =
      label.held === "same_as" && label.sameAs
        ? `Held out of search: it looks like ${titled || "a document"}, which Cortex already has in ${context.placeOf(label.sameAs.key)}. Searching both would cite the same rules twice.`
        : `Held out of search: it does not look like MRV material${label.summary ? ` (${label.summary.replace(/\.$/, "")})` : ""}. Keep it if Cortex should read it.`;
    return { kind: "held", text, canDecide: canChange };
  }

  if (label.placementKept || !label.pin || !isCapabilityId(label.pin) || !DOCUMENT_PINS.has(label.pin)) return null;
  const pin = label.pin;
  let scope: DocumentScope = doc.scope;
  if (label.appliesTo === "every_project" && ORGANISATION_PINS.has(pin) && context.canShare) scope = "tenant";
  if (label.appliesTo === "one_project" || !ORGANISATION_PINS.has(pin)) scope = "project";
  if (pin === doc.pin && scope === doc.scope) return null;

  const pinName = CAPABILITY_BY_ID[pin].name;
  const where =
    scope === "tenant"
      ? `the ${pinName} pin, for every project`
      : doc.scope === "tenant"
        ? `this project's ${pinName} pin`
        : `the ${pinName} pin`;
  return {
    kind: "move",
    text: `Looks like ${KIND_PHRASE[label.kind]}${titled ? `: ${titled}` : ""}. It belongs on ${where}.`,
    to: { pin, scope },
    action: scope === "tenant" ? `Move to ${pinName} · every project` : `Move to ${pinName}`,
    canDecide: canChange && (scope === "project" || context.canShare),
  };
}

// ── Duplicates ──────────────────────────────────────────────────────────────

/** A SHA-256 digest in base64, as S3 checks it (x-amz-checksum-sha256). */
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_BASE64.test(value);
}

/** Where a document already is, in words: "the Protocols pin of Fujairah", "the registry (…)". */
export function documentPlace(doc: Pick<KnowledgeDocument, "scope" | "pin" | "methodology" | "edition">, projectName: string): string {
  const pin = doc.pin && isCapabilityId(doc.pin) ? CAPABILITY_BY_ID[doc.pin].name : doc.pin;
  if (doc.scope === "shared") {
    const edition = [doc.methodology, doc.edition].filter(Boolean).join(" ");
    return edition ? `the registry documents (${edition})` : "the registry documents";
  }
  if (doc.scope === "tenant") return pin ? `your organisation's ${pin} documents` : "your organisation's documents";
  return pin ? `the ${pin} pin of ${projectName}` : projectName;
}

/** Where a document key is, in words (documentPlace for a key alone). */
export function placeOfKey(key: string, projectName: string): string {
  const shared = sharedPlace(key);
  if (shared) return documentPlace({ scope: "shared", pin: null, ...shared }, projectName);
  const parts = key.split("/");
  if (parts[0] === "tenants" && parts[2] === "tenant") {
    return documentPlace({ scope: "tenant", pin: parts.length > 4 ? parts[3] : null }, projectName);
  }
  if (parts[0] === "tenants" && parts[2] === "projects") {
    return documentPlace({ scope: "project", pin: parts.length > 5 ? parts[4] : null }, projectName);
  }
  return "another place";
}

/** Files that appear more than once among the documents a project searches (by file name). */
export function duplicateNames(names: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) twice.add(key);
    seen.add(key);
  }
  return twice;
}

/** Kinds a title and version identify (labels.py: IDENTIFIED_BY_TITLE). */
const IDENTIFIED_BY_TITLE: ReadonlySet<LabelKind | undefined> = new Set<LabelKind>([
  "registry_rules",
  "organisation_procedure",
  "reference",
  "project_design",
]);

/**
 * Warnings about what a project searches more than once: two editions of the same
 * rules (search may cite the superseded one), the same document in two places (the
 * pipeline only holds back a copy within one place), and, for documents not yet
 * labelled, the same file name twice.
 */
export function duplicateNotes(documents: readonly KnowledgeDocument[], placeOf: (doc: KnowledgeDocument) => string): string[] {
  const notes: string[] = [];
  const covered = new Set<string>();
  const searched = documents.filter((doc) => doc.status === "in_cortex");

  const byTitle = new Map<string, KnowledgeDocument[]>();
  for (const doc of searched) {
    const label = doc.label;
    if (!label?.checked || !IDENTIFIED_BY_TITLE.has(label.kind) || (label.titleKey ?? "").length < 6) continue;
    byTitle.set(label.titleKey as string, [...(byTitle.get(label.titleKey as string) ?? []), doc]);
  }
  for (const docs of byTitle.values()) {
    if (docs.length < 2) continue;
    const issuers = new Set(docs.map((doc) => (doc.label?.issuer ?? "").toLowerCase()).filter(Boolean));
    if (issuers.size > 1) continue;
    const title = docs[0].label?.title || docs[0].name;
    const listed = docs.map((doc) => `${doc.name}${doc.label?.version ? ` (${doc.label.version})` : ""} in ${placeOf(doc)}`);
    const versions = new Set(docs.map((doc) => doc.label?.versionKey ?? ""));
    if (versions.size > 1) {
      notes.push(`Cortex searches more than one edition of ${title}: ${listed.join("; ")}. Remove the editions not in force, or answers may cite superseded rules.`);
    } else {
      notes.push(`${title} is in Cortex more than once: ${listed.join("; ")}. Search can return the same rule twice; remove the extra copy.`);
    }
    for (const doc of docs) covered.add(doc.key);
  }

  // Held copies are not searched, so they do not count twice.
  const rest = documents.filter((doc) => !covered.has(doc.key) && doc.status !== "held");
  const twice = duplicateNames(rest.map((doc) => doc.name));
  for (const name of twice) {
    const docs = rest.filter((doc) => doc.name.toLowerCase() === name);
    notes.push(`${docs[0].name} is in Cortex more than once (${docs.map(placeOf).join("; ")}), so search can return the same rule twice. Remove the extra copy.`);
  }
  return notes;
}

// ── Status ──────────────────────────────────────────────────────────────────

/** GuardDuty Malware Protection for S3 writes its verdict as this object tag. */
export const SCAN_TAG = "GuardDutyMalwareScanStatus";

/** held: admitted, but kept out of search until someone decides (see Labels). */
export type DocumentStatus = "scanning" | "admitting" | "in_cortex" | "held" | "rejected";

export interface CortexDocument {
  key: string;
  name: string;
  size: number;
  uploadedAt: string;
  status: DocumentStatus;
  detail: string;
  /** What Cortex made of it; null until labelled (or for documents admitted before labels). */
  label?: DocumentLabel | null;
}

/** Longer than this without a verdict or admission means something went wrong. */
const SCAN_PATIENCE_MS = 30 * 60 * 1000;
const ADMIT_PATIENCE_MS = 10 * 60 * 1000;

/**
 * Where an upload has got to, from what is visible to the project's own session:
 * the intake copy (and its scan verdict) and the admitted copy in the knowledge bucket.
 */
export function documentStatus(input: {
  intakeAt?: Date;
  admittedAt?: Date;
  scan?: string | null;
  now: Date;
}): { status: DocumentStatus; detail: string } {
  const { intakeAt, admittedAt, scan, now } = input;
  // Admitted, and no newer upload of the same file waiting behind it.
  if (admittedAt && (!intakeAt || admittedAt >= intakeAt)) {
    return { status: "in_cortex", detail: "Admitted. Searchable a few minutes after admission." };
  }
  const waited = intakeAt ? now.getTime() - intakeAt.getTime() : 0;
  if (scan === "THREATS_FOUND") {
    return { status: "rejected", detail: "The malware scan found a threat. Not admitted." };
  }
  if (scan && scan !== "NO_THREATS_FOUND") {
    return { status: "rejected", detail: "The malware scan could not check this file. Not admitted." };
  }
  if (scan === "NO_THREATS_FOUND") {
    return waited > ADMIT_PATIENCE_MS
      ? { status: "rejected", detail: "Scanned clean but not admitted. An admin can see why in the ingestion run." }
      : { status: "admitting", detail: "Scanned clean. Being admitted." };
  }
  return waited > SCAN_PATIENCE_MS
    ? { status: "rejected", detail: "No scan result after 30 minutes. Try uploading again." }
    : { status: "scanning", detail: "Checking for malware." };
}

export function isSettled(status: DocumentStatus): boolean {
  return status === "in_cortex" || status === "held" || status === "rejected";
}
