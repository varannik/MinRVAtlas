/**
 * Map operator / MinRV / Fujairah column names onto the tags CO2_RULES
 * and anomaly DEFAULT_THRESHOLDS already know.
 *
 * Canonical DQA names stay as in Data Sentinel `CO2_RULES`. Anomaly keys are
 * added as extra columns when the units are compatible — never copy m³/h
 * injection rate onto `CO2_FLOW_RATE` (kg/hr).
 */

export const DQA_CANONICAL = [
  "timestamp_utc",
  "operational_state",
  "batch_id",
  "WHP_WELL_A_bar",
  "WHP_WELL_B_bar",
  "ANNULUS_PRESS_bar",
  "INJ_RATE_FT01_m3h",
  "INJ_RATE_FT02_m3h",
  "CO2_TOTAL_SENSOR_m3",
  "CO2_TOTAL_CALC_m3",
  "TEMP_SURF_01_degC",
  "TEMP_SURF_02_degC",
  "CO2_TRACER_01_ppm",
  "WATER_FLOW_m3h",
  "ENERGY_PER_TONNE_kWht",
  "INGESTION_LATENCY_sec",
] as const;

const EXACT_ALIAS: Record<string, string> = {
  TIMESTAMP_UTC: "timestamp_utc",
  TIMESTAMP: "timestamp_utc",
  TIME: "timestamp_utc",
  TIME_UTC: "timestamp_utc",
  DATETIME: "timestamp_utc",
  DATE_TIME: "timestamp_utc",
  OPERATIONAL_STATE: "operational_state",
  OP_STATE: "operational_state",
  STATE: "operational_state",
  WHP_WELL_A_BAR: "WHP_WELL_A_bar",
  WHP_WELL_A: "WHP_WELL_A_bar",
  WHP_A: "WHP_WELL_A_bar",
  WHP: "WHP_WELL_A_bar",
  WELLHEAD_PRESSURE: "WHP_WELL_A_bar",
  WELLHEAD_PRESSURE_A: "WHP_WELL_A_bar",
  INJECTION_PRESSURE: "WHP_WELL_A_bar",
  WHP_WELL_B_BAR: "WHP_WELL_B_bar",
  WHP_WELL_B: "WHP_WELL_B_bar",
  WHP_B: "WHP_WELL_B_bar",
  WELLHEAD_PRESSURE_B: "WHP_WELL_B_bar",
  ANNULUS_PRESS_BAR: "ANNULUS_PRESS_bar",
  ANNULUS_PRESS: "ANNULUS_PRESS_bar",
  ANNULUS_PRESSURE: "ANNULUS_PRESS_bar",
  ANNULUS: "ANNULUS_PRESS_bar",
  INJ_RATE_FT01_M3H: "INJ_RATE_FT01_m3h",
  INJ_RATE_FT01: "INJ_RATE_FT01_m3h",
  INJ_RATE: "INJ_RATE_FT01_m3h",
  INJECTION_RATE: "INJ_RATE_FT01_m3h",
  CO2_FLOW: "INJ_RATE_FT01_m3h",
  FLOW_RATE: "INJ_RATE_FT01_m3h",
  INJ_RATE_FT02_M3H: "INJ_RATE_FT02_m3h",
  INJ_RATE_FT02: "INJ_RATE_FT02_m3h",
  INJ_RATE_2: "INJ_RATE_FT02_m3h",
  CO2_TOTAL_SENSOR_M3: "CO2_TOTAL_SENSOR_m3",
  CO2_TOTAL_SENSOR: "CO2_TOTAL_SENSOR_m3",
  CO2_TOTAL: "CO2_TOTAL_SENSOR_m3",
  CO2_TOTALIZER: "CO2_TOTAL_SENSOR_m3",
  CO2_TOTAL_CALC_M3: "CO2_TOTAL_CALC_m3",
  CO2_TOTAL_CALC: "CO2_TOTAL_CALC_m3",
  TEMP_SURF_01_DEGC: "TEMP_SURF_01_degC",
  TEMP_SURF_01: "TEMP_SURF_01_degC",
  TEMP_SURF: "TEMP_SURF_01_degC",
  TEMP_SURF_02_DEGC: "TEMP_SURF_02_degC",
  TEMP_SURF_02: "TEMP_SURF_02_degC",
  CO2_TRACER_01_PPM: "CO2_TRACER_01_ppm",
  CO2_TRACER: "CO2_TRACER_01_ppm",
  WATER_FLOW_M3H: "WATER_FLOW_m3h",
  WATER_FLOW: "WATER_FLOW_m3h",
  WATER_FLOW_RATE: "WATER_FLOW_m3h",
  ENERGY_PER_TONNE_KWHT: "ENERGY_PER_TONNE_kWht",
  INGESTION_LATENCY_SEC: "INGESTION_LATENCY_sec",
  BATCH_ID: "batch_id",
};

export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

