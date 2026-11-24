import type { DateRange } from "@/lib/mrv/types";

/**
 * What the data quality engine (apps/quality-engine) records about a project:
 * runs, worded findings and people's decisions. Plain data, shared by the
 * server route and the calculation tree's trend.
 */

/** What a finding may do to a submission. */
export type QualitySeverity = "blocks" | "look" | "info";

/** A person's decision on a finding. */
export type FindingStatus = "open" | "confirmed" | "dismissed";

export type QualityVerdict = "blocked" | "needs_look" | "clear";

/** The engine's four plain-English parts and its method. */
export interface FindingText {
  headline: string;
  saw: string;
  matters: string;
  todo: string;
  how: string;
}

export interface FindingReview {
  decision: FindingStatus;
  reason?: string;
  by?: string;
  at?: string;
}

export interface QualityFinding {
  /** Stable for the same problem in the same data, so decisions carry over between runs. */
  id: string;
  kind: string;
  severity: QualitySeverity;
  /** A detector: advises only, blocks once a person confirms it. */
  advisory: boolean;
  /** Stream metric it is about (the calculation tree's series metric). */
  metric: string | null;
  /** Dated value it is about (lab result, factor). */
  fixedKey: string | null;
  start: string;
  end: string;
  /** Moment inside the day, for intraday findings (ISO, UTC). */
  at: string | null;
  observed: Record<string, unknown>;
  expected: Record<string, unknown>;
  impact: { t_co2?: number; t_co2_missed?: number } | null;
  rule: { id: string; name: string; origin: string; version: number; threshold?: { value: number; unit: string; source: string } };
  status: FindingStatus;
  review: FindingReview | null;
  text: FindingText;
  blocking: boolean;
}

export interface QualityRun {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  /** stream, seeded or none. */
  source?: string;
  verdict?: QualityVerdict;
  counts?: Record<string, number>;
  range?: DateRange | null;
  versions?: Record<string, string | number>;
  error?: string;
}

export interface QualityView {
  /** The engine is deployed and the project is on Cortex. */
  available: boolean;
  /** Why not, when it is not. */
  reason?: string;
  /** Latest finished run. */
  run: QualityRun | null;
  /** A run in progress. */
  running: QualityRun | null;
  findings: QualityFinding[];
  /** The user may confirm, dismiss and re-run. */
  canDecide: boolean;
}

export const DECISIONS: FindingStatus[] = ["confirmed", "dismissed", "open"];

/** Counts against the verdict: an open or confirmed block, or a confirmed detector finding. */
export function isBlocking(finding: Pick<QualityFinding, "status" | "advisory" | "severity">): boolean {
  if (finding.status === "dismissed") return false;
  if (finding.advisory) return finding.status === "confirmed";
  return finding.severity === "blocks";
}

export function touches(finding: Pick<QualityFinding, "start" | "end">, range: DateRange): boolean {
  return finding.end >= range.start && finding.start <= range.end;
}

/** The engine's verdict rule, for one window (a ledger block). */
export function verdictFor(findings: QualityFinding[], range: DateRange): QualityVerdict {
  const inside = findings.filter((finding) => touches(finding, range));
  if (inside.some(isBlocking)) return "blocked";
  if (inside.some((finding) => finding.status === "open" && (finding.severity === "look" || finding.advisory))) return "needs_look";
  return "clear";
}

/**
 * Findings about what a calculation node reads: its stream metrics, its dated values,
 * and stream-wide findings (whole days with no data) when it reads the stream at all.
 */
export function findingsForSources(
  findings: QualityFinding[],
  sources: { metrics: Set<string>; fixedKeys: Set<string> },
  range?: DateRange,
): QualityFinding[] {
  return findings.filter((finding) => {
    if (range && !touches(finding, range)) return false;
    if (finding.metric) return sources.metrics.has(finding.metric);
    if (finding.fixedKey) return sources.fixedKeys.has(finding.fixedKey);
    return sources.metrics.size > 0;
  });
}

const SEVERITY_RANK: Record<QualitySeverity, number> = { blocks: 0, look: 1, info: 2 };

/** Most severe first, dismissed last, then by date. */
export function bySeverity(a: QualityFinding, b: QualityFinding): number {
  const dismissed = Number(a.status === "dismissed") - Number(b.status === "dismissed");
  return dismissed || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.start.localeCompare(b.start);
}

/** A decision applied to a finding as the engine applies it on its next run. */
export function withReview(finding: QualityFinding, review: FindingReview | null): QualityFinding {
  const status: FindingStatus = review && review.decision !== "open" ? review.decision : "open";
  const next = { ...finding, status, review: review && review.decision !== "open" ? review : null };
  return { ...next, blocking: isBlocking(next) };
}

export const VERDICT_LABEL: Record<QualityVerdict, string> = {
  blocked: "Blocks submission",
  needs_look: "Needs a look",
  clear: "Clear",
};

export const SEVERITY_LABEL: Record<QualitySeverity, string> = {
  blocks: "Blocks submission",
  look: "Needs a look",
  info: "For information",
};
