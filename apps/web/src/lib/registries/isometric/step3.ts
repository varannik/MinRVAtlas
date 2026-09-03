/**
 * Step-3 registry rules for Isometric in-situ mineralisation.
 *
 * Lives next to the adapter, not in Sentinel’s Puro stub. Thresholds are the
 * methodology defaults for Fujairah until a permit override is supplied on
 * the CSV (`MASIP_bar`).
 *
 * In-Situ Mineralization v1.0 §3.1.1:
 *   - wellhead / annulus pressure held below MASIP
 *   - bubble point recalculated at least monthly; reservoir pressure stays
 *     more than 5 bar above it
 *   - CO₂-to-water ratio proving full dissolution
 *   - cadences per monitoring parameter
 */

import {
  normalizeHeader,
  splitCsvLine,
} from "@/lib/sentinel/column-map";
import type { ItemKind } from "@/lib/types";

export const INSITU_THRESHOLDS = {
  /** Permit MASIP default (bar). Below DQA physical max (300) so Step-3 can fail a quality-clean pack. */
  masipBar: 150,
  bubblePointMarginBar: 5,
  /** Minimum water / injectate volume ratio at surface meters for aqueous dissolution. */
  minWaterToInjectate: 0.35,
  continuousMaxGapMinutes: 15,
} as const;

export type Step3Check = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type Step3Evaluation = {
  status: "passed" | "failed" | "skipped";
  detail: string;
  checks: Step3Check[];
};

export type InsituStep3Input = {
  slotId: string;
  kind: ItemKind;
  csvText: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  cadence?: string | null;
};

type Frame = {
  headers: string[];
  rows: string[][];
};

const STEP3_ALIAS: Record<string, string> = {
  MASIP: "MASIP_bar",
  MASIP_BAR: "MASIP_bar",
  BUBBLE_POINT: "BUBBLE_POINT_bar",
  BUBBLE_POINT_BAR: "BUBBLE_POINT_bar",
  P_BUBBLE: "BUBBLE_POINT_bar",
  PBUBBLE: "BUBBLE_POINT_bar",
  RESERVOIR_PRESSURE: "RESERVOIR_PRESSURE_bar",
  RESERVOIR_PRESSURE_BAR: "RESERVOIR_PRESSURE_bar",
  P_RES: "RESERVOIR_PRESSURE_bar",
  P_RESERVOIR: "RESERVOIR_PRESSURE_bar",
  WATER_CO2_RATIO: "WATER_CO2_RATIO",
  PH: "pH",
};

const DEFAULT_CADENCE: Record<string, string> = {
  "injection-pressure": "continuous",
  "stream-flow": "continuous",
  "bubble-point": "monthly",
  "injectate-composition": "periodic",
  "injected-volume": "annual",
  "internal-integrity": "semiannual",
  "external-integrity": "annual",
  "near-surface": "continuous",
  usdw: "periodic",
  "reservoir-model": "every-5-years",
  seismicity: "continuous",
};

function itemKey(slotId: string): string {
  const parts = slotId.split(".");
  return parts[parts.length - 1] ?? slotId;
}

function parseFrame(csvText: string): Frame {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const rawHeaders = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const headers = rawHeaders.map((header) => {
    const alias = STEP3_ALIAS[normalizeHeader(header)];
    return alias ?? header;
  });
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { headers, rows };
}

function col(headers: string[], name: string): number {
  const exact = headers.findIndex((header) => header === name);
  if (exact >= 0) return exact;
  const want = normalizeHeader(name);
  return headers.findIndex((header) => normalizeHeader(header) === want);
}

