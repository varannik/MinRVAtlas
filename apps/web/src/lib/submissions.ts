import { ACCENT } from "./brand";
import { coverageFromEvidence, isDueThisPeriod } from "./period-due";
import { type ReportingPeriod } from "./period-desk";
import { getRequirementSpec } from "./registries";
import type {
  BatchGroup,
  ItemState,
  Project,
  RequirementItem,
  RequirementSpec,
  SubmissionBatch,
  SubmissionStatus,
} from "./types";

const VOLUME_UNITS = ["1.2 MB", "8.4 MB", "340 KB", "62 MB", "4.1 GB", "18 MB"];

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

function evidenceState(
  item: Pick<RequirementItem, "evidence">,
  periodStart: string,
  periodEnd: string,
): ItemState {
  const coverage = coverageFromEvidence(item, periodStart, periodEnd);
  if (coverage === "valid") return "submitted";
  if (coverage === "partial") return "pending";
  return "missing";
}

function buildGroups(
  spec: RequirementSpec,
  period: ReportingPeriod,
): BatchGroup[] {
  return spec.groups.map((group) => ({
    id: group.id,
    code: group.code,
    title: group.title,
    accent: group.accent,
    items: group.items.map((item) => {
      const seed = `${period.id}:${group.id}:${item.id}`;
      const r = ratio(seed);
      const dueThisPeriod = isDueThisPeriod(
        { ...item, groupCode: group.code },
        period.periodStart,
        period.periodEnd,
      );
      return {
        ...item,
        slotId: `${group.id}.${item.id}`,
        groupId: group.id,
        groupCode: group.code,
        groupTitle: group.title,
        accent: group.accent,
        dueThisPeriod,
        state: item.evidence
          ? evidenceState(item, period.periodStart, period.periodEnd)
          : dueThisPeriod
            ? "missing"
            : "complete",
        volume: VOLUME_UNITS[Math.floor(r * VOLUME_UNITS.length)],
        updatedDaysAgo: 1 + Math.round(r * 88),
      } satisfies RequirementItem;
    }),
  }));
}

function monitoringCoverage(items: RequirementItem[]): "valid" | "partial" | "missing" {
  const due = items.filter((item) => item.dueThisPeriod && item.mandatory);
  if (due.length === 0) return "missing";
  const covered = due.filter(
    (item) => item.state === "submitted" || item.state === "complete",
  ).length;
  if (covered === due.length) return "valid";
  if (covered > 0 || due.some((item) => item.state === "pending")) return "partial";
  return "missing";
}

function tally(items: RequirementItem[]) {
  const due = items.filter((item) => item.dueThisPeriod);
  const complete = due.filter(
    (item) => item.state === "submitted" || item.state === "complete",
  ).length;
  return {
    completion: due.length ? Math.round((complete / due.length) * 100) : 0,
    blockers: due.filter(
      (item) =>
        item.mandatory &&
        (item.state === "missing" || item.state === "rejected"),
    ).length,
    outstanding: due.length - complete,
  };
}

export function buildPeriodBatches(
  project: Project,
  spec: RequirementSpec,
  periods: ReportingPeriod[],
): SubmissionBatch[] {
  if (periods.length === 0) return [];
  let parentHash: string | null = null;
  return periods.map((period) => {
    const groups = buildGroups(spec, period);
    const items = groups.flatMap((group) => group.items);
    const stats = tally(items);
    const hash = hexHash(`${project.id}:${period.id}`);
    const spanDays = Math.max(
      1,
      (Date.parse(`${period.periodEnd}T00:00:00Z`) -
        Date.parse(`${period.periodStart}T00:00:00Z`)) /
        86_400_000,
    );
    const volume = Math.round(
      (project.annualForecast * Math.min(spanDays / 365, 1)) / 100,
    ) * 100;
    const batch: SubmissionBatch = {
      id: period.id,
      projectId: project.id,
      sequence: period.sequence,
      hash,
      parentHash,
      periodLabel: period.periodLabel,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      volume,
      status: period.status,
      anchoredAt: null,
      specVersion: spec.specVersion,
      groups,
      items,
      origin: period.origin,
      ghgStatementId: period.ghgStatementId,
      monitoringCoverage: monitoringCoverage(items),
      ...stats,
    };
    parentHash = hash;
    return batch;
  });
}

/**
 * Build the reporting-period chain. Empty when nothing has been started or
 * filed — the ribbon then shows only the + control.
 */
export function getSubmissions(
  project: Project,
  requirementSpec?: RequirementSpec,
  periods?: ReportingPeriod[],
): SubmissionBatch[] {
  const spec = requirementSpec ?? getRequirementSpec(project);
  return buildPeriodBatches(project, spec, periods ?? []);
}

export function getLatestSubmissionId(
  project: Project,
  periods?: ReportingPeriod[],
): string | null {
  const batches = getSubmissions(project, undefined, periods);
  return batches.length > 0 ? batches[batches.length - 1].id : null;
}

export function dueMandatorySlots(batch: SubmissionBatch): RequirementItem[] {
  return batch.items.filter((item) => item.dueThisPeriod && item.mandatory);
}

export function periodCloseReady(batch: SubmissionBatch): boolean {
  return dueMandatorySlots(batch).every((item) => item.state === "submitted");
}
