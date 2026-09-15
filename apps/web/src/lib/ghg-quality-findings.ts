import type {
  AnomalyHit,
  DqaViolationHit,
  PipelineResult,
  RegistryCheck,
} from "./sentinel/pipeline-types";
import type { GhgSeriesTable } from "./ghg-csv-series";

export type QualityStep = 1 | 2 | 3;
export type AnomalyView = "heuristic" | "statistical" | "ml";
export type FindingKind = "dqa" | "anomaly" | "registry";
export type ResolutionMode = "edited" | "approved";

export type FindingScope = "sample" | "factor" | "unmapped";

export type QualityFinding = {
  id: string;
  groupId: string;
  kind: FindingKind;
  scope: FindingScope;
  entityKeys: string[];
  rowIndex: number | null;
  timeMs: number | null;
  value: number | null;
  severity: string;
  title: string;
  message: string;
  reason: string;
  ruleId?: string;
  dimension?: string;
  editable: boolean;
  alarmType?: string;
  family?: AnomalyView;
  confidence?: number;
};

export function severityColor(severity: string): string {
  const key = severity.toLowerCase();
  if (key === "critical") return "#9c3a2f";
  if (key === "high") return "#b85616";
  return "#6f663f";
}

const DQA_RULE_WHY: Record<string, string> = {
  "C-01": "Timestamps are missing from the expected 2-minute sequence, so this batch has gaps in the time axis.",
  "C-02": "This tag has null or empty values above the allowed share of the batch.",
  "C-03": "A mandatory tag is missing from the file schema.",
  "C-04": "The batch has fewer rows than expected for the reporting window.",
  "I-01": "This tag is stuck on the same reading across consecutive samples (flatline), which usually means a frozen sensor.",
  "I-02": "This reading is outside the physical range allowed for this tag.",
  "I-03": "Timestamps are out of order or duplicated.",
  "I-04": "This sample is a spike: it sits far outside the typical range for this tag (beyond about 4σ from the robust median).",
  "T-01": "The delay between data generation and ingestion is above the SLA.",
  "T-02": "This batch arrived later than the allowed schedule.",
  "U-01": "The same timestamp appears more than once.",
  "U-02": "Operational-state events are repeated instead of recording a real transition.",
  "A-01": "The sensor totaliser does not match the flow rate integrated over the same interval.",
  "A-02": "Sensor-derived CO₂ load does not match the credit-note value.",
  "A-03": "The manual operational sheet does not match the sensor average.",
  "CON-01": "The two flow sensors on the same line disagree beyond tolerance.",
  "CON-02": "The change in flow rate is not consistent with the totaliser increment at this sample.",
  "CON-03": "Energy-per-tonne at this sample is outside the expected statistical range of the recent trend.",
  "CON-04": "The water-to-CO₂ ratio at this sample is outside the expected physical bounds.",
  "CON-05": "Wellhead pressure and temperature are not moving in the expected relationship.",
  "CON-06": "Injection rate and wellhead pressure are not positively correlated during active injection.",
  "CON-07": "This sample is a rolling z-score outlier: it diverges from the recent window of this tag (beyond about 3σ).",
  "REL-01": "This sample falls in a non-operational state (maintenance, idle, or shutdown) and should not be used as process data.",
  "REL-02": "This sample sits in the exclusion window around a maintenance event.",
  "REL-03": "This sample is in the start-up transient after switching to active injection.",
};

