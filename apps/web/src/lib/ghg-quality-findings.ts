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

export type QualityFinding = {
  id: string;
  groupId: string;
  kind: FindingKind;
  entityKeys: string[];
  rowIndex: number | null;
  timeMs: number | null;
  value: number | null;
  severity: string;
  title: string;
  message: string;
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
  const keys = entityKeySet(table);
  const out: QualityFinding[] = [];
  for (const violation of violations ?? []) {
    const rows = (violation.affected_rows ?? []).filter(
      (index) => Number.isInteger(index) && index >= 0 && index < table.rows.length,
    );
    const mapped = resolveEntityKeys(keys, fieldsFromAffected(violation.affected_field));
    const fields = mapped.length > 0 ? mapped : outlierEntityKeys(table, rows);
    const targets =
      rows.length > 0
        ? rows.slice(0, 80)
        : fields[0]
          ? [peakRow(table, fields[0], "max")]
          : [];
    for (const rowIndex of targets) {
      if (rowIndex == null || fields.length === 0) continue;
      const entityKey = fields[0];
      out.push({
        id: `dqa:${violation.id}:${rowIndex}`,
        groupId: `dqa:${violation.rule_id}:${violation.affected_field ?? "field"}:${rowIndex}`,
        kind: "dqa",
        entityKeys: fields,
        rowIndex,
        timeMs: timeAt(table, rowIndex),
        value: valueAt(table, entityKey, rowIndex),
        severity: violation.severity,
        title: violation.rule_name || violation.rule_id,
        message: `${violation.rule_id} · ${violation.affected_field ?? "field"}`,
        editable: true,
      });
    }
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
    out.push({
      id: `anomaly:${hit.parameter ?? "p"}:${rowIndex}:${index}`,
      groupId: `anomaly:${hit.parameter ?? "p"}:${rowIndex}`,
      kind: "anomaly",
      entityKeys: fields,
      rowIndex,
      timeMs: timeAt(table, rowIndex),
      value: hit.value ?? valueAt(table, fields[0], rowIndex),
      severity: hit.severity ?? "medium",
      title: hit.parameter ?? "Anomaly",
      message: `${hit.alarm_type ?? "Anomaly"} · ${hit.votes ?? 0} model votes`,
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
    out.push({
      id: `registry:${check.id}:${rowIndex}`,
      groupId: `registry:${check.id}:${rowIndex}`,
      kind: "registry",
      entityKeys: fields,
      rowIndex,
      timeMs: timeAt(table, rowIndex),
      value: valueAt(table, fields[0], rowIndex),
      severity: "high",
      title: check.label,
      message: check.detail,
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
  if (finding.rowIndex == null) return false;
  return finding.entityKeys.some((key) =>
    editedCells.has(`${key}:${finding.rowIndex}`),
  );
}
