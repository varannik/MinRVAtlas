import { addDays, formatDay, rangeDays } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import { monitoringMetric } from "@/lib/monitoring/metrics";
import type { DecisionRecord, QualityFinding, QualityVerdict } from "./types";
import { touches, verdictFor } from "./types";

/**
 * The data quality page's plain helpers: the periods of its strip, the names of
 * kinds, meters and thresholds, and the export. Pure, so they are tested.
 */

export interface Period {
  id: string;
  label: string;
  range: DateRange;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

/** Months for a short history (up to about four), quarters for a longer one, clipped to the data. */
export function periodsFor(range: DateRange | null): Period[] {
  if (!range) return [];
  const byMonth = rangeDays(range) <= 125;
  const out: Period[] = [];
  let year = Number(range.start.slice(0, 4));
  let month = Number(range.start.slice(5, 7)) - 1;
  if (!byMonth) month -= month % 3;
  for (;;) {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    if (start > range.end) break;
    const span = byMonth ? 1 : 3;
    const end = lastDayOfMonth(year, month + span - 1);
    const label = byMonth ? `${MONTHS[month]} ${year}` : `Q${month / 3 + 1} ${year}`;
    out.push({
      id: byMonth ? start.slice(0, 7) : `${year}-Q${month / 3 + 1}`,
      label,
      range: { start: start < range.start ? range.start : start, end: end > range.end ? range.end : end },
    });
    month += span;
    if (month > 11) {
      year += 1;
      month -= 12;
    }
  }
  return out;
}

/** A period's verdict and how many of its findings are open (not dismissed, not for information). */
export function periodState(findings: QualityFinding[], range: DateRange): { verdict: QualityVerdict; open: number } {
  return {
    verdict: verdictFor(findings, range),
    open: findings.filter((finding) => touches(finding, range) && finding.status !== "dismissed" && finding.severity !== "info").length,
  };
}

export const KIND_LABEL: Record<string, string> = {
  missing_days: "Missing days",
  metric_gap: "Meter missing",
  gap: "Gap in a day",
  bad_readings: "Unreadable readings",
  incomplete_day: "Short day",
  flatline: "Flatline",
  stuck_day: "Same reading all day",
  stuck_zero: "Stuck at zero",
  out_of_range: "Impossible reading",
  out_of_order: "Time going backwards",
  reading_spike: "Odd reading",
  duplicates: "Counted twice",
  meter_agreement: "Meters disagree",
  counter_reset: "Totaliser reset",
  losses_exceed: "Losses above deliveries",
  loss_share: "High losses",
  fixed_coverage: "Lab result or factor missing",
  spike: "Unusual day",
  level_shift: "Level shift",
};

const FIXED_LABEL: Record<string, string> = {
  BIOGENIC_FRACTION_pct: "C-14 lab result",
  GRID_EMISSION_FACTOR_kg_per_kWh: "Grid emission factor",
  DIESEL_EF_kg_per_L: "Diesel emission factor",
  EMBODIED_EMISSIONS_t: "Embodied emissions (LCA)",
};

/** What a finding is about, in the site's words: a meter, a dated value, or the whole stream. */
export function subjectOf(finding: Pick<QualityFinding, "metric" | "fixedKey">): string {
  if (finding.metric) return monitoringMetric(finding.metric)?.name ?? finding.metric;
  if (finding.fixedKey) return FIXED_LABEL[finding.fixedKey] ?? finding.fixedKey;
  return "Whole stream";
}

export function daysLabel(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

export interface RuleLabel {
  label: string;
  unit: string;
  /** Checks can block; detectors advise. */
  group: "check" | "detector";
  /** Stored as a share; shown as a percentage. */
  percent?: boolean;
}

/** rules.py, in words. */
export const RULE_LABEL: Record<string, RuleLabel> = {
  missing_days_block: { label: "Whole days with no readings that block, in a row", unit: "days", group: "check" },
  min_day_share: { label: "Readings a continuous meter needs in a day", unit: "% of its cadence", group: "check", percent: true },
  gap_intervals: { label: "A gap inside a day is reported after", unit: "reading intervals", group: "check" },
  flatline_minutes: { label: "The same reading for this long is stuck", unit: "minutes", group: "check" },
  flatline_min_readings: { label: "…counted only with at least", unit: "readings", group: "check" },
  zero_days: { label: "Days in a row at exactly zero that block", unit: "days", group: "check" },
  reading_spike_sigma: { label: "One reading this far from the day's middle", unit: "robust spreads", group: "check" },
  loss_share_look: { label: "Losses that need a look, above", unit: "% of CO₂ delivered", group: "check", percent: true },
  agreement_share: { label: "Two meters on one quantity may differ by", unit: "% of the larger", group: "check", percent: true },
  spike_sigma: { label: "Unusual day: this far from the usual level", unit: "robust spreads", group: "detector" },
  spike_min_share: { label: "…and at least this far from it", unit: "% of the usual level", group: "detector", percent: true },
  baseline_days: { label: "The usual level is taken over", unit: "days before", group: "detector" },
  baseline_min_days: { label: "…from at least", unit: "days", group: "detector" },
  shift_before_days: { label: "Level shift: the level before, over", unit: "days", group: "detector" },
  shift_after_days: { label: "Level shift: the level after, over", unit: "days", group: "detector" },
  shift_share: { label: "Level shift: a change of at least", unit: "% of the level before", group: "detector", percent: true },
};

export function ruleValue(name: string, value: number): string {
  const label = RULE_LABEL[name];
  return label?.percent ? `${Number((value * 100).toPrecision(4))}` : String(value);
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A period's findings with their decisions, as the verifier gets them: every
 * finding touching the days (dismissed ones too), in the engine's words.
 */
export function findingsCsv(findings: QualityFinding[], range: DateRange | null, decisions: DecisionRecord[] = []): string {
  const decided = new Map(decisions.map((decision) => [decision.findingId, decision]));
  const header = ["finding", "severity", "status", "kind", "about", "first day", "last day", "what's wrong", "what we saw", "why it matters", "what to do", "rule", "rule version", "decision by", "decision at", "decision reason"];
  const rows = findings
    .filter((finding) => !range || touches(finding, range))
    .map((finding) => {
      const review = finding.review ?? decided.get(finding.id) ?? null;
      return [
        finding.id,
        finding.severity,
        finding.status,
        KIND_LABEL[finding.kind] ?? finding.kind,
        subjectOf(finding),
        finding.start,
        finding.end,
        finding.text.headline,
        finding.text.saw,
        finding.text.matters,
        finding.text.todo,
        finding.rule.id,
        finding.rule.version,
        review?.by ?? "",
        review?.at ?? "",
        review?.reason ?? "",
      ];
    });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** Days of a range, for the coverage grid. */
export function daysOf(range: DateRange): string[] {
  return Array.from({ length: rangeDays(range) }, (_, offset) => addDays(range.start, offset));
}