function detailNumber(
  detail: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatRuleExtras(detail: Record<string, unknown> | undefined): string {
  if (!detail) return "";
  const parts: string[] = [];
  const z = detailNumber(detail, "max_z_score") ?? detailNumber(detail, "max_z");
  if (z != null) parts.push(`peak z-score ${z}`);
  const sigma = detailNumber(detail, "sigma_threshold") ?? detailNumber(detail, "sigma");
  if (sigma != null) parts.push(`threshold ${sigma}σ`);
  const min = detailNumber(detail, "min");
  const max = detailNumber(detail, "max");
  if (min != null && max != null) parts.push(`allowed range ${min}–${max}`);
  const median = detailNumber(detail, "median");
  if (median != null) parts.push(`series median ${median}`);
  const corr = detailNumber(detail, "correlation");
  if (corr != null) parts.push(`correlation ${corr}`);
  return parts.length ? ` Engine numbers: ${parts.join(", ")}.` : "";
}

export function explainDqaRule(
  ruleId: string,
  options?: {
    label?: string;
    value?: number | null;
    detail?: Record<string, unknown>;
  },
): string {
  const base =
    DQA_RULE_WHY[ruleId] ??
    "The data-quality engine flagged this value against its configured rule.";
  const where = options?.label ? ` Affected series: ${options.label}.` : "";
  const reading =
    options?.value != null ? ` This sample’s value is ${options.value}.` : "";
  return `${base}${where}${reading}${formatRuleExtras(options?.detail)}`;
}

export function explainAnomaly(hit: AnomalyHit, label: string): string {
  const alarm = hit.alarm_type ? hit.alarm_type.replaceAll("_", " ") : "anomaly";
  const votes = hit.votes != null ? ` ${hit.votes} model(s) agreed.` : "";
  const z = hit.context?.z_score;
  const zText = z != null ? ` z-score ${z}.` : "";
  const reading = hit.value != null ? ` This sample’s value is ${hit.value}.` : "";
  return `Anomaly check: ${label} looks like a ${alarm} at this timestamp.${votes}${zText}${reading}`;
}

export function explainRegistry(
  label: string,
  detail: string,
  value: number | null,
): string {
  const reading = value != null ? ` Marked sample value is ${value}.` : "";
  return `Registry rule “${label}” failed: ${detail}${reading}`;
}

function fieldsFromAffected(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(/\s+vs\.?\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function entityKeySet(table: GhgSeriesTable): Map<string, string> {
  const map = new Map<string, string>();
  const extra: Record<string, string> = {
    INJECTION_PRESSURE: "WHP_WELL_A_bar",
    WATER_FLOW_RATE: "WATER_FLOW_m3h",
    CO2_TOTALIZER: "CO2_TOTAL_SENSOR_m3",
    TEMPERATURE: "TEMP_SURF_01_degC",
  };
  for (const entity of table.entities) {
    map.set(entity.key, entity.key);
    map.set(entity.header, entity.key);
    map.set(entity.key.toLowerCase(), entity.key);
    map.set(entity.header.toLowerCase(), entity.key);
  }
  for (const [alias, canonical] of Object.entries(extra)) {
    const hit = map.get(canonical);
    if (hit) {
      map.set(alias, hit);
      map.set(alias.toLowerCase(), hit);
    }
  }
  return map;
}

function resolveEntityKeys(
  keys: Map<string, string>,
  candidates: string[],
): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const hit =
      keys.get(candidate) ??
      keys.get(candidate.toLowerCase()) ??
      keys.get(candidate.replaceAll(" ", "_"));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function severityRank(severity: string): number {
  const key = severity.toLowerCase();
  if (key === "critical") return 3;
  if (key === "high") return 2;
  if (key === "medium") return 1;
  return 0;
}

function worseSeverity(a: string, b: string): string {
  return severityRank(a) >= severityRank(b) ? a : b;
}

function coerceRows(
  raw: unknown[] | undefined,
  length: number,
): number[] {
  const out: number[] = [];
  for (const item of raw ?? []) {
    const n = typeof item === "number" ? item : Number(item);
    if (Number.isInteger(n) && n >= 0 && n < length) out.push(n);
  }
  return out;
}

function constantKeySet(table: GhgSeriesTable): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of table.constants) {
    map.set(row.header, row.header);
    map.set(row.header.toLowerCase(), row.header);
    map.set(row.header.replaceAll(" ", "_"), row.header);
  }
  return map;
}

function resolveConstantHeader(
  keys: Map<string, string>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const hit =
      keys.get(candidate) ??
      keys.get(candidate.toLowerCase()) ??
      keys.get(candidate.replaceAll(" ", "_"));
    if (hit) return hit;
  }
  return null;
}