export function canonicalFromHeader(header: string): string | null {
  const key = normalizeHeader(header);
  if (EXACT_ALIAS[key]) return EXACT_ALIAS[key];

  if (key.startsWith("WHP")) {
    return key.includes("B") && !key.includes("A")
      ? "WHP_WELL_B_bar"
      : "WHP_WELL_A_bar";
  }
  if (key.startsWith("ANNULUS")) return "ANNULUS_PRESS_bar";
  if (key.startsWith("INJ_RATE") || key.startsWith("INJECTION_RATE")) {
    return key.includes("FT02") || key.endsWith("_2") || key.includes("B")
      ? "INJ_RATE_FT02_m3h"
      : "INJ_RATE_FT01_m3h";
  }
  if (key.startsWith("CO2_TOTAL")) {
    return key.includes("CALC") ? "CO2_TOTAL_CALC_m3" : "CO2_TOTAL_SENSOR_m3";
  }
  if (key.startsWith("WATER_FLOW") || key === "WATER") return "WATER_FLOW_m3h";
  if (key.startsWith("TEMP")) {
    return key.includes("02") || key.includes("B")
      ? "TEMP_SURF_02_degC"
      : "TEMP_SURF_01_degC";
  }
  if (key === "TIMESTAMP_UTC" || key === "OPERATIONAL_STATE" || key === "BATCH_ID") {
    return key === "TIMESTAMP_UTC"
      ? "timestamp_utc"
      : key === "OPERATIONAL_STATE"
        ? "operational_state"
        : "batch_id";
  }
  return null;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export type ColumnMapResult = {
  csv: string;
  mapped: Record<string, string>;
  added: string[];
};

function isCsvName(name: string): boolean {
  return name.toLowerCase().endsWith(".csv");
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header === name);
}

function numeric(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rewrite a CSV so DQA `CO2_RULES` and compatible anomaly thresholds fire.
 * Non-CSV files are left untouched (returns null).
 */
export function remapCsv(filename: string, text: string): ColumnMapResult | null {
  if (!isCsvName(filename)) return null;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length === 0 || !lines[0]?.trim()) {
    return { csv: text, mapped: {}, added: [] };
  }

  const original = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const headers = [...original];
  const mapped: Record<string, string> = {};
  const claimed = new Set<string>();

  for (let i = 0; i < original.length; i += 1) {
    const canonical = canonicalFromHeader(original[i]);
    if (!canonical) continue;
    if (original[i] === canonical) {
      claimed.add(canonical);
      continue;
    }
    if (claimed.has(canonical)) continue;
    headers[i] = canonical;
    mapped[canonical] = original[i];
    claimed.add(canonical);
  }

  const added: string[] = [];
  function ensureCopy(canonical: string, sourceName: string) {
    if (columnIndex(headers, canonical) >= 0) return;
    const from = columnIndex(headers, sourceName);
    if (from < 0) return;
    headers.push(canonical);
    added.push(canonical);
    mapped[canonical] ??= original[from] ?? sourceName;
  }

  ensureCopy("INJECTION_PRESSURE", "WHP_WELL_A_bar");
  ensureCopy("WATER_FLOW_RATE", "WATER_FLOW_m3h");
  ensureCopy("CO2_TOTALIZER", "CO2_TOTAL_SENSOR_m3");
  ensureCopy("TEMPERATURE", "TEMP_SURF_01_degC");

  const wantRatio = columnIndex(headers, "WATER_CO2_RATIO") < 0;
  const waterIdx = columnIndex(headers, "WATER_FLOW_m3h");
  const co2Idx = columnIndex(headers, "INJ_RATE_FT01_m3h");
  if (wantRatio && waterIdx >= 0 && co2Idx >= 0) {
    headers.push("WATER_CO2_RATIO");
    added.push("WATER_CO2_RATIO");
  }

  const wantState = columnIndex(headers, "operational_state") < 0;
  if (wantState) {
    headers.push("operational_state");
    added.push("operational_state");
  }

  const rows = [headers.map(csvEscape).join(",")];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const next = headers.map((header, index) => {
      if (index < original.length) {
        return csvEscape(cells[index] ?? "");
      }
      if (header === "operational_state") return "active_injection";
      if (header === "WATER_CO2_RATIO") {
        const water = numeric(cells[waterIdx] ?? "");
        const co2 = numeric(cells[co2Idx] ?? "");
        if (water == null || co2 == null || co2 === 0) return "";
        return csvEscape(String(Number((water / co2).toFixed(4))));
      }
      const source =
        header === "INJECTION_PRESSURE"
          ? "WHP_WELL_A_bar"
          : header === "WATER_FLOW_RATE"
            ? "WATER_FLOW_m3h"
            : header === "CO2_TOTALIZER"
              ? "CO2_TOTAL_SENSOR_m3"
              : header === "TEMPERATURE"
                ? "TEMP_SURF_01_degC"
                : null;
      if (!source) return "";
      const from = columnIndex(headers.slice(0, original.length), source);
      const fallback = original.findIndex((_, i) => headers[i] === source);
      const idx = from >= 0 ? from : fallback;
      return csvEscape(cells[idx] ?? "");
    });
    rows.push(next.join(","));
  }

  return { csv: `${rows.join("\n")}\n`, mapped, added };
}
