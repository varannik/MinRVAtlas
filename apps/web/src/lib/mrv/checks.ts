import { leaves } from "./calc/tree";
import type { DailyPoint } from "./calc/evaluate";
import type { CalcSpec, Evaluation } from "./calc/types";
import { addDays, formatDay, formatRange } from "./days";
import type { DateRange, IssueSeverity } from "./types";

/**
 * Automated checks an MRV expert runs before batching a window for the
 * registry. Each check is a plain function over the same context, so adding
 * one (or a Sentinel model behind one) does not touch the UI.
 */

export interface Finding {
  id: string;
  check: string;
  severity: IssueSeverity;
  title: string;
  detail?: string;
  /** Days the finding points at, drawn on the timeline. */
  range?: DateRange;
  /** Calculation node it points at, opened in the calculation view. */
  nodeId?: string;
}

export interface CheckContext {
  spec: CalcSpec;
  range: DateRange;
  evaluation: Evaluation;
  /** Daily root values inside `range`. */
  daily: DailyPoint[];
}

type Check = (ctx: CheckContext) => Finding[];

function labelFor(spec: CalcSpec): Map<string, { label: string; remedy?: string }> {
  return new Map(
    leaves(spec.root).map((node) => [node.id, { label: node.label, remedy: node.kind === "input" ? node.remedy : undefined }]),
  );
}

const missingInputs: Check = ({ spec, evaluation }) => {
  const labels = labelFor(spec);
  const seen = new Set<string>();
  return evaluation.root.missing.flatMap((id) => {
    const meta = labels.get(id);
    if (!meta || seen.has(meta.label)) return [];
    seen.add(meta.label);
    return [{
      id: `missing:${id}`,
      check: "Inputs",
      severity: "blocker" as const,
      title: `No data for ${meta.label}`,
      detail: meta.remedy,
      nodeId: id,
    }];
  });
};

const partialInputs: Check = ({ spec, evaluation }) => {
  const labels = labelFor(spec);
  const seen = new Set<string>();
  return evaluation.root.partial.flatMap((id) => {
    const meta = labels.get(id);
    const result = evaluation.byId.get(id);
    if (!meta || !result || seen.has(meta.label)) return [];
    seen.add(meta.label);
    return [{
      id: `partial:${id}`,
      check: "Coverage",
      severity: "warning" as const,
      title: `${meta.label} covers ${Math.round(result.coverage * 100)}% of the window`,
      detail: result.detail,
      nodeId: id,
    }];
  });
};

const dataGaps: Check = ({ daily }) => {
  const findings: Finding[] = [];
  let runStart: string | null = null;
  const flush = (end: string) => {
    if (!runStart) return;
    const span = { start: runStart, end };
    findings.push({
      id: `gap:${runStart}`,
      check: "Stream gaps",
      severity: "warning",
      title: `No stream rows ${formatRange(span)}`,
      detail: "Days with no telemetry are left out of series totals.",
      range: span,
    });
    runStart = null;
  };
  for (const point of daily) {
    if (!point.hasData) runStart ??= point.day;
    else if (runStart) flush(addDays(point.day, -1));
  }
  if (runStart && daily.length) flush(daily[daily.length - 1].day);
  return findings;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const NEIGHBOURS = 7;
/** Also needs to be this far off in relative terms; weekly rhythms are normal. */
const MIN_RELATIVE = 0.6;

/**
 * Days far from their own fortnight, so a ramp-up or a season is not flagged
 * but a double-counted ticket is. Robust z-score against a rolling median.
 */
const unusualDays: Check = ({ daily }) => {
  // Compare like with like: net where it exists, the gross proxy only when no
  // day in the window has a net value.
  const useNet = daily.some((point) => point.value != null);
  const values = daily.map((point) => (useNet ? point.value : point.proxy));
  const present = values.filter((value): value is number => value != null);
  if (present.length < 14) return [];
  const findings: Finding[] = [];
  const residuals: number[] = [];
  const local: (number | null)[] = values.map((value, index) => {
    if (value == null) return null;
    const mid = median(values.slice(Math.max(0, index - NEIGHBOURS), index + NEIGHBOURS + 1).filter((row): row is number => row != null));
    residuals.push(Math.abs(value - mid));
    return mid;
  });
  const mad = median(residuals) * 1.4826;
  if (mad <= 0) return [];
  daily.forEach((point, index) => {
    const value = values[index];
    const mid = local[index];
    if (value == null || mid == null) return;
    const z = (value - mid) / mad;
    if (Math.abs(z) < 6 || Math.abs(value - mid) < Math.abs(mid) * MIN_RELATIVE) return;
    findings.push({
      id: `spike:${point.day}`,
      check: "Unusual days",
      severity: "warning",
      title: `${formatDay(point.day)} is ${z > 0 ? "far above" : "far below"} its fortnight`,
      detail: `${value.toFixed(1)} t against a local median of ${mid.toFixed(1)} t. Check the meter and tickets for that day.`,
      range: { start: point.day, end: point.day },
    });
  });
  return findings.slice(0, 12);
};

const negativeDays: Check = ({ daily }) => {
  const negative = daily.filter((point) => point.value != null && point.value < 0);
  if (!negative.length) return [];
  return [{
    id: "negative",
    check: "Net balance",
    severity: "info",
    title: `Net is negative on ${negative.length} day${negative.length === 1 ? "" : "s"}`,
    detail: "Emissions exceeded storage on those days, usually start-up or shutdown.",
  }];
};

/** Registered checks, run in order. */
const CHECKS: Check[] = [missingInputs, partialInputs, dataGaps, unusualDays, negativeDays];

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };

export function runChecks(ctx: CheckContext): Finding[] {
  return CHECKS.flatMap((check) => check(ctx)).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