function timeAt(table: GhgSeriesTable, rowIndex: number): number | null {
  return table.times[rowIndex] ?? null;
}

function valueAt(
  table: GhgSeriesTable,
  entityKey: string,
  rowIndex: number,
): number | null {
  const entity = table.entities.find((row) => row.key === entityKey);
  if (!entity) return null;
  return entity.values[rowIndex] ?? null;
}

export function peakRow(
  table: GhgSeriesTable,
  entityKey: string,
  mode: "max" | "min",
): number | null {
  const entity = table.entities.find((row) => row.key === entityKey);
  if (!entity) return null;
  let bestIndex: number | null = null;
  let bestValue = mode === "max" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (let i = 0; i < entity.values.length; i += 1) {
    const value = entity.values[i];
    if (value == null) continue;
    if (
      bestIndex == null ||
      (mode === "max" ? value > bestValue : value < bestValue)
    ) {
      bestIndex = i;
      bestValue = value;
    }
  }
  return bestIndex;
}

function outlierEntityKeys(table: GhgSeriesTable, rowIndexes: number[]): string[] {
  if (rowIndexes.length === 0) return [];
  let bestKey = "";
  let bestScore = -1;
  for (const entity of table.entities) {
    const span = entity.max - entity.min || 1;
    const mid = (entity.max + entity.min) / 2;
    for (const index of rowIndexes) {
      const value = entity.values[index];
      if (value == null) continue;
      const score = Math.abs(value - mid) / span;
      if (score > bestScore) {
        bestScore = score;
        bestKey = entity.key;
      }
    }
  }
  return bestKey ? [bestKey] : [];
}

