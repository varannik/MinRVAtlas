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
export interface KnowledgeDocument {
  key: string;
  name: string;
  /** shared: registry document; tenant: every project in the organisation; project: this project. */
  scope: "shared" | DocumentScope;
  pin: string | null;
  size: number;
  uploadedAt: string;
  status: DocumentStatus;
  detail: string;
  /** Rule passages Cortex made from it; null when not counted (still processing, or no access yet). */
  passages: number | null;
  registry?: string;
  methodology?: string;
  edition?: string;
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

// ── Status ──────────────────────────────────────────────────────────────────

/** GuardDuty Malware Protection for S3 writes its verdict as this object tag. */
export const SCAN_TAG = "GuardDutyMalwareScanStatus";

export type DocumentStatus = "scanning" | "admitting" | "in_cortex" | "rejected";

export interface CortexDocument {
  key: string;
  name: string;
  size: number;
  uploadedAt: string;
  status: DocumentStatus;
  detail: string;
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
  return status === "in_cortex" || status === "rejected";
}