function numeric(rows: string[][], index: number): number[] {
  if (index < 0) return [];
  const out: number[] = [];
  for (const row of rows) {
    const n = Number((row[index] ?? "").trim());
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function parseTime(value: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : null;
}

function monthKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsInPeriod(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
  const cursor = new Date(from);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(to);
  last.setUTCDate(1);
  const keys: string[] = [];
  while (cursor.getTime() <= last.getTime()) {
    keys.push(monthKey(cursor.getTime()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function check(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
): Step3Check {
  return { id, label, passed, detail };
}

function masipLimit(frame: Frame): number {
  const values = numeric(frame.rows, col(frame.headers, "MASIP_bar"));
  if (values.length === 0) return INSITU_THRESHOLDS.masipBar;
  return Math.min(...values);
}

function activeMask(frame: Frame): boolean[] {
  const stateIdx = col(frame.headers, "operational_state");
  if (stateIdx < 0) return frame.rows.map(() => true);
  return frame.rows.map((row) => {
    const state = cell(row, stateIdx).toLowerCase();
    return !state || state.includes("inject") || state === "active_injection";
  });
}

function pressureCheck(frame: Frame, column: string, label: string, limit: number): Step3Check {
  const idx = col(frame.headers, column);
  if (idx < 0) {
    return check(
      column.toLowerCase(),
      label,
      false,
      `Missing ${column} — cannot test MASIP (${limit} bar)`,
    );
  }
  const mask = activeMask(frame);
  const values: number[] = [];
  frame.rows.forEach((row, i) => {
    if (!mask[i]) return;
    const n = Number(cell(row, idx));
    if (Number.isFinite(n)) values.push(n);
  });
  if (values.length === 0) {
    return check(
      column.toLowerCase(),
      label,
      false,
      `No active-injection rows for ${column}`,
    );
  }
  const max = Math.max(...values);
  return check(
    column.toLowerCase(),
    label,
    max <= limit,
    `max ${column} ${max.toFixed(2)} bar vs MASIP ${limit} bar`,
  );
}

function ratioCheck(frame: Frame): Step3Check {
  const ratioIdx = col(frame.headers, "WATER_CO2_RATIO");
  const waterIdx = col(frame.headers, "WATER_FLOW_m3h");
  const injIdx = col(frame.headers, "INJ_RATE_FT01_m3h");
  const min = INSITU_THRESHOLDS.minWaterToInjectate;
  const ratios: number[] = [];

  if (ratioIdx >= 0) {
    ratios.push(...numeric(frame.rows, ratioIdx).filter((n) => n > 0));
  } else if (waterIdx >= 0 && injIdx >= 0) {
    for (const row of frame.rows) {
      const water = Number(cell(row, waterIdx));
      const inj = Number(cell(row, injIdx));
      if (Number.isFinite(water) && Number.isFinite(inj) && inj > 0) {
        ratios.push(water / inj);
      }
    }
  } else {
    return check(
      "co2_water_ratio",
      "CO₂-water ratio",
      false,
      "Need WATER_FLOW_m3h and INJ_RATE_FT01_m3h (or WATER_CO2_RATIO)",
    );
  }

  if (ratios.length === 0) {
    return check("co2_water_ratio", "CO₂-water ratio", false, "No usable flow pairs");
  }
  const observed = Math.min(...ratios);
  return check(
    "co2_water_ratio",
    "CO₂-water ratio",
    observed >= min,
    `min water/injectate ${observed.toFixed(3)} vs ≥ ${min} for full dissolution`,
  );
}

function bubblePointCheck(frame: Frame): Step3Check {
  const bubbleIdx = col(frame.headers, "BUBBLE_POINT_bar");
  const resIdx = col(frame.headers, "RESERVOIR_PRESSURE_bar");
  const margin = INSITU_THRESHOLDS.bubblePointMarginBar;
  if (bubbleIdx < 0 || resIdx < 0) {
    return check(
      "bubble_point",
      "Bubble-point margin",
      false,
      `Need BUBBLE_POINT_bar and RESERVOIR_PRESSURE_bar; reservoir must stay > ${margin} bar above bubble point`,
    );
  }
  let worst = Infinity;
  let n = 0;
  for (const row of frame.rows) {
    const bubble = Number(cell(row, bubbleIdx));
    const res = Number(cell(row, resIdx));
    if (!Number.isFinite(bubble) || !Number.isFinite(res)) continue;
    n += 1;
    worst = Math.min(worst, res - bubble);
  }
  if (n === 0) {
    return check("bubble_point", "Bubble-point margin", false, "No numeric bubble-point pairs");
  }
  return check(
    "bubble_point",
    "Bubble-point margin",
    worst > margin,
    `min (P_res − P_bubble) ${worst.toFixed(2)} bar vs > ${margin} bar`,
  );
}

function timestamps(frame: Frame): number[] {
  const idx = col(frame.headers, "timestamp_utc");
  if (idx < 0) return [];
  return frame.rows
    .map((row) => parseTime(cell(row, idx)))
    .filter((ms): ms is number => ms != null)
    .sort((a, b) => a - b);
}

function cadenceCheck(
  frame: Frame,
  cadence: string | null | undefined,
  periodStart?: string | null,
  periodEnd?: string | null,
): Step3Check | null {
  const required = (cadence ?? "continuous").toLowerCase();
  const times = timestamps(frame);

  if (required === "continuous") {
    if (times.length < 2) {
      return check("cadence", "Continuous cadence", false, "Need at least two timestamps");
    }
    let maxGap = 0;
    for (let i = 1; i < times.length; i += 1) {
      maxGap = Math.max(maxGap, times[i] - times[i - 1]);
    }
    const minutes = maxGap / 60_000;
    const limit = INSITU_THRESHOLDS.continuousMaxGapMinutes;
    return check(
      "cadence",
      "Continuous cadence",
      minutes <= limit,
      `max gap ${minutes.toFixed(1)} min vs ≤ ${limit} min`,
    );
  }

  if (required === "monthly") {
    const start = periodStart ?? "";
    const end = periodEnd ?? "";
    const needed = start && end ? monthsInPeriod(start, end) : [];
    const seen = new Set(times.map(monthKey));
    if (needed.length === 0) {
      const unique = seen.size;
      return check(
        "cadence",
        "Monthly cadence",
        unique >= 1 && times.length > 0,
        unique >= 1
          ? `${unique} calendar month(s) in file; batch period unknown`
          : "No timestamps for monthly bubble-point",
      );
    }
    const missing = needed.filter((month) => !seen.has(month));
    return check(
      "cadence",
      "Monthly cadence",
      missing.length === 0,
      missing.length === 0
        ? `bubble point present in all ${needed.length} months of the period`
        : `missing ${missing.length}/${needed.length} months (e.g. ${missing.slice(0, 3).join(", ")})`,
    );
  }

  if (required === "annual") {
    if (times.length === 0) {
      return check("cadence", "Annual cadence", false, "No timestamps");
    }
    if (!periodStart || !periodEnd) {
      return check("cadence", "Annual cadence", true, "At least one sample; batch period unknown");
    }
    const from = Date.parse(`${periodStart}T00:00:00Z`);
    const to = Date.parse(`${periodEnd}T23:59:59Z`);
    const inPeriod = times.filter((ms) => ms >= from && ms <= to).length;
    return check(
      "cadence",
      "Annual cadence",
      inPeriod > 0,
      inPeriod > 0
        ? `${inPeriod} sample(s) inside ${periodStart} – ${periodEnd}`
        : `no samples inside ${periodStart} – ${periodEnd}`,
    );
  }

  if (required === "periodic" || required === "per-batch") {
    return check(
      "cadence",
      "Periodic cadence",
      times.length > 0 || frame.rows.length > 0,
      times.length > 0 || frame.rows.length > 0
        ? `${Math.max(times.length, frame.rows.length)} sample(s)`
        : "No samples in this drop",
    );
  }

  if (required === "semiannual" || required === "biennial" || required === "every-5-years") {
    return check(
      "cadence",
      `${required} cadence`,
      true,
      "Document-side interval; not scored from this CSV",
    );
  }

  return null;
}

function compositionCheck(frame: Frame): Step3Check {
  const names = ["pH", "PH", "CO2_CONC", "DENSITY", "MAJOR_IONS"];
  const found = names.filter((name) => col(frame.headers, name) >= 0);
  return check(
    "composition",
    "Injectate composition",
    found.length > 0,
    found.length > 0
      ? `columns ${found.join(", ")}`
      : "Need pH / concentration / density columns for injectate composition",
  );
}

function cumulativeCheck(frame: Frame): Step3Check {
  const idx = col(frame.headers, "CO2_TOTAL_SENSOR_m3");
  if (idx < 0) {
    return check(
      "cumulative_mass",
      "Cumulative injected mass",
      false,
      "Missing CO2_TOTAL_SENSOR_m3",
    );
  }
  const values = numeric(frame.rows, idx);
  if (values.length < 2) {
    return check("cumulative_mass", "Cumulative injected mass", values.length === 1, "Need a totalizer series");
  }
  let drops = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] + 1e-6 < values[i - 1]) drops += 1;
  }
  return check(
    "cumulative_mass",
    "Cumulative injected mass",
    drops === 0,
    drops === 0
      ? `totalizer ${values[0].toFixed(2)} → ${values[values.length - 1].toFixed(2)} m³`
      : `${drops} totalizer decrease(s)`,
  );
}

function summarize(checks: Step3Check[]): Step3Evaluation {
  if (checks.length === 0) {
    return { status: "skipped", detail: "No Step-3 checks for this requirement", checks };
  }
  const failed = checks.filter((entry) => !entry.passed);
  if (failed.length === 0) {
    return {
      status: "passed",
      detail: `${checks.length} methodology check(s) passed`,
      checks,
    };
  }
  return {
    status: "failed",
    detail: failed.map((entry) => entry.detail).join("; "),
    checks,
  };
}

/**
 * Run in-situ mineralisation Step-3 on one requirement’s mapped CSV.
 */
export function evaluateInsituMineralization(input: InsituStep3Input): Step3Evaluation {
  const key = itemKey(input.slotId);
  const cadenceHint = input.cadence ?? DEFAULT_CADENCE[key] ?? null;
  if (!input.csvText?.trim()) {
    if (input.kind === "document" || input.kind === "attestation") {
      return {
        status: "skipped",
        detail: "Document cadence is scored in V&V, not Step-3",
        checks: [],
      };
    }
    return {
      status: "failed",
      detail: "Upload a CSV for methodology checks",
      checks: [
        check("csv", "Tabular payload", false, "Upload a CSV for methodology checks"),
      ],
    };
  }

  const frame = parseFrame(input.csvText);
  if (frame.headers.length === 0) {
    return {
      status: "failed",
      detail: "CSV has no header row",
      checks: [check("csv", "Tabular payload", false, "CSV has no header row")],
    };
  }

  const checks: Step3Check[] = [];
  const limit = masipLimit(frame);
  const cadence = cadenceCheck(frame, cadenceHint, input.periodStart, input.periodEnd);

  switch (key) {
    case "injection-pressure":
      checks.push(pressureCheck(frame, "WHP_WELL_A_bar", "Wellhead vs MASIP", limit));
      if (col(frame.headers, "ANNULUS_PRESS_bar") >= 0) {
        checks.push(pressureCheck(frame, "ANNULUS_PRESS_bar", "Annulus vs MASIP", limit));
      }
      if (cadence) checks.push(cadence);
      break;
    case "stream-flow":
      checks.push(ratioCheck(frame));
      checks.push(
        check(
          "temperature",
          "Stream temperature",
          col(frame.headers, "TEMP_SURF_01_degC") >= 0,
          col(frame.headers, "TEMP_SURF_01_degC") >= 0
            ? "TEMP_SURF_01_degC present"
            : "Missing TEMP_SURF_01_degC",
        ),
      );
      if (cadence) checks.push(cadence);
      break;
    case "bubble-point":
      checks.push(bubblePointCheck(frame));
      if (cadence) checks.push(cadence);
      break;
    case "injected-volume":
      checks.push(ratioCheck(frame));
      checks.push(cumulativeCheck(frame));
      if (cadence) checks.push(cadence);
      break;
    case "injectate-composition":
      checks.push(compositionCheck(frame));
      if (cadence) checks.push(cadence);
      break;
    case "near-surface":
    case "seismicity":
      if (cadence) checks.push(cadence);
      else checks.push(check("cadence", "Cadence", true, "No extra methodology columns required"));
      break;
    case "usdw":
      checks.push(compositionCheck(frame));
      if (cadence) checks.push(cadence);
      break;
    default:
      if (col(frame.headers, "WHP_WELL_A_bar") >= 0) {
        checks.push(pressureCheck(frame, "WHP_WELL_A_bar", "Wellhead vs MASIP", limit));
      }
      if (
        col(frame.headers, "WATER_FLOW_m3h") >= 0 &&
        col(frame.headers, "INJ_RATE_FT01_m3h") >= 0
      ) {
        checks.push(ratioCheck(frame));
      }
      if (cadence) checks.push(cadence);
      break;
  }

  return summarize(checks);
}