export function dqaFindings(
  table: GhgSeriesTable,
  violations: DqaViolationHit[] | undefined,
): QualityFinding[] {
  const seriesKeys = entityKeySet(table);
  const factorKeys = constantKeySet(table);
  const out: QualityFinding[] = [];
  const factors = new Map<
    string,
    { titles: string[]; rules: string[]; severity: string; value: number; reasons: string[] }
  >();

  for (const violation of violations ?? []) {
    const candidates = fieldsFromAffected(violation.affected_field);
    const rows = coerceRows(violation.affected_rows, table.rows.length);
    const factorHeader = resolveConstantHeader(factorKeys, candidates);
    if (factorHeader) {
      const constant = table.constants.find((row) => row.header === factorHeader);
      const current = factors.get(factorHeader) ?? {
        titles: [],
        rules: [],
        severity: violation.severity,
        value: constant?.value ?? 0,
        reasons: [],
      };
      const title = violation.rule_name || violation.rule_id;
      if (!current.titles.includes(title)) current.titles.push(title);
      if (!current.rules.includes(violation.rule_id)) {
        current.rules.push(violation.rule_id);
        current.reasons.push(
          explainDqaRule(violation.rule_id, {
            label: constant?.label ?? factorHeader,
            value: constant?.value ?? null,
            detail: violation.violation_detail,
          }),
        );
      }
      current.severity = worseSeverity(current.severity, violation.severity);
      factors.set(factorHeader, current);
      continue;
    }

    const mapped = resolveEntityKeys(seriesKeys, candidates);
    const fields =
      mapped.length > 0
        ? mapped
        : candidates.length === 0
          ? outlierEntityKeys(table, rows)
          : [];
    if (fields.length === 0) {
      out.push({
        id: `dqa:unmapped:${violation.id}`,
        groupId: `dqa:unmapped:${violation.rule_id}:${violation.affected_field ?? "field"}`,
        kind: "dqa",
        scope: "unmapped",
        entityKeys: [],
        rowIndex: null,
        timeMs: null,
        value: null,
        severity: violation.severity,
        title: violation.rule_name || violation.rule_id,
        message: `${violation.rule_id} · ${violation.affected_field ?? "no field"}`,
        reason: explainDqaRule(violation.rule_id, {
          label: violation.affected_field ?? undefined,
          detail: violation.violation_detail,
        }),
        ruleId: violation.rule_id,
        dimension: violation.dimension,
        editable: false,
      });
      continue;
    }
    const targets =
      rows.length > 0
        ? rows.slice(0, 80)
        : fields[0]
          ? [peakRow(table, fields[0], "max")]
          : [];
    for (const rowIndex of targets) {
      if (rowIndex == null) continue;
      const entityKey = fields[0];
      const entity = table.entities.find((row) => row.key === entityKey);
      const sampleValue = valueAt(table, entityKey, rowIndex);
      out.push({
        id: `dqa:${violation.id}:${rowIndex}`,
        groupId: `dqa:${violation.rule_id}:${violation.affected_field ?? "field"}:${rowIndex}`,
        kind: "dqa",
        scope: "sample",
        entityKeys: fields,
        rowIndex,
        timeMs: timeAt(table, rowIndex),
        value: sampleValue,
        severity: violation.severity,
        title: violation.rule_name || violation.rule_id,
        message: `${violation.rule_id} · ${violation.affected_field ?? "field"}`,
        reason: explainDqaRule(violation.rule_id, {
          label: entity?.label ?? entityKey,
          value: sampleValue,
          detail: violation.violation_detail,
        }),
        ruleId: violation.rule_id,
        dimension: violation.dimension,
        editable: true,
      });
    }
  }

  for (const [header, acc] of factors) {
    const constant = table.constants.find((row) => row.header === header);
    out.push({
      id: `dqa:factor:${header}`,
      groupId: `dqa:factor:${header}`,
      kind: "dqa",
      scope: "factor",
      entityKeys: [header],
      rowIndex: null,
      timeMs: null,
      value: constant?.value ?? acc.value,
      severity: acc.severity,
      title: constant?.label ?? header,
      message: `${acc.rules.join(", ")} · period factor`,
      reason: acc.reasons.join(" "),
      ruleId: acc.rules[0],
      dimension: "Accuracy",
      editable: true,
    });
  }
  return out;
}

function familyOf(hit: AnomalyHit, view: AnomalyView): boolean {
  return hit.models?.[view]?.status === "Anomaly";
}

export function anomalyFindings(
  table: GhgSeriesTable,
  hits: AnomalyHit[] | undefined,
): QualityFinding[] {
  const keys = entityKeySet(table);
  const out: QualityFinding[] = [];
  for (const [index, hit] of (hits ?? []).entries()) {
    const mapped = resolveEntityKeys(keys, hit.parameter ? [hit.parameter] : []);
    const fields =
      mapped.length > 0
        ? mapped
        : outlierEntityKeys(
            table,
            hit.row_index != null ? [hit.row_index] : [],
          );
    let rowIndex: number | null =
      hit.row_index != null && hit.row_index >= 0 && hit.row_index < table.rows.length
        ? hit.row_index
        : null;
    if (rowIndex == null && hit.timestamp) {
      const parsed = Date.parse(
        hit.timestamp.includes("T")
          ? hit.timestamp
          : `${hit.timestamp.replace(" ", "T")}Z`,
      );
      const found = table.times.findIndex(
        (ms) => ms != null && Number.isFinite(parsed) && Math.abs(ms - parsed) < 1000,
      );
      rowIndex = found >= 0 ? found : null;
    }
    if (rowIndex == null && fields[0]) rowIndex = peakRow(table, fields[0], "max");
    if (rowIndex == null || fields.length === 0) continue;
    const families = (["heuristic", "statistical", "ml"] as const).filter((view) =>
      familyOf(hit, view),
    );
    const label =
      table.entities.find((row) => row.key === fields[0])?.label ?? fields[0];
    out.push({
      id: `anomaly:${hit.parameter ?? "p"}:${rowIndex}:${index}`,
      groupId: `anomaly:${hit.parameter ?? "p"}:${rowIndex}`,
      kind: "anomaly",
      scope: "sample",
      entityKeys: fields,
      rowIndex,
      timeMs: timeAt(table, rowIndex),
      value: hit.value ?? valueAt(table, fields[0], rowIndex),
      severity: hit.severity ?? "medium",
      title: hit.parameter ?? "Anomaly",
      message: `${hit.alarm_type ?? "Anomaly"} · ${hit.votes ?? 0} model votes`,
      reason: explainAnomaly(hit, label),
      ruleId: hit.alarm_type ?? "anomaly",
      dimension: families[0],
      editable: true,
      alarmType: hit.alarm_type,
      family: families[0],
      confidence: hit.ensemble_confidence,
    });
  }
  return out;
}

