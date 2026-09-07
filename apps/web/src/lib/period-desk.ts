/**
 * Reporting-period verify-and-submit desk (UI catalog).
 *
 * UI-01 World / Portfolio — pick the Certify-defined project; show live vs bundled.
 * UI-02 Period ribbon — statement windows, not synthetic years.
 * UI-03 Period board — live monitoring slots due in the open window.
 * UI-04 Slot intake — period-scoped popup (schema → quality → submit).
 * UI-05 Schema check — exact columns / document type for this requirement.
 * UI-06 Quality stepper — DQA → anomaly → V&V → Step-3.
 * UI-07 Refine loop — remap / replace / re-run in the same popup.
 * UI-08 Slot submit — explicit Certify write after READY.
 * UI-09 Period close — GHG statement submit when due slots are Valid.
 * UI-10 Quality Console — admin rules/models only; not the period desk.
 */

import type { Project, SubmissionStatus } from "./types";

export type PeriodOrigin = "certify" | "draft";

export type MonitoringCoverage = "valid" | "partial" | "missing";

export interface ReportingPeriod {
  id: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: SubmissionStatus;
  origin: PeriodOrigin;
  sequence: number;
  ghgStatementId?: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatPeriodLabel(start: string, end: string): string {
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  if (!sy || !sm || !ey || !em) return `${start} – ${end}`;
  const left = `${MONTHS[Number(sm) - 1]} ${sy}`;
  const right = `${MONTHS[Number(em) - 1]} ${ey}`;
  return left === right ? left : `${left} – ${right}`;
}

/** Earliest date a reporting period may start: creation, crediting, then design filing. */
export function earliestAllowedPeriodStart(
  project: Pick<Project, "creditingStart" | "createdOn" | "vintage">,
  designFiledOn?: string | null,
): string {
  const dates: string[] = [];
  if (project.createdOn && /^\d{4}-\d{2}-\d{2}/.test(project.createdOn)) {
    dates.push(project.createdOn.slice(0, 10));
  }
  if (Number.isFinite(project.creditingStart) && project.creditingStart >= 1990) {
    dates.push(`${project.creditingStart}-01-01`);
  }
  if (designFiledOn && /^\d{4}-\d{2}-\d{2}/.test(designFiledOn)) {
    dates.push(designFiledOn.slice(0, 10));
  }
  if (dates.length > 0) return dates.sort()[dates.length - 1];
  if (Number.isFinite(project.vintage) && project.vintage >= 1990) {
    return `${project.vintage}-01-01`;
  }
  return "1990-01-01";
}

export function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function sortPeriods(periods: ReportingPeriod[]): ReportingPeriod[] {
  return [...periods].sort((a, b) =>
    a.periodStart === b.periodStart
      ? a.periodEnd.localeCompare(b.periodEnd)
      : a.periodStart.localeCompare(b.periodStart),
  );
}

export function withSequences(periods: ReportingPeriod[]): ReportingPeriod[] {
  return sortPeriods(periods).map((period, index) => ({
    ...period,
    sequence: index + 1,
  }));
}

export function latestPeriodId(periods: ReportingPeriod[]): string | null {
  if (periods.length === 0) return null;
  return sortPeriods(periods)[periods.length - 1].id;
}

export function draftKey(
  projectId: string,
  periodId: string,
  slotId: string,
): string {
  return `${projectId}:${periodId}:${slotId}`;
}
