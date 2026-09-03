import { ACCENT } from "./brand";
import { getRequirementSpec } from "./registries";
import type {
  BatchGroup,
  ItemState,
  Project,
  ProjectStatus,
  RequirementItem,
  RequirementSpec,
  SpecEvidence,
  SubmissionBatch,
  SubmissionStatus,
} from "./types";

const BASE_YEAR = 2026;

const BATCH_COUNT: Record<ProjectStatus, number> = {
  draft: 1,
  validation: 2,
  monitoring: 3,
  verification: 4,
  issued: 5,
};

/** How far along an in-flight batch is, by project maturity. */
const ASSEMBLY_WEIGHT: Record<ProjectStatus, number> = {
  draft: 0.34,
  validation: 0.52,
  monitoring: 0.72,
  verification: 0.86,
  issued: 0.92,
};

const VOLUME_UNITS = ["1.2 MB", "8.4 MB", "340 KB", "62 MB", "4.1 GB", "18 MB"];

const REGISTRY_PREFIX: Record<string, string> = {
  "Verra VCS": "VCS",
  "Gold Standard": "GS",
  "Puro.earth": "CORC",
  Isometric: "ISO",
};

function fnv(seed: string, offset = 0): number {
  let hash = 0x811c9dc5 ^ offset;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function ratio(seed: string): number {
  return (fnv(seed) % 10_000) / 10_000;
}

function hexHash(seed: string): string {
  const a = fnv(seed, 0).toString(16).padStart(8, "0");
  const b = fnv(seed, 0x9e3779b9).toString(16).padStart(8, "0");
  return `0x${a}${b.slice(0, 4)}`;
}

const STATUS_META: Record<
  SubmissionStatus,
  { label: string; color: string }
> = {
  assembling: { label: "Assembling", color: ACCENT.alert },
  submitted: { label: "Submitted", color: ACCENT.tech },
  "in-verification": { label: "In verification", color: ACCENT.storage },
  issued: { label: "Issued", color: ACCENT.land },
  rejected: { label: "Rejected", color: ACCENT.reject },
};

export const SUBMISSION_STATUS_META = STATUS_META;

function batchStatus(
  index: number,
  count: number,
  seed: string,
): SubmissionStatus {
  if (index === count - 1) return "assembling";
  if (index === count - 2) return "in-verification";
  if (index === count - 3) return "submitted";
  return ratio(`${seed}:reject`) < 0.2 ? "rejected" : "issued";
}

function itemState(
  status: SubmissionStatus,
  seed: string,
  weight: number,
  mandatory: boolean,
): ItemState {
  const r = ratio(seed);
  switch (status) {
    case "issued":
    case "submitted":
      return "complete";
    case "in-verification":
      return r > 0.88 ? "pending" : "complete";
    case "rejected":
      return r > 0.92 ? "rejected" : "complete";
    default: {
      const bias = mandatory ? weight : weight - 0.22;
      if (r < bias - 0.16) return "complete";
      if (r < bias) return "pending";
      if (r < bias + 0.05) return "rejected";
      return "missing";
    }
  }
}

/**
 * When a requirement came from a live registry read we know what the registry
 * actually holds for the period, so coverage decides the state instead of the
 * simulation.
 */
function evidenceState(
  evidence: SpecEvidence[],
  periodStart: string,
  periodEnd: string,
): ItemState {
  let overlaps = false;

  for (const entry of evidence) {
    const from = entry.validFrom ?? "0000-01-01";
    const to = entry.validTo;
    if (from <= periodStart && to >= periodEnd) return "complete";
    if (from <= periodEnd && to >= periodStart) overlaps = true;
  }

  return overlaps ? "pending" : "missing";
}

function buildGroups(
  spec: RequirementSpec,
  project: Project,
  batchSeed: string,
  status: SubmissionStatus,
  periodStart: string,
  periodEnd: string,
): BatchGroup[] {
  const weight = ASSEMBLY_WEIGHT[project.status];

  return spec.groups.map((group) => ({
    id: group.id,
    code: group.code,
    title: group.title,
    accent: group.accent,
    items: group.items.map((item) => {
      const seed = `${batchSeed}:${group.id}:${item.id}`;
      const r = ratio(seed);
      return {
        ...item,
        slotId: `${group.id}.${item.id}`,
        groupId: group.id,
        groupCode: group.code,
        groupTitle: group.title,
        accent: group.accent,
        state: item.evidence
          ? evidenceState(item.evidence, periodStart, periodEnd)
          : itemState(status, seed, weight, item.mandatory),
        volume: VOLUME_UNITS[Math.floor(r * VOLUME_UNITS.length)],
        updatedDaysAgo: 1 + Math.round(r * 88),
      } satisfies RequirementItem;
    }),
  }));
}

const CACHE = new Map<string, SubmissionBatch[]>();

/**
 * Build the submission chain for a project. Pass a spec that was read from the
 * registry to have the chain reflect live requirements; omit it to fall back to
 * the bundled rulebook.
 */
export function getSubmissions(
  project: Project,
  requirementSpec?: RequirementSpec,
): SubmissionBatch[] {
  const spec = requirementSpec ?? getRequirementSpec(project);
  const cacheKey = `${project.id}:${spec.specVersion}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  const count = BATCH_COUNT[project.status];
  const prefix = REGISTRY_PREFIX[project.registry] ?? "REG";
  const batches: SubmissionBatch[] = [];
  let parentHash: string | null = null;

  for (let index = 0; index < count; index += 1) {
    const year = BASE_YEAR - (count - 1 - index);
    const seed = `${project.id}:${year}:${index}`;
    const status = batchStatus(index, count, seed);
    const periodStart = `${year}-01-01`;
    const periodEnd = `${year}-12-31`;
    const groups = buildGroups(
      spec,
      project,
      seed,
      status,
      periodStart,
      periodEnd,
    );
    const items = groups.flatMap((group) => group.items);
    const complete = items.filter((item) => item.state === "complete").length;
    const hash = hexHash(seed);
    const r = ratio(`${seed}:volume`);

    batches.push({
      id: `${prefix}-${project.id.slice(0, 3).toUpperCase()}-${year}-B${index + 1}`,
      projectId: project.id,
      sequence: index + 1,
      hash,
      parentHash,
      periodLabel: `Jan – Dec ${year}`,
      periodStart,
      periodEnd,
      volume:
        Math.round((project.annualForecast * (0.78 + r * 0.34)) / 100) * 100,
      status,
      anchoredAt:
        status === "issued" || status === "rejected"
          ? `${year + 1}-03-${String(4 + Math.floor(r * 20)).padStart(2, "0")}`
          : null,
      specVersion: spec.specVersion,
      groups,
      items,
      completion: Math.round((complete / items.length) * 100),
      blockers: items.filter(
        (item) =>
          item.mandatory &&
          (item.state === "missing" || item.state === "rejected"),
      ).length,
      outstanding: items.length - complete,
    });

    parentHash = hash;
  }

  CACHE.set(cacheKey, batches);
  return batches;
}

export function getLatestSubmissionId(project: Project): string {
  const batches = getSubmissions(project);
  return batches[batches.length - 1].id;
}