const REGISTRY_SERIES: Record<string, { keys: string[]; mode: "max" | "min" }> = {
  whp_well_a_bar: { keys: ["WHP_WELL_A_bar"], mode: "max" },
  whp_well_b_bar: { keys: ["WHP_WELL_B_bar"], mode: "max" },
  annulus_press_bar: { keys: ["ANNULUS_PRESS_bar"], mode: "max" },
  cumulative_mass: { keys: ["CO2_TOTAL_SENSOR_m3"], mode: "max" },
  water_co2_ratio: { keys: ["WATER_CO2_RATIO", "WATER_FLOW_m3h"], mode: "min" },
};

export function registryFindings(
  table: GhgSeriesTable,
  checks: RegistryCheck[] | undefined,
): QualityFinding[] {
  const keys = entityKeySet(table);
  const out: QualityFinding[] = [];
  for (const check of checks ?? []) {
    if (check.passed) continue;
    const spec = REGISTRY_SERIES[check.id];
    const fields = resolveEntityKeys(keys, spec?.keys ?? []);
    const rowIndex = fields[0] ? peakRow(table, fields[0], spec?.mode ?? "max") : null;
    if (rowIndex == null || fields.length === 0) continue;
    const sampleValue = valueAt(table, fields[0], rowIndex);
    out.push({
      id: `registry:${check.id}:${rowIndex}`,
      groupId: `registry:${check.id}:${rowIndex}`,
      kind: "registry",
      scope: "sample",
      entityKeys: fields,
      rowIndex,
      timeMs: timeAt(table, rowIndex),
      value: sampleValue,
      severity: "high",
      title: check.label,
      message: check.detail,
      reason: explainRegistry(check.label, check.detail, sampleValue),
      ruleId: check.id,
      dimension: "registry",
      editable: true,
    });
  }
  return out;
}

export function findingsForStep(
  step: QualityStep,
  table: GhgSeriesTable,
  pipeline: PipelineResult | undefined,
): QualityFinding[] {
  if (step === 1) return dqaFindings(table, pipeline?.dqaViolations);
  if (step === 2) return anomalyFindings(table, pipeline?.anomalies);
  return registryFindings(table, pipeline?.registryChecks);
}

export function findingIdentity(findings: QualityFinding[]): string {
  return findings
    .map((row) => `${row.groupId}:${row.severity}`)
    .sort()
    .join("|");
}

export function isFindingResolved(
  finding: QualityFinding,
  resolutions: Record<string, ResolutionMode>,
  editedCells: Set<string>,
): boolean {
  if (resolutions[finding.groupId]) return true;
  if (finding.scope === "factor") {
    return finding.entityKeys.some((key) => editedCells.has(`${key}:-1`));
  }
  if (finding.rowIndex == null) return false;
  return finding.entityKeys.some((key) =>
    editedCells.has(`${key}:${finding.rowIndex}`),
  );
}

export function findingsByScope(
  findings: QualityFinding[],
  scope: FindingScope,
): QualityFinding[] {
  return findings.filter((row) => (row.scope ?? "sample") === scope);
}
